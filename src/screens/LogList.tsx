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
  logs, loading,
}: { logs: LogWithDetail[]; loading?: boolean }) {
  if (loading) return <p className="muted">Loading…</p>
  if (logs.length === 0)
    return <p className="empty">Nothing recorded yet.</p>

  return (
    <ul className="loglist">
      {logs.map((l) => (
        <li key={l.id}>
          <div className="log-main">
            <span className="log-type">{LABELS[l.type] ?? l.type}</span>
            {l.summary && <span className="log-qty">{l.summary}</span>}
          </div>
          {l.subjects && <div className="log-sub">{l.subjects}</div>}
          {l.notes && <div className="log-note">{l.notes}</div>}
          <time className="log-time">
            {new Date(l.timestamp).toLocaleDateString(undefined,
              { month: 'short', day: 'numeric' })}
          </time>
        </li>
      ))}
    </ul>
  )
}
