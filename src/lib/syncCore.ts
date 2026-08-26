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

    // A log_asset row's log and asset are pushed here too, whether or not
    // they were independently queued — the 60-second auto-sync timer can
    // catch a multi-step write (create a lot, log a harvest, archive the
    // source) mid-flight, and a log_asset row for something this push
    // doesn't otherwise know about is exactly what trips the foreign key
    // and wedges every push after it, since a failed batch retries the
    // same missing reference forever.
    if (tbl === 'log_asset' && outgoing.length > 0) {
      await pushReferenced(local, remote, 'asset', outgoing.map((r) => String(r.asset_id)))
      await pushReferenced(local, remote, 'log', outgoing.map((r) => String(r.log_id)))
    }

    const ordered = orderByParent(outgoing)
    for (let i = 0; i < ordered.length; i += PAGE) {
      await remote.upsert(tbl, ordered.slice(i, i + PAGE), keyFor(tbl))
      total += Math.min(PAGE, ordered.length - i)
    }

    // Only clear once the server has them, so a failed push retries.
    await local.query(`delete from sync_outbox where tbl = $1`, [tbl])
  }
  return total
}

/** Pushes specific rows by id, regardless of whether they were queued. */
async function pushReferenced(local: Local, remote: Remote, tbl: string, ids: string[]) {
  const distinct = [...new Set(ids)]
  if (distinct.length === 0) return
  const { rows } = await local.query(
    `select * from "${tbl}" where id in (select value from json_each($1))`,
    [JSON.stringify(distinct)],
  )
  if (rows.length === 0) return
  const ordered = orderByParent(rows)
  for (let i = 0; i < ordered.length; i += PAGE) {
    await remote.upsert(tbl, ordered.slice(i, i + PAGE), keyFor(tbl))
  }
}

/**
 * asset, term and location all self-reference via parent_id, and reading rows
 * back by an id list makes no promise about what order they come back in — a
 * group's members can come back ahead of the group itself, since that has
 * nothing to do with which was inserted first. Pushing a member before its
 * still-unpushed parent trips the parent_id foreign key. Puts every row after
 * its own parent (recursively), stable otherwise; a cycle can't happen in
 * practice but `seen` keeps one from hanging if it ever did.
 */
function orderByParent(rows: Row[]): Row[] {
  if (rows.length === 0 || !('parent_id' in rows[0])) return rows
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  const ordered: Row[] = []
  const seen = new Set<string>()
  const visit = (r: Row) => {
    const id = String(r.id)
    if (seen.has(id)) return
    seen.add(id)
    const parent = r.parent_id ? byId.get(String(r.parent_id)) : undefined
    if (parent) visit(parent)
    ordered.push(r)
  }
  rows.forEach(visit)
  return ordered
}

async function localRowsFor(local: Local, tbl: string, ids: string[]): Promise<Row[]> {
  if (tbl === 'log_asset') {
    // Composite key; fetch by log and let the upsert sort out the rest.
    const logIds = [...new Set(ids.map((i) => i.split('|')[0]))]
    const { rows } = await local.query(
      `select * from log_asset where log_id in (select value from json_each($1))`,
      [JSON.stringify(logIds)],
    )
    return rows
  }
  const { rows } = await local.query(
    `select * from "${tbl}" where id in (select value from json_each($1))`,
    [JSON.stringify(ids)],
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
      // Same reason push orders these: a page can return a group's members
      // ahead of the group itself (createGroupWithMembers gives them all but
      // identical timestamps, so "ascending by updated_at" doesn't promise
      // parent-before-child), which trips parent_id's foreign key on insert.
      await upsertLocal(local, tbl, orderByParent(data))
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
