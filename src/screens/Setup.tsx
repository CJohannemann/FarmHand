import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { createAsset, getFarmName, listTerms, renameFarm } from '../db/queries'
import { setFarmLocation, searchPlace, type Place } from '../lib/weather'
import { Sheet } from './Sheet'

/**
 * First run, once and only once. Three questions, all skippable, each of which
 * removes something the app would otherwise be unable to do: an unnamed farm,
 * no weather, and a Today screen with three buttons and nothing to point them
 * at.
 */
export function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)

  return (
    <main className="screen setup">
      <ol className="steps" aria-label="Setup progress">
        {[0, 1, 2].map((i) => (
          <li key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />
        ))}
      </ol>

      {step === 0 && <NameStep onNext={() => setStep(1)} />}
      {step === 1 && <PlaceStep onNext={() => setStep(2)} />}
      {step === 2 && <StockStep onNext={onDone} />}
    </main>
  )
}

function NameStep({ onNext }: { onNext: () => void }) {
  const [name, setName] = useState('')

  const save = async () => {
    if (name.trim()) await renameFarm(name.trim())
    onNext()
  }

  return (
    <>
      <h1>Welcome to FarmHand</h1>
      <p className="tagline">
        Records for a farm or a homestead — what you keep, what you feed it,
        what it produces, and what any of it actually cost.
      </p>

      <label className="field">
        <span>What do you call your place?</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          placeholder="Johannemann homestead" />
        <small className="hint">You can change this whenever you like.</small>
      </label>

      <button className="primary" onClick={save}>
        {name.trim() ? 'Next' : 'Skip for now'}
      </button>
    </>
  )
}

function PlaceStep({ onNext }: { onNext: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    if (!query.trim()) return
    setBusy(true); setError(null)
    try {
      const found = await searchPlace(query.trim())
      setResults(found)
      if (found.length === 0) setError('Nothing found. Try a nearby town.')
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  const choose = async (p: Place) => {
    await setFarmLocation({
      latitude: p.latitude,
      longitude: p.longitude,
      placeName: [p.name, p.admin].filter(Boolean).join(', '),
    })
    onNext()
  }

  const useDevice = () => {
    if (!navigator.geolocation) { setError('This device cannot share a location.'); return }
    setBusy(true); setError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await setFarmLocation({
          latitude: Number(pos.coords.latitude.toFixed(4)),
          longitude: Number(pos.coords.longitude.toFixed(4)),
          placeName: 'My farm',
        })
        setBusy(false); onNext()
      },
      (e) => { setError(e.message); setBusy(false) },
      { timeout: 10_000 },
    )
  }

  return (
    <>
      <h1>Where is it?</h1>
      <p className="tagline">
        This gets you a forecast with frost and heat warnings, plus your
        hardiness zone and average frost dates. A nearby town is close enough.
      </p>

      <label className="field">
        <span>Town or postcode</span>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search() }}
          placeholder="64050 or Independence, Missouri" />
        <small className="hint">
          Only used to fetch weather. It is not shared with anyone.
        </small>
      </label>

      <button className="primary" disabled={busy || !query.trim()} onClick={search}>
        {busy ? 'Looking…' : 'Search'}
      </button>

      {error && <p className="error">{error}</p>}

      {results && results.length > 0 && (
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
      )}

      <div className="setup-foot">
        <button className="linkish" onClick={useDevice} disabled={busy}>
          Use this device’s location
        </button>
        <button className="linkish" onClick={onNext}>Skip</button>
      </div>
    </>
  )
}

function StockStep({ onNext }: { onNext: () => void }) {
  const { data: species } = useAsync(() => listTerms('species'), [])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const entered = Object.entries(counts).filter(([, v]) => Number(v) > 0)

  const save = async () => {
    setBusy(true)
    for (const [name, count] of entered) {
      await createAsset({
        type: 'group',
        name,
        attributes: { species: name, headcount: Number(count) },
      })
    }
    setBusy(false)
    onNext()
  }

  return (
    <>
      <h1>What do you keep?</h1>
      <p className="tagline">
        Rough numbers are fine. This is only so the app knows what to offer you —
        an Eggs button is no use without birds.
      </p>

      <ul className="countlist">
        {(species ?? []).map((s) => (
          <li key={s}>
            <label htmlFor={`c-${s}`}>{s}</label>
            <input
              id={`c-${s}`} type="number" inputMode="numeric" min="0"
              value={counts[s] ?? ''} placeholder="0"
              onChange={(e) => setCounts({ ...counts, [s]: e.target.value })}
            />
          </li>
        ))}
      </ul>

      <p className="hint">
        Each becomes a group you can name and split later — individual animals,
        separate batches, whatever suits. Nothing here is permanent.
      </p>

      <button className="primary" disabled={busy} onClick={save}>
        {entered.length
          ? `Add ${entered.length === 1 ? 'it' : 'them'} and finish`
          : 'Skip — I will add them later'}
      </button>
    </>
  )
}

/**
 * The farm's name, tappable to change it. Lives in the footer because it is
 * identity rather than navigation — and because a farm called "My farm"
 * forever was the gap left by naming it only at creation.
 */
export function FarmName() {
  const { data, reload } = useAsync(() => getFarmName(), [])
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')

  const open = () => { setName(data ?? ''); setEditing(true) }

  const save = async () => {
    if (name.trim()) await renameFarm(name.trim())
    setEditing(false)
    reload()
  }

  return (
    <>
      <button className="farmname" onClick={open}>{data ?? '…'}</button>
      {editing && (
        <Sheet title="Rename your farm" onClose={() => setEditing(false)}>
          <label className="field">
            <span>What do you call it?</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
          </label>
          <button className="primary" disabled={!name.trim()} onClick={save}>
            Save
          </button>
        </Sheet>
      )}
    </>
  )
}
