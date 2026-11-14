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
import { HEAT_LEAD_DAYS, daysUntil, heatCycleFor, heatOutlook, heatSentence } from './husbandry.ts'

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

/**
 * Where one animal stands, in a line — what `notify.sh --dry-run` lists
 * for every animal it tracks, so running it always shows the server can
 * see her, even in a week with nothing to send:
 *
 *   Rosie (Pig): next heat around Sat, Dec 5 (in 21 days) — alert goes out Sat, Nov 28
 *   Daisy (Cattle): watch for a return around Sat, Nov 21 (in 7 days) — alert due now
 *   Bess (Cattle): last heat Apr 1 — too long ago to predict the next
 */
export function heatTracking(a: HeatAlertAnimal, now: Date = new Date()): string {
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const who = `${a.name} (${a.species ?? 'no species'})`
  const o = heatOutlook(a, now)
  if (!o) {
    if (!heatCycleFor(a.species)) return `${who}: no heat cycle known for this species — not tracked`
    // Bred at (or after) that heat — the same test heatOutlook uses.
    if (a.lastBred && a.lastHeat && daysUntil(new Date(a.lastHeat), new Date(a.lastBred)) <= 1) {
      return `${who}: bred, and the return-to-heat check has passed — most likely settled`
    }
    return `${who}: last heat ${a.lastHeat ? fmt(new Date(a.lastHeat)) : 'unknown'} — too long ago to predict the next`
  }
  const what = o.kind === 'return' ? 'watch for a return' : 'next heat'
  const when = o.days === 0 ? 'today' : o.days === 1 ? 'tomorrow' : o.days === -1 ? 'yesterday'
    : o.days < 0 ? `${-o.days} days ago` : `in ${o.days} days`
  const alertOn = new Date(o.date.getFullYear(), o.date.getMonth(), o.date.getDate() - HEAT_LEAD_DAYS, 12)
  const alert = o.days < 0 ? 'past, no alert'
    : o.days <= HEAT_LEAD_DAYS ? 'alert due now'
    : `alert goes out ${fmt(alertOn)}`
  return `${who}: ${what} around ${fmt(o.date)} (${when}) — ${alert}`
}
