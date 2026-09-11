// Buyers: the contact table, and the buyer a sale is recorded against.
//
// Three things are worth guarding here, and each one has already gone wrong
// in this codebase in some other shape:
//
//  1. A new local table reaching a device that already exists. `receipt`
//     shipped broken exactly this way ("no such table: receipt", sync dead)
//     — see verify-local-upgrade.ts and SCHEMA_VERSION's comment in
//     src/db/worker.ts. `contact` is the next table to take that path.
//  2. The buyer surviving a sale with no price. It used to ride in the
//     price quantity's label, so a sale recorded before the cheque was
//     worked out had no quantity row for it to land on and lost the buyer
//     silently. It now lives on the log's own attributes.
//  3. A contact counting as a real record. localIsEmpty() decides whether
//     adoptFarmId() may delete this device's placeholder farm; a buyer
//     saved before signing in that does not count leaves an orphan row
//     pointing at a farm that no longer exists, which wedges every table
//     behind it on the next push.
//
// Raw SQL rather than importing queries.ts, the same as every other
// verify-*-local test: queries.ts talks to the wa-sqlite worker, which has
// no Node equivalent. The statements below are copied from it.
//
//   npm run verify:contacts
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'

const R = fileURLToPath(new URL('../', import.meta.url))
const schema = fs.readFileSync(R + 'schema.local.sql', 'utf8')

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

// ---------------------------------------------------------------------------
console.log('\nA device that predates buyers gets the table on upgrade')

// The shape a phone in the field is carrying right now: today's schema with
// the contact section and its triggers cut back out. Written \r?\n rather
// than \n throughout — this file is checked out with CRLF endings on
// Windows, and a \n-only pattern silently matches nothing, leaving the
// "older" database identical to the current one and every assertion below
// passing for the wrong reason.
const older = schema
  .replace(/create table if not exists contact[\s\S]*?create index if not exists contact_farm on contact \(farm_id\);\r?\n/, '')
  .replace(/create trigger if not exists sync_contact_insert[\s\S]*?end;\r?\ncreate trigger if not exists sync_contact_update[\s\S]*?end;\r?\n/, '')

// Guard the guard: if either pattern above stops matching (a rename, a
// reformat, a line-ending change), `older` is just today's schema and every
// check below would pass while testing nothing at all.
check('the stripped schema really is missing the contact section',
  older.length < schema.length && !older.includes('create table if not exists contact'))

const up = new DatabaseSync(':memory:')
up.exec(older)
const upTables = () =>
  (up.prepare(`select name from sqlite_master where type='table'`).all() as { name: string }[])
    .map((r) => r.name)
check('no contact table, as on an existing device', !upTables().includes('contact'))

// A record already on that device, to prove the upgrade does not disturb it.
const oldFarm = uuid()
up.prepare(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`)
  .run(oldFarm, 'Rosebud Acres', now(), now())

up.exec(schema) // what migrate() re-runs once SCHEMA_VERSION changes
check('contact table now exists', upTables().includes('contact'))
check('its sync triggers came with it',
  up.prepare(`select name from sqlite_master where type='trigger' and name like 'sync_contact%'`)
    .all().length === 2)
check('the farm it already had survived',
  (up.prepare(`select name from farm`).all() as { name: string }[])[0].name === 'Rosebud Acres')
up.close()

// ---------------------------------------------------------------------------
console.log('\nBuyer CRUD, scoped to the farm')

const db = new DatabaseSync(':memory:')
db.exec(schema)
const q = (sql: string, params: unknown[] = []) =>
  db.prepare(sql).all(...params as never[]) as never[]
const run = (sql: string, params: unknown[] = []) =>
  db.prepare(sql).run(...params as never[])

const farm = uuid()
const other = uuid()
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`, [farm, 'Ours', now(), now()])
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`, [other, 'Theirs', now(), now()])
run(`insert into active_farm (id) values (?)`, [farm])

// createContact()
const harpers = uuid()
run(`insert into contact (id, farm_id, name, phone, email, notes, created_at, updated_at)
     values (?,?,?,?,?,?,?,?)`,
  [harpers, farm, 'The Harpers', '555-0123', null, null, now(), now()])
// A neighbour's buyer, which must never show up in our list.
run(`insert into contact (id, farm_id, name, phone, email, notes, created_at, updated_at)
     values (?,?,?,?,?,?,?,?)`,
  [uuid(), other, 'Someone Else', null, null, null, now(), now()])

// listContacts()
const list = () => q(
  `select id, name, phone, email, notes from contact
    where deleted_at is null and farm_id = (select id from active_farm)
    order by name`) as { id: string; name: string; phone: string | null }[]

check('our buyer is listed', list().length === 1, `${list().length} found`)
check('with the phone number we gave them', list()[0].phone === '555-0123')
check('the other farm\'s buyer does not leak in',
  !list().some((c) => c.name === 'Someone Else'))

// updateContact() — the dynamic set-builder writes only what was passed.
run(`update contact set email = ?, updated_at = ? where id = ?`,
  ['harpers@example.com', now(), harpers])
check('an edit lands', list()[0].phone === '555-0123'
  && (list()[0] as { email: string }).email === 'harpers@example.com')
check('and leaves the untouched columns alone', list()[0].name === 'The Harpers')

// deleteContact() — soft, so it syncs out rather than vanishing.
run(`update contact set deleted_at = ?, updated_at = ? where id = ?`, [now(), now(), harpers])
check('a removed buyer drops off the list', list().length === 0)
check('but the row is retained for sync', q(`select 1 from contact where id=?`, [harpers]).length === 1)

// ---------------------------------------------------------------------------
console.log('\nThe buyer survives a sale with no price')

// sellAsset(): the regression this feature was built around. Price omitted
// entirely, so there is no quantity row — the old label slot would have had
// nowhere to put the buyer.
const henrietta = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'animal','Henrietta','{"species":"Chicken"}',?,?)`, [henrietta, farm, now(), now()])
const sale = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, attributes, created_at, updated_at)
     values (?,?,'sale',?,'Sold Henrietta',?,?,?)`,
  [sale, farm, now(), JSON.stringify({ buyer: 'The Harpers' }), now(), now()])
run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [sale, henrietta])

// recentLogs() reads it back through exactly this expression.
const buyerOf = (id: string) =>
  (q(`select attributes->>'buyer' as buyer from log where id = ?`, [id]) as { buyer: string | null }[])[0].buyer

check('a sale with no price still carries its buyer', buyerOf(sale) === 'The Harpers')
check('and wrote no price quantity to hide it in',
  q(`select 1 from quantity where log_id = ?`, [sale]).length === 0)

// recordDisposition(): the produce side, same slot.
const eggs = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'lot','Eggs','{"origin":"produced"}',?,?)`, [eggs, farm, now(), now()])
const sold = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, attributes, created_at, updated_at)
     values (?,?,'disposition',?,'Sold',?,?,?)`,
  [sold, farm, now(), JSON.stringify({ buyer: 'The Harpers' }), now(), now()])
check('a produce sale keeps its buyer in the same place', buyerOf(sold) === 'The Harpers')

// A log with no buyer must read null, not crash or return '{}'.
const note = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'observation',?,'Note',?,?)`, [note, farm, now(), now(), now()])
check('a log with no buyer reads back null', buyerOf(note) === null)

// ---------------------------------------------------------------------------
console.log('\nA buyer counts as a real record')

// localIsEmpty(): if a contact does not count, adoptFarmId() deletes the
// placeholder farm out from under it and the orphan wedges the push queue.
const emptyCount = () => (q(
  `select ((select count(*) from asset    where farm_id = (select id from active_farm)) +
           (select count(*) from log      where farm_id = (select id from active_farm)) +
           (select count(*) from location where farm_id = (select id from active_farm)) +
           (select count(*) from contact  where farm_id = (select id from active_farm))) as n`,
) as { n: number }[])[0].n

const fresh = new DatabaseSync(':memory:')
fresh.exec(schema)
const fFarm = uuid()
fresh.prepare(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`)
  .run(fFarm, 'Fresh', now(), now())
fresh.prepare(`insert into active_farm (id) values (?)`).run(fFarm)
const freshCount = () => (fresh.prepare(
  `select ((select count(*) from asset    where farm_id = (select id from active_farm)) +
           (select count(*) from log      where farm_id = (select id from active_farm)) +
           (select count(*) from location where farm_id = (select id from active_farm)) +
           (select count(*) from contact  where farm_id = (select id from active_farm))) as n`,
).all() as { n: number }[])[0].n
check('a brand new device reads as empty', freshCount() === 0)
fresh.prepare(`insert into contact (id, farm_id, name, created_at, updated_at) values (?,?,?,?,?)`)
  .run(uuid(), fFarm, 'Saved before signing in', now(), now())
check('a device with only a buyer on it does NOT read as empty', freshCount() > 0)
fresh.close()

check('the farm with records is not empty either', emptyCount() > 0)

// ---------------------------------------------------------------------------
console.log('\nBuyers queue for sync like any other table')

// The outbox triggers are what push() reads. Without them a buyer saved on
// one device never reaches another.
run(`delete from sync_outbox`)
const queued = uuid()
run(`insert into contact (id, farm_id, name, created_at, updated_at) values (?,?,?,?,?)`,
  [queued, farm, 'Queued Buyer', now(), now()])
check('an insert queues',
  q(`select 1 from sync_outbox where tbl='contact' and row_id=?`, [queued]).length === 1)

run(`delete from sync_outbox`)
run(`update contact set name = ?, updated_at = ? where id = ?`, ['Renamed', now(), queued])
check('an edit queues too',
  q(`select 1 from sync_outbox where tbl='contact' and row_id=?`, [queued]).length === 1)

// Rows arriving from a pull must not queue straight back, forever.
run(`delete from sync_outbox`)
run(`update sync_control set applying = 1`)
run(`insert into contact (id, farm_id, name, created_at, updated_at) values (?,?,?,?,?)`,
  [uuid(), farm, 'Pulled Buyer', now(), now()])
run(`update sync_control set applying = 0`)
check('but a pulled row does not queue itself back',
  q(`select 1 from sync_outbox where tbl='contact'`).length === 0)

db.close()

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
