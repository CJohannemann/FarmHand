// The phone notification a week before a heat — which heats get one, what
// it says, and that each is sent once (src/lib/heatAlerts.ts).
//
//   npm run verify:heat-alerts
import { heatAlerts } from '../../src/lib/heatAlerts.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

process.env.TZ = 'America/Chicago'
const day = (d: string) => new Date(`${d}T12:00:00`)
const now = day('2026-11-14')
const cow = (lastHeat: string | null, lastBred: string | null = null, extra = {}) => ({
  farmId: 'F', assetId: 'A', name: 'Daisy', species: 'Cattle',
  lastHeat: lastHeat && day(lastHeat).toISOString(), lastBred: lastBred && day(lastBred).toISOString(), ...extra,
})

console.log('\nA week ahead')
const [a] = heatAlerts([cow('2026-10-31')], now)   // next heat Nov 21: 7 days out
check('a heat 7 days out gets an alert', !!a, JSON.stringify(a))
check('it says who and when', a?.title === 'Daisy may come into heat'
  && a?.body.startsWith('Around Sat, Nov 21 (in 7 days).') && a?.body.includes('about every 3 weeks'), a?.body)
check('keyed to the farm, the animal and the date', a?.key === 'F:A:heat:2026-11-21', a?.key)
check('8 days out is too soon to say', heatAlerts([cow('2026-11-01')], now).length === 0)
check('still sent if the server missed the 7-day mark (3 days out)', heatAlerts([cow('2026-10-27')], now).length === 1)
check('the same heat seen on a later day has the same key, so it is sent once',
  heatAlerts([cow('2026-10-31')], day('2026-11-16'))[0]?.key === a?.key)
check('a heat already past gets nothing', heatAlerts([cow('2026-10-22')], now).length === 0)

console.log('\nAfter breeding')
const [r] = heatAlerts([cow('2026-10-30', '2026-10-31')], now)
check('a return to heat is watched for a week ahead too', r?.title === 'Watch Daisy for a return to heat'
  && r?.key === 'F:A:return:2026-11-21', `${r?.title} ${r?.key}`)
check('and says what no heat means', !!r?.body.includes('most likely settled'))

console.log('\nOnly what cycles')
check('no alert for a species with no cycle', heatAlerts([cow('2026-10-31', null, { species: 'Rabbit' })], now).length === 0)
check('ewes on their own 17 days', heatAlerts([cow('2026-11-04', null, { species: 'Sheep' })], now)[0]?.key === 'F:A:heat:2026-11-21')

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
