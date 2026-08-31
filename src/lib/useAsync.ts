import { useCallback, useEffect, useState } from 'react'
import { onDataChanged } from './dataSignal'

export interface UseAsyncOptions {
  /**
   * Opts out of the onDataChanged reload below — for the handful of
   * one-shot device-lifecycle checks (has the local database finished
   * opening, has this device's storage engine finished migrating) that
   * gate which *screen* renders at all, not a farm's data. One of those,
   * App.tsx's `ready`, gates literally everything: reloading it mid-session
   * re-runs its whole boot sequence and its `loading` flag briefly replaces
   * the entire app with the "Setting up your local database…" screen — a
   * flash reported right after picking a weather location, because saving
   * it writes the farm row, which pushes, and the pull half of that same
   * sync cycle immediately reports that same row as newly arrived. Nothing
   * about weather is special here; any write can trigger it. A query that
   * actually reads farm data wants the reload (that's the whole point of
   * onDataChanged); a query that reads "has this device finished booting"
   * does not, because it was never stale to begin with.
   */
  skipOnDataChanged?: boolean
}

/** Runs an async query, re-runs on demand. */
export function useAsync<T>(
  fn: () => Promise<T>, deps: unknown[] = [], options: UseAsyncOptions = {},
) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const { skipOnDataChanged = false } = options

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)

  const reload = useCallback(() => {
    let live = true
    setLoading(true)
    run().then(
      (v) => { if (live) { setData(v); setError(null); setLoading(false) } },
      (e) => { if (live) { setError(e as Error); setLoading(false) } },
    )
    return () => { live = false }
  }, [run])

  useEffect(() => reload(), [reload])

  // A screen that mounted and read local data before sync's first pull
  // finished — opening the app, or right after accepting a farm invite on
  // a device that started out empty — would otherwise show that first,
  // still-empty read forever. Re-reads whenever sync actually brings
  // something new in, not just on mount or an explicit reload().
  useEffect(() => {
    if (skipOnDataChanged) return
    // Each reload() hands back its own canceller, and two signals arriving
    // close together would otherwise leave both runs racing: if the earlier,
    // slower one settles last, it overwrites the newer result. Cancel the
    // run in flight before starting the next, and on unmount.
    let cancelRun: (() => void) | undefined
    const unsubscribe = onDataChanged(() => {
      cancelRun?.()
      cancelRun = reload()
    })
    return () => { cancelRun?.(); unsubscribe() }
  }, [reload, skipOnDataChanged])

  return { data, error, loading, reload }
}
