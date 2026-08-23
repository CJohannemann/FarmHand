import { PGlite } from '@electric-sql/pglite'
import schemaSql from '../../db/schema.sql?raw'
import seedSql from '../../db/seed.sql?raw'
import syncLocalSql from '../../db/sync-local.sql?raw'
import cropSeedSql from '../../db/migrations/002_crop_vocabulary.sql?raw'

// schema.sql targets Supabase, which provides auth.users and auth.uid().
// Locally we stand those up ourselves so one schema file serves both.
const AUTH_STUB = `
  do $r$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
    then create role authenticated; end if; end $r$;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid
    language sql stable as $q$ select null::uuid $q$;
`

// Table list lives with the algorithm that uses it.
import { SYNCED_TABLES } from '../lib/syncCore'
export { SYNCED_TABLES }

let pending: Promise<PGlite> | null = null

export function db(): Promise<PGlite> {
  if (!pending) pending = open()
  return pending
}

async function open(): Promise<PGlite> {
  // idb:// persists to IndexedDB, so records survive a page reload —
  // the same mechanism that lets the app work with no signal.
  const pg = new PGlite('idb://farmhand')
  const { rows } = await pg.query<{ t: string | null }>(
    `select to_regclass('public.farm') as t`,
  )
  if (!rows[0]?.t) await migrate(pg)
  // Both are cheap and idempotent, so they also upgrade databases created
  // before these existed — which is the whole migration story for now.
  await installSync(pg)
  await pg.exec(cropSeedSql)
  return pg
}

async function migrate(pg: PGlite) {
  await pg.exec(AUTH_STUB)
  // pgcrypto is unavailable in PGlite; gen_random_uuid() is core since PG13.
  await pg.exec(schemaSql.replace(/create extension[^;]*;/, ''))
  await pg.exec(seedSql)
  await pg.exec(`insert into farm (name) values ('My farm')`)
}

/** Outbox table and the triggers that fill it. Safe to run repeatedly. */
export async function installSync(pg: PGlite) {
  await pg.exec(syncLocalSql)
}

/** Suppress outbox writes while applying rows pulled from the server. */
export async function applying<T>(fn: () => Promise<T>): Promise<T> {
  const pg = await db()
  await pg.query(`select set_config('farmhand.applying', 'on', false)`)
  try {
    return await fn()
  } finally {
    await pg.query(`select set_config('farmhand.applying', 'off', false)`)
  }
}

export async function getSyncState(key: string): Promise<string | null> {
  const pg = await db()
  const { rows } = await pg.query<{ value: string }>(
    `select value from sync_state where key = $1`, [key],
  )
  return rows[0]?.value ?? null
}

export async function setSyncState(key: string, value: string) {
  const pg = await db()
  await pg.query(
    `insert into sync_state (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, value],
  )
}

/** Wipe local data and rebuild. Development convenience. */
export async function resetDb() {
  const pg = await db()
  await pg.exec(`drop schema public cascade; create schema public;`)
  await migrate(pg)
  await installSync(pg)
}
