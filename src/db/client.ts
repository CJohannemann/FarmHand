// Table list lives with the algorithm that uses it.
import { SYNCED_TABLES } from '../lib/syncCore'
import { parseJsonColumns } from './json'
import { beginApplying, endApplying, noteWrite } from './writeSignal'
export { SYNCED_TABLES }
export { onLocalWrite } from './writeSignal'

export interface DbHandle {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(sql: string): Promise<void>
}

let pending: Promise<DbHandle> | null = null

// The database itself runs in a Worker (see worker.ts) so a query never
// blocks the UI thread — this is just a postMessage RPC stub. wa-sqlite has
// no built-in Worker wrapper the way PGlite did, so this file hand-rolls the
// small piece PGliteWorker used to provide for free: a request id, a promise
// per in-flight call, and a single message listener that resolves or rejects
// the right one.
export function db(): Promise<DbHandle> {
  if (!pending) pending = open()
  return pending
}

async function open(): Promise<DbHandle> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

  let nextId = 1
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  // Worker boot posts one unsolicited message with id 0 — a message the
  // worker sends once it has booted. If the worker script itself fails to
  // start (a module-worker quirk on an older WebKit, say), nothing ever
  // posts that message and the promise hangs forever with no error. Raced
  // against a startup error from the worker itself, or a flat timeout, so a
  // broken worker surfaces as a message instead of an app that just sits on
  // the boot screen.
  const ready = new Promise<void>((resolve, reject) => {
    const onReady = (ev: MessageEvent<{ id: number; error?: string }>) => {
      if (ev.data.id !== 0) return
      worker.removeEventListener('message', onReady)
      if (ev.data.error) reject(new Error(ev.data.error))
      else resolve()
    }
    worker.addEventListener('message', onReady)
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

  worker.addEventListener('message', (ev: MessageEvent<{
    id: number; result?: unknown; error?: string
  }>) => {
    const { id, result, error } = ev.data
    const call = waiting.get(id)
    if (!call) return
    waiting.delete(id)
    if (error) call.reject(new Error(error))
    else call.resolve(result)
  })

  function send(method: 'query' | 'exec', args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId++
      waiting.set(id, { resolve, reject })
      worker.postMessage({ id, method, args })
    })
  }

  await ready
  return {
    // The worker's actual response shape does match `{ rows: T[] }` for
    // whatever T the caller asked for; this is just where that boundary gets
    // asserted, since `send()` itself only knows it got an `unknown` value
    // back over postMessage.
    //
    // JSON columns are parsed here, at the single point every read passes
    // through — queries.ts for the screens, and sync.ts's Local adapter for
    // push — so both see the objects callers were written against, exactly
    // as PGlite used to hand them back. See db/json.ts.
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await (send('query', [sql, params]) as unknown as Promise<{ rows: T[] }>)
      // Only after it succeeded — a rejected write has nothing to push.
      noteWrite(sql)
      return { rows: parseJsonColumns(result.rows) }
    },
    exec: (sql: string) => send('exec', [sql]) as Promise<void>,
  }
}

/** Suppress outbox writes while applying rows pulled from the server. */
export async function applying<T>(fn: () => Promise<T>): Promise<T> {
  const pg = await db()
  await pg.query(`update sync_control set applying = 1`)
  beginApplying()
  try {
    return await fn()
  } finally {
    endApplying()
    await pg.query(`update sync_control set applying = 0`)
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
