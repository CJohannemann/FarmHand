/**
 * A signal that the local database was just changed by the person using the
 * app, so sync can push shortly after instead of leaving the record sitting
 * on the device until the next 60-second tick — the window in which a phone
 * left in a barn, or closed and forgotten, loses work it looked like it had
 * saved.
 *
 * Kept as its own leaf module, with no imports: db/client.ts is the only
 * caller, but this is the part worth testing on its own (see
 * db/test/verify-write-signal.ts) and client.ts drags a Worker and the
 * whole sync algorithm in behind it.
 */

const listeners = new Set<() => void>()

/** Returns its own unsubscribe. */
export function onLocalWrite(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// Recognising writes from the SQL itself, at the single point every query
// funnels through, rather than asking ~40 call sites in queries.ts to
// remember to announce themselves — one forgotten call there is a record
// that silently syncs late.
const MUTATION = /^\s*(insert|update|delete|replace)\b/i
// sync_state/sync_outbox/sync_control are the bookkeeping sync itself
// writes. They must never count: setSyncState('lastSyncedAt', ...) runs at
// the end of EVERY sync, so treating one as a local write would have each
// sync schedule the next, forever, with no user action involved at all.
const BOOKKEEPING = /\bsync_(state|outbox|control)\b/i

/**
 * Whether this statement is a local edit worth pushing. Exported for its
 * own test rather than kept private: the bookkeeping exclusion is the one
 * line standing between "push shortly after a write" and an endless
 * self-triggering sync loop, and that is not a thing to find out about in
 * production.
 */
export function isPushableWrite(sql: string): boolean {
  return MUTATION.test(sql) && !BOOKKEEPING.test(sql)
}

// Rows arriving from a pull are written through the same path. They are not
// local edits and must not schedule a push — the outbox trigger already
// skips them for exactly this reason. Counted rather than a boolean so
// nesting cannot clear the flag early.
let applyingDepth = 0

export function beginApplying(): void { applyingDepth++ }
export function endApplying(): void { applyingDepth = Math.max(0, applyingDepth - 1) }

export function noteWrite(sql: string): void {
  if (applyingDepth > 0) return
  if (!isPushableWrite(sql)) return
  for (const listener of listeners) listener()
}
