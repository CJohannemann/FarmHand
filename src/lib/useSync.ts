import { useCallback, useEffect, useRef, useState } from 'react'
import { lastSyncedAt, pendingCount, syncNow } from './sync'

const INTERVAL_MS = 60_000

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline'

export function useSync(enabled: boolean) {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [pending, setPending] = useState(0)
  const [last, setLast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    setPending(await pendingCount())
    setLast(await lastSyncedAt())
  }, [])

  const sync = useCallback(async () => {
    if (!enabled || busy.current) return
    if (!navigator.onLine) { setStatus('offline'); return }

    busy.current = true
    setStatus('syncing')
    try {
      await syncNow()
      setError(null)
      setStatus('idle')
    } catch (e) {
      setError((e as Error).message)
      setStatus('error')
    } finally {
      busy.current = false
      await refresh()
    }
  }, [enabled, refresh])

  useEffect(() => {
    refresh()
    if (!enabled) return

    sync()
    const timer = setInterval(sync, INTERVAL_MS)
    // Cheap local count, so the badge reflects new records between syncs.
    const poll = setInterval(refresh, 8_000)
    const onOnline = () => sync()
    const onOffline = () => setStatus('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      clearInterval(timer)
      clearInterval(poll)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [enabled, sync, refresh])

  return { status, pending, last, error, sync, refresh }
}
