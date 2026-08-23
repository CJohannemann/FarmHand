import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { deleteAsset, listTerms, updateAsset } from '../db/queries'
import type { Asset } from '../db/types'
import { Sheet } from './Sheet'

export function EditAsset({
  asset, onClose, onChanged, onDeleted,
}: {
  asset: Asset
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(asset.name)
  const [species, setSpecies] = useState(String(asset.attributes?.species ?? ''))
  const [headcount, setHeadcount] = useState(
    asset.attributes?.headcount ? String(asset.attributes.headcount) : '',
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data: speciesList } = useAsync(() => listTerms('species'), [])

  const wantsSpecies = asset.type === 'animal' || asset.type === 'group'

  const save = async () => {
    setBusy(true)
    const attributes = { ...asset.attributes }
    if (wantsSpecies) {
      if (species) attributes.species = species
      else delete attributes.species
    }
    if (asset.type === 'group') {
      if (Number(headcount) > 0) attributes.headcount = Number(headcount)
      else delete attributes.headcount
    }
    await updateAsset(asset.id, { name: name.trim(), attributes })
    setBusy(false)
    onChanged()
  }

  const remove = async () => {
    setBusy(true)
    await deleteAsset(asset.id)
    setBusy(false)
    onDeleted()
  }

  return (
    <Sheet title={`Edit ${asset.name}`} onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      {wantsSpecies && (
        <label className="field">
          <span>Species</span>
          <select value={species} onChange={(e) => setSpecies(e.target.value)}>
            <option value="">— none —</option>
            {(speciesList ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}

      {asset.type === 'group' && (
        <label className="field">
          <span>How many?</span>
          <input type="number" inputMode="numeric" value={headcount}
            onChange={(e) => setHeadcount(e.target.value)} />
        </label>
      )}

      <button className="primary" disabled={busy || !name.trim()} onClick={save}>
        Save
      </button>

      {!confirming ? (
        <button className="danger" onClick={() => setConfirming(true)}>
          Delete {asset.name}
        </button>
      ) : (
        <div className="confirm">
          <p>
            Delete {asset.name}? Its records stay, but it disappears from your
            lists. If it was sold or died, use “Sold or died” instead — that
            keeps the history honest.
          </p>
          <div className="actions">
            <button onClick={() => setConfirming(false)}>Keep it</button>
            <button className="danger" disabled={busy} onClick={remove}>Delete</button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
