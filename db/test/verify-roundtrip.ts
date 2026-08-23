// Drives the real sync algorithm between two device databases and a stand-in
// server, all PGlite. Verifies that records travel, that a second device does
// not push back what it just pulled, and that edits propagate both ways.
//
//   npm run verify:roundtrip
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import {
  runSync, type Local, type Remote, type Row,
} from '../../src/lib/syncCore.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const schema = fs.readFileSync(R + 'schema.sql', 'utf8').replace(/create extension[^;]*;/, '')
const seed = fs.readFileSync(R + 'seed.sql', 'utf8')
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

async function makeDevice(withSync: boolean) {
  const pg = new PGlite()
  await pg.exec(STUB)
  await pg.exec(schema)
  await pg.exec(seed)
  await pg.exec(`insert into farm (name) values ('My farm')`)
  if (withSync) {
    await pg.exec(syncLocal)
    await pg.exec(`delete from sync_outbox`)   // seed ran before the triggers
  }
  return pg
}

function asLocal(pg: PGlite): Local {
  return {
    async query<T = Row>(sql: string, params?: unknown[]) {
      const { rows } = await pg.query<T>(sql, params)
      return { rows }
    },
    async applying<T>(fn: () => Promise<T>) {
      await pg.query(`select set_config('farmhand.applying','on',false)`)
      try { return await fn() } finally {
        await pg.query(`select set_config('farmhand.applying','off',false)`)
      }
    },
    async getState(key) {
      const { rows } = await pg.query<{ value: string }>(
        `select value from sync_state where key=$1`, [key])
      return rows[0]?.value ?? null
    },
    async setState(key, value) {
      await pg.query(
        `insert into sync_state (key,value) values ($1,$2)
         on conflict (key) do update set value=excluded.value`, [key, value])
    },
  }
}

/** A PGlite standing in for Supabase. */
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
      const extra = table === 'term' ? ' and farm_id is not null' : ''
      const { rows } = await pg.query<Row>(
        `select * from "${table}" where updated_at > $1${extra}
         order by updated_at asc limit $2`, [since, limit])
      return rows
    },
    async selectLogAssets(logIds) {
      if (!logIds.length) return []
      const { rows } = await pg.query<Row>(
        `select * from log_asset where log_id = any($1::uuid[])`, [logIds])
      return rows
    },
  }
}

// ---------------------------------------------------------------------------

const server = await makeDevice(false)
const A = await makeDevice(true)
const B = await makeDevice(true)
const remote = asRemote(server)

const one = async (pg: PGlite, sql: string, p: unknown[] = []) =>
  (await pg.query<{ id: string }>(sql, p)).rows[0].id
const count = async (pg: PGlite, sql: string, p: unknown[] = []) =>
  Number((await pg.query<{ n: number }>(sql, p)).rows[0].n)

const farm = await one(A, `select id from farm limit 1`)

// The farm row is established remotely by the create_farm RPC when a user
// first signs in, adopting the device's existing id — not by a push. It is
// written before the triggers exist, so it is never in the outbox.
await server.exec(`delete from farm`)
await server.query(`insert into farm (id, name) values ($1, 'My farm')`, [farm])

console.log('\nDevice A records a batch')
const flock = await one(A,
  `insert into asset (farm_id,type,name,attributes)
   values ($1,'group','Spring broilers','{"headcount":75}') returning id`, [farm])
const log = await one(A,
  `insert into log (farm_id,type,timestamp,name)
   values ($1,'harvest',now(),'Eggs collected') returning id`, [farm])
await A.query(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`,
  [log, flock])
await A.query(
  `insert into quantity (farm_id,log_id,measure,value,unit)
   values ($1,$2,'count',18,'each')`, [farm, log])

check('A has queued its writes', await count(A, `select count(*)::int n from sync_outbox`) >= 4)

console.log('\nA syncs up')
const up = await runSync(asLocal(A), remote)
check('push reported rows', up.pushed >= 4, `${up.pushed} pushed`)
check('server has the farm', await count(server, `select count(*)::int n from farm`) === 1)
check('server has the flock', await count(server,
  `select count(*)::int n from asset where id=$1`, [flock]) === 1)
check('server has the log', await count(server,
  `select count(*)::int n from log where id=$1`, [log]) === 1)
check('server has the link', await count(server,
  `select count(*)::int n from log_asset where log_id=$1`, [log]) === 1)
check('server has the quantity', await count(server,
  `select count(*)::int n from quantity where log_id=$1`, [log]) === 1)
check("A's outbox is now empty", await count(A, `select count(*)::int n from sync_outbox`) === 0)
// The server seeded its own 90 terms. If A had pushed its copies too we would
// see 180, and every species would appear twice in the app's dropdowns.
const serverTerms = await count(server, `select count(*)::int n from term`)
check('shared vocabulary was not duplicated', serverTerms === 90, `${serverTerms} terms`)

console.log('\nDevice B syncs down')
await B.exec(`delete from farm`)          // B adopts A's farm, as linkFarm does
const down = await runSync(asLocal(B), remote)
check('pull reported rows', down.pulled >= 3, `${down.pulled} pulled`)
check('B sees the flock', await count(B,
  `select count(*)::int n from asset where id=$1`, [flock]) === 1)
check('B sees the log', await count(B,
  `select count(*)::int n from log where id=$1`, [log]) === 1)
check('B sees the link', await count(B,
  `select count(*)::int n from log_asset where log_id=$1`, [log]) === 1)
check('B sees the quantity', await count(B,
  `select count(*)::int n from quantity where log_id=$1`, [log]) === 1)

// The whole point: pulled rows must not look like local edits.
check('B does NOT queue what it pulled',
  await count(B, `select count(*)::int n from sync_outbox`) === 0,
  `${await count(B, `select count(*)::int n from sync_outbox`)} queued`)

console.log('\nB edits, A picks it up')
await B.query(`update asset set name='Spring broilers (2026)', updated_at=now() where id=$1`,
  [flock])
check('B queued its own edit', await count(B, `select count(*)::int n from sync_outbox`) === 1)
await runSync(asLocal(B), remote)
await runSync(asLocal(A), remote)
const nameOnA = (await A.query<{ name: string }>(
  `select name from asset where id=$1`, [flock])).rows[0].name
check('A received the rename', nameOnA === 'Spring broilers (2026)', nameOnA)

console.log('\nRepeat sync is quiet')
const again = await runSync(asLocal(A), remote)
check('nothing left to push', again.pushed === 0, `${again.pushed}`)
check('A outbox still empty', await count(A, `select count(*)::int n from sync_outbox`) === 0)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
