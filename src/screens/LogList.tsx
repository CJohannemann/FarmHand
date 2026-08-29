import type { LogWithDetail } from '../db/types'
import { withThousands } from '../lib/numeric'

const LABELS: Record<string, string> = {
  harvest: 'Harvest',
  weight: 'Weight',
  input_application: 'Feeding',
  observation: 'Note',
  birth: 'Birth',
  death: 'Death',
  movement: 'Moved',
  purchase: 'Purchase',
  sale: 'Sale',
  processing: 'Processing',
  disposition: 'Used',
  maintenance: 'Maintenance',
}

/**
 * Shared by every history list. Always carries the year — dropping it for
 * the current year read fine in isolation, but next to an older entry in
 * the same list ("Aug 26" above "Nov 30, 2025") it looked like an
 * inconsistency rather than a deliberate omission.
 */
export function logDate(timestamp: string): string {
  const d = new Date(timestamp)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function LogList({
  logs, loading, onSelect, empty = 'Nothing recorded yet.',
}: {
  logs: LogWithDetail[]
  loading?: boolean
  /**
   * What to say when there is nothing to show. The default is only true on
   * a farm that has never logged anything — a caller that filters by date
   * has to say so itself, or it tells a farm with years of history that it
   * has no records because it took a quiet weekend.
   */
  empty?: string
  onSelect?: (log: LogWithDetail) => void
}) {
  if (loading) return <p className="muted">Loading…</p>
  if (logs.length === 0) return <p className="empty">{empty}</p>

  return (
    <ul className="loglist">
      {logs.map((l) => {
        const body = (
          <>
            <div className="log-main">
              <span className="log-type">{l.name ?? LABELS[l.type] ?? l.type}</span>
              {l.summary && <span className="log-qty">{withThousands(l.summary)}</span>}
            </div>
            {l.subjects && <div className="log-sub">{l.subjects}</div>}
            {l.notes && <div className="log-note">{l.notes}</div>}
            <time className="log-time">{logDate(l.timestamp)}</time>
          </>
        )
        return (
          <li key={l.id}>
            {onSelect
              ? <button className="logrow" onClick={() => onSelect(l)}>{body}</button>
              : <div className="logbody">{body}</div>}
          </li>
        )
      })}
    </ul>
  )
}
