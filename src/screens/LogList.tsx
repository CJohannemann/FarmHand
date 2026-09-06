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

/** What a row calls itself — the name given, or the type's own word. */
export function logLabel(type: string): string {
  return LABELS[type] ?? type
}

/**
 * Local calendar day, as a key that compares by value. Local rather than
 * UTC on purpose: a 7pm entry belongs to the day the person logging it was
 * having, which east of UTC is already tomorrow by the clock in London.
 */
function dayKeyOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const dayKey = (timestamp: string) => dayKeyOf(new Date(timestamp))

/**
 * A day heading reads as "when", so the two days a farmer thinks of by name
 * get their names. Everything older is a date, and carries its year for the
 * same reason logDate does.
 */
function dayHeading(timestamp: string): string {
  const key = dayKey(timestamp)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (key === dayKeyOf(new Date())) return 'Today'
  if (key === dayKeyOf(yesterday)) return 'Yesterday'
  return logDate(timestamp)
}

export function LogList({
  logs, loading, onSelect, empty = 'Nothing recorded yet.', groupByDate = false,
}: {
  logs: LogWithDetail[]
  loading?: boolean
  /**
   * Breaks the list into a heading per day and drops the date from each row,
   * for a history long enough that one undifferentiated run of entries is
   * hard to place in time. Off for short lists, where a heading over two
   * rows is more furniture than the date it replaces.
   */
  groupByDate?: boolean
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

  const item = (l: LogWithDetail) => {
    const body = (
      <>
        <div className="log-main">
          <span className="log-type">{l.name ?? logLabel(l.type)}</span>
          {l.summary && <span className="log-qty">{withThousands(l.summary)}</span>}
        </div>
        {l.subjects && <div className="log-sub">{l.subjects}</div>}
        {l.notes && <div className="log-note">{l.notes}</div>}
        {/* The day's heading already says when, when there is one. */}
        {!groupByDate && <time className="log-time">{logDate(l.timestamp)}</time>}
      </>
    )
    return (
      <li key={l.id}>
        {onSelect
          ? <button className="logrow" onClick={() => onSelect(l)}>{body}</button>
          : <div className="logbody">{body}</div>}
      </li>
    )
  }

  if (!groupByDate) return <ul className="loglist">{logs.map(item)}</ul>

  // Logs arrive newest first, so a day is a run of adjacent rows — no
  // sorting needed, and none wanted: re-sorting here would quietly override
  // whatever order the caller's query asked for.
  const days: { key: string; heading: string; logs: LogWithDetail[] }[] = []
  for (const l of logs) {
    const key = dayKey(l.timestamp)
    const last = days[days.length - 1]
    if (last && last.key === key) last.logs.push(l)
    else days.push({ key, heading: dayHeading(l.timestamp), logs: [l] })
  }

  return (
    <>
      {days.map((d) => (
        <div key={d.key}>
          <h2 className="section">{d.heading}</h2>
          <ul className="loglist">{d.logs.map(item)}</ul>
        </div>
      ))}
    </>
  )
}
