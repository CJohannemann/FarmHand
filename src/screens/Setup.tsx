import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  createAsset, createGroupWithMembers, createPlanting, createTerm, getFarmName,
  listTerms, renameFarm,
} from '../db/queries'
import { setFarmLocation, searchPlace, type Place } from '../lib/weather'
import { type Purpose } from '../lib/tiles'
import { purposeLabel } from '../lib/husbandry'
import {
  ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput, onNumericChange, sanitizeNumeric,
} from '../lib/numeric'
import { Sheet } from './Sheet'

/**
 * First run, once and only once. Three questions, each of which removes
 * something the app would otherwise be unable to do: an unnamed farm, no
 * weather, and a Today screen with three buttons and nothing to point them
 * at. Name and place are skippable — a guess is fine and easy to change
 * later. What the farm keeps is not: it is the one answer Today cannot
 * function without, so it is the one thing setup requires.
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
      <h1>Welcome to Farmhand Management</h1>
      <p className="tagline">
        Records for a farm or a homestead — what you keep, what you feed it,
        what it produces, and what any of it actually cost.
      </p>

      <label className="field">
        <span>What's the name of your farm?</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          placeholder="Sonny Side Acres" />
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

      <div className="setup-foot">
        <button className="linkish" onClick={useDevice} disabled={busy}>
          Use this device’s location
        </button>
        <button className="linkish" onClick={onNext}>Skip</button>
      </div>

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

/**
 * Grouping the seeded species by the kind of farming they belong to. Tapping
 * a card is one gesture instead of scanning a long list of number fields —
 * and it mirrors how tilesFor() decides what the Today screen offers, so a
 * farm that picks Poultry sees the Eggs tile the moment setup finishes.
 *
 * A row's `purpose` is what tilesFor() uses to tell a laying flock from a
 * pen of broilers, or a dairy herd from a beef one — both are Chicken, or
 * both are Cattle, but only one earns an Eggs or Milk button. Rows with no
 * purpose (Goat, Rabbit…) don't need the distinction. Goose and Turkey
 * default to meat without offering a choice: homesteaders keep them for the
 * table far more often than for eggs.
 *
 * Crops and "Custom" are not on this list on purpose. A headcount only
 * makes sense per species, but what a farm grows — or the kind of farming
 * it does at all — is too varied to curate into cards. Pigs live under
 * Livestock rather than alone, which keeps this at five: with Crops that's
 * six cards, two rows of three, and "Custom" on its own row — the same
 * three-column grid Today's tiles use, capped the same way.
 */
interface SpeciesRow {
  key: string
  name: string
  label: string
  purpose?: Purpose
}

const KINDS: {
  key: string; label: string; glyph: string; rows: SpeciesRow[]
  /** Which purposes this category's "add another kind" should offer, if any. */
  purposeOptions?: Purpose[]
}[] = [
  {
    key: 'poultry', label: 'Poultry', glyph: '🐔', purposeOptions: ['eggs', 'meat'],
    rows: [
      { key: 'chicken-eggs', name: 'Chicken', label: 'Chicken (layers)', purpose: 'eggs' },
      { key: 'chicken-meat', name: 'Chicken', label: 'Chicken (broilers)', purpose: 'meat' },
      { key: 'duck-eggs', name: 'Duck', label: 'Duck (layers)', purpose: 'eggs' },
      { key: 'duck-meat', name: 'Duck', label: 'Duck (meat)', purpose: 'meat' },
      { key: 'quail-eggs', name: 'Quail', label: 'Quail (layers)', purpose: 'eggs' },
      { key: 'quail-meat', name: 'Quail', label: 'Quail (meat)', purpose: 'meat' },
      { key: 'goose', name: 'Goose', label: 'Goose', purpose: 'meat' },
      { key: 'turkey', name: 'Turkey', label: 'Turkey', purpose: 'meat' },
    ],
  },
  {
    key: 'livestock', label: 'Livestock', glyph: '🐄', purposeOptions: ['dairy', 'meat', 'wool'],
    rows: [
      { key: 'cattle-dairy', name: 'Cattle', label: 'Cattle (dairy)', purpose: 'dairy' },
      { key: 'cattle-beef', name: 'Cattle', label: 'Cattle (beef)', purpose: 'meat' },
      { key: 'goat-dairy', name: 'Goat', label: 'Goat (dairy)', purpose: 'dairy' },
      { key: 'goat-meat', name: 'Goat', label: 'Goat (meat)', purpose: 'meat' },
      { key: 'sheep-wool', name: 'Sheep', label: 'Sheep (wool)', purpose: 'wool' },
      { key: 'sheep-lamb', name: 'Sheep', label: 'Sheep (lamb)', purpose: 'meat' },
      { key: 'pig', name: 'Pig', label: 'Pig' },
    ],
  },
  { key: 'bees', label: 'Bees', glyph: '🐝', rows: [{ key: 'honeybee', name: 'Honeybee', label: 'Honeybee' }] },
  { key: 'rabbits', label: 'Rabbits', glyph: '🐇', rows: [{ key: 'rabbit', name: 'Rabbit', label: 'Rabbit' }] },
  { key: 'horses', label: 'Horses', glyph: '🐴', rows: [{ key: 'horse', name: 'Horse', label: 'Horse' }] },
]

const ROW_BY_KEY = new Map(KINDS.flatMap((k) => k.rows).map((r) => [r.key, r]))

interface CustomEntry { name: string; count: string; purpose?: Purpose }

/**
 * "+ Add another kind", repeatable, inside whichever category is open. The
 * app cannot enumerate every species a farm anywhere might keep — this is
 * how a guinea fowl, a water buffalo, or anything else not on the curated
 * list still gets added, with the same purpose distinction Poultry and
 * Livestock offer.
 */
function AddKindRow({
  purposeOptions, askCount = true, label = '+ Add another kind',
  nameLabel = 'What is it?', placeholder = 'Guinea fowl, water buffalo, whatever it is',
  onAdd,
}: {
  purposeOptions?: Purpose[]
  askCount?: boolean
  label?: string
  nameLabel?: string
  placeholder?: string
  onAdd: (e: CustomEntry) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [count, setCount] = useState('')
  const [purpose, setPurpose] = useState<Purpose | undefined>(undefined)

  const add = () => {
    if (!name.trim()) return
    onAdd({ name: name.trim(), count, purpose })
    setName(''); setCount(''); setPurpose(undefined); setOpen(false)
  }

  if (!open) {
    return (
      <button type="button" className="linkish" style={{ marginTop: '0.6rem' }}
        onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <label className="field">
        <span>{nameLabel}</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder={placeholder} />
      </label>
      {askCount && (
        <label className="field">
          <span>How many? (optional)</span>
          <input type="number" inputMode="numeric" min="0" value={count}
            onChange={onNumericChange(setCount, { integer: true })}
            onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
            placeholder="0" />
        </label>
      )}
      {purposeOptions && (
        <div className="chipwrap" style={{ marginBottom: '1rem' }}>
          {purposeOptions.map((p) => (
            <button key={p} type="button" className={`chip${purpose === p ? ' on' : ''}`}
              onClick={() => setPurpose(purpose === p ? undefined : p)}>
              {purposeLabel(p, name)}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="linkish" disabled={!name.trim()} onClick={add}>
        + Add
      </button>
    </div>
  )
}

/** The order pages appear in once selection is done — matches the grid. */
const CATEGORY_ORDER = [...KINDS.map((k) => k.key), 'crops', 'custom']

const CATEGORY_TITLE: Record<string, string> = {
  poultry: 'What kind of poultry, and how many?',
  livestock: 'What kind of livestock, and how many?',
  bees: 'How many hives?',
  rabbits: 'How many rabbits?',
  horses: 'How many horses?',
  crops: 'What do you grow?',
  custom: 'Anything else?',
}

function StockStep({ onNext }: { onNext: () => void }) {
  const { data: species } = useAsync(() => listTerms('species'), [])
  // 'select' picks which kinds of farming apply; a number is an index into
  // that selection's own page — one kind, filled out on its own screen,
  // rather than all of them stacked on one long scroll.
  const [phase, setPhase] = useState<'select' | number>('select')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [cropInput, setCropInput] = useState('')
  const [pickedCrops, setPickedCrops] = useState<string[]>([])
  const [customByKind, setCustomByKind] = useState<Record<string, CustomEntry[]>>({})
  const [customName, setCustomName] = useState('')
  const [customCount, setCustomCount] = useState('')
  const [custom, setCustom] = useState<CustomEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        // Deselecting means "not this" — clear whatever was entered for it,
        // reachable now that Back can bring someone here after filling it in.
        const kind = KINDS.find((k) => k.key === key)
        if (kind) {
          setCounts((c) => {
            const copy = { ...c }
            kind.rows.forEach((r) => delete copy[r.key])
            return copy
          })
          setCustomByKind((c) => { const copy = { ...c }; delete copy[key]; return copy })
        }
        if (key === 'crops') setPickedCrops([])
        if (key === 'custom') setCustom([])
      } else {
        next.add(key)
      }
      return next
    })
  }

  const addCrop = () => {
    const name = cropInput.trim()
    if (!name) return
    if (pickedCrops.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setCropInput('')
      return
    }
    setPickedCrops([...pickedCrops, name])
    setCropInput('')
  }
  const removeCrop = (i: number) => setPickedCrops(pickedCrops.filter((_, x) => x !== i))

  const addCustomToKind = (kindKey: string, entry: CustomEntry) => {
    setCustomByKind((prev) => ({ ...prev, [kindKey]: [...(prev[kindKey] ?? []), entry] }))
  }
  const removeCustomFromKind = (kindKey: string, i: number) => {
    setCustomByKind((prev) => ({
      ...prev, [kindKey]: (prev[kindKey] ?? []).filter((_, x) => x !== i),
    }))
  }

  const addCustom = () => {
    if (!customName.trim()) return
    setCustom([...custom, { name: customName.trim(), count: customCount }])
    setCustomName(''); setCustomCount('')
  }

  const removeCustom = (i: number) => setCustom(custom.filter((_, x) => x !== i))

  const known = new Set(species ?? [])
  const entered = Object.entries(counts).filter(([, v]) => Number(v) > 0)
  const customByKindTotal = Object.values(customByKind)
    .reduce((n, entries) => n + entries.length, 0)
  const total = entered.length + pickedCrops.length + custom.length + customByKindTotal

  // This is the one step with no Skip, so a failure part-way through must
  // not leave the button disabled forever on a half-written farm with
  // nothing on screen to explain it. Writes are idempotent enough to retry.
  const save = async () => {
    setBusy(true); setError(null)
    try {
      await writeEverything()
      onNext()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const writeEverything = async () => {
    for (const [key, count] of entered) {
      const row = ROW_BY_KEY.get(key)!
      await createGroupWithMembers({
        name: row.label,
        count: Number(count),
        attributes: {
          species: row.name,
          ...(row.purpose ? { purpose: row.purpose } : {}),
        },
      })
    }
    for (const crop of pickedCrops) {
      await createTerm('crop', crop)
      await createPlanting({ name: crop, crop, logPlanting: false })
    }
    for (const [kindKey, entries] of Object.entries(customByKind)) {
      for (const e of entries) {
        await createTerm('species', e.name)
        await createAsset({
          type: 'group',
          name: e.name,
          attributes: {
            species: e.name,
            category: kindKey,
            ...(e.purpose ? { purpose: e.purpose } : {}),
            ...(Number(e.count) > 0 ? { headcount: Number(e.count) } : {}),
          },
        })
      }
    }
    for (const c of custom) {
      await createTerm('species', c.name)
      await createAsset({
        type: 'group',
        name: c.name,
        attributes: {
          species: c.name,
          ...(Number(c.count) > 0 ? { headcount: Number(c.count) } : {}),
        },
      })
    }
  }

  if (phase === 'select') {
    return (
      <>
        <h1>What kind of farming?</h1>
        <p className="tagline">
          Tap what applies — you'll fill in numbers for each on its own page
          next, one at a time.
        </p>

        <div className="tiles">
          {KINDS.map((k) => (
            <button key={k.key} type="button"
              className={`tile${selected.has(k.key) ? ' on' : ''}`}
              onClick={() => toggle(k.key)}>
              <span className="glyph">{k.glyph}</span>
              {k.label}
            </button>
          ))}
          <button type="button"
            className={`tile${selected.has('crops') ? ' on' : ''}`}
            onClick={() => toggle('crops')}>
            <span className="glyph">🌾</span>
            Crops
          </button>
          <button type="button"
            className={`tile tile-solo${selected.has('custom') ? ' on' : ''}`}
            onClick={() => toggle('custom')}>
            <span className="glyph">➕</span>
            Custom
          </button>
        </div>

        <p className="hint" style={{ marginTop: '1.25rem' }}>
          {selected.size
            ? 'Rough numbers are fine on the pages that follow — nothing here is permanent.'
            : 'Pick at least one to continue — an Eggs button is no use without birds.'}
        </p>

        <button className="primary" disabled={selected.size === 0}
          onClick={() => setPhase(0)}>
          Next
        </button>
      </>
    )
  }

  const pageOrder = CATEGORY_ORDER.filter((k) => selected.has(k))
  const key = pageOrder[phase]
  const isLast = phase === pageOrder.length - 1
  const kind = KINDS.find((k) => k.key === key)
  const goBack = () => setPhase(phase === 0 ? 'select' : phase - 1)
  const goForward = () => { if (isLast) save(); else setPhase(phase + 1) }

  return (
    <>
      <button type="button" className="back" onClick={goBack}>‹ Back</button>
      <h1>{CATEGORY_TITLE[key]}</h1>
      {pageOrder.length > 1 && (
        <p className="tagline">{phase + 1} of {pageOrder.length}</p>
      )}

      {kind && (() => {
        const rows = kind.rows.filter((r) => known.has(r.name))
        const kindCustom = customByKind[kind.key] ?? []
        return (
          <>
            {rows.length > 0 && (
              <ul className="countlist">
                {rows.map((r) => (
                  <li key={r.key}>
                    <label htmlFor={`c-${r.key}`}>{r.label}</label>
                    <input
                      id={`c-${r.key}`} type="number" inputMode="numeric" min="0"
                      value={counts[r.key] ?? ''} placeholder="0"
                      onChange={(e) => setCounts({
                        ...counts,
                        [r.key]: sanitizeNumeric(e.target.value, { integer: true }),
                      })}
                      onWheel={ignoreScrollOnNumberInput}
                      onKeyDown={ignoreArrowKeysOnNumberInput}
                    />
                  </li>
                ))}
              </ul>
            )}
            {kindCustom.length > 0 && (
              <div className="chipwrap" style={{ marginTop: '0.75rem' }}>
                {kindCustom.map((c, i) => (
                  <button key={i} type="button" className="chip remove"
                    onClick={() => removeCustomFromKind(kind.key, i)}>
                    {c.name}{Number(c.count) > 0 ? ` · ${c.count}` : ''}
                    {c.purpose ? ` · ${c.purpose}` : ''} ✕
                  </button>
                ))}
              </div>
            )}
            <AddKindRow purposeOptions={kind.purposeOptions}
              onAdd={(e) => addCustomToKind(kind.key, e)} />
          </>
        )
      })()}

      {key === 'crops' && (
        <>
          <label className="field">
            <span>What do you grow?</span>
            <input autoFocus value={cropInput} onChange={(e) => setCropInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCrop() } }}
              placeholder="Tomato, taro, whatever it is" />
          </label>
          <button type="button" className="linkish" disabled={!cropInput.trim()} onClick={addCrop}>
            + Add
          </button>

          {pickedCrops.length > 0 && (
            <ul className="countlist" style={{ marginTop: '1rem' }}>
              {pickedCrops.map((c, i) => (
                <li key={i}>
                  <label>{c}</label>
                  <button type="button" className="linkish" onClick={() => removeCrop(i)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {key === 'custom' && (
        <>
          <label className="field">
            <span>What do you call it?</span>
            <input autoFocus value={customName} onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCustom() }}
              placeholder="Aquaponics, mushrooms, whatever it is" />
          </label>
          <label className="field">
            <span>How many? (optional)</span>
            <input type="number" inputMode="numeric" min="0" value={customCount}
              onChange={onNumericChange(setCustomCount, { integer: true })}
              onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
              placeholder="0" />
          </label>
          <button type="button" className="linkish" disabled={!customName.trim()}
            onClick={addCustom}>
            + Add
          </button>

          {custom.length > 0 && (
            <div className="chipwrap" style={{ marginTop: '1rem' }}>
              {custom.map((c, i) => (
                <button key={i} type="button" className="chip remove"
                  onClick={() => removeCustom(i)}>
                  {c.name}{Number(c.count) > 0 ? ` · ${c.count}` : ''} ✕
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <p className="hint" style={{ marginTop: '1.25rem' }}>
        {isLast
          ? (total
            ? 'Rough numbers are fine — each becomes a group (or planting) you can name and split later. Nothing here is permanent.'
            : 'Add at least one thing, on this page or an earlier one, to continue.')
          : 'Rough numbers are fine — you can add more, or fine-tune, at any time.'}
      </p>

      {error && (
        <p className="error">
          Could not save that: {error}. Nothing is lost — try again.
        </p>
      )}

      <button className="primary" disabled={busy || (isLast && !total)} onClick={goForward}>
        {isLast
          ? (total ? `Add ${total === 1 ? 'it' : 'them'} and finish` : 'Add and finish')
          : 'Next'}
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
