/**
 * Which heats are worth a phone notification today — what
 * deploy/selfhost/send-notifications.ts sends. Pure, so
 * db/test/verify-heat-alerts.ts can pin it down.
 *
 * A week's warning: enough to plan around (have the bull in, book the AI
 * tech, move her up), and the same week Today starts listing her (see
 * HEAT_LEAD_DAYS). Each expected heat is sent once, whatever day the
 * sender first sees it inside that week — the key carries the date, so a
 * missed run sends it the next day and a re-run sends nothing new.
 *
 * Dates are the farm's: the sender runs this with the process set to the
 * farm's timezone, so "in 7 days" is counted from the farm's today.
 */
import { HEAT_LEAD_DAYS, heatOutlook, heatSentence } from './husbandry.ts'

export interface HeatAlertAnimal {
  farmId: string
  assetId: string
  name: string
  species: string | null
  lastHeat: string | null
  lastBred: string | null
}

export interface HeatAlert {
  /** "<farm>:<animal>:heat:2026-11-21" — sent at most once. */
  key: string
  farmId: string
  title: string
  body: string
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function heatAlerts(animals: HeatAlertAnimal[], now: Date = new Date()): HeatAlert[] {
  const out: HeatAlert[] = []
  for (const a of animals) {
    const o = heatOutlook(a, now)
    if (!o || o.days < 0 || o.days > HEAT_LEAD_DAYS) continue
    const when = o.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const inDays = o.days === 0 ? 'today' : o.days === 1 ? 'tomorrow' : `in ${o.days} days`
    out.push({
      key: `${a.farmId}:${a.assetId}:${o.kind}:${ymd(o.date)}`,
      farmId: a.farmId,
      title: o.kind === 'return' ? `Watch ${a.name} for a return to heat` : `${a.name} may come into heat`,
      body: o.kind === 'return'
        ? `Around ${when} (${inDays}), one cycle after she was bred. No heat then means she most likely settled.`
        : `Around ${when} (${inDays}). ${heatSentence(a.species ?? '') ?? ''}`.trim(),
    })
  }
  return out
}
