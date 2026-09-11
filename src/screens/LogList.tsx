import type { LogWithDetail } from '../db/types'
import { withThousands } from '../lib/numeric'
import { useFarmTimezone } from '../lib/weather'

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
 *
 * Takes the farm's own timezone (see useFarmTimezone()), not the viewer's
 * device — an owner checking Records from three states away, or a phone
 * with its clock set to the wrong zone, should still see the date the farm
 * itself would call it.
 */
export function logDate(timestamp: string, timeZone: string): string {
  const d = new Date(timestamp)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone })
}

/** Wall-clock time a record was actually entered, for the "who did what and
 * when" byline — logDate() already covers the date. Same farm-timezone
 * reasoning as logDate(). */
export function logTime(timestamp: string, timeZone: string): string {
  return new Date(timestamp)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone })
}

/** What a row calls itself — the name given, or the type's own word. */
export function logLabel(type: string): string {
  return LABELS[type] ?? type
}

/**
 * The farm's calendar day, as a key that compares by value. In the farm's
 * timezone rather than the device's on purpose: a 7pm entry belongs to the
 * day the person logging it was having on the farm, not whatever day it
 * already is by the clock of someone checking Records from London.
 */
function dayKeyOf(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d)
}

const dayKey = (timestamp: string, timeZone: string) => dayKeyOf(new Date(timestamp), timeZone)

/**
 * A day heading reads as "when", so the two days a farmer thinks of by name
 * get their names. Everything older is a date, and carries its year for the
 * same reason logDate does.
 */
function dayHeading(timestamp: string, timeZone: string): string {
  const key = dayKey(timestamp, timeZone)
  // A flat 24 hours back, not "device midnight minus a day": the point is
  // the farm's previous calendar day, and re-formatting through timeZone is
  // what actually answers that regardless of which day it happens to be
  // where the viewer's device thinks it is right now.
  if (key === dayKeyOf(new Date(), timeZone)) return 'Today'
  if (key === dayKeyOf(new Date(Date.now() - 86_400_000), timeZone)) return 'Yesterday'
  return logDate(timestamp, timeZone)
}

export function LogList({
  logs, loading, onSelect, empty = 'Nothing recorded yet.', groupByDate = false, membersById,
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
  /**
   * User id -> email, from useMembersMap(). Empty on a solo farm — with only
   * one person it could ever be, "Logged by you" on every row would be noise,
   * not information, so useMembersMap() itself withholds it in that case.
   */
  membersById?: Record<string, string>
}) {
  const timeZone = useFarmTimezone()
  if (loading) return <p className="muted">Loading…</p>
  if (logs.length === 0) return <p className="empty">{empty}</p>

  const item = (l: LogWithDetail) => {
    const body = (
      <>
        <div className="log-main">
          <span className="log-type">{l.name ?? logLabel(l.type)}</span>
          {(l.summary || l.cost) && (
            <span className="log-qty">
              {withThousands([l.summary, l.cost].filter(Boolean).join(', '))}
            </span>
          )}
        </div>
        {/* `uses` (the feed lot, say) is italicized — plain text next to a
            comma-separated name list like "Bacon, Pinkie, Rita, Runt" reads
            as just one more name in it, not the material that was drawn on. */}
        {(l.subjects || l.uses) && (
          <div className="log-sub">
            {l.subjects}
            {l.subjects && l.uses && ' · '}
            {l.uses && <em>{l.uses}</em>}
          </div>
        )}
        {/* Who bought it. The whole point of asking for a buyer is being
            able to find them again — kept off the subject line above so a
            sale still reads "what, then who" rather than running the two
            together. */}
        {l.buyer && <div className="log-sub">Sold to {l.buyer}</div>}
        {l.notes && <div className="log-note">{l.notes}</div>}
        {membersById && l.created_by && membersById[l.created_by] && (
          <div className="log-sub">
            Logged by {membersById[l.created_by]} · {logTime(l.created_at, timeZone)}
          </div>
        )}
        {membersById && l.edited_by && l.edited_at && membersById[l.edited_by] && (
          <div className="log-sub">
            Edited by {membersById[l.edited_by]} · {logTime(l.edited_at, timeZone)}
          </div>
        )}
        {/* The day's heading already says when, when there is one. */}
        {!groupByDate && <time className="log-time">{logDate(l.timestamp, timeZone)}</time>}
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
    const key = dayKey(l.timestamp, timeZone)
    const last = days[days.length - 1]
    if (last && last.key === key) last.logs.push(l)
    else days.push({ key, heading: dayHeading(l.timestamp, timeZone), logs: [l] })
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
