import SQLiteAsyncESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs'
import * as SQLite from 'wa-sqlite'
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js'
import schemaSql from '../../db/schema.local.sql?raw'
import { seedLocalVocabulary } from '../../db/seedLocal.ts'

// The actual SQLite-in-WASM engine lives here, off the UI thread — a query
// never blocks rendering. The main thread only ever holds a small postMessage
// RPC stub (see client.ts) built by hand: unlike PGlite, wa-sqlite has no
// built-in Worker/RPC wrapper, so this file and client.ts together are what
// that convenience used to provide.
//
// wa-sqlite (unlike PGlite) ships no schema of its own — schema.local.sql is
// purpose-built for this local, single-farm database and is NOT a port of the
// remote db/schema.sql (RLS, farm_member, and the create_farm() RPC exist to
// police access between farms sharing one server, which a lone on-device copy
// has no use for). See schema.local.sql's own header for the full reasoning,
// including why there is no incremental migration story locally at all: this
// database is always rebuilt fresh rather than upgraded in place.

let sqlite3: SQLiteAPI
let db: number

/**
 * Bump this whenever schema.local.sql gains anything — a table, an index, a
 * trigger. A device that already has a database only ever ran the schema
 * once, at the moment it was created, so without this a new table simply
 * never exists there and the first query touching it fails with "no such
 * table". That is exactly how `receipt` shipped broken: sync died on every
 * device that had been used before receipts were added.
 */
const SCHEMA_VERSION = '2'
const SCHEMA_VERSION_KEY = 'localSchema'

async function open(): Promise<void> {
  const module = await SQLiteAsyncESMFactory()
  sqlite3 = SQLite.Factory(module)
  const vfs = new IDBBatchAtomicVFS('farmhand')
  sqlite3.vfs_register(vfs, true)
  db = await sqlite3.open_v2('farmhand')

  const { rows } = await queryRaw(
    `select name from sqlite_master where type = 'table' and name = 'farm'`,
  )
  const fresh = rows.length === 0
  if (fresh || (await schemaVersion()) !== SCHEMA_VERSION) await migrate(fresh)
}

/**
 * Runs the schema, then seeds only if this database is brand new.
 *
 * Every statement in schema.local.sql is `if not exists`, so running it
 * against a database that already has most of it creates whatever is
 * missing and leaves the rest — and the farm's records — untouched. That is
 * the whole upgrade story locally: no alter-table migrations to write, no
 * wipe-and-repull that would risk anything still sitting in the outbox.
 *
 * Guarded by a version rather than run every boot: these are cheap
 * statements but there are forty of them, and cold-boot time on a phone is
 * the one budget this database is actually tight on.
 */
async function migrate(fresh: boolean): Promise<void> {
  await sqlite3.exec(db, schemaSql)
  if (fresh) {
    const now = new Date().toISOString()
    await runRaw(
      `insert into farm (id, name, created_at, updated_at) values (?, ?, ?, ?)`,
      [crypto.randomUUID(), 'My farm', now, now],
    )
    await seedLocalVocabulary((sql, params) => runRaw(sql, params as SQLiteCompatibleType[]))
  }
  await runRaw(
    `insert into sync_state (key, value) values (?, ?)
     on conflict (key) do update set value = excluded.value`,
    [SCHEMA_VERSION_KEY, SCHEMA_VERSION],
  )
}

/**
 * Empty this device's database and rebuild it as if the app had never run
 * here — used when an account is deleted, and when someone signs in on a
 * device holding another account's records.
 *
 * Drops the tables and re-runs the schema rather than deleting the whole
 * IndexedDB database. That distinction is the entire point: deleting the
 * IndexedDB file needs every connection to it closed, so it BLOCKS while
 * any other tab has the app open — and the old code treated a five-second
 * timeout as success, cleared the "wipe me" flag, and left the records in
 * place with nobody any the wiser. A farm reported exactly that: deleted
 * the account, signed up fresh, and the new farm arrived carrying the old
 * one's chickens. Dropping tables goes through this same connection and
 * cannot be blocked by another tab.
 */
async function reset(): Promise<void> {
  // Triggers first: dropping a table takes its triggers with it, but a
  // trigger left behind referencing a dropped table is a landmine.
  const triggers = await queryRaw(
    `select name from sqlite_master where type = 'trigger'`,
  )
  for (const t of triggers.rows) await execRaw(`drop trigger if exists "${t.name}"`)

  const { rows } = await queryRaw(
    `select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`,
  )
  // Foreign keys are declared but not enforced by default here, so the
  // order tables go in does not matter.
  for (const r of rows) await execRaw(`drop table if exists "${r.name}"`)

  await migrate(true)
}

/** Null on a database predating this marker, which is a database needing the upgrade. */
async function schemaVersion(): Promise<string | null> {
  try {
    const { rows } = await queryRaw(
      `select value from sync_state where key = '${SCHEMA_VERSION_KEY}'`,
    )
    return (rows[0]?.[0] as string) ?? null
  } catch {
    return null
  }
}

/**
 * Every caller elsewhere writes Postgres-style numbered placeholders
 * ($1, $2, ...) — this is the one place that gets translated to SQLite's
 * anonymous `?`. Each occurrence becomes its own `?` with the bound value
 * duplicated from the original array, rather than a bare `$N` -> `?N`
 * rename: reusing one bound value across two occurrences of the same
 * placeholder number (a pattern several queries rely on, matching Postgres)
 * cannot be assumed to work the same way against every SQLite binding —
 * verified during the Node-side migration work that at least one common
 * driver does not.
 */
function expandParams(
  sql: string, params: SQLiteCompatibleType[] = [],
): { sql: string; params: SQLiteCompatibleType[] } {
  const expanded: SQLiteCompatibleType[] = []
  const expandedSql = sql.replace(/\$(\d+)/g, (_, n: string) => {
    expanded.push(params[Number(n) - 1])
    return '?'
  })
  return { sql: expandedSql, params: expanded }
}

async function queryRaw(
  sql: string, params: SQLiteCompatibleType[] = [],
): Promise<{ rows: Record<string, unknown>[] }> {
  const { rows, columns } = await sqlite3.execWithParams(db, sql, params)
  return {
    rows: rows.map((row: unknown[]) => Object.fromEntries(columns.map((c, i) => [c, row[i]]))),
  }
}

async function runRaw(sql: string, params?: SQLiteCompatibleType[]): Promise<void> {
  await sqlite3.execWithParams(db, sql, params ?? [])
}

async function execRaw(sql: string): Promise<void> {
  await sqlite3.exec(db, sql)
}

// ------------------------------------------------------------------- RPC

interface Request { id: number; method: 'query' | 'exec' | 'reset'; args: unknown[] }
interface Response { id: number; result?: unknown; error?: string }

const ready = open()

// wa-sqlite's async build runs on Asyncify, which is not reentrant: a second
// call into the WASM module before a first one's unwind/rewind cycle finishes
// corrupts its memory outright (seen directly as "memory access out of
// bounds" / "Aborted(RuntimeError: unreachable)" crashes once more than one
// query was in flight at a time — e.g. a few effects each firing their own
// query on mount). Every RPC call is chained onto this single promise so the
// engine only ever sees one call at a time, in arrival order.
let queue: Promise<void> = Promise.resolve()

self.addEventListener('message', (ev: MessageEvent<Request>) => {
  const { id, method, args } = ev.data
  // eslint-disable-next-line no-unused-vars -- chained onto itself to serialize calls
  queue = queue.then(() => handle(id, method, args))
})

async function handle(id: number, method: Request['method'], args: unknown[]): Promise<void> {
  try {
    await ready
    let result: unknown
    if (method === 'query') {
      const { sql, params } = expandParams(
        args[0] as string, args[1] as SQLiteCompatibleType[] | undefined,
      )
      result = await queryRaw(sql, params)
    } else if (method === 'reset') {
      await reset()
      result = undefined
    } else {
      await execRaw(args[0] as string)
      result = undefined
    }
    postMessage({ id, result } satisfies Response)
  } catch (e) {
    postMessage({ id, error: (e as Error).message } satisfies Response)
  }
}

ready.then(
  () => postMessage({ id: 0, result: 'ready' } satisfies Response),
  (e: Error) => postMessage({ id: 0, error: e.message } satisfies Response),
)
