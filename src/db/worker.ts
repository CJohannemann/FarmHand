import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'
import schemaSql from '../../db/schema.sql?raw'
import seedSql from '../../db/seed.sql?raw'
import syncLocalSql from '../../db/sync-local.sql?raw'
import cropSeedSql from '../../db/migrations/002_crop_vocabulary.sql?raw'
import farmLocationSql from '../../db/migrations/003_farm_location.sql?raw'
import quailSeedSql from '../../db/migrations/004_quail.sql?raw'
import baleUnitsSql from '../../db/migrations/005_bale_units.sql?raw'
import equipmentSeedSql from '../../db/migrations/006_equipment.sql?raw'
import equipmentTerminalSql from '../../db/migrations/007_equipment_terminal.sql?raw'

// The actual Postgres-in-WASM engine lives here, off the UI thread — every
// query used to run on the main thread and block rendering, which is what
// made screen-to-screen navigation feel choppy. The main thread only ever
// holds a PGliteWorker RPC stub (see client.ts); this file is where the
// real work happens.

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

worker({
  async init() {
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
    await pg.exec(farmLocationSql)
    await pg.exec(cropSeedSql)
    await pg.exec(quailSeedSql)
    await pg.exec(baleUnitsSql)
    await pg.exec(equipmentSeedSql)
    await pg.exec(equipmentTerminalSql)
    return pg
  },
})

async function migrate(pg: PGlite) {
  await pg.exec(AUTH_STUB)
  // pgcrypto is unavailable in PGlite; gen_random_uuid() is core since PG13.
  await pg.exec(schemaSql.replace(/create extension[^;]*;/, ''))
  await pg.exec(seedSql)
  await pg.exec(`insert into farm (name) values ('My farm')`)
}

/** Outbox table and the triggers that fill it. Safe to run repeatedly. */
async function installSync(pg: PGlite) {
  await pg.exec(syncLocalSql)
}
