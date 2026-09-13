/**
 * Calendar bucketing for the Analytics page — all in the viewer's local
 * time, deliberately never in SQL. date_trunc() buckets by the database
 * session's timezone, which need not match the browser's; doing the math
 * here with plain Date methods keeps "which bucket does this cost belong
 * to" and "what the axis label says" using the same clock.
 */

export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year'

/**
 * `kind` is the direction, not the log type — 'purchase' is money out,
 * 'sale' is money in. Both ways of selling (closing out an animal, and
 * drawing stock out of Stores) arrive as 'sale'; see db/queries.ts.
 */
export interface CostEntry {
  timestamp: string
  value: number
  material: string
  kind: 'purchase' | 'sale'
}

/**
 * A period, both directions kept apart.
 *
 * `total` stays as the money-out figure it always was, so everything that
 * already reads a Bucket keeps meaning what it meant; `spent` is its
 * explicit name, `earned` the other half, and `net` what the farm actually
 * did over that period.
 */
export interface Bucket {
  start: Date
  total: number
  spent: number
  earned: number
  net: number
}

function bucketStart(d: Date, g: Granularity): Date {
  const y = d.getFullYear()
  const m = d.getMonth()
  if (g === 'year') return new Date(y, 0, 1)
  if (g === 'quarter') return new Date(y, Math.floor(m / 3) * 3, 1)
  if (g === 'month') return new Date(y, m, 1)
  if (g === 'day') return new Date(y, m, d.getDate())
  // Week: Monday-start, same convention Postgres date_trunc uses.
  const dow = d.getDay()
  const diff = (dow + 6) % 7
  return new Date(y, m, d.getDate() - diff)
}

/** One bucket later. Date normalises the overflow, so Dec + 1 is next January. */
function nextBucket(d: Date, g: Granularity): Date {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate()
  if (g === 'year') return new Date(y + 1, 0, 1)
  if (g === 'quarter') return new Date(y, m + 3, 1)
  if (g === 'month') return new Date(y, m + 1, 1)
  if (g === 'day') return new Date(y, m, day + 1)
  return new Date(y, m, day + 7)
}

/** The last instant still inside the bucket that starts on `start`. */
export function bucketEnd(start: Date, g: Granularity): Date {
  if (g === 'year') return new Date(start.getFullYear() + 1, 0, 0, 23, 59, 59, 999)
  if (g === 'quarter') return new Date(start.getFullYear(), start.getMonth() + 3, 0, 23, 59, 59, 999)
  if (g === 'month') return new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999)
  if (g === 'day') {
    return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999)
  }
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999)
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const endOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

export type RangeId =
  | '7d' | '30d' | 'thisMonth' | 'lastMonth'
  | '12m' | 'thisYear' | 'lastYear' | 'all'

/** The window a reading covers, and how finely to cut it up. */
export interface DateRange {
  id: RangeId
  label: string
  from: Date
  to: Date
  granularity: Granularity
}

/** Offered in the picker, in this order. */
export const RANGES: { id: RangeId; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'thisYear', label: 'This year' },
  { id: 'lastYear', label: 'Last year' },
  { id: 'all', label: 'All time' },
]

/**
 * A preset turned into real dates, plus the bucket size to draw it at.
 *
 * The granularity is derived rather than chosen, and that is the whole
 * point of this screen's redesign: the old chips set bar WIDTH and left the
 * window implied, so "Week" drew twelve weekly bars across three months and
 * read as a bug. Here the window is what you pick and the bars follow it —
 * a week of days, a year of months.
 *
 * `entries` is only read by 'all', which has to start somewhere real.
 */
export function resolveRange(
  id: RangeId, entries: CostEntry[] = [], now: Date = new Date(),
): DateRange {
  const label = RANGES.find((r) => r.id === id)?.label ?? 'All time'
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  const make = (from: Date, to: Date, granularity: Granularity): DateRange =>
    ({ id, label, from, to, granularity })

  switch (id) {
    // Inclusive of today, so "7 days" is today and the six before it.
    case '7d': return make(new Date(y, m, d - 6), endOfDay(now), 'day')
    case '30d': return make(new Date(y, m, d - 29), endOfDay(now), 'day')
    case 'thisMonth': return make(new Date(y, m, 1), endOfDay(now), 'day')
    // Day 0 of this month is the last day of the previous one.
    case 'lastMonth':
      return make(new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59, 999), 'day')
    // Eleven whole months back plus this one — twelve bars, not thirteen.
    case '12m': return make(new Date(y, m - 11, 1), endOfDay(now), 'month')
    case 'thisYear': return make(new Date(y, 0, 1), endOfDay(now), 'month')
    case 'lastYear':
      return make(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31, 23, 59, 59, 999), 'month')
    default: {
      // Starts at the oldest thing on record — or today, on a farm with
      // nothing yet, which gives one empty bucket rather than an empty axis.
      const oldest = entries.reduce<Date | null>((acc, e) => {
        const t = new Date(e.timestamp)
        return !acc || t < acc ? t : acc
      }, null)
      const from = oldest ? startOfDay(oldest) : startOfDay(now)
      // Monthly bars stop being readable somewhere past a few years, and a
      // farm keeping records for a decade wants the shape, not 120 slivers.
      const years = (now.getTime() - from.getTime()) / (365.25 * 86_400_000)
      return make(from, endOfDay(now), years > 3 ? 'year' : 'month')
    }
  }
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Continuous buckets spanning a range, oldest first, zero-filled for gaps.
 *
 * Only entries actually inside the range are counted, which matters at the
 * edges: "This month" cuts its first bucket at the 1st even though that day
 * is a whole day, and a purchase on the last day of last month must not
 * leak in.
 */
export function bucketsIn(entries: CostEntry[], range: DateRange): Bucket[] {
  const g = range.granularity
  const sums = new Map<string, { spent: number; earned: number }>()
  for (const e of entries) {
    const t = new Date(e.timestamp)
    if (t < range.from || t > range.to) continue
    const k = dayKey(bucketStart(t, g))
    const cur = sums.get(k) ?? { spent: 0, earned: 0 }
    if (e.kind === 'sale') cur.earned += e.value
    else cur.spent += e.value
    sums.set(k, cur)
  }

  const out: Bucket[] = []
  const last = bucketStart(range.to, g)
  // A guard rather than a limit: every range here is bounded, but a bad
  // granularity would otherwise spin forever building an array nobody can
  // draw. 'All time' at yearly granularity is the widest real case.
  for (let cur = bucketStart(range.from, g), i = 0; cur <= last && i < 400;
    cur = nextBucket(cur, g), i++) {
    const { spent, earned } = sums.get(dayKey(cur)) ?? { spent: 0, earned: 0 }
    out.push({ start: cur, total: spent, spent, earned, net: earned - spent })
  }
  return out
}

/** Cost by material for entries falling inside [start, end], highest first. */
export function materialBreakdown(
  entries: CostEntry[], start: Date, end: Date, kind: 'purchase' | 'sale' = 'purchase',
): { material: string; total: number }[] {
  const sums = new Map<string, number>()
  for (const e of entries) {
    if (e.kind !== kind) continue
    const t = new Date(e.timestamp)
    if (t < start || t > end) continue
    sums.set(e.material, (sums.get(e.material) ?? 0) + e.value)
  }
  return [...sums.entries()]
    .map(([material, total]) => ({ material, total }))
    .sort((a, b) => b.total - a.total)
}

/**
 * Compact axis label — abbreviated, but never without a year.
 *
 * 'day' is the one exception, deliberately. A daily axis carries up to
 * thirty-one labels across 272px, and "Dec 28 '25" in that space overlaps
 * its neighbours into mush. Nothing is lost: every daily range is at most
 * a month or so wide, and the caption under the chart spells out the whole
 * span with its years.
 */
export function axisLabel(start: Date, g: Granularity): string {
  const yy = String(start.getFullYear()).slice(-2)
  if (g === 'year') return String(start.getFullYear())
  if (g === 'quarter') return `Q${Math.floor(start.getMonth() / 3) + 1} '${yy}`
  if (g === 'month') return `${start.toLocaleDateString(undefined, { month: 'short' })} '${yy}`
  if (g === 'day') return start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} '${yy}`
}

/**
 * The dates a range actually covers, spelled out — "Sep 7 – Sep 13, 2026".
 *
 * This is the line that answers the question the old chips could not: which
 * window am I looking at. Shown on the picker button and under the chart.
 */
export function rangeDates(r: DateRange): string {
  const daily = r.granularity === 'day' || r.granularity === 'week'
  const opts: Intl.DateTimeFormatOptions = daily
    ? { month: 'short', day: 'numeric' }
    : { month: 'short' }
  const sameYear = r.from.getFullYear() === r.to.getFullYear()
  const from = r.from.toLocaleDateString(undefined, opts)
  const to = r.to.toLocaleDateString(undefined, { ...opts, year: 'numeric' })
  // A single day, or a single month at monthly granularity, reads better
  // as itself than as a span from something to the same thing.
  if (from === r.to.toLocaleDateString(undefined, opts) && sameYear) return to
  return `${from}${sameYear ? '' : ` ${r.from.getFullYear()}`} – ${to}`
}

/** Full, unambiguous label for the selected bucket. */
export function rangeLabel(start: Date, g: Granularity): string {
  if (g === 'year') return String(start.getFullYear())
  if (g === 'quarter') return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`
  if (g === 'month') return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const end = bucketEnd(start, g)
  const opts = { month: 'short', day: 'numeric', year: 'numeric' } as const
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`
}

/**
 * Rounds a max value up to a clean tick — 42 -> 50, 340 -> 400.
 *
 * The 1/2/3/5 rungs matter more than they look. With only 1/2/5, a real
 * month of $23,501 rounded to $50,000 — more than double, so the tallest
 * bar filled under half the space it had and the axis claimed a scale the
 * farm never reached. 3 closes the widest gap on the ladder.
 */
export function niceMax(n: number) {
  if (n <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(n))
  const norm = n / mag
  const step = norm <= 1 ? 1 : norm <= 1.5 ? 1.5 : norm <= 2 ? 2
    : norm <= 3 ? 3 : norm <= 5 ? 5 : 10
  return step * mag
}

export function money(n: number): string {
  if (n < 1000) return `$${Math.round(n)}`
  const k = n / 1000
  // One decimal where it earns it: a $2,500 gridline read "$3k" before,
  // which is worse than no gridline at all on an axis meant to be counted.
  return `$${k % 1 === 0 ? k : k.toFixed(1)}k`
}

/**
 * Gridline values from 0 up to `max`, at a step that stays a round number.
 *
 * niceMax only ever returns 1, 1.5, 2, 3, 5 or 10 times a power of ten, so
 * the number of divisions can be chosen per leading digit and every label
 * lands on something a person would actually say: 30k splits in three, not
 * four, because 10k/20k/30k reads and 7.5k/15k/22.5k does not.
 */
export function ticksTo(max: number): number[] {
  if (max <= 0) return [0]
  const lead = max / 10 ** Math.floor(Math.log10(max))
  const divisions = lead === 1.5 || lead === 3 ? 3 : lead === 5 ? 5 : 4
  return Array.from({ length: divisions + 1 }, (_, i) => (i * max) / divisions)
}
