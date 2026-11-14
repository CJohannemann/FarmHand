// The phone notification a week before a heat — which heats get one, what
// it says, and that each is sent once (src/lib/heatAlerts.ts).
//
//   npm run verify:heat-alerts
import { heatAlerts, heatTracking } from '../../src/lib/heatAlerts.ts'

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

console.log('\nThe dry run says where each animal stands')
{
  const t = (lastHeat: string | null, lastBred: string | null = null, extra = {}) => heatTracking(cow(lastHeat, lastBred, extra), now)
  const inHeatToday = t('2026-11-14', null, { name: 'Rosie', species: 'Pig' })
  check('in heat today: the next one, and the day the alert goes out',
    inHeatToday === 'Rosie (Pig): next heat around Sat, Dec 5 (in 21 days) — alert goes out Sat, Nov 28', inHeatToday)
  check('a week out: alert due now', t('2026-10-31').endsWith('— alert due now'), t('2026-10-31'))
  check('just past: no alert', t('2026-10-22').includes('(2 days ago) — past, no alert'), t('2026-10-22'))
  check('yesterday, not "1 days ago"', t('2026-10-23').includes('(yesterday)'), t('2026-10-23'))
  check('after breeding: the return check', t('2026-11-10', '2026-11-10').startsWith('Daisy (Cattle): watch for a return around Tue, Dec 1'), t('2026-11-10', '2026-11-10'))
  check('bred long ago: settled', t('2026-09-01', '2026-09-01').includes('most likely settled'), t('2026-09-01', '2026-09-01'))
  check('heat long ago: too old to predict', t('2026-04-01').includes('too long ago to predict'), t('2026-04-01'))
  check('a species with no cycle says so', t('2026-11-01', null, { species: 'Rabbit' }).includes('no heat cycle known'))
}

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
