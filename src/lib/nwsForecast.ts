/**
 * Turning NOAA/NWS's raw API shapes into the same DayForecast[] Open-Meteo
 * already produces, so weather.ts and everything downstream of it (the
 * warnings engine, the icons, the UI) needs no idea which provider answered.
 *
 * Pure and fetch-free on purpose — see weatherRules.ts's own comment for
 * why: this is exactly the kind of date/unit math that is quietly wrong in
 * a way nobody notices until a forecast reads a day late or ten degrees off.
 */
import type { DayForecast } from './weatherRules'

export interface NwsPeriod {
  startTime: string
  isDaytime: boolean
  temperature: number
  shortForecast?: string
}

export interface NwsGridValue {
  validTime: string
  value: number | null
}

/**
 * NWS reports conditions as free text ("Sunny", "Chance Showers And
 * Thunderstorms"), not the WMO codes weatherIcons.ts expects. Matched by
 * keyword, most specific first, so "Slight Chance Rain Showers" hits rain
 * rather than falling through to the generic cloudy code.
 */
export function nwsCodeFromText(text: string | undefined): number | undefined {
  if (!text) return undefined
  const t = text.toLowerCase()
  if (t.includes('thunder')) return 95
  // Ahead of both the snow and the rain branches: "Freezing Rain" and
  // "Freezing Drizzle" contain none of snow/sleet/flurr/ice, so they would
  // otherwise fall through and read as ordinary rain on exactly the day ice
  // is the hazard.
  if (t.includes('freezing')) return t.includes('drizzle') ? 56 : 66
  if (t.includes('snow') || t.includes('sleet') || t.includes('flurr') || t.includes('ice')) return 71
  if (t.includes('rain') || t.includes('shower')) return 61
  if (t.includes('drizzle')) return 51
  if (t.includes('fog') || t.includes('haze')) return 45
  // Checked before the plain clear/sunny match below, since "partly sunny"
  // and "mostly clear" both contain "sunny"/"clear" as substrings.
  if (t.includes('mostly sunny') || t.includes('mostly clear') || t.includes('partly')) return 1
  if (t.includes('clear') || t.includes('sunny')) return 0
  if (t.includes('cloudy') || t.includes('overcast')) return 3
  return 3
}

/** YYYY-MM-DD for an ISO instant, in a given IANA time zone. */
export function localDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

/**
 * Buckets a gridpoint series (each entry's `validTime` is "{startISO}/{iso
 * duration}") by the local calendar date of its start, combining whichever
 * entries land on the same date. Good enough for a farm threshold — this is
 * "how much rain today", not a metered total, and NWS's own sub-day windows
 * (1h gust readings, 6h precipitation buckets) don't line up with calendar
 * days any more precisely than that anyway.
 */
export function aggregateByDate(
  values: NwsGridValue[] | undefined, timeZone: string,
  convert: (raw: number) => number, combine: (a: number, b: number) => number,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const v of values ?? []) {
    if (v.value == null || !Number.isFinite(v.value)) continue
    const date = localDateKey(v.validTime.split('/')[0], timeZone)
    const converted = convert(v.value)
    out.set(date, out.has(date) ? combine(out.get(date)!, converted) : converted)
  }
  return out
}

/**
 * Pairs NWS's alternating day/night periods ("Today", "Tonight", "Monday",
 * "Monday Night", ...) into one entry per calendar date. A period's
 * `startTime` already carries its own UTC offset, and the day and its
 * following night share that same local date, so grouping by
 * `localDateKey(startTime)` pairs them for free.
 *
 * A date with only one period (typically today, once its daytime period has
 * already passed and only "Tonight" remains) uses that single reading for
 * both ends rather than leaving the other blank — a farmer checking after
 * dark still gets a real number, not a hole in the row.
 */
export function daysFromPeriods(periods: NwsPeriod[], timeZone: string): DayForecast[] {
  const byDate = new Map<string, { day?: NwsPeriod; night?: NwsPeriod }>()
  for (const p of periods) {
    const date = localDateKey(p.startTime, timeZone)
    const entry = byDate.get(date) ?? {}
    if (p.isDaytime) entry.day = p
    // Two night periods can share one calendar date: opened between midnight
    // and dawn, NWS leads with "Overnight" — this morning's low, a couple of
    // hours out — and "Tonight", eighteen hours later, lands on that same
    // date. Keeping the colder is what makes a 28° sunrise still trip the
    // frost warning instead of being papered over by a mild 45° evening.
    else if (!entry.night || p.temperature < entry.night.temperature) entry.night = p
    byDate.set(date, entry)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { day, night }]) => ({
      date,
      maxF: day?.temperature ?? night!.temperature,
      minF: night?.temperature ?? day!.temperature,
      code: nwsCodeFromText(day?.shortForecast ?? night?.shortForecast),
      precipIn: 0,
      gustMph: 0,
      snowIn: 0,
    }))
}

/** Folds precip/snow/gust onto the days daysFromPeriods() already built, by date. */
export function withGridExtras(
  days: DayForecast[],
  precipIn: Map<string, number>, snowIn: Map<string, number>, gustMph: Map<string, number>,
): DayForecast[] {
  return days.map((d) => ({
    ...d,
    precipIn: precipIn.get(d.date) ?? 0,
    snowIn: snowIn.get(d.date) ?? 0,
    gustMph: gustMph.get(d.date) ?? 0,
  }))
}
