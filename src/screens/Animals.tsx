import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { createAsset, listAssets, listTerms } from '../db/queries'
import type { AssetType } from '../db/types'
import { Sheet } from './Sheet'

const GROUPS: { type: AssetType; heading: string; blurb: string }[] = [
  { type: 'animal',    heading: 'Animals',   blurb: 'Tracked one by one' },
  { type: 'group',     heading: 'Groups',    blurb: 'Flocks, batches, herds' },
  { type: 'lot',       heading: 'Lots',      blurb: 'Feed, seed, meat, produce' },
  { type: 'land',      heading: 'Land',      blurb: 'Fields, paddocks, beds' },
  { type: 'equipment', heading: 'Equipment', blurb: '' },
]

export function Animals() {
  const [adding, setAdding] = useState(false)
  const { data, loading, reload } = useAsync(() => listAssets(), [])
  const assets = data ?? []

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
        const mine = assets.filter((a) => a.type === g.type)
        if (mine.length === 0) return null
        return (
          <section key={g.type}>
            <h2 className="section">{g.heading}</h2>
            <ul className="assetlist">
              {mine.map((a) => (
                <li key={a.id} className={a.status === 'archived' ? 'gone' : ''}>
                  <span className="asset-name">{a.name}</span>
                  <span className="asset-meta">
                    {String(a.attributes?.species ?? '')}
                    {a.attributes?.headcount
                      ? ` · ${String(a.attributes.headcount)} head` : ''}
                    {a.status === 'archived'
                      ? ` · ${a.terminal_event ?? 'archived'}` : ''}
                  </span>
                </li>
              ))}
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
  const [headcount, setHeadcount] = useState('')
  const { data: speciesList } = useAsync(() => listTerms('species'), [])

  const wantsSpecies = type === 'animal' || type === 'group'

  const save = async () => {
    const attributes: Record<string, unknown> = {}
    if (wantsSpecies && species) attributes.species = species
    if (type === 'group' && Number(headcount) > 0)
      attributes.headcount = Number(headcount)
    await createAsset({ type, name: name.trim(), attributes })
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

      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder={type === 'group' ? 'Spring broilers' : 'Bluebell'} />
      </label>

      {wantsSpecies && (
        <label className="field">
          <span>Species</span>
          <select value={species} onChange={(e) => setSpecies(e.target.value)}>
            <option value="">— pick one —</option>
            {(speciesList ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}

      {type === 'group' && (
        <label className="field">
          <span>How many?</span>
          <input type="number" inputMode="numeric" value={headcount}
            onChange={(e) => setHeadcount(e.target.value)} placeholder="75" />
        </label>
      )}

      <button className="primary" disabled={!name.trim()} onClick={save}>Save</button>
    </Sheet>
  )
}
