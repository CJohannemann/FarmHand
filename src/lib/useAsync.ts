import { useCallback, useEffect, useState } from 'react'

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

  return { data, error, loading, reload }
}
