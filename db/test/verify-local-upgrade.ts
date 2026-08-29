// Upgrading an existing on-device database in place.
//
// Reported from a real phone: "no such table: receipt", and sync dead. The
// local schema only ever ran once, when the database was created, so a
// device used before receipts existed never got those tables — and the
// first query touching one killed every sync.
//
// The fix is that schema.local.sql is entirely `if not exists`, so it can be
// re-run against an older database to create what is missing. What has to be
// true, and is checked here, is that re-running it changes nothing else: not
// the farm's records, not the seeded vocabulary, not the sync bookkeeping.
//
//   npm run verify:local-upgrade
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { seedLocalVocabulary } from '../seedLocal.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const schema = fs.readFileSync(R + 'schema.local.sql', 'utf8')
const q = (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params as never[]) as never[]
const run = (sql: string, params: unknown[] = []) => db.prepare(sql).run(...params as never[])
const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const tables = () =>
  (q(`select name from sqlite_master where type='table'`) as { name: string }[])
    .map((r) => r.name)

console.log('\nBuild a database the way it looked before receipts existed')
// Everything except the receipt section — the exact shape a phone in the
// field is carrying right now.
const older = schema
  .replace(/-- -+ receipts[\s\S]*?-- -+ local sync bookkeeping/, '-- ---- local sync bookkeeping')
  .replace(/create trigger if not exists sync_receipt[\s\S]*?end;\n/g, '')
db.exec(older)
check('no receipt table, as on an existing device', !tables().includes('receipt'))
check('no receipt_blob either', !tables().includes('receipt_blob'))

await seedLocalVocabulary(async (sql, params = []) => run(sql, params as unknown[]))
const farm = uuid()
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`,
  [farm, 'Rosebud Acres', now(), now()])
const cow = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'animal','Bluebell','{"species":"Cattle"}',?,?)`, [cow, farm, now(), now()])
const log = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'purchase',?,'Bought feed',?,?)`, [log, farm, now(), now(), now()])
const termsBefore = (q(`select count(*) as n from term`) as { n: number }[])[0].n
check('vocabulary seeded', termsBefore > 100, String(termsBefore))
// The writes above queued themselves through the outbox triggers. That
// backlog is what a wipe-and-repull upgrade would throw away, which is the
// reason this fix creates missing tables in place instead.
const queuedBefore = q(`select tbl, row_id from sync_outbox`).length
check('writes are queued for push', queuedBefore > 0, `${queuedBefore} rows`)

console.log('\nRe-run the current schema over it, as the worker now does')
db.exec(schema)

check('receipt table now exists', tables().includes('receipt'))
check('receipt_blob too', tables().includes('receipt_blob'))
check('its triggers came with it',
  (q(`select name from sqlite_master where type='trigger' and name like 'sync_receipt%'`)).length === 3)

console.log('\nAnd nothing else moved')
check('the farm is still there',
  (q(`select name from farm`) as { name: string }[])[0].name === 'Rosebud Acres')
check('the animal survived', q(`select 1 from asset where id=?`, [cow]).length === 1)
check('the log survived', q(`select 1 from log where id=?`, [log]).length === 1)
check('the unpushed backlog is still queued',
  q(`select tbl, row_id from sync_outbox`).length === queuedBefore, `${queuedBefore} rows`)
const termsAfter = (q(`select count(*) as n from term`) as { n: number }[])[0].n
check('vocabulary not duplicated', termsAfter === termsBefore, `${termsBefore} -> ${termsAfter}`)
check('sync_control still has exactly one row',
  (q(`select count(*) as n from sync_control`) as { n: number }[])[0].n === 1)

console.log('\nThe new tables actually work')
run(`insert into receipt (id, farm_id, log_id, captured_at, created_at, updated_at)
     values (?,?,?,?,?,?)`, [uuid(), farm, log, now(), now(), now()])
check('a receipt can be written', q(`select 1 from receipt`).length === 1)
const queued = (q(`select tbl from sync_outbox where tbl='receipt'`)).length
check('and its trigger queued it for push', queued === 1)

console.log('\nRunning it a third time is still a no-op')
db.exec(schema)
check('vocabulary still not duplicated',
  (q(`select count(*) as n from term`) as { n: number }[])[0].n === termsBefore)
check('sync_control still one row',
  (q(`select count(*) as n from sync_control`) as { n: number }[])[0].n === 1)
check('the receipt is still there', q(`select 1 from receipt`).length === 1)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
