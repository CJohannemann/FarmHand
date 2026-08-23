// Proves the local change-tracking behaves, especially that rows applied from
// a pull are not re-queued for push.
//   npm run verify:sync
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { fileURLToPath } from 'url'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new PGlite()
let failures = 0

const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}` +
              (ok ? '' : ` (expected ${expected})`))
}

await db.exec(`create schema auth; create table auth.users (id uuid primary key);
  do $r$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
    then create role authenticated; end if; end $r$;
  create function auth.uid() returns uuid language sql stable as $q$ select null::uuid $q$;`)
await db.exec(fs.readFileSync(R + 'schema.sql', 'utf8').replace(/create extension[^;]*;/, ''))
await db.exec(fs.readFileSync(R + 'seed.sql', 'utf8'))
await db.exec(fs.readFileSync(R + 'sync-local.sql', 'utf8'))

const q = async (s, p = []) => (await db.query(s, p)).rows
const outbox = async (tbl) => (await q(
  tbl ? `select count(*)::int n from sync_outbox where tbl=$1`
      : `select count(*)::int n from sync_outbox`, tbl ? [tbl] : []))[0].n

console.log('\nLocal change tracking')

// The seed ran before the triggers existed, so we start clean.
await q(`delete from sync_outbox`)

const farm = (await q(
  `insert into farm (name) values ('Test') returning id`))[0].id
check('local insert is queued', await outbox('farm'), 1)

const asset = (await q(
  `insert into asset (farm_id,type,name) values ($1,'animal','Bluebell') returning id`,
  [farm]))[0].id
check('second table queued separately', await outbox('asset'), 1)

await q(`update asset set name='Bluebell II' where id=$1`, [asset])
check('update does not duplicate the row', await outbox('asset'), 1)

// --- the important one ----------------------------------------------------
await q(`select set_config('farmhand.applying','on',false)`)
await q(`insert into asset (farm_id,type,name) values ($1,'animal','FromServer')`, [farm])
await q(`update asset set name='Renamed by server' where id=$1`, [asset])
await q(`select set_config('farmhand.applying','off',false)`)
check('pulled rows are NOT queued for push', await outbox('asset'), 1)

// A local edit after a pull still queues.
await q(`insert into asset (farm_id,type,name) values ($1,'animal','Local again')`, [farm])
check('local writes resume queueing', await outbox('asset'), 2)

// Composite key flattening for log_asset.
const log = (await q(
  `insert into log (farm_id,type,timestamp) values ($1,'observation',now()) returning id`,
  [farm]))[0].id
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`, [log, asset])
const [la] = await q(`select row_id from sync_outbox where tbl='log_asset'`)
check('log_asset key has three parts', la.row_id.split('|').length, 3)

check('sync_state round-trips',
  (await q(`insert into sync_state (key,value) values ('k','v')
            on conflict (key) do update set value=excluded.value
            returning value`))[0].value, 'v')

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
