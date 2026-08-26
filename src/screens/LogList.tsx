import type { LogWithDetail } from '../db/types'

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
 * Shared by every history list. The year is dropped for anything in the
 * current one — on a phone the date sits in its own column beside the entry,
 * and "Aug 26, 2026" spends a third of a narrow screen saying something the
 * reader already knows.
 */
export function logDate(timestamp: string): string {
  const d = new Date(timestamp)
  const thisYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined,
    thisYear ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' })
}

export function LogList({
  logs, loading, onSelect,
}: {
  logs: LogWithDetail[]
  loading?: boolean
  onSelect?: (log: LogWithDetail) => void
}) {
  if (loading) return <p className="muted">Loading…</p>
  if (logs.length === 0) return <p className="empty">Nothing recorded yet.</p>

  return (
    <ul className="loglist">
      {logs.map((l) => {
        const body = (
          <>
            <div className="log-main">
              <span className="log-type">{l.name ?? LABELS[l.type] ?? l.type}</span>
              {l.summary && <span className="log-qty">{l.summary}</span>}
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
