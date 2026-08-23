import { PGlite } from '@electric-sql/pglite'
import schemaSql from '../../db/schema.sql?raw'
import seedSql from '../../db/seed.sql?raw'

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

let pending: Promise<PGlite> | null = null

export function db(): Promise<PGlite> {
  if (!pending) pending = open()
  return pending
}

async function open(): Promise<PGlite> {
  // idb:// persists to IndexedDB, so records survive a page reload —
  // the same mechanism that will let the app work with no signal.
  const pg = new PGlite('idb://farmhand')
  const { rows } = await pg.query<{ t: string | null }>(
    `select to_regclass('public.farm') as t`,
  )
  if (!rows[0]?.t) await migrate(pg)
  return pg
}

async function migrate(pg: PGlite) {
  await pg.exec(AUTH_STUB)
  // pgcrypto is unavailable in PGlite; gen_random_uuid() is core since PG13.
  await pg.exec(schemaSql.replace(/create extension[^;]*;/, ''))
  await pg.exec(seedSql)
  await pg.exec(`insert into farm (name) values ('My farm')`)
}

/** Wipe local data and rebuild. Development convenience. */
export async function resetDb() {
  const pg = await db()
  await pg.exec(`drop schema public cascade; create schema public;`)
  await migrate(pg)
}
