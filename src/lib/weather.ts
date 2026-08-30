import { db, getSyncState, setSyncState } from '../db/client'
import {
  farmWarnings, frostDates, hardinessZone,
  type DayForecast, type FrostDates, type Warning,
} from './weatherRules'
import {
  aggregateByDate, daysFromPeriods, nwsCodeFromText, withGridExtras, type NwsPeriod,
} from './nwsForecast'

/**
 * Open-Meteo: free, no API key, no signup, worldwide. Chosen so the app has no
 * credential to leak, no quota to police, and nothing to bill. Still the
 * fallback for the climate archive and for any farm outside NWS's US-only
 * coverage — see fetchNwsForecast below for the forecast itself.
 */
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'

const UNITS = 'temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch'

/**
 * The US government's own forecast — free, no key, and closer to what a
 * farmer already checks (and what other US weather apps quote) than a
 * global model blend, which is what someone actually pointed out: a
 * multi-day-out forecast reading ten degrees hotter than everyone else's
 * is exactly the gap that matters when it decides whether stock gets
 * moved into shade. US coverage only — fetchNwsForecast returns null
 * outside it (a 404 from /points), and getForecast() falls back to
 * Open-Meteo in that case, or if NWS is having a bad day itself.
 */
const NWS_POINTS = 'https://api.weather.gov/points'
const NWS_STATIONS = 'https://api.weather.gov/stations'

const FORECAST_TTL_MS = 60 * 60 * 1000        // an hour
const CLIMATE_TTL_MS = 180 * 24 * 60 * 60 * 1000  // half a year; it barely moves

export interface FarmLocation {
  latitude: number
  longitude: number
  placeName: string | null
}

export interface Place {
  name: string
  admin: string
  country: string
  latitude: number
  longitude: number
}

export interface Forecast {
  fetchedAt: string
  currentF: number | null
  currentCode: number | null
  days: DayForecast[]
  warnings: Warning[]
  /** Which provider actually answered — shown on the sheet so "why does this differ from X" has an answer. */
  source: 'nws' | 'open-meteo'
}

export interface Climate {
  fetchedAt: string
  zone: string
  avgAnnualMinF: number
  frost: FrostDates
}

// ------------------------------------------------------------------ location

export async function getFarmLocation(): Promise<FarmLocation | null> {
  const pg = await db()
  const { rows } = await pg.query<{
    latitude: number | null; longitude: number | null; place_name: string | null
  }>(`select latitude, longitude, place_name from farm limit 1`)
  const r = rows[0]
  if (!r || r.latitude === null || r.longitude === null) return null
  return {
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    placeName: r.place_name,
  }
}

export async function setFarmLocation(loc: FarmLocation) {
  const pg = await db()
  await pg.query(
    `update farm set latitude = $1, longitude = $2, place_name = $3,
            updated_at = $4`,
    [loc.latitude, loc.longitude, loc.placeName, new Date().toISOString()],
  )
  // Location changed, so anything derived from it is stale.
  await setSyncState('weather:forecast', '')
  await setSyncState('weather:climate', '')
}

/** Accepts a town, a postcode, or "town, state" — Open-Meteo handles all three. */
export async function searchPlace(query: string): Promise<Place[]> {
  const url = `${GEOCODE}?name=${encodeURIComponent(query)}&count=8&language=en&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Place lookup failed (${res.status})`)
  const json = await res.json()
  return (json.results ?? []).map((r: Record<string, unknown>) => ({
    name: String(r.name),
    admin: String(r.admin1 ?? ''),
    country: String(r.country ?? ''),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
  }))
}

const US_STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY', 'District of Columbia': 'DC',
}

/**
 * "Independence, MO" rather than "Independence, Missouri" — short enough to
 * sit next to a temperature without crowding it. Open-Meteo's geocoder only
 * gives the full state name; anything not in the table (a non-US admin
 * region) passes through as-is rather than being dropped.
 */
export function formatPlaceName(name: string, admin: string): string {
  const short = US_STATE_ABBR[admin] ?? admin
  return [name, short].filter(Boolean).join(', ')
}

/**
 * Reverse geocoding for "use this device's location" — a bare lat/long is
 * meaningless on the weather strip, and Open-Meteo (forward search only)
 * can't turn coordinates back into a place name. Reuses the same NWS lookup
 * getForecast() makes anyway, which already returns city/state (already
 * abbreviated) for free — US only, and null wherever NWS is, so the caller
 * falls back to a generic label rather than showing nothing.
 */
export async function reverseGeocodePlaceName(
  latitude: number, longitude: number,
): Promise<string | null> {
  try {
    const res = await fetch(`${NWS_POINTS}/${latitude},${longitude}`)
    if (!res.ok) return null
    const json = await res.json()
    const rel = json.properties?.relativeLocation?.properties
    if (!rel?.city) return null
    return [rel.city, rel.state].filter(Boolean).join(', ')
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ forecast

/**
 * Cached in the local database rather than fetched on every render, so the
 * forecast is still on screen in a barn with no signal — stale, but there.
 * Tries NWS first (US only) and falls back to Open-Meteo — either a farm
 * outside US coverage, or NWS itself failing.
 */
export async function getForecast(force = false): Promise<Forecast | null> {
  const cached = await readCache<Forecast>('weather:forecast')
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < FORECAST_TTL_MS
  if (cached && fresh && !force) return cached

  const loc = await getFarmLocation()
  if (!loc) return cached

  const forecast = await fetchNwsForecast(loc) ?? await fetchOpenMeteoForecast(loc)
  if (!forecast) return cached
  await writeCache('weather:forecast', forecast)
  return forecast
}

async function fetchOpenMeteoForecast(loc: FarmLocation): Promise<Forecast | null> {
  try {
    const url = `${FORECAST}?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,` +
      `snowfall_sum,wind_gusts_10m_max,weather_code` +
      `&current=temperature_2m,weather_code&forecast_days=7&timezone=auto&${UNITS}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Weather fetch failed (${res.status})`)
    const j = await res.json()

    const days: DayForecast[] = (j.daily?.time ?? []).map((date: string, i: number) => ({
      date,
      maxF: j.daily.temperature_2m_max[i],
      minF: j.daily.temperature_2m_min[i],
      precipIn: j.daily.precipitation_sum[i] ?? 0,
      snowIn: j.daily.snowfall_sum?.[i] ?? 0,
      gustMph: j.daily.wind_gusts_10m_max[i] ?? 0,
      code: j.daily.weather_code?.[i],
    }))

    return {
      fetchedAt: new Date().toISOString(),
      currentF: j.current?.temperature_2m ?? null,
      currentCode: j.current?.weather_code ?? null,
      days,
      warnings: farmWarnings(days),
      source: 'open-meteo',
    }
  } catch {
    // Offline, or Open-Meteo is having a day. The caller falls back to
    // whatever's cached.
    return null
  }
}

/**
 * NWS's /forecast gives clean per-period highs/lows already in Fahrenheit —
 * used as-is rather than converted, to keep zero conversion risk on the
 * one number people actually compare against other apps. Precipitation,
 * snow and wind gust aren't in that endpoint at all (only a percent
 * chance of rain), so those come from the raw gridpoint data instead —
 * metric, and bucketed by calendar day in nwsForecast.ts.
 */
async function fetchNwsForecast(loc: FarmLocation): Promise<Forecast | null> {
  try {
    const pointsRes = await fetch(`${NWS_POINTS}/${loc.latitude},${loc.longitude}`)
    if (!pointsRes.ok) return null // outside US coverage, or NWS having a day
    const points = await pointsRes.json()
    const { forecast: forecastUrl, forecastGridData: gridUrl, timeZone } =
      points.properties ?? {}
    if (!forecastUrl || !gridUrl || !timeZone) return null

    const [periodsRes, gridRes] = await Promise.all([fetch(forecastUrl), fetch(gridUrl)])
    if (!periodsRes.ok || !gridRes.ok) return null
    const periodsJson = await periodsRes.json()
    const gridJson = await gridRes.json()

    const periods: NwsPeriod[] = periodsJson.properties?.periods ?? []
    if (periods.length === 0) return null

    const grid = gridJson.properties ?? {}
    const precipIn = aggregateByDate(
      grid.quantitativePrecipitation?.values, timeZone, (mm) => mm / 25.4, (a, b) => a + b,
    )
    const snowIn = aggregateByDate(
      grid.snowfallAmount?.values, timeZone, (mm) => mm / 25.4, (a, b) => a + b,
    )
    const gustMph = aggregateByDate(
      grid.windGust?.values, timeZone, (kmh) => kmh * 0.621371, (a, b) => Math.max(a, b),
    )
    const days = withGridExtras(daysFromPeriods(periods, timeZone), precipIn, snowIn, gustMph)
      .slice(0, 7)
    if (days.length === 0) return null

    const current = await fetchNwsCurrentConditions(gridUrl)

    return {
      fetchedAt: new Date().toISOString(),
      currentF: current?.tempF ?? null,
      currentCode: current?.code ?? null,
      days,
      warnings: farmWarnings(days),
      source: 'nws',
    }
  } catch {
    return null
  }
}

/**
 * NWS has no single "current conditions" forecast field — this is a real
 * station's most recent observation, the same kind of reading a human
 * checking the airport's weather page would see. Best-effort: if a device
 * has no stations nearby, or the nearest one hasn't reported recently, the
 * caller just shows no current reading rather than a period's fixed high
 * mislabeled as "now".
 */
async function fetchNwsCurrentConditions(
  gridUrl: string,
): Promise<{ tempF: number; code?: number } | null> {
  try {
    const stationsRes = await fetch(`${gridUrl}/stations`)
    if (!stationsRes.ok) return null
    const stationsJson = await stationsRes.json()
    const id = stationsJson.features?.[0]?.properties?.stationIdentifier
    if (!id) return null

    const obsRes = await fetch(`${NWS_STATIONS}/${id}/observations/latest`)
    if (!obsRes.ok) return null
    const obs = (await obsRes.json()).properties ?? {}
    const c = obs.temperature?.value
    if (c == null || !Number.isFinite(c)) return null
    return { tempF: c * 9 / 5 + 32, code: nwsCodeFromText(obs.textDescription) }
  } catch {
    return null
  }
}

// ------------------------------------------------------------------- climate

/**
 * Ten years of daily minimums, reduced to a hardiness zone and average frost
 * dates. Fetched once and kept, because it describes the climate rather than
 * the weather and does not meaningfully change between seasons.
 */
export async function getClimate(force = false): Promise<Climate | null> {
  const cached = await readCache<Climate>('weather:climate')
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < CLIMATE_TTL_MS
  if (cached && fresh && !force) return cached

  const loc = await getFarmLocation()
  if (!loc) return cached

  try {
    const end = new Date()
    end.setFullYear(end.getFullYear() - 1)
    const start = new Date(end)
    start.setFullYear(start.getFullYear() - 10)
    const iso = (d: Date) => d.toISOString().slice(0, 10)

    const url = `${ARCHIVE}?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&start_date=${iso(start)}&end_date=${iso(end)}` +
      `&daily=temperature_2m_min&timezone=auto&${UNITS}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Climate fetch failed (${res.status})`)
    const j = await res.json()

    const daily: { date: string; minF: number }[] =
      (j.daily?.time ?? []).map((date: string, i: number) => ({
        date, minF: j.daily.temperature_2m_min[i],
      })).filter((d: { minF: number }) => Number.isFinite(d.minF))

    if (daily.length === 0) return cached

    // Average annual minimum: the coldest night of each year, averaged.
    const minByYear = new Map<number, number>()
    for (const d of daily) {
      const y = Number(d.date.slice(0, 4))
      minByYear.set(y, Math.min(minByYear.get(y) ?? Infinity, d.minF))
    }
    const mins = [...minByYear.values()]
    const avgAnnualMinF = mins.reduce((a, b) => a + b, 0) / mins.length

    const climate: Climate = {
      fetchedAt: new Date().toISOString(),
      zone: hardinessZone(avgAnnualMinF),
      avgAnnualMinF,
      frost: frostDates(daily),
    }
    await writeCache('weather:climate', climate)
    return climate
  } catch {
    return cached
  }
}

// --------------------------------------------------------------------- cache

async function readCache<T>(key: string): Promise<T | null> {
  const raw = await getSyncState(key)
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

async function writeCache(key: string, value: unknown) {
  await setSyncState(key, JSON.stringify(value))
}
