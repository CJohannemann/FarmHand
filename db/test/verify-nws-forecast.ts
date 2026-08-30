// NOAA/NWS's raw shapes are messier than Open-Meteo's — irregular period
// names, UTC timestamps that need converting to the farm's own local date,
// millimeters and km/h instead of the inches and mph everything downstream
// expects. This is exactly the "quietly wrong" territory weatherRules.ts's
// own tests exist for: a date bucketed one zone off reads as a whole day
// late, and a missed mm-to-inch conversion turns a drizzle into a flood
// warning.
//
//   npm run verify:nws-forecast
import {
  aggregateByDate, daysFromPeriods, localDateKey, nwsCodeFromText, withGridExtras,
  type NwsPeriod,
} from '../../src/lib/nwsForecast.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const TZ = 'America/Chicago'

console.log('\nCondition text to icon code')
check('thunderstorm mentions win over rain', nwsCodeFromText('Chance Showers And Thunderstorms') === 95)
check('snow', nwsCodeFromText('Slight Chance Snow Showers') === 71)
check('plain rain', nwsCodeFromText('Rain Likely') === 61)
check('sunny', nwsCodeFromText('Sunny') === 0)
check('partly cloudy leans clear-ish', nwsCodeFromText('Partly Sunny') === 1)
check('overcast', nwsCodeFromText('Cloudy') === 3)
check('missing text is undefined, not a guess', nwsCodeFromText(undefined) === undefined)

console.log('\nLocal date from a UTC instant')
check('mid-afternoon UTC is still the same Chicago day',
  localDateKey('2026-08-30T18:00:00+00:00', TZ) === '2026-08-30')
check('early UTC morning is still the previous Chicago evening',
  localDateKey('2026-08-31T03:00:00+00:00', TZ) === '2026-08-30')
check('already-local timestamps (NWS periods carry their own offset) pass through correctly',
  localDateKey('2026-08-30T18:00:00-05:00', TZ) === '2026-08-30')

console.log('\nAggregating a gridpoint series by local date')
const precipMm = [
  { validTime: '2026-08-30T12:00:00+00:00/PT6H', value: 5 },
  { validTime: '2026-08-30T18:00:00+00:00/PT6H', value: 3 },
  { validTime: '2026-08-31T12:00:00+00:00/PT6H', value: 0 },
]
const precipIn = aggregateByDate(precipMm, TZ, (mm) => mm / 25.4, (a, b) => a + b)
check('same-day readings sum', Math.abs((precipIn.get('2026-08-30') ?? 0) - 8 / 25.4) < 0.001,
  String(precipIn.get('2026-08-30')))
check('a dry day still gets an entry', precipIn.get('2026-08-31') === 0)

const gustKmh = [
  { validTime: '2026-08-30T14:00:00+00:00/PT1H', value: 20 },
  { validTime: '2026-08-30T20:00:00+00:00/PT1H', value: 55 },
]
const gustMph = aggregateByDate(gustKmh, TZ, (kmh) => kmh * 0.621371, (a, b) => Math.max(a, b))
check('gusts take the max for the day, not the sum',
  Math.abs((gustMph.get('2026-08-30') ?? 0) - 55 * 0.621371) < 0.01)

check('a null reading is skipped rather than treated as zero',
  aggregateByDate(
    [{ validTime: '2026-08-30T12:00:00+00:00/PT6H', value: null }], TZ, (v) => v, (a, b) => a + b,
  ).size === 0)

console.log('\nPairing day/night periods into calendar days')
const period = (over: Partial<NwsPeriod>): NwsPeriod => ({
  startTime: '2026-08-30T06:00:00-05:00', isDaytime: true, temperature: 90, ...over,
})
const periods: NwsPeriod[] = [
  period({ startTime: '2026-08-30T06:00:00-05:00', isDaytime: true, temperature: 99, shortForecast: 'Sunny' }),
  period({ startTime: '2026-08-30T18:00:00-05:00', isDaytime: false, temperature: 81, shortForecast: 'Clear' }),
  period({ startTime: '2026-08-31T06:00:00-05:00', isDaytime: true, temperature: 100, shortForecast: 'Sunny' }),
  period({ startTime: '2026-08-31T18:00:00-05:00', isDaytime: false, temperature: 79, shortForecast: 'Clear' }),
]
const days = daysFromPeriods(periods, TZ)
check('two calendar days come out of four periods', days.length === 2, String(days.length))
check('first day high is the daytime reading', days[0].maxF === 99)
check('first day low is the following night', days[0].minF === 81)
check('second day matches too', days[1].maxF === 100 && days[1].minF === 79)
check('days come out in date order', days[0].date < days[1].date)
check('condition code comes from the daytime period', days[0].code === 0)

console.log('\nA lone period (checked after tonight\'s high already passed) still yields a real day')
const lonelyNight = daysFromPeriods(
  [period({ startTime: '2026-08-30T18:00:00-05:00', isDaytime: false, temperature: 74 })], TZ,
)
check('one entry, not a crash or a dropped day', lonelyNight.length === 1)
check('both ends use the only reading available, rather than a hole in the row',
  lonelyNight[0].maxF === 74 && lonelyNight[0].minF === 74)

console.log('\nFolding precip/snow/gust onto the paired days')
const merged = withGridExtras(
  days,
  new Map([['2026-08-30', 1.2]]),
  new Map(),
  new Map([['2026-08-30', 34]]),
)
check('a date with data gets it', merged[0].precipIn === 1.2 && merged[0].gustMph === 34)
check('a date with none defaults to zero, not undefined',
  merged[1].precipIn === 0 && merged[1].snowIn === 0 && merged[1].gustMph === 0)
check('temperatures pass through untouched', merged[0].maxF === 99 && merged[1].minF === 79)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
