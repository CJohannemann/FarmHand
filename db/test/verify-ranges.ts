// The Analytics date ranges, and their edges.
//
// This is calendar arithmetic in local time, which is where date code goes
// wrong quietly: an off-by-one at a month boundary, a "last year" that is
// really a rolling twelve months, a January "last month" that lands in the
// wrong year. None of those throw — they just report the wrong money, and
// look entirely plausible doing it.
//
// `now` is passed in throughout rather than read from the clock, so these
// assertions mean the same thing on any day of any year. That matters here
// more than usual: a test that only passes in mid-September is worse than
// no test, because it will fail for someone else and read as a real bug.
//
//   npm run verify:ranges
import {
  RANGES, bucketsIn, resolveRange, rangeDates,
  type CostEntry, type RangeId,
} from '../../src/lib/periods.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

/** A local-time date, the way every Date in periods.ts is built. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)
const iso = (d: Date) => d.toISOString()
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const entry = (d: Date, value: number, kind: 'purchase' | 'sale' = 'purchase'): CostEntry =>
  ({ timestamp: iso(d), value, material: 'Feed', kind })

// A Tuesday in the middle of a month, deliberately not near an edge.
const NOW = at(2026, 9, 15)

// ---------------------------------------------------------------------------
console.log('\nEvery preset resolves')

for (const r of RANGES) {
  const range = resolveRange(r.id as RangeId, [], NOW)
  check(`${r.label} has a window`,
    range.from <= range.to && range.label === r.label,
    `${ymd(range.from)} .. ${ymd(range.to)} (${range.granularity})`)
}

// ---------------------------------------------------------------------------
console.log('\nShort ranges are counted in days, and include today')

{
  const r = resolveRange('7d', [], NOW)
  const b = bucketsIn([], r)
  check('Last 7 days is 7 buckets', b.length === 7, String(b.length))
  check('the last one is today', ymd(b[b.length - 1].start) === '2026-09-15')
  check('the first is six days back', ymd(b[0].start) === '2026-09-09')
  check('cut by day', r.granularity === 'day')
}
{
  const b = bucketsIn([], resolveRange('30d', [], NOW))
  check('Last 30 days is 30 buckets', b.length === 30, String(b.length))
  check('crossing the month boundary intact',
    ymd(b[0].start) === '2026-08-17' && ymd(b[b.length - 1].start) === '2026-09-15')
}

// ---------------------------------------------------------------------------
console.log('\nCalendar ranges snap to the calendar, not to today')

{
  const r = resolveRange('thisMonth', [], NOW)
  check('This month starts on the 1st', ymd(r.from) === '2026-09-01')
  check('and runs to today', ymd(r.to) === '2026-09-15')
  check('a half-done month has a bucket per day so far',
    bucketsIn([], r).length === 15, String(bucketsIn([], r).length))
}
{
  const r = resolveRange('lastMonth', [], NOW)
  check('Last month is the whole previous month',
    ymd(r.from) === '2026-08-01' && ymd(r.to) === '2026-08-31')
  check('all 31 days of it', bucketsIn([], r).length === 31)
}
{
  // The one that bites: December is the previous month in January.
  const r = resolveRange('lastMonth', [], at(2026, 1, 10))
  check('from January, last month is DECEMBER of the year before',
    ymd(r.from) === '2025-12-01' && ymd(r.to) === '2025-12-31',
    `${ymd(r.from)} .. ${ymd(r.to)}`)
}
{
  const r = resolveRange('lastYear', [], NOW)
  check('Last year is a calendar year, not a rolling twelve months',
    ymd(r.from) === '2025-01-01' && ymd(r.to) === '2025-12-31',
    `${ymd(r.from)} .. ${ymd(r.to)}`)
  check('twelve monthly buckets', bucketsIn([], r).length === 12)
}
{
  const r = resolveRange('thisYear', [], NOW)
  check('This year starts at January 1st', ymd(r.from) === '2026-01-01')
  check('with a bucket per month so far', bucketsIn([], r).length === 9)
}
{
  const r = resolveRange('12m', [], NOW)
  check('Last 12 months is twelve buckets, not thirteen',
    bucketsIn([], r).length === 12, String(bucketsIn([], r).length))
  check('starting eleven whole months back', ymd(r.from) === '2025-10-01')
}

// ---------------------------------------------------------------------------
console.log('\nAll time starts where the records do')

{
  const entries = [entry(at(2024, 3, 7), 100), entry(at(2026, 1, 2), 50)]
  const r = resolveRange('all', entries, NOW)
  check('begins at the oldest entry', ymd(r.from) === '2024-03-07', ymd(r.from))
  check('still monthly under three years', r.granularity === 'month')
}
{
  // A decade of records would be 120 monthly slivers — switch to years.
  const entries = [entry(at(2015, 5, 1), 100)]
  const r = resolveRange('all', entries, NOW)
  check('a long history is cut by year instead', r.granularity === 'year')
  check('one bucket per year', bucketsIn(entries, r).length === 12,
    String(bucketsIn(entries, r).length))
}
{
  // A farm with nothing logged must not produce an empty or endless axis.
  const r = resolveRange('all', [], NOW)
  check('an empty farm still gives exactly one bucket',
    bucketsIn([], r).length === 1, String(bucketsIn([], r).length))
}

// ---------------------------------------------------------------------------
console.log('\nOnly what is inside the window counts')

{
  const r = resolveRange('thisMonth', [], NOW)
  const entries = [
    entry(at(2026, 8, 31, 23), 999),   // last instant of last month
    entry(at(2026, 9, 1, 0), 10),      // first instant of this one
    entry(at(2026, 9, 15, 23), 20),    // today, late
    entry(at(2026, 9, 16, 0), 888),    // tomorrow
  ]
  const b = bucketsIn(entries, r)
  const spent = b.reduce((t, x) => t + x.spent, 0)
  check('the day before the window is excluded', spent === 30, String(spent))
  check('and the day after it', !b.some((x) => x.spent === 888))
  check('the first day of the month is included',
    b[0].spent === 10, String(b[0].spent))
  check('a late-evening entry still lands on its own day',
    b[14].spent === 20, String(b[14].spent))
}
{
  // Zero-fill: a gap in the middle is a zero bucket, not a missing one.
  const r = resolveRange('7d', [], NOW)
  const b = bucketsIn([entry(at(2026, 9, 11), 40)], r)
  check('quiet days are zero, not absent', b.length === 7 && b[2].spent === 40,
    `${b.length} buckets, [2]=${b[2].spent}`)
  check('and the rest really are zero',
    b.filter((x) => x.spent === 0).length === 6)
}
{
  // Sales and purchases are kept apart, the way the chart draws them.
  const r = resolveRange('thisMonth', [], NOW)
  const b = bucketsIn([
    entry(at(2026, 9, 3), 100, 'purchase'),
    entry(at(2026, 9, 3), 30, 'sale'),
  ], r)
  check('both directions land on the same day, separately',
    b[2].spent === 100 && b[2].earned === 30)
  check('net is the difference', b[2].net === -70, String(b[2].net))
}

// ---------------------------------------------------------------------------
console.log('\nThe caption says which window this is')

check('a daily range names its days',
  rangeDates(resolveRange('7d', [], NOW)) === 'Sep 9 – Sep 15, 2026',
  rangeDates(resolveRange('7d', [], NOW)))
check('a yearly one names its months',
  rangeDates(resolveRange('lastYear', [], NOW)) === 'Jan – Dec 2025',
  rangeDates(resolveRange('lastYear', [], NOW)))
check('a range spanning new year carries both years',
  rangeDates(resolveRange('12m', [], NOW)).includes('2025'),
  rangeDates(resolveRange('12m', [], NOW)))

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
