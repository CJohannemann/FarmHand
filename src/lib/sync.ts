import { supabase } from './supabase'
import { applying, db, getSyncState, setSyncState } from '../db/client'
import {
  runSync, SyncError, type Local, type Remote, type Row, type SyncResult,
} from './syncCore'

export { SyncError }
export type { SyncResult }

/** The local device database, as the algorithm wants to see it. */
const local: Local = {
  async query<T = Row>(sql: string, params?: unknown[]) {
    const pg = await db()
    const { rows } = await pg.query<T>(sql, params)
    return { rows }
  },
  applying,
  getState: getSyncState,
  setState: setSyncState,
}

/** Supabase, as the algorithm wants to see it. */
const remote: Remote = {
  async upsert(table, rows, conflict) {
    const { error } = await supabase!
      .from(table)
      .upsert(rows, { onConflict: conflict.join(',') })
    if (error) throw new SyncError(`Pushing ${table}: ${error.message}`)
  },

  async selectSince(table, since, limit) {
    let q = supabase!
      .from(table)
      .select('*')
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(limit)

    // Seeded vocabulary exists on both sides already, with different ids.
    if (table === 'term') q = q.not('farm_id', 'is', null)

    const { data, error } = await q
    if (error) throw new SyncError(`Pulling ${table}: ${error.message}`)
    return (data ?? []) as Row[]
  },

  async selectLogAssets(logIds) {
    if (logIds.length === 0) return []
    const out: Row[] = []
    for (let i = 0; i < logIds.length; i += 500) {
      const { data, error } = await supabase!
        .from('log_asset').select('*').in('log_id', logIds.slice(i, i + 500))
      if (error) throw new SyncError(`Pulling log_asset: ${error.message}`)
      if (data) out.push(...(data as Row[]))
    }
    return out
  },
}

let running: Promise<SyncResult> | null = null

/** One push-then-pull cycle. Concurrent calls share the in-flight run. */
export function syncNow(): Promise<SyncResult> {
  if (!running) running = run().finally(() => { running = null })
  return running
}

async function run(): Promise<SyncResult> {
  if (!supabase) throw new SyncError('Supabase is not configured.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new SyncError('Not signed in.')
  return runSync(local, remote)
}

// ------------------------------------------------------------------ status

export async function pendingCount(): Promise<number> {
  const { rows } = await local.query<{ n: number }>(
    `select count(*)::int as n from sync_outbox`,
  )
  return rows[0]?.n ?? 0
}

export async function lastSyncedAt(): Promise<string | null> {
  return getSyncState('lastSyncedAt')
}
