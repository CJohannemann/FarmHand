// The Analytics chart's axis arithmetic.
//
// Reported from the live app: a month of $23,501.26 spent against $500
// earned drew a chart with two tick labels printed on top of each other and
// the tallest bar filling under half the height it had. Neither is visible
// from the code — both only appear once real, lopsided numbers go through
// it — so the arithmetic behind them is pinned here.
//
//   npm run verify:chart-scale
import {
  bucketize, money, niceMax, ticksTo, type CostEntry,
} from '../../src/lib/periods.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

console.log('\nAxis ticks round up close, not to the next power')
// The bug: with only 1/2/5 rungs, 23501 * 1.15 landed on 50000 — the bar
// filled 54% of its half and the axis claimed a scale the farm never hit.
const realMonth = niceMax(23501.26 * 1.15)
check('a $23.5k month tops out at $30k, not $50k', realMonth === 30000, String(realMonth))
check('and the tallest bar fills most of its space',
  (23501.26 / realMonth) > 0.75, `${((23501.26 / realMonth) * 100).toFixed(0)}%`)

for (const [raw, want] of [[42, 50], [340, 500], [1250, 1500], [7800, 10000]] as const) {
  const got = niceMax(raw * 1.15)
  check(`${raw} -> ${want}`, got === want, String(got))
}
check('never returns zero, so a division by it is safe', niceMax(0) === 1)
check('a negative is treated the same way', niceMax(-5) === 1)

console.log('\nThe zero line leaves room for a label on each side it shows')
// With one shared scale, a tiny side gets a tiny share of the height. The
// chart suppresses that side's number when it would land on top of the zero
// one; this is the geometry that decision is made from.
const plotH = 190 - 12 - 30
const share = (spent: number, earned: number) => {
  const sm = spent > 0 ? niceMax(spent * 1.15) : 0
  const em = earned > 0 ? niceMax(earned * 1.15) : 0
  return { px: plotH * (em / (sm + em || 1)), sm, em }
}
const lopsided = share(23501.26, 500)
check('the real case leaves under 14px above zero — label must be dropped',
  lopsided.px < 14, `${lopsided.px.toFixed(1)}px`)
const even = share(410, 1450)
check('an ordinary year leaves plenty — label stays',
  even.px > 14, `${even.px.toFixed(1)}px`)
const noSales = share(410, 0)
check('with no sales at all the zero line sits at the very top',
  noSales.px === 0, `${noSales.px}px`)

console.log('\nGridlines land on numbers a person would say out loud')
// With only a baseline and a peak, a bar two thirds of the way up could be
// seen but not read. These are the steps between — and every one has to be
// a round figure, or the axis is harder to count than no axis at all.
const labels = (max: number) => ticksTo(max).map(money).join(' ')
check('a $23.5k month (peak $30k) steps in tens of thousands',
  labels(30000) === '$0 $10k $20k $30k', labels(30000))
check('$1k steps in quarters', labels(1000) === '$0 $250 $500 $750 $1k', labels(1000))
check('$1.5k steps in halves', labels(1500) === '$0 $500 $1k $1.5k', labels(1500))
check('$500 steps in hundreds',
  labels(500) === '$0 $100 $200 $300 $400 $500', labels(500))
check('$10k splits in quarters, with the halfway point spelled out',
  labels(10000) === '$0 $2.5k $5k $7.5k $10k', labels(10000))
// The bug this formatter had: $2,500 rendered as "$3k".
check('a fractional thousand keeps its decimal', money(2500) === '$2.5k', money(2500))
check('a whole thousand does not gain one', money(2000) === '$2k', money(2000))
check('under a thousand stays plain', money(750) === '$750', money(750))
check('every tick is a round number', ticksTo(30000).every((t) => t % 1000 === 0))
check('an empty axis is just zero', labels(0) === '$0', labels(0))
check('the top tick is always the max',
  ticksTo(30000).at(-1) === 30000 && ticksTo(1500).at(-1) === 1500)
check('never more than six labels on a 148px axis',
  [50, 500, 1000, 1500, 2000, 3000, 10000, 30000].every((m) => ticksTo(m).length <= 6))

console.log('\nOne direction at a time gets the whole height')
// The mode toggle works by zeroing the suppressed side's peak, so the split
// above hands the full height to the other one — there is no separate
// single-series geometry that could drift out of step with this.
const modeShare = (spent: number, earned: number, mode: 'both' | 'in' | 'out') => {
  const sp = mode === 'in' ? 0 : spent
  const ea = mode === 'out' ? 0 : earned
  const sm = sp > 0 ? niceMax(sp * 1.15) : 0
  const em = ea > 0 ? niceMax(ea * 1.15) : 0
  const span = sm + em || 1
  return { zeroFromTop: plotH * (em / span), span }
}
const outOnly = modeShare(23501.26, 500, 'out')
check('money out puts the zero line at the very top', outOnly.zeroFromTop === 0)
check('and scales to spending alone', outOnly.span === 30000, String(outOnly.span))

const inOnly = modeShare(23501.26, 500, 'in')
check('money in puts the zero line at the very bottom',
  Math.abs(inOnly.zeroFromTop - plotH) < 0.01, String(inOnly.zeroFromTop))
check('and scales to income alone', inOnly.span === 1000, String(inOnly.span))
check('so $500 fills half its own chart instead of vanishing',
  (500 / inOnly.span) >= 0.5, `${((500 / inOnly.span) * 100).toFixed(0)}%`)

// The reason the toggle exists at all.
const bothMode = modeShare(23501.26, 500, 'both')
check('where in "both" that same $500 is a sliver',
  (plotH * (500 / bothMode.span)) < 5,
  `${(plotH * (500 / bothMode.span)).toFixed(1)}px`)

console.log('\nBoth directions land in the right bucket')
const now = new Date()
const iso = (d: Date) => d.toISOString()
const entries: CostEntry[] = [
  { timestamp: iso(now), value: 23501.26, material: 'Feed', kind: 'purchase' },
  { timestamp: iso(now), value: 500, material: 'Pig', kind: 'sale' },
]
const buckets = bucketize(entries, 'month')
const last = buckets[buckets.length - 1]
check('spend lands as spent', Math.abs(last.spent - 23501.26) < 0.01, String(last.spent))
check('sale lands as earned', last.earned === 500, String(last.earned))
check('net is the difference', Math.abs(last.net - -23001.26) < 0.01, String(last.net))
check('total stays the money-out figure it always was',
  Math.abs(last.total - 23501.26) < 0.01, String(last.total))
check('an empty month is zero on both sides',
  buckets[0].spent === 0 && buckets[0].earned === 0 && buckets[0].net === 0)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
