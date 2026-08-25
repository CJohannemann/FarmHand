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
        return (
          <section key={g.type}>
            <h2 className="section">{g.heading}</h2>
            <ul className="assetlist">
              {mine.map((a) => {
                const liveMembers = assets.filter(
                  (m) => m.parent_id === a.id && m.status === 'active',
                ).length
                const headcount = liveMembers || a.attributes?.headcount
                const equipMeta = [a.attributes?.kind, a.attributes?.make, a.attributes?.model]
                  .filter(Boolean).join(' ')
                return (
                  <li key={a.id} className={a.status === 'archived' ? 'gone' : ''}>
                    <button className="assetrow" onClick={() => setStack([a])}>
                      <span className="asset-name">{a.name}</span>
                      <span className="asset-meta">
                        {a.type === 'equipment'
                          ? equipMeta
                          : String(a.attributes?.species ?? a.attributes?.crop ?? '')}
                        {headcount ? ` · ${String(headcount)} head` : ''}
                        {a.status === 'archived'
                          ? ` · ${a.terminal_event ?? 'archived'}` : ''}
                        <span className="chev">›</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
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
