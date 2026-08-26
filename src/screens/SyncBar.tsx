import type { SyncStatus } from '../lib/useSync'

export function ago(iso: string | null): string {
  if (!iso) return 'never'
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export function SyncBar({
  status, pending, last, error, onSync,
}: {
  status: SyncStatus
  pending: number
  last: string | null
  error: string | null
  onSync: () => void
}) {
  // Nothing queued, nothing wrong, nothing in flight — then there is
  // nothing worth a permanent strip across the top of every screen. Syncing
  // is automatic (on load, after a write, every minute, and on reconnect),
  // so a standing "Synced just now" is a status light for a thing that is
  // simply working. It reappears the moment that stops being true, which is
  // when it actually carries information: something waiting, a failure, or
  // no signal. "Sync now" and the last-synced time live in Settings for
  // when someone wants to check or force it.
  if (status === 'idle' && pending === 0 && !error) return null

  const text =
    status === 'syncing' ? 'Syncing…'
    : status === 'offline' ? `Offline · ${pending} waiting`
    : status === 'error' ? (error ?? 'Sync failed')
    : pending > 0 ? `${pending} waiting to sync`
    : `Synced ${ago(last)}`

  return (
    <div className={`syncbar ${status}`}>
      <span>{text}</span>
      <button
        className="linkish"
        onClick={onSync}
        disabled={status === 'syncing'}
      >
        Sync now
      </button>
    </div>
  )
}
