// The weather rules are the part that can be quietly wrong: a threshold off by
// a few degrees produces advice that is confidently useless. No network here —
// these are pure functions fed known numbers.
//
//   npm run verify:weather
import {
  farmWarnings, frostDates, hardinessZone, type DayForecast,
} from '../../src/lib/weatherRules.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const day = (over: Partial<DayForecast>): DayForecast => ({
  date: '2026-04-10', minF: 50, maxF: 70, precipIn: 0, gustMph: 5, snowIn: 0, ...over,
})
const kinds = (d: Partial<DayForecast>) => farmWarnings([day(d)]).map((w) => w.kind)

console.log('\nCold thresholds')
check('18°F is a hard freeze', kinds({ minF: 18 }).includes('hard-freeze'))
check('26°F is a freeze', kinds({ minF: 26 }).includes('freeze'))
check('33°F is a frost watch', kinds({ minF: 33 }).includes('frost'))
check('40°F is unremarkable', kinds({ minF: 40 }).length === 0)
check('cold warnings do not stack',
  kinds({ minF: 18 }).filter((k) => k.includes('freeze') || k === 'frost').length === 1)

console.log('\nHeat thresholds')
check('102°F is extreme heat', kinds({ maxF: 102 }).includes('extreme-heat'))
check('93°F is a heat warning', kinds({ maxF: 93 }).includes('heat'))
check('85°F is fine', kinds({ maxF: 85 }).length === 0)
check('heat warnings do not stack',
  kinds({ maxF: 102 }).filter((k) => k.includes('heat')).length === 1)

console.log('\nWind, rain and snow')
check('50 mph gusts warn', kinds({ gustMph: 50 }).includes('wind'))
check('30 mph gusts do not', kinds({ gustMph: 30 }).length === 0)
check('2.5 inches of rain warns', kinds({ precipIn: 2.5 }).includes('heavy-rain'))
check('half an inch does not', kinds({ precipIn: 0.5 }).length === 0)
check('6 inches of snow warns', kinds({ snowIn: 6, precipIn: 0.6 }).includes('snow'))
check('snow supersedes rain, not both',
  !kinds({ snowIn: 6, precipIn: 2.5 }).includes('heavy-rain'))

console.log('\nA nasty day earns several warnings')
const nasty = kinds({ minF: 15, maxF: 20, gustMph: 55, snowIn: 8 })
check('cold, wind and snow all flagged',
  nasty.includes('hard-freeze') && nasty.includes('wind') && nasty.includes('snow'),
  nasty.join(', '))

console.log('\nHardiness zones')
check('0°F is zone 7a', hardinessZone(0) === '7a', hardinessZone(0))
check('5°F is zone 7b', hardinessZone(5) === '7b', hardinessZone(5))
check('-20°F is zone 5a', hardinessZone(-20) === '5a', hardinessZone(-20))
check('-10°F is zone 6a', hardinessZone(-10) === '6a', hardinessZone(-10))
check('-60°F is zone 1a', hardinessZone(-60) === '1a', hardinessZone(-60))
check('absurd warmth clamps', hardinessZone(120) === '13b', hardinessZone(120))

console.log('\nFrost dates from ten years of minimums')
// Frost every day through 15 April and from 15 October, mild in between.
const daily: { date: string; minF: number }[] = []
for (let year = 2016; year <= 2025; year++) {
  for (let m = 0; m < 12; m++) {
    for (let dd = 1; dd <= 28; dd++) {
      const d = new Date(year, m, dd)
      const iso = d.toISOString().slice(0, 10)
      const spring = m < 3 || (m === 3 && dd <= 15)
      const fall = m > 9 || (m === 9 && dd >= 15)
      daily.push({ date: iso, minF: spring || fall ? 25 : 55 })
    }
  }
}
const f = frostDates(daily)
check('last spring frost is mid-April', /Apr 1[0-9]/.test(f.lastSpring ?? ''), String(f.lastSpring))
check('first fall frost is mid-October', /Oct 1[0-9]/.test(f.firstFall ?? ''), String(f.firstFall))
check('season is about six months',
  (f.seasonDays ?? 0) > 160 && (f.seasonDays ?? 0) < 200, String(f.seasonDays))

const none = frostDates([{ date: '2025-06-01', minF: 70 }])
check('a frost-free climate reports nothing rather than lying',
  none.lastSpring === null && none.seasonDays === null)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
