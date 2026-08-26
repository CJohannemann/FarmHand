import { supabase } from './supabase'
import { applying, db, getSyncState, setSyncState } from '../db/client'
import {
  push, runSync, SyncError, type Local, type Remote, type Row, type SyncResult,
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

/**
 * `error.message` alone rarely says which row — for a foreign key violation
 * the useful part ("Key (parent_id)=(...) is not present in table
 * \"asset\".") is in `details`, which the bare message drops.
 */
function describe(error: { message: string; details?: string }): string {
  return error.details ? `${error.message} (${error.details})` : error.message
}

/** Supabase, as the algorithm wants to see it. */
const remote: Remote = {
  async upsert(table, rows, conflict) {
    const { error } = await supabase!
      .from(table)
      .upsert(rows, { onConflict: conflict.join(',') })
    if (error) throw new SyncError(`Pushing ${table}: ${describe(error)}`)
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
    if (error) throw new SyncError(`Pulling ${table}: ${describe(error)}`)
    return (data ?? []) as Row[]
  },

  async selectLogAssets(logIds) {
    if (logIds.length === 0) return []
    const out: Row[] = []
    for (let i = 0; i < logIds.length; i += 500) {
      const { data, error } = await supabase!
        .from('log_asset').select('*').in('log_id', logIds.slice(i, i + 500))
      if (error) throw new SyncError(`Pulling log_asset: ${describe(error)}`)
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

/**
 * Pushes a *different* local database's outbox through the same Supabase
 * remote this module already talks to — for draining an old engine's queued
 * writes during the storage-engine cutover, before that database is thrown
 * away. Push only: there is no reason to pull data into a database about to
 * be deleted.
 */
export async function pushFrom(otherLocal: Local): Promise<number> {
  if (!supabase) throw new SyncError('Supabase is not configured.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new SyncError('Not signed in.')
  return push(otherLocal, remote)
}

// ------------------------------------------------------------------ status

export async function pendingCount(): Promise<number> {
  const { rows } = await local.query<{ n: number }>(
    `select count(*) as n from sync_outbox`,
  )
  return rows[0]?.n ?? 0
}

export async function lastSyncedAt(): Promise<string | null> {
  return getSyncState('lastSyncedAt')
}

export function ago(iso: string | null): string {
  if (!iso) return 'never'
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * The actual clock time of the last sync, not just "3m ago" — for someone
 * checking whether a sync actually happened around a specific moment (right
 * before losing signal, say), a relative age is the wrong unit.
 */
export function syncClockTime(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return d.toLocaleString(undefined, sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
