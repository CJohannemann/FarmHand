import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  createAsset, createGroupWithMembers, createLog, createPlanting, listAssets, listTerms,
  lotBalances, type LotBalance,
} from '../db/queries'
import type { Asset, AssetType } from '../db/types'
import { EQUIPMENT_KINDS, FUEL_TYPES, SPECIES_PURPOSES, type Purpose } from '../lib/tiles'
import { purposeLabel, sexTermsFor, speciesGlyph } from '../lib/husbandry'
import {
  formatQty, hasNumericValue, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput,
  onNumericChange,
} from '../lib/numeric'
import { Sheet } from './Sheet'
import { AssetDetail } from './AssetDetail'
import { TakeFromLot } from './TakeFromLot'

const GROUPS: { type: AssetType; heading: string; blurb: string }[] = [
  { type: 'animal',    heading: 'Animals',   blurb: 'Tracked one by one' },
  { type: 'group',     heading: 'Groups',    blurb: 'Flocks, batches, herds' },
  { type: 'planting',  heading: 'Plantings', blurb: 'A crop in a place, this season' },
  { type: 'lot',       heading: 'Stores',    blurb: 'Feed, seed, meat, produce' },
  { type: 'land',      heading: 'Land',      blurb: 'Fields, paddocks, beds' },
  { type: 'equipment', heading: 'Equipment', blurb: 'Tractors, attachments, vehicles' },
]

/**
 * Section headings come from what a thing IS, not from the table it lives
 * in. "Lots" is a word out of the schema — nobody buys a lot, they buy hay,
 * and hay belongs under Feed. Same for a tractor, which belongs under
 * Tractors rather than Equipment. So lots are bucketed by their material and
 * machines by their kind, and the type-level heading survives only as the
 * fallback for anything that never got one.
 */
function bucketBy<T>(
  items: T[], key: (item: T) => string | null, fallback: string,
): { heading: string; items: T[] }[] {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const heading = (key(item) ?? '').trim() || fallback
    const bucket = buckets.get(heading)
    if (bucket) bucket.push(item)
    else buckets.set(heading, [item])
  }
  return [...buckets.entries()]
    .map(([heading, items]) => ({ heading, items }))
    .sort((a, b) => {
      // The fallback bucket is the leftovers — always last, whatever it
      // would sort as alphabetically.
      if (a.heading === fallback) return 1
      if (b.heading === fallback) return -1
      return a.heading.localeCompare(b.heading)
    })
}

/**
 * "Tractor" as a heading over three tractors reads wrong. Only applied to a
 * real kind — the fallback heading is a category name that already reads as
 * one ("Equipment"), and materials need no help either, being mass nouns
 * ("Feed", "Hay", "Straw") left exactly as they were typed.
 */
const pluralKind = (kind: string) =>
  kind === 'Other' || kind.endsWith('s') ? kind : kind + 's'

/**
 * Buckets animals under their species, alphabetically, with anything that
 * has no species recorded last — those are the ones needing attention, and
 * burying them mid-list makes them easy to miss.
 */
function groupBySpecies(items: Asset[]): { species: string | null; items: Asset[] }[] {
  const buckets = new Map<string | null, Asset[]>()
  for (const a of items) {
    const species = String(a.attributes?.species ?? '').trim() || null
    const bucket = buckets.get(species)
    if (bucket) bucket.push(a)
    else buckets.set(species, [a])
  }
  return [...buckets.entries()]
    .map(([species, items]) => ({ species, items }))
    .sort((a, b) => {
      if (a.species === null) return 1
      if (b.species === null) return -1
      return a.species.localeCompare(b.species)
    })
}

export function Stock() {
  const [adding, setAdding] = useState(false)
  const [taking, setTaking] = useState<LotBalance | null>(null)
  // A stack, not a single value — so Back from a member returns to its
  // group, not all the way out to the top list. Selecting from the top
  // list starts a fresh stack; a group's Members list pushes onto it.
  const [stack, setStack] = useState<Asset[]>([])
  // Which species card is open, if any. `null` is a real value here — the
  // bucket of animals with no species recorded — so `undefined` means "no
  // card open" and the two cannot be confused.
  const [species, setSpecies] = useState<string | null | undefined>(undefined)
  const { data, loading, reload } = useAsync(() => listAssets(), [])
  const assets = data ?? []
  // Lots come from lotBalances() rather than the asset list, because a lot
  // is only ever interesting as "how much is left" — and that query already
  // filters out the service lots (a vet bill, an oil change) that exist to
  // carry a price and nothing else.
  const lots = useAsync(() => lotBalances(), [])
  const reloadAll = () => { reload(); lots.reload() }

  // `underOwnHeading` rows already sit under a heading naming their species
  // or their kind — repeating it on every row is just noise, so an animal
  // shows its ear tag instead and a machine drops straight to make and model.
  const row = (a: Asset, underOwnHeading = false) => {
    const liveMembers = assets.filter(
      (m) => m.parent_id === a.id && m.status === 'active',
    ).length
    const headcount = liveMembers || a.attributes?.headcount
    const equipMeta = [
      underOwnHeading ? null : a.attributes?.kind,
      a.attributes?.make, a.attributes?.model,
    ].filter(Boolean).join(' ')
    const kind = a.type === 'equipment'
      ? equipMeta
      : underOwnHeading
        ? [a.attributes?.sex, a.attributes?.tag ? `Tag ${String(a.attributes.tag)}` : '']
          .filter(Boolean).join(' · ')
        : String(a.attributes?.species ?? a.attributes?.crop ?? '')
    return (
      <li key={a.id} className={a.status === 'archived' ? 'gone' : ''}>
        <button className="assetrow" onClick={() => setStack([a])}>
          <span className="asset-name">{a.name}</span>
          <span className="asset-meta">
            {kind}
            {headcount ? ` · ${formatQty(Number(headcount))} head` : ''}
            {a.status === 'archived'
              ? ` · ${a.terminal_event ?? 'archived'}` : ''}
            <span className="chev">›</span>
          </span>
        </button>
      </li>
    )
  }

  if (stack.length > 0) {
    const current = stack[stack.length - 1]
    // Re-read from the list so the header reflects any change just made.
    const fresh = assets.find((a) => a.id === current.id) ?? current
    return (
      <AssetDetail
        asset={fresh}
        onBack={() => setStack(stack.slice(0, -1))}
        onChanged={reload}
        onSelect={(a) => setStack([...stack, a])}
      />
    )
  }

  if (species !== undefined) {
    const mine = assets.filter((a) =>
      a.type === 'animal' && !a.parent_id
      && (String(a.attributes?.species ?? '').trim() || null) === species)
    return (
      <div className="screen">
        <button type="button" className="back" onClick={() => setSpecies(undefined)}>
          ‹ Back
        </button>
        <h1>{species ?? 'No species set'}</h1>
        <p className="tagline">
          {formatQty(mine.length)} {mine.length === 1 ? 'animal' : 'animals'}
        </p>
        <ul className="assetlist">{mine.map((a) => row(a, true))}</ul>
      </div>
    )
  }

  return (
    <div className="screen">
      <h1>Inventory</h1>
      <p className="tagline">
        Animals, land, feed and machines — everything the records hang off.
      </p>

      <button className="primary" onClick={() => setAdding(true)}>
        + Add something
      </button>

      {loading && <p className="muted">Loading…</p>}

      {!loading && assets.length === 0 && (
        <p className="empty">
          Nothing here yet. Add your cattle, a flock, a bag of feed — or the
          tractor, so its services have somewhere to go.
        </p>
      )}

      {GROUPS.map((g) => {
        // Stores is the one section not backed by the asset list — see
        // `lots` above. Its rows carry a balance and draw the lot down
        // rather than opening an asset page, which is all the separate
        // Stores tab ever did.
        if (g.type === 'lot') {
          const all = lots.data ?? []
          if (all.length === 0) return null
          return (
            <section key={g.type}>
              {bucketBy(all, (l) => l.material, 'Other supplies').map(({ heading, items }) => (
                <div key={heading}>
                  <h2 className="section">{heading}</h2>
                  <ul className="assetlist">
                    {items.map((l) => (
                      <li key={l.id} className={l.remaining > 0.001 ? '' : 'gone'}>
                        <button className="assetrow" onClick={() => setTaking(l)}>
                          <span className="asset-name">{l.name}</span>
                          <span className="asset-meta">
                            {l.remaining > 0.001 ? (
                              <strong className="remaining">
                                {formatQty(l.remaining)} {l.unit ?? ''}
                              </strong>
                            ) : `${formatQty(l.came_in)} ${l.unit ?? ''} in, none left`}
                            <span className="chev">›</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )
        }

        // Members of a group are reached through that group, not listed
        // flatly here too — otherwise every named-out animal would show up
        // twice.
        const mine = assets.filter((a) => a.type === g.type && !a.parent_id)
        if (mine.length === 0) return null

        // Animals are tracked and named individually, so a flat list of "1",
        // "2", "Patti" says nothing about which is a pig and which the cow.
        // One card per species, tapped to see that species' animals — a herd
        // of forty would otherwise bury everything else on this screen.
        // Nothing else here needs it: a group carries its kind in its own
        // name ("Cattle (beef)"), and the rest have no species at all.
        if (g.type === 'animal') {
          return (
            <section key={g.type}>
              <h2 className="section">{g.heading}</h2>
              <div className="speciescards">
                {groupBySpecies(mine).map(({ species, items }) => (
                  <button key={species ?? '—'} type="button" className="speciescard"
                    onClick={() => setSpecies(species)}>
                    <span className="glyph">{speciesGlyph(species)}</span>
                    <span className="speciescard-name">{species ?? 'No species set'}</span>
                    <span className="speciescard-count">
                      {formatQty(items.length)} {items.length === 1 ? 'animal' : 'animals'}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )
        }

        // A tractor and the bush hog behind it are different things to own
        // and different things to service — one "Equipment" heading over
        // both hides that.
        if (g.type === 'equipment') {
          return (
            <section key={g.type}>
              {bucketBy(mine, (a) => String(a.attributes?.kind ?? ''), g.heading)
                .map(({ heading, items }) => (
                  <div key={heading}>
                    <h2 className="section">
                      {heading === g.heading ? heading : pluralKind(heading)}
                    </h2>
                    <ul className="assetlist">{items.map((a) => row(a, true))}</ul>
                  </div>
                ))}
            </section>
          )
        }

        return (
          <section key={g.type}>
            <h2 className="section">{g.heading}</h2>
            <ul className="assetlist">{mine.map((a) => row(a))}</ul>
          </section>
        )
      })}

      {adding && (
        <AddForm onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); reloadAll() }} />
      )}

      {taking && (
        <TakeFromLot lot={taking} onClose={() => setTaking(null)}
          onDone={() => { setTaking(null); lots.reload() }} />
      )}
    </div>
  )
}

function AddForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  // Blank until chosen — defaulting to any one kind (Animals or otherwise)
  // risks a tractor getting saved as a stray animal because nobody
  // reselected the dropdown.
  const [type, setType] = useState<AssetType | ''>('')
  const [name, setName] = useState('')
  const [species, setSpecies] = useState('')
  const [purpose, setPurpose] = useState<Purpose | undefined>(undefined)
  const [sex, setSex] = useState('')
  const [tag, setTag] = useState('')
  const [headcount, setHeadcount] = useState('')
  const [birthday, setBirthday] = useState('')
  const [price, setPrice] = useState('')
  const [crop, setCrop] = useState('')
  const [variety, setVariety] = useState('')
  const [where, setWhere] = useState('')
  const [kind, setKind] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [serial, setSerial] = useState('')
  const [hours, setHours] = useState('')
  const [mileage, setMileage] = useState('')
  const [fuel, setFuel] = useState('')
  const [plate, setPlate] = useState('')
  const { data: speciesList } = useAsync(() => listTerms('species'), [])
  const { data: cropList } = useAsync(() => listTerms('crop'), [])

  const wantsSpecies = type === 'animal' || type === 'group'
  const isAnimal = type === 'animal'
  const isPlanting = type === 'planting'
  const isEquipment = type === 'equipment'
  const purposeOptions = SPECIES_PURPOSES[species]
  // A commercial operation IDs by ear tag, never a name — a cow tracked
  // only that way shouldn't need a name invented for it just to save.
  const finalName = name.trim() || (isAnimal ? tag.trim() : '')

  const save = async () => {
    if (!type) return
    if (isPlanting) {
      await createPlanting({
        name: finalName,
        crop,
        variety: variety.trim() || undefined,
        where: where.trim() || undefined,
      })
      onDone()
      return
    }
    const attributes: Record<string, unknown> = {}
    if (wantsSpecies && species) attributes.species = species
    if (purposeOptions && purpose) attributes.purpose = purpose
    if (isEquipment && kind) attributes.kind = kind
    if (isEquipment && make.trim()) attributes.make = make.trim()
    if (isEquipment && model.trim()) attributes.model = model.trim()
    if (isEquipment && Number(year) > 0) attributes.year = Number(year)
    if (isEquipment && serial.trim()) attributes.serial = serial.trim()
    if (isEquipment && kind === 'Tractor' && Number(hours) > 0) attributes.hours = Number(hours)
    if (isEquipment && kind === 'Vehicle' && Number(mileage) > 0) attributes.mileage = Number(mileage)
    if (isEquipment && (kind === 'Tractor' || kind === 'Vehicle') && fuel) attributes.fuel = fuel
    if (isEquipment && kind === 'Vehicle' && plate.trim()) attributes.plate = plate.trim()
    if (isAnimal && sex) attributes.sex = sex
    if (isAnimal && tag.trim()) attributes.tag = tag.trim()
    const id = type === 'group' && Number(headcount) > 0
      ? await createGroupWithMembers({ name: finalName, count: Number(headcount), attributes })
      : await createAsset({ type, name: finalName, attributes })
    if (isAnimal && birthday) {
      await createLog({
        type: 'birth', name: 'Born', timestamp: new Date(`${birthday}T12:00:00`),
        assets: [{ id, role: 'subject' }],
      })
    }
    if ((isAnimal || isEquipment) && hasNumericValue(price)) {
      await createLog({
        type: 'purchase', name: `Bought ${finalName}`,
        assets: [{ id, role: 'subject' }],
        quantities: [{ measure: 'price', value: Number(price), unit: 'USD' }],
      })
    }
    onDone()
  }

  return (
    <Sheet title="Add" onClose={onClose}>
      <label className="field">
        <span>What kind?</span>
        <select value={type} onChange={(e) => setType(e.target.value as AssetType)}>
          <option value="">— Select —</option>
          {GROUPS.map((g) => (
            <option key={g.type} value={g.type}>
              {g.heading}{g.blurb ? ` — ${g.blurb}` : ''}
            </option>
          ))}
        </select>
      </label>

      {wantsSpecies && (
        <label className="field">
          <span>Species</span>
          <select autoFocus value={species}
            onChange={(e) => { setSpecies(e.target.value); setPurpose(undefined); setSex('') }}>
            <option value="">— pick one —</option>
            {(speciesList ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}

      {wantsSpecies && purposeOptions && (
        <div className="chipwrap" style={{ marginBottom: '1rem' }}>
          {purposeOptions.map((p) => (
            <button key={p} type="button" className={`chip${purpose === p ? ' on' : ''}`}
              onClick={() => setPurpose(purpose === p ? undefined : p)}>
              {purposeLabel(p, species)}
            </button>
          ))}
        </div>
      )}

      {/* Held back until a species is picked: the words themselves depend on
          it, and offering "Gilt" before knowing it's a pig invites nonsense. */}
      {isAnimal && species && (
        <label className="field">
          <span>What is it? (optional)</span>
          <div className="chipwrap">
            {sexTermsFor(species).map((s) => (
              <button key={s} type="button" className={`chip${sex === s ? ' on' : ''}`}
                onClick={() => setSex(sex === s ? '' : s)}>
                {s}
              </button>
            ))}
          </div>
        </label>
      )}

      <label className="field">
        <span>Name{isAnimal ? ' (optional with a tag)' : ''}</span>
        <input autoFocus={!wantsSpecies} value={name} onChange={(e) => setName(e.target.value)}
          placeholder={type === 'group' ? 'Spring broilers' : 'Bluebell'} />
      </label>

      {isAnimal && (
        <label className="field">
          <span>Tag number{name.trim() ? ' (optional)' : ''}</span>
          <input value={tag} onChange={(e) => setTag(e.target.value)}
            placeholder="Ear tag, ID number, whatever you use" />
        </label>
      )}

      {isAnimal && (
        <label className="field">
          <span>Birthday (optional)</span>
          <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        </label>
      )}

      {isEquipment && (
        <div className="chipwrap" style={{ marginBottom: '1rem' }}>
          {EQUIPMENT_KINDS.map((k) => (
            <button key={k} type="button" className={`chip${kind === k ? ' on' : ''}`}
              onClick={() => setKind(kind === k ? '' : k)}>
              {k}
            </button>
          ))}
        </div>
      )}

      {isEquipment && (
        <div className="pair">
          <label className="field">
            <span>Make (optional)</span>
            <input value={make} onChange={(e) => setMake(e.target.value)}
              placeholder="Kubota" />
          </label>
          <label className="field">
            <span>Model (optional)</span>
            <input value={model} onChange={(e) => setModel(e.target.value)}
              placeholder="L3901" />
          </label>
        </div>
      )}

      {isEquipment && (
        <div className="pair">
          <label className="field">
            <span>Year (optional)</span>
            <input type="number" inputMode="numeric" min="0" value={year}
              onChange={onNumericChange(setYear, { integer: true })}
              onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
              placeholder="2020" />
          </label>
          <label className="field">
            <span>Serial / VIN (optional)</span>
            <input value={serial} onChange={(e) => setSerial(e.target.value)} />
          </label>
        </div>
      )}

      {isEquipment && (kind === 'Tractor' || kind === 'Vehicle') && (
        <div className="pair">
          <label className="field">
            <span>{kind === 'Tractor' ? 'Engine hours (optional)' : 'Mileage (optional)'}</span>
            {kind === 'Tractor' ? (
              <input type="number" inputMode="numeric" min="0" value={hours}
                onChange={onNumericChange(setHours, { integer: true })}
                onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
                placeholder="1240" />
            ) : (
              <input type="number" inputMode="numeric" min="0" value={mileage}
                onChange={onNumericChange(setMileage, { integer: true })}
                onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
                placeholder="32400" />
            )}
          </label>
          <label className="field">
            <span>Fuel (optional)</span>
            <select value={fuel} onChange={(e) => setFuel(e.target.value)}>
              <option value="">— none —</option>
              {FUEL_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </div>
      )}

      {isEquipment && kind === 'Vehicle' && (
        <label className="field">
          <span>License plate (optional)</span>
          <input value={plate} onChange={(e) => setPlate(e.target.value)} />
        </label>
      )}

      {(isAnimal || isEquipment) && (
        <label className="field">
          <span>Bought for ($, optional)</span>
          <input type="number" inputMode="decimal" min="0" value={price}
            onChange={onNumericChange(setPrice)} onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="350" />
        </label>
      )}

      {type === 'group' && (
        <label className="field">
          <span>How many?</span>
          <input type="number" inputMode="numeric" min="0" value={headcount}
            onChange={onNumericChange(setHeadcount, { integer: true })}
            onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
            placeholder="75" />
        </label>
      )}

      {isPlanting && (
        <>
          <label className="field">
            <span>Crop</span>
            <select value={crop} onChange={(e) => setCrop(e.target.value)}>
              <option value="">— pick one —</option>
              {(cropList ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Variety (optional)</span>
            <input value={variety} onChange={(e) => setVariety(e.target.value)}
              placeholder="Salanova" />
          </label>
          <label className="field">
            <span>Where (optional)</span>
            <input value={where} onChange={(e) => setWhere(e.target.value)}
              placeholder="Bed 7" />
          </label>
          <p className="hint">
            Saving also records that you planted it today, so the season has a
            start date to measure from.
          </p>
        </>
      )}

      <button
        className="primary"
        disabled={!type || !finalName || (isPlanting && !crop)}
        onClick={save}
      >
        Save
      </button>
    </Sheet>
  )
}
