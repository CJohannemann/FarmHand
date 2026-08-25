import { PGliteWorker } from '@electric-sql/pglite/worker'

// Table list lives with the algorithm that uses it.
import { SYNCED_TABLES } from '../lib/syncCore'
export { SYNCED_TABLES }

let pending: Promise<PGliteWorker> | null = null

// The database itself runs in a Worker (see worker.ts) so a query never
// blocks the UI thread — this is just an RPC handle to it. Its query/exec
// API is identical to PGlite's, so every caller elsewhere is unaffected.
export function db(): Promise<PGliteWorker> {
  if (!pending) pending = open()
  return pending
}

async function open(): Promise<PGliteWorker> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

  // PGliteWorker.create() waits on a message the worker sends once it has
  // booted — if the worker script itself fails to start (a module-worker
  // quirk on an older WebKit, say), nothing ever posts that message and the
  // promise hangs forever with no error. Race it against a startup error
  // from the worker itself, or a flat timeout, so a broken worker surfaces
  // as a message instead of an app that just sits on the boot screen.
  const failure = new Promise<never>((_, reject) => {
    worker.addEventListener('error', (e) => {
      reject(new Error(`Database worker failed to start: ${e.message} (${e.filename}:${e.lineno})`))
    })
    worker.addEventListener('messageerror', () => {
      reject(new Error('Database worker sent an unreadable message.'))
    })
    setTimeout(() => reject(new Error(
      'Database worker did not respond within 20s — it may not have started at all.',
    )), 20_000)
  })

  return Promise.race([PGliteWorker.create(worker), failure])
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
