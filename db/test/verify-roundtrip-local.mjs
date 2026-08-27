// The SQLite counterpart of verify-roundtrip.ts — but unlike that file, this
// one is deliberately NOT symmetric: the "server" stays PGlite running the
// real, untouched db/schema.sql, because the actual remote after this
// migration is still Postgres/Supabase (this migration only replaces the
// on-device engine). Devices A and B run node:sqlite against
// db/schema.local.sql instead. This is the one test that exercises the real,
// asymmetric shape production will actually have: SQLite devices syncing
// against a Postgres remote, driven by the real (dialect-ported) src/lib/
// syncCore.ts on both sides of that boundary.
//   npm run verify:roundtrip-local
import { PGlite } from '@electric-sql/pglite'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { runSync } from '../../src/lib/syncCore.ts'
import { seedLocalVocabulary } from '../seedLocal.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const schema = fs.readFileSync(R + 'schema.sql', 'utf8').replace(/create extension[^;]*;/, '')
const seed = fs.readFileSync(R + 'seed.sql', 'utf8')
const schemaLocal = fs.readFileSync(R + 'schema.local.sql', 'utf8')

const STUB = `
  do $r$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
    then create role authenticated; end if; end $r$;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $q$ select null::uuid $q$;
`

let fails = 0
const check = (label, ok, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

// -------------------------------------------------------------- the server
// Real remote: unchanged Postgres schema, via PGlite, exactly like today.

async function makeServer() {
  const pg = new PGlite()
  await pg.exec(STUB)
  await pg.exec(schema)
  await pg.exec(seed)
  await pg.exec(`insert into farm (name) values ('My farm')`)
  return pg
}

function asRemote(pg) {
  return {
    async upsert(table, rows, conflict) {
      if (rows.length === 0) return
      const cols = Object.keys(rows[0])
      const sets = cols.filter((c) => !conflict.includes(c))
        .map((c) => `"${c}"=excluded."${c}"`)
      const sql =
        `insert into "${table}" (${cols.map((c) => `"${c}"`).join(',')}) ` +
        `values (${cols.map((_, i) => `$${i + 1}`).join(',')}) ` +
        `on conflict (${conflict.map((c) => `"${c}"`).join(',')}) ` +
        (sets.length ? `do update set ${sets.join(',')}` : 'do nothing')
      for (const r of rows) {
        await pg.query(sql, cols.map((c) => {
          const v = r[c]
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
        }))
      }
    },
    async selectSince(table, since, limit) {
      const extra = table === 'term' ? ' and farm_id is not null' : ''
      const { rows } = await pg.query(
        `select * from "${table}" where updated_at > $1${extra}
         order by updated_at asc limit $2`, [since, limit])
      return rows
    },
    async selectLogAssets(logIds) {
      if (!logIds.length) return []
      const { rows } = await pg.query(
        `select * from log_asset where log_id = any($1::uuid[])`, [logIds])
      return rows
    },
  }
}

// -------------------------------------------------------------- the devices
// The new local engine: node:sqlite against schema.local.sql. Local.query
// receives syncCore.ts's Postgres-numbered ($1, $2, ...) placeholders — real
// client.ts will carry this same expansion (see the Phase 2 plan); duplicated
// here rather than imported since client.ts hasn't been touched yet.

function expandParams(sql, params = []) {
  const expanded = []
  const newSql = sql.replace(/\$(\d+)/g, (_, n) => {
    expanded.push(params[Number(n) - 1])
    return '?'
  })
  return { sql: newSql, params: expanded }
}

async function makeDevice() {
  const db = new DatabaseSync(':memory:')
  db.exec(schemaLocal)
  const farm = crypto.randomUUID()
  const t = new Date().toISOString()
  db.prepare(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`)
    .run(farm, 'My farm', t, t)
  await seedLocalVocabulary(async (sql, params = []) => db.prepare(sql).run(...params))
  db.prepare(`delete from sync_outbox`).run()   // seeding queues the outbox; see verify-seed-local
  return db
}

function asLocal(db) {
  return {
    async query(sql, params) {
      const { sql: s, params: p } = expandParams(sql, params)
      const rows = /^\s*select/i.test(s) || /^\s*insert.*returning/is.test(s)
        ? db.prepare(s).all(...p)
        : (db.prepare(s).run(...p), [])
      return { rows }
    },
    async applying(fn) {
      db.prepare(`update sync_control set applying = 1`).run()
      try { return await fn() } finally {
        db.prepare(`update sync_control set applying = 0`).run()
      }
    },
    async getState(key) {
      const row = db.prepare(`select value from sync_state where key=?`).get(key)
      return row?.value ?? null
    },
    async setState(key, value) {
      db.prepare(`insert into sync_state (key,value) values (?,?)
         on conflict (key) do update set value=excluded.value`).run(key, value)
    },
  }
}

// ---------------------------------------------------------------------------

const server = await makeServer()
const A = await makeDevice()
const B = await makeDevice()
const remote = asRemote(server)

const farm = A.prepare(`select id from farm limit 1`).get().id

// The farm row is established remotely by the create_farm RPC when a user
// first signs in, adopting the device's existing id — not by a push.
await server.exec(`delete from farm`)
await server.query(`insert into farm (id, name) values ($1, 'My farm')`, [farm])

console.log('\nDevice A records a batch')
const flock = crypto.randomUUID()
const now = () => new Date().toISOString()
A.prepare(`insert into asset (id,farm_id,type,name,attributes,created_at,updated_at)
   values (?,?,'group','Spring broilers','{"headcount":75}',?,?)`)
  .run(flock, farm, now(), now())
const log = crypto.randomUUID()
A.prepare(`insert into log (id,farm_id,type,timestamp,name,created_at,updated_at)
   values (?,?,'harvest',?,'Eggs collected',?,?)`).run(log, farm, now(), now(), now())
A.prepare(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`).run(log, flock)
A.prepare(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at)
   values (?,?,?,'count',18,'each',?,?)`).run(crypto.randomUUID(), farm, log, now(), now())

check('A has queued its writes',
  A.prepare(`select count(*) n from sync_outbox`).get().n >= 4)

console.log('\nA syncs up')
const up = await runSync(asLocal(A), remote)
const scount = async (sql, p = []) => Number((await server.query(sql, p)).rows[0].n)
check('push reported rows', up.pushed >= 4, `${up.pushed} pushed`)
check('server has the farm', await scount(`select count(*)::int n from farm`) === 1)
check('server has the flock',
  await scount(`select count(*)::int n from asset where id=$1`, [flock]) === 1)
check('server has the log',
  await scount(`select count(*)::int n from log where id=$1`, [log]) === 1)
check('server has the link',
  await scount(`select count(*)::int n from log_asset where log_id=$1`, [log]) === 1)
check('server has the quantity',
  await scount(`select count(*)::int n from quantity where log_id=$1`, [log]) === 1)
check("A's outbox is now empty",
  A.prepare(`select count(*) n from sync_outbox`).get().n === 0)
// The server seeded its own (unchanged, Postgres-side) vocabulary. If A had
// pushed its 144 system-vocab rows too the count would rise — it must not.
const serverTerms = await scount(`select count(*)::int n from term`)
check('shared vocabulary was not duplicated', serverTerms === 133, `${serverTerms} terms`)

console.log('\nDevice B syncs down')
const down = await runSync(asLocal(B), remote)
check('pull reported rows', down.pulled >= 3, `${down.pulled} pulled`)
check('B sees the flock', B.prepare(`select count(*) n from asset where id=?`).get(flock).n === 1)
check('B sees the log', B.prepare(`select count(*) n from log where id=?`).get(log).n === 1)
check('B sees the link',
  B.prepare(`select count(*) n from log_asset where log_id=?`).get(log).n === 1)
check('B sees the quantity',
  B.prepare(`select count(*) n from quantity where log_id=?`).get(log).n === 1)

// The whole point: pulled rows must not look like local edits.
check('B does NOT queue what it pulled',
  B.prepare(`select count(*) n from sync_outbox`).get().n === 0)

console.log('\nB edits, A picks it up')
B.prepare(`update asset set name='Spring broilers (2026)', updated_at=? where id=?`)
  .run(now(), flock)
check('B queued its own edit', B.prepare(`select count(*) n from sync_outbox`).get().n === 1)
await runSync(asLocal(B), remote)
await runSync(asLocal(A), remote)
const nameOnA = A.prepare(`select name from asset where id=?`).get(flock).name
check('A received the rename', nameOnA === 'Spring broilers (2026)', nameOnA)

console.log('\nA deletes a record, B must learn it died')
A.prepare(`update log set deleted_at = ?, updated_at = ? where id = ?`).run(now(), now(), log)
A.prepare(`update quantity set deleted_at = ?, updated_at = ? where log_id = ?`)
  .run(now(), now(), log)
await runSync(asLocal(A), remote)
await runSync(asLocal(B), remote)

check('B sees the log as deleted',
  B.prepare(`select count(*) n from log where id=? and deleted_at is not null`).get(log).n === 1)
check('B would not list it',
  B.prepare(`select count(*) n from log where id=? and deleted_at is null`).get(log).n === 0)
check('its quantities died with it',
  B.prepare(`select count(*) n from quantity where log_id=? and deleted_at is not null`)
    .get(log).n === 1)
// The row must still exist — a hard delete would leave other devices unable
// to tell "deleted" from "never seen".
check('the row itself is retained',
  B.prepare(`select count(*) n from log where id=?`).get(log).n === 1)

console.log('\nDevice A creates a group and its members in the same batch')
const herd = crypto.randomUUID()
A.prepare(`insert into asset (id,farm_id,type,name,attributes,created_at,updated_at)
   values (?,?,'group','Beef cattle','{"headcount":12}',?,?)`).run(herd, farm, now(), now())
for (let i = 1; i <= 12; i++) {
  A.prepare(`insert into asset (id,farm_id,type,name,parent_id,created_at,updated_at)
    values (?,?,'animal',?,?,?,?)`)
    .run(crypto.randomUUID(), farm, `Beef cattle ${i}`, herd, now(), now())
}

let herdPushError = ''
try {
  await runSync(asLocal(A), remote)
} catch (err) {
  herdPushError = err.message
}
check('pushing a new group with its members does not trip the parent_id FK',
  herdPushError === '', herdPushError)
check('server has the group', await scount(`select count(*)::int n from asset where id=$1`, [herd]) === 1)
check('server has all 12 members',
  await scount(`select count(*)::int n from asset where parent_id=$1`, [herd]) === 12)

console.log('\nDevice B pulls that herd fresh — the exact shape that broke a')
console.log('brand new device signing into an existing farm for the first time')
await runSync(asLocal(B), remote)
check('B has the herd', B.prepare(`select count(*) n from asset where id=?`).get(herd).n === 1)
check('B has all 12 members',
  B.prepare(`select count(*) n from asset where parent_id=?`).get(herd).n === 12)

console.log('\nRepeat sync is quiet')
const again = await runSync(asLocal(A), remote)
check('nothing left to push', again.pushed === 0, `${again.pushed}`)
check('A outbox still empty', A.prepare(`select count(*) n from sync_outbox`).get().n === 0)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
