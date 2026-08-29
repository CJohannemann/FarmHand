import { useCallback, useEffect, useRef, useState } from 'react'
import { lastSyncedAt, pendingCount, syncNow } from './sync'
import { checkStillMember } from './members'
import { handleRevokedAccess } from './revocation'
import { onLocalWrite } from '../db/writeSignal'
import { noteDataChanged } from './dataSignal'

/**
 * The idle backstop, and only while the app is on screen.
 *
 * It used to be 60s and unconditional, from before writes pushed on their
 * own — the timer WAS how a record left the device, so it had to be short.
 * Now a write pushes a couple of seconds later regardless, which leaves
 * this doing exactly one job: pulling in what somebody else on the farm
 * entered, for a screen already open and being watched. Five minutes is
 * plenty for that, and a tenth of the wake-ups on a phone that mostly sits
 * in a pocket. Opening the app, reconnecting, or writing anything all sync
 * straight away, so this is never what someone waits on.
 */
const VISIBLE_INTERVAL_MS = 5 * 60_000

// Long enough that one gesture writing several rows (a group and its
// members, a harvest and its quantities) pushes once rather than per row;
// short enough that a record is off the device while the barn door is still
// open.
const AFTER_WRITE_MS = 2_000

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
      const result = await syncNow()
      // Only when something actually arrived — most syncs pull nothing,
      // and there is no point every open screen re-reading the same data.
      if (result.pulled > 0) noteDataChanged()
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

  // Piggybacks on the same 60s cadence as sync() rather than its own timer —
  // this is the revocation check: has an owner removed this account from
  // the farm since last time? A `null` result (offline, a network error)
  // means the check itself didn't complete and is never treated as
  // revoked — only a successful query that comes back with zero rows is.
  const checkRevocation = useCallback(async () => {
    if (await checkStillMember() === false) await handleRevokedAccess()
  }, [])

  // Push shortly after a local write, rather than waiting out the interval.
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onLocalWrite(() => {
      // Immediately, so the "waiting to sync" count reflects the new record
      // while the push itself is still being batched up.
      refresh()
      clearTimeout(timer)
      timer = setTimeout(sync, AFTER_WRITE_MS)
    })
    return () => { off(); clearTimeout(timer) }
  }, [enabled, sync, refresh])

  useEffect(() => {
    refresh()
    if (!enabled) return

    const cycle = () => { sync(); checkRevocation() }

    // The timer only runs while the app is actually on screen. Nothing this
    // does is useful to someone who has pocketed the phone: their own writes
    // already pushed a couple of seconds after they made them, and pulling
    // somebody else's changes into a screen nobody is looking at just spends
    // battery and cellular data. Coming back to the app syncs immediately,
    // which is the moment it actually matters.
    let timer: ReturnType<typeof setInterval> | undefined
    const start = () => { clearInterval(timer); timer = setInterval(cycle, VISIBLE_INTERVAL_MS) }
    const stop = () => { clearInterval(timer); timer = undefined }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') { cycle(); start() } else stop()
    }

    cycle()
    if (document.visibilityState === 'visible') start()

    const onOnline = () => cycle()
    const onOffline = () => setStatus('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, sync, refresh, checkRevocation])

  return { status, pending, last, error, sync, refresh }
}
