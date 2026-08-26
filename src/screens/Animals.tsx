import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  createAsset, createGroupWithMembers, createLog, createPlanting, listAssets, listTerms,
} from '../db/queries'
import type { Asset, AssetType } from '../db/types'
import { EQUIPMENT_KINDS, PURPOSE_LABEL, SPECIES_PURPOSES, type Purpose } from '../lib/tiles'
import {
  ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput, onNumericChange,
} from '../lib/numeric'
import { Sheet } from './Sheet'
import { AssetDetail } from './AssetDetail'

const GROUPS: { type: AssetType; heading: string; blurb: string }[] = [
  { type: 'animal',    heading: 'Animals',   blurb: 'Tracked one by one' },
  { type: 'group',     heading: 'Groups',    blurb: 'Flocks, batches, herds' },
  { type: 'planting',  heading: 'Plantings', blurb: 'A crop in a place, this season' },
  { type: 'lot',       heading: 'Lots',      blurb: 'Feed, seed, meat, produce' },
  { type: 'land',      heading: 'Land',      blurb: 'Fields, paddocks, beds' },
  { type: 'equipment', heading: 'Equipment', blurb: 'Tractors, implements, vehicles' },
]

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

export function Animals() {
  const [adding, setAdding] = useState(false)
  // A stack, not a single value — so Back from a member returns to its
  // group, not all the way out to the top list. Selecting from the top
  // list starts a fresh stack; a group's Members list pushes onto it.
  const [stack, setStack] = useState<Asset[]>([])
  const { data, loading, reload } = useAsync(() => listAssets(), [])
  const assets = data ?? []

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

  return (
    <div className="screen">
      <h1>Livestock &amp; land</h1>
      <p className="tagline">Everything the records hang off.</p>

      <button className="primary" onClick={() => setAdding(true)}>
        + Add something
      </button>

      {loading && <p className="muted">Loading…</p>}

      {!loading && assets.length === 0 && (
        <p className="empty">
          Nothing here yet. Add your cattle, a flock, or a bag of feed.
        </p>
      )}

      {GROUPS.map((g) => {
        // Members of a group are reached through that group, not listed
        // flatly here too — otherwise every named-out animal would show up
        // twice.
        const mine = assets.filter((a) => a.type === g.type && !a.parent_id)
        if (mine.length === 0) return null

        // `underSpeciesHeading` rows sit beneath a heading naming their
        // species already — repeating it on every row is just noise.
        const row = (a: Asset, underSpeciesHeading = false) => {
          const liveMembers = assets.filter(
            (m) => m.parent_id === a.id && m.status === 'active',
          ).length
          const headcount = liveMembers || a.attributes?.headcount
          const equipMeta = [a.attributes?.kind, a.attributes?.make, a.attributes?.model]
            .filter(Boolean).join(' ')
          const kind = a.type === 'equipment'
            ? equipMeta
            : underSpeciesHeading
              ? String(a.attributes?.tag ? `Tag ${String(a.attributes.tag)}` : '')
              : String(a.attributes?.species ?? a.attributes?.crop ?? '')
          return (
            <li key={a.id} className={a.status === 'archived' ? 'gone' : ''}>
              <button className="assetrow" onClick={() => setStack([a])}>
                <span className="asset-name">{a.name}</span>
                <span className="asset-meta">
                  {kind}
                  {headcount ? ` · ${String(headcount)} head` : ''}
                  {a.status === 'archived'
                    ? ` · ${a.terminal_event ?? 'archived'}` : ''}
                  <span className="chev">›</span>
                </span>
              </button>
            </li>
          )
        }

        // Animals are tracked individually and named individually, so a flat
        // list of "1", "2", "Patti" says nothing about which is a pig and
        // which is the cow. Everything else on this screen either carries
        // its kind in its own name (a group called "Cattle (beef)") or has
        // no species at all, so only animals get split up this way.
        const bySpecies = g.type === 'animal' ? groupBySpecies(mine) : null

        return (
          <section key={g.type}>
            <h2 className="section">{g.heading}</h2>
            {bySpecies
              ? bySpecies.map(({ species, items }) => (
                <div key={species ?? '—'}>
                  {/* One unlabelled bucket is just the flat list again. */}
                  {(species || bySpecies.length > 1) && (
                    <h3 className="subsection">{species ?? 'No species set'}</h3>
                  )}
                  <ul className="assetlist">{items.map((a) => row(a, species !== null))}</ul>
                </div>
              ))
              : <ul className="assetlist">{mine.map((a) => row(a))}</ul>}
          </section>
        )
      })}

      {adding && (
        <AddForm onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); reload() }} />
      )}
    </div>
  )
}

function AddForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [type, setType] = useState<AssetType>('animal')
  const [name, setName] = useState('')
  const [species, setSpecies] = useState('')
  const [purpose, setPurpose] = useState<Purpose | undefined>(undefined)
  const [tag, setTag] = useState('')
  const [headcount, setHeadcount] = useState('')
  const [birthday, setBirthday] = useState('')
  const [price, setPrice] = useState('')
  const [crop, setCrop] = useState('')
  const [variety, setVariety] = useState('')
  const [where, setWhere] = useState('')
  const [kind, setKind] = useState('')
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
    if (isAnimal && Number(price) > 0) {
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
            onChange={(e) => { setSpecies(e.target.value); setPurpose(undefined) }}>
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
              {PURPOSE_LABEL[p]}
            </button>
          ))}
        </div>
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

      {isAnimal && (
        <label className="field">
          <span>Bought for ($, optional)</span>
          <input type="number" inputMode="decimal" min="0" value={price}
            onChange={onNumericChange(setPrice)} onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="350" />
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
        disabled={!finalName || (isPlanting && !crop)}
        onClick={save}
      >
        Save
      </button>
    </Sheet>
  )
}
