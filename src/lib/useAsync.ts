import { useCallback, useEffect, useState } from 'react'
import { onDataChanged } from './dataSignal'

/** Runs an async query, re-runs on demand. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)

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
  useEffect(() => onDataChanged(reload), [reload])

  return { data, error, loading, reload }
}
