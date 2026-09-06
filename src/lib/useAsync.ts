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

  /**
   * `quiet` re-runs the query without raising `loading`, so a screen that
   * already has data keeps showing it while the fresh copy is fetched.
   *
   * Every caller renders `loading` as a one-line "Loading…" *instead of*
   * its content, which is right the first time and destructive afterwards:
   * a 200-row list collapsing to one line takes the page height with it,
   * the browser clamps the scroll position to the new height, and the rows
   * come back a moment later with the reader dumped at the top. Reported as
   * editing a record in Records and losing your place — twice, because
   * saving reloads once and the sync round-trip fires onDataChanged for a
   * second one just as you have scrolled back down.
   *
   * Only the mount-and-deps-change load below is loud. A refresh of data
   * already on screen has nothing to announce: same query, same screen, and
   * the rows it replaces are the rows it is replacing them with.
   */
  const load = useCallback((quiet = false) => {
    let live = true
    if (!quiet) setLoading(true)
    run().then(
      (v) => { if (live) { setData(v); setError(null); setLoading(false) } },
      (e) => { if (live) { setError(e as Error); setLoading(false) } },
    )
    return () => { live = false }
  }, [run])

  const reload = useCallback(() => load(true), [load])

  // Loud: there is nothing on screen yet to preserve, and a deps change
  // means what is there belongs to the old deps.
  useEffect(() => load(), [load])

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
