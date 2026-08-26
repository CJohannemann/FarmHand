// push() (src/lib/syncCore.ts) is driven against two different `Local`
// backends in production: the normal on-device SQLite engine, and — via
// db/cutover.ts's oldLocalAdapter() — a real Postgres database (PGlite),
// for a device migrating off the old pre-wa-sqlite local engine with
// records still queued in its outbox. Every other push()-exercising test
// (verify-roundtrip-local.mjs, verify-push-order.ts) only ever runs it
// against SQLite or a hand-written stand-in, so nothing caught that
// localRowsFor()/pushReferenced() built their id-list IN-clauses with
// SQLite's json_each() — which happily unpacks a JSON array in SQLite, but
// against real Postgres raises "operator does not exist: uuid = json"
// (Postgres's json_each() expects a JSON object, not an array, and its
// value column comes back typed json, not something a uuid column can be
// compared to). This reproduces the exact shape that broke a real device's
// cutover: a Postgres-backed Local with a log_asset row queued alongside
// the asset and log it references, which is exactly what routes through
// both the composite-key branch of localRowsFor() and pushReferenced().
//
//   npm run verify:cutover-push
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { push, type Local, type Remote, type Row } from '../../src/lib/syncCore.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const schema = fs.readFileSync(R + 'schema.sql', 'utf8').replace(/create extension[^;]*;/, '')
const syncLocal = fs.readFileSync(R + 'sync-local.sql', 'utf8')

const STUB = `
  do $r$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
    then create role authenticated; end if; end $r$;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $q$ select null::uuid $q$;
`

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

async function makePg(): Promise<PGlite> {
  const pg = new PGlite()
  await pg.exec(STUB)
  await pg.exec(schema)
  return pg
}

// The real old-engine local database: schema.sql (PGlite was genuine
// Postgres, so it ran the same schema the remote does) plus the local-only
// outbox bookkeeping from sync-local.sql, which cutover.ts's real
// pendingCountOf()/oldLocalAdapter() depend on existing.
async function makeOldDevice(): Promise<PGlite> {
  const pg = await makePg()
  await pg.exec(syncLocal)
  return pg
}

// Mirrors db/cutover.ts's oldLocalAdapter() exactly — the real thing this
// test stands in for.
function asOldLocal(pg: PGlite): Local {
  return {
    async query<T = Row>(sql: string, params?: unknown[]) {
      const { rows } = await pg.query<T>(sql, params)
      return { rows }
    },
    async applying<T>(fn: () => Promise<T>) {
      await pg.query(`select set_config('farmhand.applying', 'on', false)`)
      try { return await fn() } finally {
        await pg.query(`select set_config('farmhand.applying', 'off', false)`)
      }
    },
    async getState(key) {
      const { rows } = await pg.query<{ value: string }>(
        `select value from sync_state where key = $1`, [key])
      return rows[0]?.value ?? null
    },
    async setState(key, value) {
      await pg.query(
        `insert into sync_state (key, value) values ($1, $2)
         on conflict (key) do update set value = excluded.value`, [key, value])
    },
  }
}

function asRemote(pg: PGlite): Remote {
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
      const { rows } = await pg.query(
        `select * from "${table}" where updated_at > $1 order by updated_at asc limit $2`,
        [since, limit])
      return rows as Row[]
    },
    async selectLogAssets(logIds) {
      if (!logIds.length) return []
      const { rows } = await pg.query(
        `select * from log_asset where log_id = any($1::uuid[])`, [logIds])
      return rows as Row[]
    },
  }
}

const oldDevice = await makeOldDevice()
const server = await makePg()

const farm = crypto.randomUUID()
await oldDevice.query(`insert into farm (id, name) values ($1, 'Old device farm')`, [farm])
await server.query(`insert into farm (id, name) values ($1, 'Old device farm')`, [farm])

const flock = crypto.randomUUID()
const log = crypto.randomUUID()
await oldDevice.query(
  `insert into asset (id, farm_id, type, name, attributes) values ($1,$2,'group','Spring broilers','{"headcount":75}')`,
  [flock, farm],
)
await oldDevice.query(
  `insert into log (id, farm_id, type, timestamp, name) values ($1,$2,'harvest',now(),'Eggs collected')`,
  [log, farm],
)
await oldDevice.query(
  `insert into log_asset (log_id, asset_id, role) values ($1,$2,'subject')`, [log, flock],
)
await oldDevice.query(
  `insert into quantity (id, farm_id, log_id, measure, value, unit) values ($1,$2,$3,'count',18,'each')`,
  [crypto.randomUUID(), farm, log],
)

const { rows: queued } = await oldDevice.query<{ n: number }>(
  `select count(*)::int as n from sync_outbox`,
)
check('old device queued its writes', (queued[0]?.n ?? 0) >= 4, `${queued[0]?.n} queued`)

console.log('\nPushing a Postgres-backed old device (the real cutover.ts shape)')
let pushError = ''
let pushed = 0
try {
  pushed = await push(asOldLocal(oldDevice), asRemote(server))
} catch (e) {
  pushError = (e as Error).message
}
check('push completes without a SQL error', pushError === '', pushError)
check('rows were pushed', pushed >= 4, `${pushed} pushed`)

const scount = async (sql: string, p: unknown[] = []) =>
  Number((await server.query<{ n: number }>(sql, p)).rows[0]?.n ?? 0)

check('server has the flock', await scount(`select count(*)::int n from asset where id=$1`, [flock]) === 1)
check('server has the log', await scount(`select count(*)::int n from log where id=$1`, [log]) === 1)
check('server has the log_asset link',
  await scount(`select count(*)::int n from log_asset where log_id=$1`, [log]) === 1)
check('server has the quantity',
  await scount(`select count(*)::int n from quantity where log_id=$1`, [log]) === 1)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
