/**
 * Turning irregular collections into a rate you can read.
 *
 * All in the viewer's local calendar, the same reasoning periods.ts gives:
 * which day a collection belongs to and what the axis says have to use one
 * clock.
 */

export interface Point {
  timestamp: string
  value: number
  unit: string
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * A trailing daily rate — "eggs a day over the last week", one point per day.
 *
 * Raw collections cannot be plotted directly and mean anything. Eggs get
 * gathered when somebody walks past the coop, so a normal week is nothing
 * on Tuesday and twenty on Wednesday; drawn as-is that is a crash and a
 * recovery rather than a week. A trailing window fixes it exactly, because
 * it does not care WHICH day inside the window the eggs were gathered —
 * Wednesday's twenty cover Tuesday too, and the window counts them once
 * either way. What survives the smoothing is the thing worth seeing: a
 * slope, when a flock starts winding down.
 *
 * Zero-filling the quiet days is what makes that arithmetic right. A day
 * with no collection really did produce nothing *into the basket*, and
 * dividing by a full `windowDays` every time is what keeps the units
 * honest: skip the zeros and an every-other-day collector would read as
 * twice the layer they are.
 */
export function rollingDaily(points: Point[], windowDays = 7): Point[] {
  if (points.length === 0 || windowDays < 1) return []

  // Several gathers on one day are one day's production.
  const perDay = new Map<string, number>()
  let first: Date | null = null
  let last: Date | null = null
  for (const p of points) {
    const t = new Date(p.timestamp)
    if (Number.isNaN(t.getTime())) continue
    const day = new Date(t.getFullYear(), t.getMonth(), t.getDate())
    perDay.set(dayKey(day), (perDay.get(dayKey(day)) ?? 0) + p.value)
    if (!first || day < first) first = day
    if (!last || day > last) last = day
  }
  if (!first || !last) return []

  // Deliberately ends at the last collection rather than at today. Running
  // zeros forward to now would draw a cliff for a farm that simply has not
  // been out to the coop this week — a false alarm on the one chart whose
  // whole job is spotting a real decline.
  const days: { day: Date; total: number }[] = []
  for (let d = first; d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    days.push({ day: d, total: perDay.get(dayKey(d)) ?? 0 })
  }

  // Nothing until a full window exists: an average over three days of a
  // seven-day window would draw the flock's first week as a ramp up from
  // near zero, which never happened.
  const unit = points[points.length - 1].unit
  const out: Point[] = []
  let sum = 0
  for (let i = 0; i < days.length; i++) {
    sum += days[i].total
    if (i >= windowDays) sum -= days[i - windowDays].total
    if (i >= windowDays - 1) {
      out.push({
        timestamp: days[i].day.toISOString(),
        value: sum / windowDays,
        unit,
      })
    }
  }
  return out
}
