/**
 * The sync algorithm, with no dependency on Supabase or on Vite.
 *
 * Kept separate from sync.ts so it can be driven against a stand-in server in
 * tests. The network half is verified separately; what lives here is the part
 * with the sharp edges — watermarks, ordering, and not pushing back what was
 * just pulled.
 */

export type Row = Record<string, unknown>

/** Tables that sync, in an order that satisfies their foreign keys. */
export const SYNCED_TABLES = [
  'farm', 'term', 'location', 'asset', 'log', 'log_asset', 'quantity',
] as const

export const PAGE = 500
const EPOCH = '1970-01-01T00:00:00Z'

/**
 * Clock skew between devices means a row written on a slow phone can carry a
 * timestamp slightly before one already pulled. Re-reading a short window on
 * every pull costs a handful of redundant rows and avoids losing records.
 */
export const OVERLAP_MS = 60_000

/** Composite keys, for tables without a single id column. */
const CONFLICT: Record<string, string[]> = { log_asset: ['log_id', 'asset_id', 'role'] }
export const keyFor = (t: string) => CONFLICT[t] ?? ['id']

export class SyncError extends Error {}

/** Everything the algorithm needs from the outside world. */
export interface Remote {
  upsert(table: string, rows: Row[], conflict: string[]): Promise<void>
  /** Rows with updated_at > since, ascending, at most `limit`. */
  selectSince(table: string, since: string, limit: number): Promise<Row[]>
  /** log_asset rows belonging to the given logs. */
  selectLogAssets(logIds: string[]): Promise<Row[]>
}

export interface Local {
  query<T = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  /** Run fn with the outbox trigger suppressed. */
  applying<T>(fn: () => Promise<T>): Promise<T>
  getState(key: string): Promise<string | null>
  setState(key: string, value: string): Promise<void>
}

export interface SyncResult { pushed: number; pulled: number; at: string }

export async function runSync(local: Local, remote: Remote): Promise<SyncResult> {
  const pushed = await push(local, remote)
  const pulled = await pull(local, remote)
  const at = new Date().toISOString()
  await local.setState('lastSyncedAt', at)
  return { pushed, pulled, at }
}

// ------------------------------------------------------------------- push

export async function push(local: Local, remote: Remote): Promise<number> {
  let total = 0

  for (const tbl of SYNCED_TABLES) {
    const { rows: queued } = await local.query<{ row_id: string }>(
      `select row_id from sync_outbox where tbl = $1 order by queued_at`, [tbl],
    )
    if (queued.length === 0) continue

    const rows = await localRowsFor(local, tbl, queued.map((q) => q.row_id))

    // System vocabulary is seeded on both sides with different ids; pushing it
    // would duplicate every species and breed.
    const outgoing = tbl === 'term'
      ? rows.filter((r) => r.farm_id !== null)
      : rows

    for (let i = 0; i < outgoing.length; i += PAGE) {
      await remote.upsert(tbl, outgoing.slice(i, i + PAGE), keyFor(tbl))
      total += Math.min(PAGE, outgoing.length - i)
    }

    // Only clear once the server has them, so a failed push retries.
    await local.query(`delete from sync_outbox where tbl = $1`, [tbl])
  }
  return total
}

async function localRowsFor(local: Local, tbl: string, ids: string[]): Promise<Row[]> {
  if (tbl === 'log_asset') {
    // Composite key; fetch by log and let the upsert sort out the rest.
    const logIds = [...new Set(ids.map((i) => i.split('|')[0]))]
    const { rows } = await local.query(
      `select * from log_asset where log_id = any($1::uuid[])`, [logIds],
    )
    return rows
  }
  const { rows } = await local.query(
    `select * from "${tbl}" where id = any($1::uuid[])`, [ids],
  )
  return rows
}

// ------------------------------------------------------------------- pull

export async function pull(local: Local, remote: Remote): Promise<number> {
  let total = 0
  for (const tbl of SYNCED_TABLES) {
    if (tbl === 'log_asset') continue   // pulled alongside its logs
    total += await pullTable(local, remote, tbl)
  }
  return total
}

async function pullTable(local: Local, remote: Remote, tbl: string): Promise<number> {
  const key = `pull:${tbl}`
  const stored = (await local.getState(key)) ?? EPOCH
  let since = new Date(new Date(stored).getTime() - OVERLAP_MS).toISOString()
  let total = 0

  for (;;) {
    const data = await remote.selectSince(tbl, since, PAGE)
    if (data.length === 0) break

    await local.applying(async () => {
      await upsertLocal(local, tbl, data)
      if (tbl === 'log') {
        const links = await remote.selectLogAssets(data.map((r) => String(r.id)))
        if (links.length) await upsertLocal(local, 'log_asset', links)
      }
    })

    total += data.length
    const last = String(data[data.length - 1].updated_at)
    await local.setState(key, last)

    if (data.length < PAGE) break
    if (last === since) break        // all one timestamp; avoid looping forever
    since = last
  }
  return total
}

export async function upsertLocal(local: Local, tbl: string, rows: Row[]) {
  if (rows.length === 0) return
  const cols = Object.keys(rows[0])
  const conflict = keyFor(tbl)
  const assignments = cols
    .filter((c) => !conflict.includes(c))
    .map((c) => `"${c}" = excluded."${c}"`)

  const sql =
    `insert into "${tbl}" (${cols.map((c) => `"${c}"`).join(', ')}) ` +
    `values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ` +
    `on conflict (${conflict.map((c) => `"${c}"`).join(', ')}) ` +
    (assignments.length ? `do update set ${assignments.join(', ')}` : `do nothing`)

  for (const row of rows) {
    const values = cols.map((c) => {
      const v = row[c]
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
    })
    await local.query(sql, values)
  }
}
