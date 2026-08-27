import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { createLog, deleteAsset, listTerms, updateAsset } from '../db/queries'
import type { Asset } from '../db/types'
import { EQUIPMENT_KINDS, FUEL_TYPES, SPECIES_PURPOSES, type Purpose } from '../lib/tiles'
import { purposeLabel, sexTermsFor } from '../lib/husbandry'
import {
  hasNumericValue, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput, onNumericChange,
} from '../lib/numeric'
import { ParentField } from './ParentField'
import { Sheet } from './Sheet'

/**
 * Name, species, sex, tag, birthday, price paid — or, for equipment, kind,
 * make, model, year, serial, hours/mileage, fuel and plate — one form for
 * the facts about a thing, rather than a separate button and sheet for
 * each. A hundred-head farm
 * cannot afford eight taps per cow just to enter one. Birthday and price
 * still land as their own log events under the hood (History, and
 * assetCosts(), both depend on that) — this just stops making the farmer
 * find a different button for each fact.
 */
export function EditAsset({
  asset, hasBirthday, hasPurchase, onClose, onChanged, onDeleted,
}: {
  asset: Asset
  hasBirthday: boolean
  hasPurchase: boolean
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(asset.name)
  const [species, setSpecies] = useState(String(asset.attributes?.species ?? ''))
  const [purpose, setPurpose] = useState<Purpose | undefined>(
    asset.attributes?.purpose as Purpose | undefined,
  )
  const [headcount, setHeadcount] = useState(
    asset.attributes?.headcount ? String(asset.attributes.headcount) : '',
  )
  const [sex, setSex] = useState(String(asset.attributes?.sex ?? ''))
  const [tag, setTag] = useState(String(asset.attributes?.tag ?? ''))
  const [sireId, setSireId] = useState(String(asset.attributes?.sireId ?? ''))
  const [sireName, setSireName] = useState(String(asset.attributes?.sireName ?? ''))
  const [damId, setDamId] = useState(String(asset.attributes?.damId ?? ''))
  const [damName, setDamName] = useState(String(asset.attributes?.damName ?? ''))
  const [birthday, setBirthday] = useState('')
  const [price, setPrice] = useState('')
  const [kind, setKind] = useState(String(asset.attributes?.kind ?? ''))
  const [make, setMake] = useState(String(asset.attributes?.make ?? ''))
  const [model, setModel] = useState(String(asset.attributes?.model ?? ''))
  const [year, setYear] = useState(
    asset.attributes?.year ? String(asset.attributes.year) : '',
  )
  const [serial, setSerial] = useState(String(asset.attributes?.serial ?? ''))
  const [hours, setHours] = useState(
    asset.attributes?.hours ? String(asset.attributes.hours) : '',
  )
  const [mileage, setMileage] = useState(
    asset.attributes?.mileage ? String(asset.attributes.mileage) : '',
  )
  const [fuel, setFuel] = useState(String(asset.attributes?.fuel ?? ''))
  const [plate, setPlate] = useState(String(asset.attributes?.plate ?? ''))
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data: speciesList } = useAsync(() => listTerms('species'), [])

  const wantsSpecies = asset.type === 'animal' || asset.type === 'group'
  const livestock = asset.type === 'animal' || asset.type === 'group'
  const equipment = asset.type === 'equipment'
  const purposeOptions = SPECIES_PURPOSES[species]

  const save = async () => {
    setBusy(true)
    const attributes = { ...asset.attributes }
    if (wantsSpecies) {
      if (species) attributes.species = species
      else delete attributes.species
    }
    // Only touch `purpose` where this form actually offered chips for it.
    // Goose and Turkey are seeded meat-only with no chips, so a blind
    // `delete` here would strip that on any save — and producibleMaterial
    // reads an absent purpose on a bird as "lays eggs", putting a bogus
    // Eggs tile on Today after nothing worse than a rename.
    if (wantsSpecies && purposeOptions) {
      if (purpose) attributes.purpose = purpose
      else delete attributes.purpose
    }
    if (asset.type === 'group') {
      if (Number(headcount) > 0) attributes.headcount = Number(headcount)
      else delete attributes.headcount
    }
    if (asset.type === 'animal') {
      if (sex) attributes.sex = sex
      else delete attributes.sex
      if (tag.trim()) attributes.tag = tag.trim()
      else delete attributes.tag
      // A parent is either a real record on this farm or just a name —
      // never both, so picking one clears the other.
      if (sireId) { attributes.sireId = sireId; delete attributes.sireName }
      else if (sireName.trim()) { attributes.sireName = sireName.trim(); delete attributes.sireId }
      else { delete attributes.sireId; delete attributes.sireName }
      if (damId) { attributes.damId = damId; delete attributes.damName }
      else if (damName.trim()) { attributes.damName = damName.trim(); delete attributes.damId }
      else { delete attributes.damId; delete attributes.damName }
    }
    if (equipment) {
      if (kind) attributes.kind = kind
      else delete attributes.kind
      if (make.trim()) attributes.make = make.trim()
      else delete attributes.make
      if (model.trim()) attributes.model = model.trim()
      else delete attributes.model
      if (Number(year) > 0) attributes.year = Number(year)
      else delete attributes.year
      if (serial.trim()) attributes.serial = serial.trim()
      else delete attributes.serial
      if (kind === 'Tractor' && hasNumericValue(hours)) attributes.hours = Number(hours)
      else delete attributes.hours
      if (kind === 'Vehicle' && hasNumericValue(mileage)) attributes.mileage = Number(mileage)
      else delete attributes.mileage
      if ((kind === 'Tractor' || kind === 'Vehicle') && fuel) attributes.fuel = fuel
      else delete attributes.fuel
      if (kind === 'Vehicle' && plate.trim()) attributes.plate = plate.trim()
      else delete attributes.plate
    }
    try {
      await updateAsset(asset.id, { name: name.trim(), attributes })
      if (birthday) {
        await createLog({
          type: 'birth', name: 'Born', timestamp: new Date(`${birthday}T12:00:00`),
          assets: [{ id: asset.id, role: 'subject' }],
        })
      }
      if (hasNumericValue(price)) {
        await createLog({
          type: 'purchase', name: `Bought ${name.trim()}`,
          assets: [{ id: asset.id, role: 'subject' }],
          quantities: [{ measure: 'price', value: Number(price), unit: 'USD' }],
        })
      }
    } finally {
      setBusy(false)
    }
    onChanged()
  }

  const remove = async () => {
    setBusy(true)
    try {
      await deleteAsset(asset.id)
    } finally {
      setBusy(false)
    }
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
          <select value={species}
            onChange={(e) => { setSpecies(e.target.value); setPurpose(undefined) }}>
            <option value="">— none —</option>
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

      {asset.type === 'group' && (
        <label className="field">
          <span>How many?</span>
          <input type="number" inputMode="numeric" min="0" value={headcount}
            onChange={onNumericChange(setHeadcount, { integer: true })}
            onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput} />
        </label>
      )}

      {asset.type === 'animal' && (
        <label className="field">
          <span>Tag number (optional)</span>
          <input value={tag} onChange={(e) => setTag(e.target.value)}
            placeholder="Ear tag, ID number, whatever you use" />
        </label>
      )}

      {asset.type === 'animal' && (
        <div className="field">
          <span>What is it?</span>
          <div className="chipwrap">
            {/* Species-specific: a cow is never a gilt. A value already
                saved under a different species stays offered alongside, so
                editing something else about the animal cannot silently
                discard it. */}
            {[...new Set([...sexTermsFor(species), ...(sex ? [sex] : [])])].map((s) => (
              <button key={s} type="button" className={`chip${sex === s ? ' on' : ''}`}
                onClick={() => setSex(sex === s ? '' : s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {asset.type === 'animal' && (
        <ParentField label="Sire" species={species} excludeId={asset.id}
          id={sireId} onId={setSireId} name={sireName} onName={setSireName} />
      )}

      {asset.type === 'animal' && (
        <ParentField label="Dam" species={species} excludeId={asset.id}
          id={damId} onId={setDamId} name={damName} onName={setDamName} />
      )}

      {equipment && (
        <div className="chipwrap" style={{ marginBottom: '1rem' }}>
          {EQUIPMENT_KINDS.map((k) => (
            <button key={k} type="button" className={`chip${kind === k ? ' on' : ''}`}
              onClick={() => setKind(kind === k ? '' : k)}>
              {k}
            </button>
          ))}
        </div>
      )}

      {equipment && (
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

      {equipment && (
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

      {equipment && (kind === 'Tractor' || kind === 'Vehicle') && (
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

      {equipment && kind === 'Vehicle' && (
        <label className="field">
          <span>License plate (optional)</span>
          <input value={plate} onChange={(e) => setPlate(e.target.value)} />
        </label>
      )}

      {livestock && !hasBirthday && (
        <label className="field">
          <span>Birthday (optional)</span>
          <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        </label>
      )}

      {(livestock || equipment) && !hasPurchase && (
        <label className="field">
          <span>Bought for ($, optional)</span>
          <input type="number" inputMode="decimal" min="0" value={price}
            onChange={onNumericChange(setPrice)} onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="350" />
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
            lists.
            {livestock && ' If it was sold or died, use "Close out" instead — that keeps the history honest.'}
            {equipment && ' If it was sold or scrapped, use "Sold / retired" instead — that keeps the history honest.'}
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
