// Turning irregular egg collections into a readable daily rate.
//
// The whole reason this chart smooths rather than plotting what was logged:
// nobody gathers eggs on a schedule. Nothing Tuesday and twenty Wednesday
// is a normal week, and drawn raw it is a crash followed by a recovery.
//
// The property everything rests on is that a trailing window does not care
// WHICH day inside it the eggs were gathered — so an every-other-day
// collector and a daily one, gathering the same eggs, must come out at the
// same rate. That is the first thing tested here, because if it is wrong
// the chart is actively misleading rather than merely noisy.
//
//   npm run verify:production
import { rollingDaily, type Point } from '../../src/lib/production.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.0001

/** Local noon on a day offset from a fixed start, so no timezone drifts. */
const day = (n: number) => new Date(2026, 2, 1 + n, 12)
const pt = (n: number, value: number, unit = 'each'): Point =>
  ({ timestamp: day(n).toISOString(), value, unit })
const ymd = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
console.log('\nThe same eggs give the same rate, however they were gathered')

{
  // Fourteen days, 7 eggs a day, collected daily.
  const daily = Array.from({ length: 14 }, (_, i) => pt(i, 7))
  // The same fortnight's eggs, gathered every other day instead: nothing on
  // the odd days, fourteen on the even ones.
  const alternate = Array.from({ length: 7 }, (_, i) => pt(i * 2 + 1, 14))

  const a = rollingDaily(daily)
  const b = rollingDaily(alternate)
  check('a daily collector reads 7/day', near(a[a.length - 1].value, 7),
    String(a[a.length - 1].value))

  // The every-other-day series cannot sit exactly on 7 at every point, and
  // that is arithmetic rather than a fault: an odd-length window holds
  // either three or four of the gather days, so it alternates 6 and 8
  // about a true 7. What matters is that it reads as the same flock —
  // around 7, nowhere near the 14 that dropping the zero days would give,
  // nor the 3.5 from dividing by gathers instead of days.
  // Not exactly 7: seven points cannot split evenly between 6 and 8, so the
  // mean sits a fraction high. The tolerance is the point — this is
  // asserting "the same flock", not a number.
  const mean = b.reduce((t, p) => t + p.value, 0) / b.length
  check('an every-other-day collector averages the same 7/day',
    Math.abs(mean - 7) < 0.25, String(mean))
  check('and never strays past the window\'s own 6–8 swing',
    b.every((p) => p.value >= 6 - 0.0001 && p.value <= 8 + 0.0001),
    b.map((p) => p.value).join(', '))
}

// ---------------------------------------------------------------------------
console.log('\nA day is a day, whatever it took to fill the basket')

{
  // Morning and evening gathers on the same calendar day.
  const r = rollingDaily([
    ...Array.from({ length: 6 }, (_, i) => pt(i, 6)),
    pt(6, 4), pt(6, 2),
  ])
  check('two gathers on one day are one day of 6', near(r[0].value, 6),
    String(r[0].value))
  check('and that is one point, not two', r.length === 1, String(r.length))
}

// ---------------------------------------------------------------------------
console.log('\nNothing is drawn until there is a full window behind it')

{
  const six = rollingDaily(Array.from({ length: 6 }, (_, i) => pt(i, 5)))
  check('six days of records draw nothing at all', six.length === 0,
    String(six.length))
  const seven = rollingDaily(Array.from({ length: 7 }, (_, i) => pt(i, 5)))
  check('the seventh day gives the first point', seven.length === 1)
  check('and it is the true rate, not a ramp from zero',
    near(seven[0].value, 5), String(seven[0].value))
  check('dated the last day of its window, not the first',
    ymd(seven[0].timestamp) === '2026-03-07', ymd(seven[0].timestamp))
}

// ---------------------------------------------------------------------------
console.log('\nThe line stops where the records stop')

{
  // Collected for a fortnight, then nothing for a month. The chart must not
  // invent a decline to zero for a farm that simply has not been out.
  const r = rollingDaily(Array.from({ length: 14 }, (_, i) => pt(i, 8)))
  check('ends on the last day collected', ymd(r[r.length - 1].timestamp) === '2026-03-14',
    ymd(r[r.length - 1].timestamp))
  check('no phantom zero-tail past it',
    r.every((p) => p.value > 0), `${r.filter((p) => p.value === 0).length} zeroes`)
}

// ---------------------------------------------------------------------------
console.log('\nA real decline shows as one, and a steady flock does not')

{
  // Three weeks at 12/day, then a fortnight at 4 — a molt.
  const steady = Array.from({ length: 21 }, (_, i) => pt(i, 12))
  const dropped = Array.from({ length: 14 }, (_, i) => pt(21 + i, 4))
  const r = rollingDaily([...steady, ...dropped])
  const start = r[0].value
  const end = r[r.length - 1].value
  check('starts at the old rate', near(start, 12), String(start))
  check('finishes at the new one', near(end, 4), String(end))
  check('and slopes down in between rather than stepping',
    r.some((p) => p.value < 12 && p.value > 4))
}
{
  const flat = rollingDaily(Array.from({ length: 30 }, (_, i) => pt(i, 9)))
  check('an unchanged flock draws a flat line',
    flat.every((p) => near(p.value, 9)), `${flat.length} points`)
}

// ---------------------------------------------------------------------------
console.log('\nDegenerate inputs do not throw')

check('no collections gives no points', rollingDaily([]).length === 0)
check('one collection gives no points', rollingDaily([pt(0, 5)]).length === 0)
check('a junk timestamp is skipped, not fatal',
  rollingDaily([{ timestamp: 'not a date', value: 5, unit: 'each' }]).length === 0)
check('the unit rides through', rollingDaily(
  Array.from({ length: 7 }, (_, i) => pt(i, 3, 'gal')))[0].unit === 'gal')

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
