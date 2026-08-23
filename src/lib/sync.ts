import { supabase } from './supabase'
import {
  applying, db, getSyncState, setSyncState, SYNCED_TABLES,
} from '../db/client'

const PAGE = 500
const EPOCH = '1970-01-01T00:00:00Z'

/**
 * Clock skew between devices means a row written on a slow phone can carry a
 * timestamp slightly before one already pulled. Re-reading a short window on
 * every pull costs a handful of redundant rows and avoids losing records.
 */
const OVERLAP_MS = 60_000

/** Composite keys, for tables without a single id column. */
const CONFLICT: Record<string, string[]> = { log_asset: ['log_id', 'asset_id', 'role'] }
const keyFor = (t: string) => CONFLICT[t] ?? ['id']

export interface SyncResult {
  pushed: number
  pulled: number
  at: string
}

export class SyncError extends Error {}

let running: Promise<SyncResult> | null = null

/** One push-then-pull cycle. Concurrent calls share the in-flight run. */
export function syncNow(): Promise<SyncResult> {
  if (!running) {
    running = run().finally(() => { running = null })
  }
  return running
}

async function run(): Promise<SyncResult> {
  if (!supabase) throw new SyncError('Supabase is not configured.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new SyncError('Not signed in.')

  const pushed = await push()
  const pulled = await pull()
  const at = new Date().toISOString()
  await setSyncState('lastSyncedAt', at)
  return { pushed, pulled, at }
}

// ------------------------------------------------------------------- push

async function push(): Promise<number> {
  const pg = await db()
  let total = 0

  for (const tbl of SYNCED_TABLES) {
    const { rows: queued } = await pg.query<{ row_id: string }>(
      `select row_id from sync_outbox where tbl = $1 order by queued_at`, [tbl],
    )
    if (queued.length === 0) continue

    const rows = await localRowsFor(tbl, queued.map((q) => q.row_id))

    // System vocabulary is seeded on both sides with different ids; pushing it
    // would duplicate every species and breed.
    const outgoing = tbl === 'term'
      ? rows.filter((r) => r.farm_id !== null)
      : rows

    for (let i = 0; i < outgoing.length; i += PAGE) {
      const chunk = outgoing.slice(i, i + PAGE)
      const { error } = await supabase!
        .from(tbl)
        .upsert(chunk, { onConflict: keyFor(tbl).join(',') })
      if (error) throw new SyncError(`Pushing ${tbl}: ${error.message}`)
      total += chunk.length
    }

    // Only clear once the server has them, so a failed push retries.
    await pg.query(`delete from sync_outbox where tbl = $1`, [tbl])
  }
  return total
}

async function localRowsFor(tbl: string, ids: string[]) {
  const pg = await db()
  if (tbl === 'log_asset') {
    // Composite key; fetch by log and let the upsert sort out the rest.
    const logIds = [...new Set(ids.map((i) => i.split('|')[0]))]
    const { rows } = await pg.query<Record<string, unknown>>(
      `select * from log_asset where log_id = any($1::uuid[])`, [logIds],
    )
    return rows
  }
  const { rows } = await pg.query<Record<string, unknown>>(
    `select * from "${tbl}" where id = any($1::uuid[])`, [ids],
  )
  return rows
}

// ------------------------------------------------------------------- pull

async function pull(): Promise<number> {
  let total = 0

  for (const tbl of SYNCED_TABLES) {
    if (tbl === 'log_asset') continue   // handled with its logs, below
    total += await pullTable(tbl)
  }
  return total
}

async function pullTable(tbl: string): Promise<number> {
  const key = `pull:${tbl}`
  const stored = (await getSyncState(key)) ?? EPOCH
  let since = new Date(new Date(stored).getTime() - OVERLAP_MS).toISOString()
  let total = 0

  for (;;) {
    let q = supabase!
      .from(tbl)
      .select('*')
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(PAGE)

    // Seeded vocabulary exists on both sides already.
    if (tbl === 'term') q = q.not('farm_id', 'is', null)

    const { data, error } = await q
    if (error) throw new SyncError(`Pulling ${tbl}: ${error.message}`)
    if (!data || data.length === 0) break

    await applying(async () => {
      await upsertLocal(tbl, data as Record<string, unknown>[])
      if (tbl === 'log') {
        await pullLogAssets((data as { id: string }[]).map((r) => r.id))
      }
    })

    total += data.length
    since = String(data[data.length - 1].updated_at)
    await setSyncState(key, since)

    if (data.length < PAGE) break
  }
  return total
}

/**
 * log_asset carries no updated_at of its own. Its rows are written with their
 * log, so pulling the logs that changed and then their links is sufficient.
 */
async function pullLogAssets(logIds: string[]) {
  if (logIds.length === 0) return
  for (let i = 0; i < logIds.length; i += PAGE) {
    const slice = logIds.slice(i, i + PAGE)
    const { data, error } = await supabase!
      .from('log_asset').select('*').in('log_id', slice)
    if (error) throw new SyncError(`Pulling log_asset: ${error.message}`)
    if (data?.length) await upsertLocal('log_asset', data as Record<string, unknown>[])
  }
}

async function upsertLocal(tbl: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return
  const pg = await db()
  const cols = Object.keys(rows[0])
  const conflict = keyFor(tbl)
  const assignments = cols
    .filter((c) => !conflict.includes(c))
    .map((c) => `"${c}" = excluded."${c}"`)

  const sql =
    `insert into "${tbl}" (${cols.map((c) => `"${c}"`).join(', ')}) ` +
    `values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ` +
    `on conflict (${conflict.map((c) => `"${c}"`).join(', ')}) ` +
    (assignments.length
      ? `do update set ${assignments.join(', ')}`
      : `do nothing`)

  for (const row of rows) {
    const values = cols.map((c) => {
      const v = row[c]
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
    })
    await pg.query(sql, values)
  }
}

// ------------------------------------------------------------------ status

export async function pendingCount(): Promise<number> {
  const pg = await db()
  const { rows } = await pg.query<{ n: number }>(
    `select count(*)::int as n from sync_outbox`,
  )
  return rows[0]?.n ?? 0
}

export async function lastSyncedAt(): Promise<string | null> {
  return getSyncState('lastSyncedAt')
}
