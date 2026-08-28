/**
 * Calendar bucketing for the Analytics page — all in the viewer's local
 * time, deliberately never in SQL. date_trunc() buckets by the database
 * session's timezone, which need not match the browser's; doing the math
 * here with plain Date methods keeps "which bucket does this cost belong
 * to" and "what the axis label says" using the same clock.
 */

export type Granularity = 'week' | 'month' | 'quarter' | 'year'

/** `kind` is the log type: a purchase is money out, a sale is money in. */
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

/** How many bars the chart shows per granularity — enough history, not a smear. */
export const BUCKET_COUNT: Record<Granularity, number> = {
  week: 12, month: 12, quarter: 8, year: 6,
}

function bucketStart(d: Date, g: Granularity): Date {
  const y = d.getFullYear()
  const m = d.getMonth()
  if (g === 'year') return new Date(y, 0, 1)
  if (g === 'quarter') return new Date(y, Math.floor(m / 3) * 3, 1)
  if (g === 'month') return new Date(y, m, 1)
  // Week: Monday-start, same convention Postgres date_trunc uses.
  const dow = d.getDay()
  const diff = (dow + 6) % 7
  return new Date(y, m, d.getDate() - diff)
}

function stepBack(d: Date, g: Granularity, n: number): Date {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate()
  if (g === 'year') return new Date(y - n, 0, 1)
  if (g === 'quarter') return new Date(y, m - n * 3, 1)
  if (g === 'month') return new Date(y, m - n, 1)
  return new Date(y, m, day - n * 7)
}

/** The last instant still inside the bucket that starts on `start`. */
export function bucketEnd(start: Date, g: Granularity): Date {
  if (g === 'year') return new Date(start.getFullYear() + 1, 0, 0, 23, 59, 59, 999)
  if (g === 'quarter') return new Date(start.getFullYear(), start.getMonth() + 3, 0, 23, 59, 59, 999)
  if (g === 'month') return new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999)
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999)
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Continuous buckets ending at "now", oldest first, zero-filled for gaps. */
export function bucketize(entries: CostEntry[], granularity: Granularity): Bucket[] {
  const n = BUCKET_COUNT[granularity]
  const sums = new Map<string, { spent: number; earned: number }>()
  for (const e of entries) {
    const k = dayKey(bucketStart(new Date(e.timestamp), granularity))
    const cur = sums.get(k) ?? { spent: 0, earned: 0 }
    if (e.kind === 'sale') cur.earned += e.value
    else cur.spent += e.value
    sums.set(k, cur)
  }
  const nowStart = bucketStart(new Date(), granularity)
  const out: Bucket[] = []
  for (let i = n - 1; i >= 0; i--) {
    const start = stepBack(nowStart, granularity, i)
    const { spent, earned } = sums.get(dayKey(start)) ?? { spent: 0, earned: 0 }
    out.push({ start, total: spent, spent, earned, net: earned - spent })
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

/** Compact axis label — abbreviated, but never without a year. */
export function axisLabel(start: Date, g: Granularity): string {
  const yy = String(start.getFullYear()).slice(-2)
  if (g === 'year') return String(start.getFullYear())
  if (g === 'quarter') return `Q${Math.floor(start.getMonth() / 3) + 1} '${yy}`
  if (g === 'month') return `${start.toLocaleDateString(undefined, { month: 'short' })} '${yy}`
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} '${yy}`
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
