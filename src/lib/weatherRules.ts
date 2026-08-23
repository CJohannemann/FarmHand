/**
 * Turning weather numbers into things a farmer would act on.
 *
 * Pure functions, no fetching — everything here is testable without a network,
 * which matters because the thresholds are the part that can be quietly wrong.
 * Temperatures are Fahrenheit, wind mph, precipitation inches.
 */

export interface DayForecast {
  date: string
  minF: number
  maxF: number
  precipIn: number
  gustMph: number
  snowIn?: number
  code?: number
}

export type Severity = 'watch' | 'warn' | 'severe'

export interface Warning {
  date: string
  kind: string
  severity: Severity
  headline: string
  /** What to actually do about it. */
  advice: string
}

/**
 * Farm thresholds, not meteorological ones. A 34°F night is unremarkable
 * weather and a real problem for tomato seedlings, so it earns a warning here
 * that a general forecast would not give.
 */
export function farmWarnings(days: DayForecast[]): Warning[] {
  const out: Warning[] = []

  for (const d of days) {
    if (d.minF <= 20) {
      out.push({
        date: d.date, kind: 'hard-freeze', severity: 'severe',
        headline: `Hard freeze — low ${Math.round(d.minF)}°F`,
        advice: 'Waterers and pipes will freeze. Check stock water twice, bed deeply, protect anything plumbed.',
      })
    } else if (d.minF <= 28) {
      out.push({
        date: d.date, kind: 'freeze', severity: 'warn',
        headline: `Freeze — low ${Math.round(d.minF)}°F`,
        advice: 'Kills tender plants outright. Harvest what is ready, cover the rest, check waterers.',
      })
    } else if (d.minF <= 34) {
      out.push({
        date: d.date, kind: 'frost', severity: 'watch',
        headline: `Frost likely — low ${Math.round(d.minF)}°F`,
        advice: 'Cover seedlings and tender crops. Hardy greens will be fine.',
      })
    }

    if (d.maxF >= 100) {
      out.push({
        date: d.date, kind: 'extreme-heat', severity: 'severe',
        headline: `Extreme heat — ${Math.round(d.maxF)}°F`,
        advice: 'Serious risk to poultry and pigs. Shade, extra water, wet the ground, do not move stock midday.',
      })
    } else if (d.maxF >= 90) {
      out.push({
        date: d.date, kind: 'heat', severity: 'warn',
        headline: `Heat — ${Math.round(d.maxF)}°F`,
        advice: 'Check shade and water. Poultry stop laying and pigs cannot sweat.',
      })
    }

    if (d.gustMph >= 45) {
      out.push({
        date: d.date, kind: 'wind', severity: 'warn',
        headline: `High wind — gusts ${Math.round(d.gustMph)} mph`,
        advice: 'Secure hoop houses, row cover and tarps. Check tree limbs over fences and shelters.',
      })
    }

    if ((d.snowIn ?? 0) >= 4) {
      out.push({
        date: d.date, kind: 'snow', severity: 'warn',
        headline: `Snow — ${Math.round(d.snowIn ?? 0)} in`,
        advice: 'Move stock to shelter, lay in feed and bedding, clear paths before it falls.',
      })
    } else if (d.precipIn >= 2) {
      out.push({
        date: d.date, kind: 'heavy-rain', severity: 'warn',
        headline: `Heavy rain — ${d.precipIn.toFixed(1)} in`,
        advice: 'Move stock off low ground. Expect mud and standing water in gateways.',
      })
    }
  }

  return out
}

/**
 * USDA hardiness zone from the average annual minimum temperature. Zones are
 * 10°F bands from -60°F, split into 5°F halves a and b.
 *
 * The label is US terminology, but the underlying measure is universal, so
 * this is meaningful anywhere — it is simply what most seed catalogues quote.
 */
export function hardinessZone(avgAnnualMinF: number): string {
  const band = Math.floor((avgAnnualMinF + 60) / 10) + 1
  // Clamp the whole label, not just the number: past the ends of the scale the
  // half-letter is meaningless, and a negative modulo would produce nonsense.
  if (band > 13) return '13b'
  if (band < 1) return '1a'
  const half = ((avgAnnualMinF + 60) % 10) < 5 ? 'a' : 'b'
  return `${band}${half}`
}

export interface FrostDates {
  lastSpring: string | null
  firstFall: string | null
  seasonDays: number | null
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const label = (dayOfYear: number) => {
  const d = new Date(2001, 0, 1)
  d.setDate(dayOfYear)
  return `${MONTH[d.getMonth()]} ${d.getDate()}`
}

/**
 * Average last spring frost and first fall frost across whole years of daily
 * minimums. These drive planting dates far more directly than a zone does.
 *
 * Frost is taken as 32°F. Spring is the last such day before midsummer, autumn
 * the first after it, which is what splits the year sensibly in both
 * hemispheres' terms for a northern user and degrades gracefully elsewhere.
 */
export function frostDates(
  daily: { date: string; minF: number }[],
  threshold = 32,
): FrostDates {
  const byYear = new Map<number, { spring: number[]; fall: number[] }>()

  for (const d of daily) {
    if (!Number.isFinite(d.minF) || d.minF > threshold) continue
    const when = new Date(d.date + 'T00:00:00')
    const year = when.getFullYear()
    const doy = Math.floor(
      (when.getTime() - new Date(year, 0, 0).getTime()) / 86_400_000,
    )
    if (!byYear.has(year)) byYear.set(year, { spring: [], fall: [] })
    const bucket = byYear.get(year)!
    if (doy <= 182) bucket.spring.push(doy)
    else bucket.fall.push(doy)
  }

  const lastSprings: number[] = []
  const firstFalls: number[] = []
  for (const { spring, fall } of byYear.values()) {
    if (spring.length) lastSprings.push(Math.max(...spring))
    if (fall.length) firstFalls.push(Math.min(...fall))
  }

  const mean = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null

  const spring = mean(lastSprings)
  const fall = mean(firstFalls)

  return {
    lastSpring: spring === null ? null : label(spring),
    firstFall: fall === null ? null : label(fall),
    seasonDays: spring !== null && fall !== null ? fall - spring : null,
  }
}
