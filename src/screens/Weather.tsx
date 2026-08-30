import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  formatPlaceName, getClimate, getForecast, getFarmLocation,
  reverseGeocodePlaceName, searchPlace, setFarmLocation,
  type Place,
} from '../lib/weather'
import type { Warning } from '../lib/weatherRules'
import { weatherIcon, colorForTemp } from '../lib/weatherIcons'
import { Sheet } from './Sheet'

const dayName = (iso: string, i: number) =>
  i === 0 ? 'Today'
    : new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })

const worst = (ws: Warning[]) =>
  ws.some((w) => w.severity === 'severe') ? 'severe'
    : ws.some((w) => w.severity === 'warn') ? 'warn' : 'watch'

export function WeatherStrip() {
  const [open, setOpen] = useState(false)
  const loc = useAsync(() => getFarmLocation(), [])
  const fc = useAsync(() => getForecast(), [loc.data?.latitude])

  if (loc.loading) return null

  if (!loc.data) {
    return (
      <>
        <button className="weatherstrip empty" onClick={() => setOpen(true)}>
          Set your farm’s location for weather and frost dates
        </button>
        {open && <WeatherSheet onClose={() => setOpen(false)}
          onLocated={() => { setOpen(false); loc.reload(); fc.reload() }} />}
      </>
    )
  }

  const f = fc.data
  const soon = (f?.warnings ?? []).slice(0, 1)

  return (
    <>
      <button className={`weatherstrip ${soon.length ? worst(f!.warnings) : ''}`}
        onClick={() => setOpen(true)}>
        <span className="wx-now-icon">{weatherIcon(f?.currentCode)}</span>
        <span className="wx-now">
          {f?.currentF != null ? `${Math.round(f.currentF)}°` : '—'}
        </span>
        <span className="wx-body">
          {loc.data.placeName && (
            <span className="wx-place">{loc.data.placeName}</span>
          )}
          <span className="wx-msg">
            {soon.length
              ? soon[0].headline
              : f ? 'Nothing rough in the next week' : 'Tap for weather'}
          </span>
        </span>
        <span className="chev">›</span>
      </button>
      {open && <WeatherSheet onClose={() => setOpen(false)}
        onLocated={() => { loc.reload(); fc.reload() }} />}
    </>
  )
}

function WeatherSheet({
  onClose, onLocated,
}: { onClose: () => void; onLocated: () => void }) {
  const loc = useAsync(() => getFarmLocation(), [])
  const fc = useAsync(() => getForecast(), [loc.data?.latitude])
  const cl = useAsync(() => getClimate(), [loc.data?.latitude])
  const [changing, setChanging] = useState(false)

  if (!loc.data || changing) {
    return (
      <Sheet title="Where is the farm?" onClose={onClose}>
        <LocationPicker onDone={() => {
          setChanging(false); loc.reload(); fc.reload(); cl.reload(); onLocated()
        }} />
      </Sheet>
    )
  }

  const f = fc.data
  const c = cl.data

  return (
    <Sheet title={loc.data.placeName ?? 'Weather'} onClose={onClose}>
      {fc.loading && !f && <p className="muted">Fetching…</p>}

      {f && f.warnings.length > 0 && (
        <>
          <h3 className="section">Worth planning for</h3>
          <ul className="warnlist">
            {f.warnings.map((w, i) => (
              <li key={i} className={w.severity}>
                <div className="warn-head">
                  {dayName(w.date, 0) && (
                    <span className="warn-when">
                      {new Date(w.date + 'T12:00:00')
                        .toLocaleDateString(undefined, { weekday: 'short' })}
                    </span>
                  )}
                  <span className="warn-title">{w.headline}</span>
                </div>
                <p className="warn-advice">{w.advice}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {f && (() => {
        const weekMin = Math.min(...f.days.map((d) => d.minF))
        const weekMax = Math.max(...f.days.map((d) => d.maxF))
        const span = Math.max(1, weekMax - weekMin)
        return (
          <>
            <h3 className="section">Next seven days</h3>
            <ul className="wxdays">
              {f.days.map((d, i) => (
                <li key={d.date}>
                  <span className="wx-day">{dayName(d.date, i)}</span>
                  <span className="wx-icon">{weatherIcon(d.code)}</span>
                  <span className="wx-low">{Math.round(d.minF)}°</span>
                  <span className="wx-bar-track">
                    <span className="wx-bar-fill" style={{
                      left: `${((d.minF - weekMin) / span) * 100}%`,
                      width: `${((d.maxF - d.minF) / span) * 100}%`,
                      backgroundImage:
                        `linear-gradient(90deg, ${colorForTemp(d.minF)}, ${colorForTemp(d.maxF)})`,
                    }} />
                  </span>
                  <strong className="wx-high">{Math.round(d.maxF)}°</strong>
                  <span className="wx-precip">
                    {d.precipIn >= 0.05 ? `${d.precipIn.toFixed(1)}"` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )
      })()}

      {c && (
        <>
          <h3 className="section">Your growing season</h3>
          <div className="costbox">
            <div className="costrow">
              <span>Hardiness zone</span><span>{c.zone}</span>
            </div>
            <div className="costrow">
              <span>Last spring frost</span>
              <span>{c.frost.lastSpring ?? '—'}</span>
            </div>
            <div className="costrow">
              <span>First fall frost</span>
              <span>{c.frost.firstFall ?? '—'}</span>
            </div>
            <div className="costrow strong">
              <span>Frost-free days</span>
              <span>{c.frost.seasonDays ?? '—'}</span>
            </div>
          </div>
          <p className="hint">
            Averaged from ten years of records for your coordinates, not a
            lookup table — so it reflects your ground rather than the nearest
            city. <strong>These are averages, not safe dates.</strong> Plant on
            the last-frost date and roughly half of years will catch you; wait a
            week or two past it if the crop cannot take a frost.
          </p>
        </>
      )}

      {f && (
        <p className="hint">
          Updated {new Date(f.fetchedAt).toLocaleString()} ·{' '}
          {f.source === 'nws' ? 'National Weather Service' : 'Open-Meteo'}. Kept on
          the device, so it is still here with no signal.
        </p>
      )}

      <button className="linkish" onClick={() => setChanging(true)}>
        Change location
      </button>
    </Sheet>
  )
}

function LocationPicker({ onDone }: { onDone: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    if (!query.trim()) return
    setBusy(true); setError(null)
    try {
      const found = await searchPlace(query.trim())
      // A postcode resolves to exactly one place, so "which one is it?" over
      // a list of one is a tap that decides nothing. Take it and move on;
      // the chosen name is shown on the sheet behind this, and Change
      // location is right there if the geocoder guessed wrong.
      if (found.length === 1) { await choose(found[0]); return }
      setResults(found)
      if (found.length === 0) setError('Nothing found. Try a nearby town.')
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  const useDevice = () => {
    if (!navigator.geolocation) { setError('This device cannot share a location.'); return }
    setBusy(true); setError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const latitude = Number(pos.coords.latitude.toFixed(4))
        const longitude = Number(pos.coords.longitude.toFixed(4))
        // A bare lat/long means nothing on the weather strip — worth a real
        // name, but only US coverage can give one this way (see the
        // function's own comment), so a farm elsewhere still gets set up
        // rather than blocked on a lookup that was never going to answer.
        const placeName = await reverseGeocodePlaceName(latitude, longitude) ?? 'My farm'
        await setFarmLocation({ latitude, longitude, placeName })
        setBusy(false); onDone()
      },
      (e) => { setError(e.message); setBusy(false) },
      { timeout: 10_000 },
    )
  }

  const choose = async (p: Place) => {
    await setFarmLocation({
      latitude: p.latitude,
      longitude: p.longitude,
      placeName: formatPlaceName(p.name, p.admin),
    })
    onDone()
  }

  return (
    <>
      <p className="hint">
        Only used to fetch weather. Nothing is shared with anyone, and a nearby
        town is close enough — frost dates barely move over a few miles.
      </p>

      <label className="field">
        <span>Town or postcode</span>
        <input
          autoFocus value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search() }}
          placeholder="64050 or Independence, Missouri"
        />
      </label>

      <button className="primary" disabled={busy || !query.trim()} onClick={search}>
        {busy ? 'Looking…' : 'Search'}
      </button>

      {error && <p className="error">{error}</p>}

      <button className="linkish" onClick={useDevice} disabled={busy}>
        Use this device’s location instead
      </button>

      {results && results.length > 0 && (
        <Sheet title="Which one is it?" onClose={() => setResults(null)}>
          <ul className="assetlist">
            {results.map((p, i) => (
              <li key={i}>
                <button className="assetrow" onClick={() => choose(p)}>
                  <span className="asset-name">{p.name}</span>
                  <span className="asset-meta">
                    {[p.admin, p.country].filter(Boolean).join(', ')}
                    <span className="chev">›</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  )
}
