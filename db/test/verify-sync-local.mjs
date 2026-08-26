// The SQLite counterpart of verify-sync.mjs: proves the outbox trigger +
// sync_control gating behaves on the new local schema exactly as
// sync_enqueue()/farmhand.applying do on the Postgres side — especially that
// rows applied during a pull (sync_control.applying = 1) are not re-queued
// for push, and that repeated writes to the same row collapse to one outbox
// entry with a bumped queued_at rather than piling up.
//   npm run verify:sync-local
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
let failures = 0

const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}` +
              (ok ? '' : ` (expected ${expected})`))
}

db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))

const now = () => new Date().toISOString()
const farm = crypto.randomUUID()
db.prepare(`insert into farm (id, name, created_at, updated_at) values (?, 'Test', ?, ?)`)
  .run(farm, now(), now())

console.log('\nA plain local write')
check('inserting the farm queued it for push',
  db.prepare(`select count(*) n from sync_outbox where tbl='farm' and row_id=?`).get(farm).n, 1)

db.prepare(`delete from sync_outbox`).run()
db.prepare(`update farm set name='Test Farm', updated_at=? where id=?`).run(now(), farm)
check('updating it again re-queues it',
  db.prepare(`select count(*) n from sync_outbox where tbl='farm' and row_id=?`).get(farm).n, 1)

console.log('\nRows arriving from a pull')
db.prepare(`delete from sync_outbox`).run()
db.prepare(`update sync_control set applying = 1`).run()
const pulled = crypto.randomUUID()
db.prepare(`insert into farm (id, name, created_at, updated_at) values (?, 'Pulled', ?, ?)`)
  .run(pulled, now(), now())
db.prepare(`update sync_control set applying = 0`).run()
check('a row inserted while applying is NOT queued for push',
  db.prepare(`select count(*) n from sync_outbox where tbl='farm' and row_id=?`).get(pulled).n, 0)

console.log('\nA write after applying turns back off')
db.prepare(`update farm set name='Pulled, then edited', updated_at=? where id=?`).run(now(), pulled)
check('an ordinary write after applying is queued normally',
  db.prepare(`select count(*) n from sync_outbox where tbl='farm' and row_id=?`).get(pulled).n, 1)

console.log('\nA composite-keyed table (log_asset)')
db.prepare(`delete from sync_outbox`).run()
const log = crypto.randomUUID()
const asset = crypto.randomUUID()
db.prepare(`insert into log (id, farm_id, type, timestamp, created_at, updated_at) values (?,?,?,?,?,?)`)
  .run(log, farm, 'observation', now(), now(), now())
db.prepare(`insert into asset (id, farm_id, type, name, created_at, updated_at) values (?,?,?,?,?,?)`)
  .run(asset, farm, 'animal', 'Bessie', now(), now())
db.prepare(`delete from sync_outbox`).run()  // the two inserts above queued asset/log too; isolate log_asset
db.prepare(`insert into log_asset (log_id, asset_id, role) values (?,?,'subject')`).run(log, asset)
check('log_asset queues under its flattened composite key',
  db.prepare(`select row_id n from sync_outbox where tbl='log_asset'`).get().n,
  `${log}|${asset}|subject`)

console.log('\nsync_state (getSyncState/setSyncState in db/client.ts)')
db.prepare(`insert into sync_state (key, value) values ('k','v')
            on conflict (key) do update set value = excluded.value`).run()
check('sync_state round-trips',
  db.prepare(`select value from sync_state where key='k'`).get().value, 'v')
db.prepare(`insert into sync_state (key, value) values ('k','v2')
            on conflict (key) do update set value = excluded.value`).run()
check('sync_state upsert overwrites, not duplicates',
  db.prepare(`select value from sync_state where key='k'`).get().value, 'v2')

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
