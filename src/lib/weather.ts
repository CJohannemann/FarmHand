import { db, getSyncState, setSyncState } from '../db/client'
import {
  farmWarnings, frostDates, hardinessZone,
  type DayForecast, type FrostDates, type Warning,
} from './weatherRules'

/**
 * Open-Meteo: free, no API key, no signup, worldwide. Chosen so the app has no
 * credential to leak, no quota to police, and nothing to bill.
 */
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'

const UNITS = 'temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch'

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

// ------------------------------------------------------------------ forecast

/**
 * Cached in the local database rather than fetched on every render, so the
 * forecast is still on screen in a barn with no signal — stale, but there.
 */
export async function getForecast(force = false): Promise<Forecast | null> {
  const cached = await readCache<Forecast>('weather:forecast')
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < FORECAST_TTL_MS
  if (cached && fresh && !force) return cached

  const loc = await getFarmLocation()
  if (!loc) return cached

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

    const forecast: Forecast = {
      fetchedAt: new Date().toISOString(),
      currentF: j.current?.temperature_2m ?? null,
      currentCode: j.current?.weather_code ?? null,
      days,
      warnings: farmWarnings(days),
    }
    await writeCache('weather:forecast', forecast)
    return forecast
  } catch {
    // Offline, or Open-Meteo is having a day. Stale beats blank.
    return cached
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
