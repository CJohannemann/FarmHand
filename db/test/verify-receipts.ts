// Receipts end to end, minus the browser: the local schema and its sync
// triggers in node:sqlite, the sync engine's push/pull split, and the ZIP
// export verified against Info-ZIP's `unzip` rather than against itself.
//
// That last part is the point of this file. A hand-written ZIP that only
// ever gets read back by the same hand-written code will happily agree with
// its own mistakes; the only test worth having is whether a real
// implementation accepts it, since that is what a bookkeeper's computer
// will use.
//
//   npm run verify:receipts
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { makeZip, csvField, safeFileName } from '../../src/lib/zip.ts'
import { SYNCED_TABLES, PUSH_ONLY_TABLES, keyFor, pageFor } from '../../src/lib/syncCore.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
let fails = 0

const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))
const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const q = (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params as never[]) as never[]
const run = (sql: string, params: unknown[] = []) => db.prepare(sql).run(...params as never[])

const farm = uuid()
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`,
  [farm, 'Test farm', now(), now()])

// ------------------------------------------------------------ schema

console.log('\nA receipt attaches to the purchase it documents')
const buy = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'purchase','2026-04-12T10:00:00.000Z','Grower feed',?,?)`,
  [buy, farm, now(), now()])
run(`insert into quantity (id, farm_id, log_id, measure, value, unit, label, created_at, updated_at)
     values (?,?,?,'price',340,'USD','Co-op',?,?)`, [uuid(), farm, buy, now(), now()])

const receipt = uuid()
run(`insert into receipt (id, farm_id, log_id, captured_at, mime, byte_size, width, height, created_at, updated_at)
     values (?,?,?,?, 'image/jpeg', 204800, 1400, 1867, ?, ?)`,
  [receipt, farm, buy, now(), now(), now()])
run(`insert into receipt_blob (receipt_id, data) values (?,?)`, [receipt, 'QUJD'])
check('receipt row stored', q(`select 1 from receipt where id=?`, [receipt]).length === 1)
check('blob stored separately', q(`select 1 from receipt_blob where receipt_id=?`, [receipt]).length === 1)

console.log('\nListing receipts never drags the image bytes along')
// The guard behind receiptsForLog / receiptsForYear: the metadata query must
// be able to report that a blob exists without selecting it.
const listed = q(`select r.id, r.byte_size,
                    (select count(*) from receipt_blob b where b.receipt_id = r.id) as local
                    from receipt r where r.log_id = ? and r.deleted_at is null`, [buy]) as
  { id: string; byte_size: number; local: number }[]
check('metadata lists without selecting data', listed.length === 1 && listed[0].local === 1)
check('byte_size carried for the year view', listed[0].byte_size === 204800)

console.log('\nA year groups by the purchase date, not the photo date')
// A receipt photographed in January for a December purchase is December's
// tax year — the query dates from the log, so prove that is what happens.
const late = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'purchase','2025-12-28T10:00:00.000Z','Winter hay',?,?)`,
  [late, farm, now(), now()])
run(`insert into receipt (id, farm_id, log_id, captured_at, mime, byte_size, created_at, updated_at)
     values (?,?,?, '2026-01-04T09:00:00.000Z', 'image/jpeg', 1000, ?, ?)`,
  [uuid(), farm, late, now(), now()])
const years = q(`select distinct substr(l.timestamp,1,4) as y from receipt r
                 join log l on l.id = r.log_id
                 where r.deleted_at is null and l.deleted_at is null order by y desc`) as { y: string }[]
check('both years present', years.map((r) => r.y).join(',') === '2026,2025', years.map((r) => r.y).join(','))
const in2025 = q(`select r.id from receipt r join log l on l.id = r.log_id
                  where substr(l.timestamp,1,4) = '2025' and r.deleted_at is null`)
check('the January photo counts as 2025, by its purchase date', in2025.length === 1)

console.log('\nSoft delete, like every other record')
run(`update receipt set deleted_at = ? where id = ?`, [now(), receipt])
check('row survives, filtered out',
  q(`select 1 from receipt where id=?`, [receipt]).length === 1 &&
  q(`select 1 from receipt where id=? and deleted_at is null`, [receipt]).length === 0)

// ------------------------------------------------------------ sync wiring

console.log('\nWrites queue for push; applied pulls do not')
run(`delete from sync_outbox`)
const r2 = uuid()
run(`insert into receipt (id, farm_id, log_id, captured_at, created_at, updated_at)
     values (?,?,?,?,?,?)`, [r2, farm, buy, now(), now(), now()])
run(`insert into receipt_blob (receipt_id, data) values (?,?)`, [r2, 'WFla'])
const queued = q(`select tbl from sync_outbox order by tbl`) as { tbl: string }[]
check('both receipt and receipt_blob queued',
  queued.map((r) => r.tbl).join(',') === 'receipt,receipt_blob', queued.map((r) => r.tbl).join(','))

// A blob arriving from a lazy fetch is written with applying = 1. Without
// the WHEN guard it would queue a push straight back to the server it came
// from, forever.
run(`delete from sync_outbox`)
run(`update sync_control set applying = 1`)
const r3 = uuid()
run(`insert into receipt (id, farm_id, log_id, captured_at, created_at, updated_at)
     values (?,?,?,?,?,?)`, [r3, farm, buy, now(), now(), now()])
run(`insert into receipt_blob (receipt_id, data) values (?,?)`, [r3, 'AAAA'])
run(`update sync_control set applying = 0`)
check('a fetched blob is not queued straight back', q(`select 1 from sync_outbox`).length === 0)

console.log('\nThe push/pull split is what keeps a new device cheap')
check('receipt metadata syncs', (SYNCED_TABLES as readonly string[]).includes('receipt'))
check('receipt_blob is NOT in SYNCED_TABLES — it must never be bulk-pulled',
  !(SYNCED_TABLES as readonly string[]).includes('receipt_blob'))
check('receipt_blob is push-only', (PUSH_ONLY_TABLES as readonly string[]).includes('receipt_blob'))
check('receipt lands after log, so its foreign key resolves',
  SYNCED_TABLES.indexOf('receipt') > SYNCED_TABLES.indexOf('log'))
check('receipt_blob is keyed by receipt_id, not id', keyFor('receipt_blob').join() === 'receipt_id')
check('blobs page far smaller than ordinary rows',
  pageFor('receipt_blob') < pageFor('log') && pageFor('receipt_blob') <= 5,
  `${pageFor('receipt_blob')} vs ${pageFor('log')}`)

// ------------------------------------------------------------ csv

console.log('\nCSV fields survive a supplier with a comma in its name')
check('comma quoted', csvField("Bob's Feed, Inc.") === '"Bob\'s Feed, Inc."', csvField("Bob's Feed, Inc."))
check('embedded quotes doubled', csvField('The "Big" Co') === '"The ""Big"" Co"', csvField('The "Big" Co'))
check('newline quoted', csvField('a\nb') === '"a\nb"')
check('plain value untouched', csvField('Co-op') === 'Co-op')
check('null becomes empty', csvField(null) === '')
check('number passes through', csvField(340.5) === '340.5')

console.log("\nThe export is named after the farm, not the app")
// A bookkeeper doing several farms' books needs to know whose archive this
// is; "farmhand-receipts-2026.zip" only says which app made it.
const slug = (name: string) => `${safeFileName(name, 'farmhand')}-receipts-2026.zip`
check('an ordinary name', slug('Johannemann Homestead') === 'Johannemann-Homestead-receipts-2026.zip',
  slug('Johannemann Homestead'))
check('apostrophes and ampersands fold away',
  slug("O'Brien & Sons Farm") === 'OBrien-Sons-Farm-receipts-2026.zip', slug("O'Brien & Sons Farm"))
check('accents fold rather than vanish',
  slug('Café Farm') === 'Cafe-Farm-receipts-2026.zip', slug('Café Farm'))
check('a name that folds to nothing falls back rather than making "-receipts-"',
  slug('!!!') === 'farmhand-receipts-2026.zip', slug('!!!'))
check('a path separator cannot escape the filename',
  !slug('../../etc/passwd').includes('/'), slug('../../etc/passwd'))

// ------------------------------------------------------------ zip

console.log('\nThe export is a ZIP that real unzip accepts')
const enc = new TextEncoder()
const jpeg = new Uint8Array(9000)
for (let i = 0; i < jpeg.length; i++) jpeg[i] = (i * 31) & 0xff
const csv = enc.encode('date,supplier,item,amount,file\n2026-04-12,"Bob\'s Feed, Inc.",Grower feed,340,a.jpg\n')
const zip = makeZip([
  { name: 'index.csv', data: csv },
  { name: '2026-04-12_Co-op_340.00.jpg', data: jpeg },
  { name: safeFileName('café-naïve & co.jpg'), data: new Uint8Array([1, 2, 3, 4, 5]) },
])

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-zip-'))
const zipPath = path.join(dir, 'receipts.zip')
fs.writeFileSync(zipPath, zip)

let unzipOk = false
let listing = ''
try {
  execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' })
  listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' })
  unzipOk = true
} catch (e) {
  const err = e as { stdout?: Buffer; stderr?: Buffer; message: string }
  listing = String(err.stdout ?? '') + String(err.stderr ?? '') + err.message
}
check('unzip -t reports no errors (CRCs and headers are right)', unzipOk, unzipOk ? '' : listing.slice(0, 300))
check('all three entries listed', /index\.csv/.test(listing) && /340\.00\.jpg/.test(listing))

// Extracting and byte-comparing is the check that catches an offset that is
// wrong but self-consistent — a zip can pass `-t` and still hand back the
// wrong bytes if the local header offsets in the central directory drift.
try {
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir], { stdio: 'pipe' })
  const gotJpeg = new Uint8Array(fs.readFileSync(path.join(dir, '2026-04-12_Co-op_340.00.jpg')))
  const gotCsv = fs.readFileSync(path.join(dir, 'index.csv'))
  check('extracted JPEG is byte-identical', Buffer.compare(Buffer.from(gotJpeg), Buffer.from(jpeg)) === 0)
  check('extracted CSV is byte-identical', Buffer.compare(gotCsv, Buffer.from(csv)) === 0)
  // Info-ZIP 6.00 ignores the archive's UTF-8 flag and mangles café into
  // caf+®, so names are folded to ASCII before they ever go in. Verified
  // here by extracting with that very extractor.
  check('folded filename extracts intact on a 2009-era unzip',
    fs.existsSync(path.join(dir, 'cafe-naive-co.jpg')),
    fs.readdirSync(dir).join(', '))
} catch (e) {
  check('extraction succeeded', false, (e as Error).message.slice(0, 200))
}

// A year with no receipts yet. Checked structurally rather than with
// `unzip -t`, which treats a legitimately empty archive as a warning and
// exits non-zero — that says nothing about whether the bytes are right.
const empty = makeZip([])
const ev = new DataView(empty.buffer)
check('an empty archive is exactly one end-of-directory record', empty.length === 22, `${empty.length}`)
check('with the right signature', ev.getUint32(0, true) === 0x06054b50)
check('and zero entries', ev.getUint16(8, true) === 0 && ev.getUint32(12, true) === 0)

fs.rmSync(dir, { recursive: true, force: true })

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
