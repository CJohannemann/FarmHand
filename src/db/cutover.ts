import { pushFrom } from '../lib/sync'
import type { Local, Row } from '../lib/syncCore'
// Type-only: erased at compile time, so it never pulls PGlite's ~13.5MB
// runtime into the app's normal bundle. The actual module is loaded with a
// dynamic import() below, and only in the one branch that has already
// confirmed there is old data to read.
import type { PGlite } from '@electric-sql/pglite'

// One-time gate for devices still running the old PGlite/Postgres local
// engine, from before the switch to SQLite (wa-sqlite) — see the project's
// migration plan. The old database is wiped rather than migrated in place
// (a normal pull() from Supabase repopulates the new engine — cheap for the
// handful of records a farm actually has), but only after anything still
// queued in its outbox has been pushed, so a write made just before the
// update is never silently lost.

const ENGINE_KEY = 'farmhand.dbEngine'
const CURRENT_ENGINE = 'sqlite-v1'

// The literal IndexedDB database name PGlite's `idb://farmhand` creates —
// confirmed empirically (Emscripten's IDBFS names the database after the
// mount path, `/pglite/<dataDir>`), not documented anywhere as a stable API,
// but this code only ever needs to recognize the one name this app itself
// has ever used.
const OLD_IDB_NAME = '/pglite/farmhand'

// wa-sqlite's IDBBatchAtomicVFS uses its constructor argument directly as
// the IndexedDB database name (confirmed in wa-sqlite/src/examples/
// IDBBatchAtomicVFS.js) — worker.ts constructs it with `new
// IDBBatchAtomicVFS('farmhand')`, so this is that same literal name.
const CURRENT_IDB_NAME = 'farmhand'

const WIPE_PENDING_KEY = 'farmhand.wipePending'


/**
 * Honours a wipe flag left by an older build, and nothing sets one any more.
 *
 * Wiping used to mean flagging here and deleting the whole IndexedDB
 * database on the next boot. That delete blocks while any other tab has the
 * app open, and this waited five seconds and then reported success anyway —
 * so with a second tab open the flag was cleared, nothing was deleted, and
 * a fresh signup on that device inherited every record. Deleting an account
 * and clearing a revoked member both go through db/client.ts's
 * resetLocalData() now, which drops the tables through the open connection
 * and cannot be blocked.
 *
 * Kept because a device flagged by an older build is still carrying that
 * flag, and this is what finally clears it.
 */
export async function consumeWipeIfPending(): Promise<void> {
  if (localStorage.getItem(WIPE_PENDING_KEY) !== '1') return
  try {
    await deleteDatabase(CURRENT_IDB_NAME)
  } finally {
    localStorage.removeItem(WIPE_PENDING_KEY)
  }
}

export type CutoverResult =
  | { ok: true }
  | { ok: false; reason: 'offline' }
  | { ok: false; reason: 'error'; message: string }

export async function ensureCutover(): Promise<CutoverResult> {
  if (localStorage.getItem(ENGINE_KEY) === CURRENT_ENGINE) {
    // Already migrated, possibly on an earlier boot — best-effort, non-
    // blocking cleanup of a leftover old database (see the note on
    // deleteDatabase() below for why that couldn't happen on the same boot
    // that did the migrating). Cheap even when there is nothing to do: one
    // indexedDB.databases() call, no PGlite involved.
    void cleanupOldDatabaseIfPresent()
    return { ok: true }
  }

  if (!(await oldDatabaseExists())) {
    // Nothing to migrate — either a brand new install, or already cleaned
    // up by a previous run of this function. Either way, never worth
    // loading the old ~13.5MB engine just to confirm that.
    localStorage.setItem(ENGINE_KEY, CURRENT_ENGINE)
    return { ok: true }
  }

  try {
    const { PGlite } = await import('@electric-sql/pglite')
    const old = new PGlite('idb://farmhand')
    try {
      if ((await pendingCountOf(old)) > 0) {
        if (!navigator.onLine) return { ok: false, reason: 'offline' }
        await pushFrom(oldLocalAdapter(old))
      }
    } finally {
      await old.close()
    }
    // Not deleted here — see deleteDatabase()'s comment. cleanupOldDatabaseIfPresent()
    // picks it up on a later boot instead.
  } catch (e) {
    return { ok: false, reason: 'error', message: (e as Error).message }
  }

  localStorage.setItem(ENGINE_KEY, CURRENT_ENGINE)
  return { ok: true }
}

async function cleanupOldDatabaseIfPresent(): Promise<void> {
  try {
    if (await oldDatabaseExists()) await deleteDatabase(OLD_IDB_NAME)
  } catch {
    // Best-effort — a future boot gets another chance.
  }
}

async function oldDatabaseExists(): Promise<boolean> {
  // Not implemented everywhere as of this writing, but present in every
  // browser this app actually targets; a browser without it just pays the
  // one-time cost of opening the old engine to find out for itself instead.
  if (typeof indexedDB.databases !== 'function') return true
  const dbs = await indexedDB.databases()
  return dbs.some((d) => d.name === OLD_IDB_NAME)
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    const timeout = setTimeout(resolve, 5000)
    req.onsuccess = () => { clearTimeout(timeout); resolve() }
    req.onerror = () => {
      clearTimeout(timeout)
      reject(req.error ?? new Error(`failed to delete database "${name}"`))
    }
    // Only ever called from a page that never itself opened the old
    // database (see the split between this and ensureCutover() above) —
    // confirmed empirically that calling this right after `await
    // old.close()` in the *same* page leaves it permanently blocked, not
    // just briefly: PGlite's close() apparently doesn't fully release its
    // IndexedDB connection in a way `deleteDatabase()` recognizes, even
    // seconds later. A later, unrelated page load has no such lingering
    // connection and deletes cleanly. This onblocked handler and the
    // timeout above are only a safety net for a genuinely different tab
    // still having the old engine open.
    req.onblocked = () => {}
  })
}

async function pendingCountOf(pg: PGlite): Promise<number> {
  const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from sync_outbox`)
  return rows[0]?.n ?? 0
}

/** The old engine, as syncCore's push() wants to see it — mirrors the pre-migration db/client.ts. */
function oldLocalAdapter(pg: PGlite): Local {
  return {
    async query<T = Row>(sql: string, params?: unknown[]) {
      const { rows } = await pg.query<T>(sql, params)
      return { rows }
    },
    async applying<T>(fn: () => Promise<T>) {
      await pg.query(`select set_config('farmhand.applying', 'on', false)`)
      try {
        return await fn()
      } finally {
        await pg.query(`select set_config('farmhand.applying', 'off', false)`)
      }
    },
    async getState(key) {
      const { rows } = await pg.query<{ value: string }>(
        `select value from sync_state where key = $1`, [key],
      )
      return rows[0]?.value ?? null
    },
    async setState(key, value) {
      await pg.query(
        `insert into sync_state (key, value) values ($1, $2)
         on conflict (key) do update set value = excluded.value`,
        [key, value],
      )
    },
  }
}
