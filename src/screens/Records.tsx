import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { logYears, recentLogs } from '../db/queries'
import type { LogWithDetail } from '../db/types'
import { useMembersMap } from '../lib/members'
import { LogList, logLabel } from './LogList'
import { EditLog } from './EditLog'

/**
 * The raw log, newest first. Body only — no heading of its own: this used to
 * be its own tab sitting next to Analytics, and the two were the same
 * question ("what has happened here?") answered at two zoom levels. They
 * share one tab now, and Analytics owns the header.
 *
 * Broken up by day and filterable by kind, because on a working farm this is
 * hundreds of rows: a fortnight of feedings alone buries the one purchase
 * someone came here to correct.
 *
 * Filed by year rather than "the most recent N" — a farm logging daily
 * blows past any fixed cap well within its first year, and a flat "last 200"
 * would make last year's records simply unreachable once this year's
 * activity pushed them out. Same year picker Past Stock and Receipts already
 * use: only years with something in them, newest first.
 */
export function Records() {
  const [year, setYear] = useState<number | null>(null)
  const { data, loading, reload } = useAsync(async () => {
    const years = await logYears()
    // `year` is only ever set by tapping a chip below, so it names a year
    // that already had something in it when the list was built — falling
    // back to the newest year is what makes that list's own top entry (and
    // a farm with no selection yet) mean "this year" rather than nothing.
    const activeYear = year ?? years[0] ?? null
    const logs = activeYear != null ? await recentLogs(5000, undefined, activeYear) : []
    return { years, activeYear, logs }
  }, [year])
  const [editing, setEditing] = useState<LogWithDetail | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const membersById = useMembersMap()

  const years = data?.years ?? []
  const activeYear = data?.activeYear ?? null
  const logs = data?.logs ?? []

  // Only the kinds this farm actually has, in the order they last happened —
  // a fixed list of every log type the schema allows would offer filters
  // that match nothing, and alphabetical would bury the common ones.
  const kinds = useMemo(() => {
    const seen: string[] = []
    for (const l of logs) if (!seen.includes(l.type)) seen.push(l.type)
    return seen
  }, [logs])

  // A filter that survives its own kind disappearing: deleting the last
  // purchase while filtered to purchases would otherwise leave an empty
  // list under a chip that is no longer offered. Switching years does the
  // same thing to this same guard for free — a kind picked in one year that
  // the next year never had just clears itself.
  const active = kind && kinds.includes(kind) ? kind : null
  const shown = active ? logs.filter((l) => l.type === active) : logs

  return (
    <>
      {/* Worth its own row only once there is more than one year to choose
          between — a farm on its first year has nowhere else to go yet. */}
      {years.length > 1 && (
        <div className="chipwrap" style={{ marginBottom: '0.5rem' }}>
          {years.map((y) => (
            <button key={y} className={activeYear === y ? 'chip on' : 'chip'}
              onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      )}

      {/* Worth its own row only once there is more than one kind to choose
          between — a single chip beside "All" is a control with no choice. */}
      {kinds.length > 1 && (
        <div className="chipwrap" style={{ marginBottom: '0.5rem' }}>
          <button className={active === null ? 'chip on' : 'chip'}
            onClick={() => setKind(null)}>
            All
          </button>
          {kinds.map((k) => (
            <button key={k} className={active === k ? 'chip on' : 'chip'}
              onClick={() => setKind(k)}>
              {logLabel(k)}
            </button>
          ))}
        </div>
      )}

      <LogList
        logs={shown}
        loading={loading}
        groupByDate
        onSelect={setEditing}
        membersById={membersById}
        empty={active
          ? `No ${logLabel(active).toLowerCase()} records yet.`
          : 'Nothing recorded yet.'}
      />

      {editing && (
        <EditLog
          log={editing}
          onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); reload() }}
        />
      )}
    </>
  )
}
