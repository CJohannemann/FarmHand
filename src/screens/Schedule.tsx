import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  completeTask, expectedBirths, loggedEvents, plannedLogs,
} from '../db/queries'
import type { LogWithDetail } from '../db/types'
import {
  dueDate, dueLabel, daysUntil, gestationFor, speciesGlyph,
} from '../lib/husbandry'
import { useFarmTimezone } from '../lib/weather'
import { dayKeyOf } from './LogList'
import { dueText } from './TaskList'
import { ChoreSheet } from './ChoreSheet'

/**
 * The farm's month, forward-looking.
 *
 * Today answers "what's next" with a flat list sorted soonest-first, which
 * is the right answer to that question and no answer at all to "what does
 * next month look like", "three things land the same day", or "the sow is
 * due the week I'm away". That is what this is for.
 *
 * Deliberately not another Records. Days that have been carry only chores
 * that were done and births that happened (see loggedEvents) — a farm
 * logging daily would otherwise dot every square, which says nothing.
 *
 * Reached from a card on Today rather than a tab of its own, and renders
 * in Today's place the way AssetDetail renders in Stock's: the tab bar
 * stays put, and tapping Today again drops back out of it.
 */

/** What a single day is carrying. */
interface DayEvents {
  /** Still to do — ticked off from here, same as on Today. */
  chores: LogWithDetail[]
  /** Done, or born. Nothing to act on. */
  past: LogWithDetail[]
  /** Animals due that day. */
  due: DueRow[]
}

interface DueRow {
  assetId: string
  name: string
  species: string | null
  /** "due to farrow" — this species' own word, not "give birth". */
  verb: string
  days: number
}

const emptyDay = (): DayEvents => ({ chores: [], past: [], due: [] })

const MONTH_FMT: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** The 1st of the month `delta` months from `d`, at midnight local. */
function shiftMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
}

export function Schedule({ onBack, onOpenAnimal }: {
  onBack: () => void
  /** Opens one animal's own profile on the Inventory tab. */
  onOpenAnimal: (assetId: string) => void
}) {
  const [month, setMonth] = useState(() => shiftMonth(new Date(), 0))
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState<Date | null>(null)
  const [editing, setEditing] = useState<LogWithDetail | null>(null)
  const timeZone = useFarmTimezone()

  // The month's own bounds, and a day key for "today" to mark the square.
  const monthStart = month
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999)
  const todayKey = dayKeyOf(new Date(), timeZone)

  // Keyed on the month so paging actually refetches. plannedLogs and
  // expectedBirths are unbounded by date — cheap, and the alternative is a
  // ranged query for each, which would have to re-derive due dates in SQL.
  const data = useAsync(async () => {
    const [planned, births, logged] = await Promise.all([
      plannedLogs(),
      expectedBirths(),
      loggedEvents(monthStart, monthEnd),
    ])
    return { planned, births, logged }
  }, [monthStart.getTime()])

  const days = useMemo(() => {
    const map = new Map<string, DayEvents>()
    const at = (key: string) => {
      const existing = map.get(key)
      if (existing) return existing
      const fresh = emptyDay()
      map.set(key, fresh)
      return fresh
    }

    for (const t of data.data?.planned ?? []) {
      at(dayKeyOf(new Date(t.timestamp), timeZone)).chores.push(t)
    }
    for (const l of data.data?.logged ?? []) {
      at(dayKeyOf(new Date(l.timestamp), timeZone)).past.push(l)
    }
    // dueDate/daysUntil rather than upcomingBirth(): that one returns null
    // once a birth is more than ~30 days out or 14 days past, which is
    // right for Today's "due soon" list and would silently empty a month
    // being looked at from a distance — exactly what this screen is for.
    for (const b of data.data?.births ?? []) {
      const due = dueDate(b.bredOn, b.species)
      const term = gestationFor(b.species)
      if (!due || !term) continue
      at(dayKeyOf(due, timeZone)).due.push({
        assetId: b.assetId,
        name: b.name,
        species: b.species,
        verb: term.verb,
        days: daysUntil(due),
      })
    }
    return map
  }, [data.data, timeZone])

  // Sunday-first grid: how many blanks before the 1st, and how many squares.
  const leading = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()

  const keyFor = (dayOfMonth: number) =>
    dayKeyOf(new Date(month.getFullYear(), month.getMonth(), dayOfMonth, 12), timeZone)

  const reload = () => data.reload()
  const chosen = selected ? days.get(selected) : undefined

  return (
    <div className="screen">
      <button className="back" onClick={onBack}>‹ Back</button>
      <h1>Schedule</h1>
      <p className="tagline">What's coming, and what got done.</p>

      <div className="monthnav">
        <button className="monthnav-step" aria-label="Previous month"
          onClick={() => { setMonth(shiftMonth(month, -1)); setSelected(null) }}>‹</button>
        <span className="monthnav-label">
          {month.toLocaleDateString(undefined, MONTH_FMT)}
        </span>
        <button className="monthnav-step" aria-label="Next month"
          onClick={() => { setMonth(shiftMonth(month, 1)); setSelected(null) }}>›</button>
      </div>

      <div className="monthgrid" role="grid">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="monthgrid-head" aria-hidden="true">{w}</span>
        ))}
        {Array.from({ length: dayCount }, (_, i) => {
          const dayOfMonth = i + 1
          const key = keyFor(dayOfMonth)
          const ev = days.get(key)
          const late = (ev?.chores ?? []).some((c) => dueText(c.timestamp).late)
          const classes = [
            'monthgrid-day',
            key === todayKey ? 'today' : '',
            key === selected ? 'on' : '',
            late ? 'late' : '',
          ].filter(Boolean).join(' ')
          return (
            <button
              key={key}
              className={classes}
              // Only the 1st needs placing; the rest follow it across.
              style={i === 0 && leading > 0 ? { gridColumnStart: leading + 1 } : undefined}
              aria-label={`${dayOfMonth}${ev ? ', has events' : ''}`}
              onClick={() => setSelected(key === selected ? null : key)}
            >
              <span className="monthgrid-num">{dayOfMonth}</span>
              <span className="monthgrid-dots" aria-hidden="true">
                {(ev?.chores.length ?? 0) > 0 && <i className="dot chore" />}
                {(ev?.due.length ?? 0) > 0 && <i className="dot due" />}
                {(ev?.past.length ?? 0) > 0 && <i className="dot past" />}
              </span>
            </button>
          )
        })}
      </div>

      {data.loading && <p className="muted">Loading…</p>}

      {selected && (
        <>
          <h2 className="section">
            {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined,
              { weekday: 'long', month: 'long', day: 'numeric' })}
          </h2>

          {!chosen && <p className="empty">Nothing on this day.</p>}

          {chosen && (
            <ul className="tasklist">
              {chosen.due.map((b) => (
                <li key={`due-${b.assetId}`} className={b.days < 0 ? 'late' : ''}>
                  <span className="task-glyph" aria-hidden="true">{speciesGlyph(b.species)}</span>
                  <button className="task-body" onClick={() => onOpenAnimal(b.assetId)}>
                    <span className="task-name">{b.name} due to {b.verb}</span>
                    <span className="task-when">{dueLabel(b.days)}</span>
                  </button>
                  <span className="chev" aria-hidden="true">›</span>
                </li>
              ))}
              {/* Outstanding chores keep their tick: looking at the week is
                  exactly when someone remembers they already did one. */}
              {chosen.chores.map((t) => (
                <li key={t.id} className={dueText(t.timestamp).late ? 'late' : ''}>
                  <button className="tick" aria-label={`Mark ${t.name ?? 'chore'} done`}
                    onClick={async () => { await completeTask(t.id); reload() }}>○</button>
                  <button className="task-body" onClick={() => setEditing(t)}>
                    <span className="task-name">{t.name}</span>
                    <span className="task-when">
                      {dueText(t.timestamp).text}{t.subjects ? ` · ${t.subjects}` : ''}
                    </span>
                  </button>
                  <span className="chev" aria-hidden="true">›</span>
                </li>
              ))}
              {/* Done and births: nothing to tick, nothing to open. */}
              {chosen.past.map((l) => (
                <li key={l.id} className="done">
                  <span className="task-glyph" aria-hidden="true">
                    {l.type === 'birth' ? '🐣' : '✓'}
                  </span>
                  <span className="task-body static">
                    <span className="task-name">{l.name}</span>
                    <span className="task-when">
                      {l.type === 'birth' ? 'born' : 'done'}
                      {l.subjects ? ` · ${l.subjects}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <button className="linkish"
            onClick={() => setAdding(new Date(`${selected}T09:00:00`))}>
            + Add a chore on this day
          </button>
        </>
      )}

      {!selected && !data.loading && (
        <p className="hint">Tap a day to see what's on it, or to plan something.</p>
      )}

      {adding && (
        <ChoreSheet initialDate={adding} onClose={() => setAdding(null)}
          onDone={() => { setAdding(null); reload() }} />
      )}
      {editing && (
        <ChoreSheet chore={editing} onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); reload() }} />
      )}
    </div>
  )
}
