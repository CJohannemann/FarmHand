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
            <time className="log-time">
              {new Date(l.timestamp).toLocaleDateString(undefined,
                { month: 'short', day: 'numeric', year: 'numeric' })}
            </time>
          </>
        )
        return (
          <li key={l.id}>
            {onSelect
              ? <button className="logrow" onClick={() => onSelect(l)}>{body}</button>
              : body}
          </li>
        )
      })}
    </ul>
  )
}
