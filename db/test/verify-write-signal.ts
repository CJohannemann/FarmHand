// Which statements count as "a local edit worth pushing".
//
// db/client.ts fires a signal on these so sync can push a couple of seconds
// after a change instead of leaving it on the device for up to a minute.
// The exclusion for sync's own bookkeeping tables is the load-bearing part:
// setSyncState('lastSyncedAt', ...) runs at the end of EVERY sync, so if
// that counted as a local write, each sync would schedule the next one and
// the app would sync forever with nobody touching it — on a phone, on
// cellular data, in a barn. Hence a test rather than a regex nobody reads
// again.
//
//   npm run verify:write-signal
import { isPushableWrite } from '../../src/db/writeSignal.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

console.log('\nReal writes from queries.ts should push')
const writes = [
  `insert into asset (id, farm_id, type, name, attributes, parent_id, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
  `update asset set status = 'archived', terminal_event = $2 where id = $1`,
  `insert into log (id, farm_id, type, timestamp, status, name, notes, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  `insert into log_asset (log_id, asset_id, role, amount, unit) values ($1,$2,$3,$4,$5)`,
  `insert into quantity (farm_id, log_id, measure, value, unit, asset_id) values ($1,$2,$3,$4,$5,$6)`,
  `insert into term (id, farm_id, vocabulary, name, created_at, updated_at) values ($1,$2,$3,$4,$5,$6)`,
  `update farm set name = $1, updated_at = $2`,
  `delete from log where id = $1`,
  `  \n  update asset set name = $1 where id = $2`,
]
for (const sql of writes) {
  check(sql.trim().split('\n')[0].slice(0, 62), isPushableWrite(sql))
}

console.log("\nSync's own bookkeeping must NOT push (this is the loop guard)")
const bookkeeping = [
  `insert into sync_state (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
  `delete from sync_outbox where tbl = $1`,
  `update sync_control set applying = 1`,
  `update sync_control set applying = 0`,
  `insert into sync_outbox (tbl, row_id, queued_at) values ('farm', new.id, datetime('now'))`,
]
for (const sql of bookkeeping) {
  check(sql.trim().split('\n')[0].slice(0, 62), !isPushableWrite(sql))
}

console.log('\nReads never push')
const reads = [
  `select id, type, name, status, terminal_event, parent_id, attributes from asset`,
  `select value from sync_state where key = $1`,
  `select count(*) as n from sync_outbox`,
  `select name from term where vocabulary = $1 and deleted_at is null`,
]
for (const sql of reads) {
  check(sql.split('\n')[0].slice(0, 62), !isPushableWrite(sql))
}

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
