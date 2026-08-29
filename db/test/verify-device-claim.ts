// A device belongs to one account at a time.
//
// Reported from a real farm: the account was deleted, a new one signed up
// and verified, and the new farm arrived carrying the old one's chickens.
//
// Three faults stacked up. Wiping meant deleting the whole IndexedDB
// database on the next boot, which blocks while any other tab has the app
// open; the delete reported success on a five-second timeout regardless;
// and the flag was cleared in a `finally` either way, so it never retried.
// The records survived — and then linkFarm() handed them to the new
// account, because create_farm() takes the LOCAL farm id as its wanted_id,
// so a signup on a device holding records adopts them as its own farm.
//
// The fix is two things, and this pins both: the wipe rebuilds the tables
// through the open connection rather than deleting the database file, and
// the device records whose it is so a different account never inherits it.
//
//   npm run verify:device-claim
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { seedLocalVocabulary } from '../seedLocal.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const schema = fs.readFileSync(R + 'schema.local.sql', 'utf8')
let db = new DatabaseSync(':memory:')
let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}
const q = (sql: string, p: unknown[] = []) => db.prepare(sql).all(...p as never[]) as never[]
const run = (sql: string, p: unknown[] = []) => db.prepare(sql).run(...p as never[])
const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

/** What the worker's reset() does: drop everything, rebuild, reseed. */
const reset = async () => {
  for (const t of q(`select name from sqlite_master where type='trigger'`) as { name: string }[])
    db.exec(`drop trigger if exists "${t.name}"`)
  for (const t of q(`select name from sqlite_master where type='table' and name not like 'sqlite_%'`) as { name: string }[])
    db.exec(`drop table if exists "${t.name}"`)
  db.exec(schema)
  run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`,
    [uuid(), 'My farm', now(), now()])
  await seedLocalVocabulary(async (sql, p = []) => run(sql, p as unknown[]))
}

const getState = (k: string) => {
  const r = q(`select value from sync_state where key = ?`, [k]) as { value: string }[]
  return r[0]?.value ?? null
}
const setState = (k: string, v: string) =>
  run(`insert into sync_state (key,value) values (?,?)
       on conflict (key) do update set value = excluded.value`, [k, v])

/** claimDeviceFor(), as lib/farm.ts implements it. */
const claim = async (userId: string) => {
  const owner = getState('ownerUserId')
  if (owner === userId) return
  if (owner !== null) await reset()
  setState('ownerUserId', userId)
}

const chris = '11111111-1111-1111-1111-111111111111'
const fresh = '22222222-2222-2222-2222-222222222222'

console.log("\nChris's device, with a farm on it")
db.exec(schema)
await seedLocalVocabulary(async (sql, p = []) => run(sql, p as unknown[]))
const farm1 = uuid()
run(`insert into farm (id,name,created_at,updated_at) values (?,?,?,?)`,
  [farm1, 'Rosebud Acres', now(), now()])
run(`insert into asset (id,farm_id,type,name,attributes,created_at,updated_at)
     values (?,?,'group','Broilers','{"species":"Chicken"}',?,?)`, [uuid(), farm1, now(), now()])
await claim(chris)
check('the device is claimed', getState('ownerUserId') === chris)
check('the chickens are here', q(`select 1 from asset`).length === 1)

console.log('\nSigning in again as the same person changes nothing')
const before = (q(`select id from farm`) as { id: string }[])[0].id
await claim(chris)
check('the farm id is the same', (q(`select id from farm`) as { id: string }[])[0].id === before)
check('the chickens are still here', q(`select 1 from asset`).length === 1)

console.log('\nA different account signs up on this device')
await claim(fresh)
check('the chickens are gone', q(`select 1 from asset`).length === 0,
  `${q(`select 1 from asset`).length} left`)
check('so is the old farm id',
  (q(`select id from farm`) as { id: string }[])[0].id !== farm1)
check('and the old name', (q(`select name from farm`) as { name: string }[])[0].name === 'My farm')
check('the device now belongs to the new account', getState('ownerUserId') === fresh)
// This is what actually caused the report: create_farm() is handed the
// local farm id, so whatever farm is sitting here becomes the new account's.
check('the id a fresh signup would claim is not the old one',
  (q(`select id from farm`) as { id: string }[])[0].id !== farm1)

console.log('\nThe rebuilt device is usable, not just empty')
check('vocabulary reseeded',
  ((q(`select count(*) n from term`) as { n: number }[])[0].n) > 100)
// Exactly one, not zero and not two: the schema seeds it and re-running
// the schema must not add a second.
check('sync_control has exactly one row', q(`select 1 from sync_control`).length === 1)
// The outbox is NOT empty here, and should not be — seeding the fresh farm
// and its vocabulary fires the outbox triggers, same as any other write.
// push() drops the system vocabulary on the way out (term rows with a null
// farm_id), so this backlog costs one round trip and nothing else.
check('the fresh seed queued itself, as any write does',
  q(`select 1 from sync_outbox where tbl = 'farm'`).length === 1)
check('triggers came back with it',
  (q(`select name from sqlite_master where type='trigger'`)).length > 10)
run(`insert into asset (id,farm_id,type,name,created_at,updated_at)
     values (?,(select id from farm),'animal','New cow',?,?)`, [uuid(), now(), now()])
check('a write works and queues for push',
  (q(`select tbl from sync_outbox where tbl='asset'`)).length === 1)

console.log('\nA device nobody has claimed is left alone')
db = new DatabaseSync(':memory:')
db.exec(schema)
await seedLocalVocabulary(async (sql, p = []) => run(sql, p as unknown[]))
const farm2 = uuid()
run(`insert into farm (id,name,created_at,updated_at) values (?,?,?,?)`,
  [farm2, 'Older install', now(), now()])
run(`insert into asset (id,farm_id,type,name,created_at,updated_at)
     values (?,?,'animal','Bluebell',?,?)`, [uuid(), farm2, now(), now()])
await claim(chris)
// Predates the ownership marker, so it belongs to whoever signs in now —
// wiping it would destroy the records of every existing install on upgrade.
check('an unclaimed device keeps its records', q(`select 1 from asset`).length === 1)
check('and its farm', (q(`select id from farm`) as { id: string }[])[0].id === farm2)
check('now claimed', getState('ownerUserId') === chris)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
