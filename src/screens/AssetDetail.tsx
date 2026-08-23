import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  archiveAsset, assetCosts, createHarvest, listTerms, logsForAsset,
} from '../db/queries'
import type { Asset } from '../db/types'
import { Sheet } from './Sheet'
import { EditAsset } from './EditAsset'

const EVENT_LABELS: Record<string, string> = {
  harvest: 'Harvest', weight: 'Weight', input_application: 'Fed',
  observation: 'Note', purchase: 'Bought', birth: 'Birth', death: 'Death',
  disposition: 'Used', movement: 'Moved', processing: 'Processed',
}

export function AssetDetail({
  asset, onBack, onChanged,
}: { asset: Asset; onBack: () => void; onChanged: () => void }) {
  const [sheet, setSheet] =
    useState<'harvest' | 'slaughter' | 'archive' | 'edit' | null>(null)

  const livestock = asset.type === 'animal' || asset.type === 'group'
  // Anything that yields product repeatedly: milk, eggs, honey, fruit, cuttings.
  const producer = livestock || asset.type === 'planting'
  const events = useAsync(() => logsForAsset(asset.id), [asset.id])
  const costs = useAsync(() => assetCosts(asset.id), [asset.id])

  const refresh = () => {
    setSheet(null); events.reload(); costs.reload(); onChanged()
  }

  const c = costs.data
  const showCosts = !!c && (c.inputCost > 0 || c.outputs.length > 0)

  return (
    <div className="screen">
      <button className="back" onClick={onBack}>‹ Back</button>

      <h1>{asset.name}</h1>
      <p className="tagline">
        {String(asset.attributes?.species ?? asset.type)}
        {asset.attributes?.headcount ? ` · ${String(asset.attributes.headcount)} head` : ''}
        {asset.status === 'archived' ? ` · ${asset.terminal_event ?? 'archived'}` : ''}
      </p>

      {showCosts && (
        <>
          <h2 className="section">Cost</h2>
          <div className="costbox">
            <Row label="Inputs" value={`$${c!.inputCost.toFixed(2)}`} />
            {c!.outputs.map((o, i) => (
              <Row key={i} label={o.name}
                value={o.amount ? `${o.amount} ${o.unit ?? ''}` : '—'} />
            ))}
            {c!.costPerUnit != null && (
              <Row strong label={`Cost per ${c!.unit ?? 'unit'}`}
                value={`$${c!.costPerUnit.toFixed(2)}`} />
            )}
          </div>
          {c!.costPerUnit == null && c!.inputCost > 0 && (
            <p className="hint">
              Record a harvest to see cost per pound.
            </p>
          )}
        </>
      )}

      <div className="actions">
        <button onClick={() => setSheet('edit')}>Edit</button>
        {asset.status === 'active' && producer && (
          <button onClick={() => setSheet('harvest')}>
            {asset.type === 'planting' ? 'Pick / cut' : 'Collect'}
          </button>
        )}
        {asset.status === 'active' && livestock && (
          <button onClick={() => setSheet('slaughter')}>Slaughter</button>
        )}
        {asset.status === 'active' && asset.type === 'planting' && (
          <button onClick={() => setSheet('slaughter')}>Pull it out</button>
        )}
        {asset.status === 'active' && livestock && (
          <button onClick={() => setSheet('archive')}>Sold or died</button>
        )}
      </div>

      <h2 className="section">History</h2>
      {events.loading && <p className="muted">Loading…</p>}
      {!events.loading && (events.data ?? []).length === 0 && (
        <p className="empty">Nothing recorded against this yet.</p>
      )}
      <ul className="loglist">
        {(events.data ?? []).map((e) => (
          <li key={e.id + e.role}>
            <div className="log-main">
              <span className="log-type">{EVENT_LABELS[e.type] ?? e.type}</span>
              {e.summary && <span className="log-qty">{e.summary}</span>}
            </div>
            {e.notes && <div className="log-note">{e.notes}</div>}
            <time className="log-time">
              {new Date(e.timestamp).toLocaleDateString(undefined,
                { month: 'short', day: 'numeric' })}
            </time>
          </li>
        ))}
      </ul>

      {(sheet === 'harvest' || sheet === 'slaughter') && (
        <HarvestForm
          asset={asset}
          endsSource={sheet === 'slaughter'}
          onClose={() => setSheet(null)}
          onDone={refresh}
        />
      )}
      {sheet === 'archive' && (
        <ArchiveForm asset={asset} onClose={() => setSheet(null)} onDone={refresh} />
      )}
      {sheet === 'edit' && (
        <EditAsset
          asset={asset}
          onClose={() => setSheet(null)}
          onChanged={refresh}
          onDeleted={() => { onChanged(); onBack() }}
        />
      )}
    </div>
  )
}

function Row({ label, value, strong }: {
  label: string; value: string; strong?: boolean
}) {
  return (
    <div className={strong ? 'costrow strong' : 'costrow'}>
      <span>{label}</span><span>{value}</span>
    </div>
  )
}

/** Guesses at what a thing yields, so the common case is one tap fewer. */
function defaultProduct(asset: Asset, endsSource: boolean) {
  const species = String(asset.attributes?.species ?? '')
  if (asset.type === 'planting') {
    const crop = String(asset.attributes?.crop ?? asset.name)
    return { material: 'Produce', unit: 'lb', label: crop }
  }
  if (endsSource) return { material: 'Meat', unit: 'lb', label: `${asset.name} — meat` }
  if (species === 'Honeybee') return { material: 'Honey', unit: 'lb', label: 'Honey' }
  if (species === 'Chicken' || species === 'Duck' || species === 'Goose') {
    return { material: 'Eggs', unit: 'each', label: 'Eggs' }
  }
  return { material: 'Milk', unit: 'gal', label: 'Milk' }
}

function HarvestForm({ asset, endsSource, onDone, onClose }: {
  asset: Asset; endsSource: boolean; onDone: () => void; onClose: () => void
}) {
  const guess = defaultProduct(asset, endsSource)
  const [name, setName] = useState(guess.label)
  const [material, setMaterial] = useState(guess.material)
  const [unit, setUnit] = useState(guess.unit)
  const [amount, setAmount] = useState('')
  const { data: materials } = useAsync(() => listTerms('material'), [])
  const { data: units } = useAsync(() => listTerms('unit'), [])

  const save = async () => {
    await createHarvest({
      sourceId: asset.id, outputName: name.trim(),
      material, amount: Number(amount), unit, endsSource,
    })
    onDone()
  }

  return (
    <Sheet
      title={endsSource
        ? (asset.type === 'planting' ? 'Pull it out' : `Slaughter ${asset.name}`)
        : `Collect from ${asset.name}`}
      onClose={onClose}
    >
      <p className="hint">
        {endsSource
          ? `This closes out ${asset.name} and creates what it became, so its
             costs follow through to the product.`
          : `${asset.name} carries on. Its accumulated costs are spread across
             everything it produces.`}
      </p>
      <label className="field">
        <span>What did you get?</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Kind</span>
        <select value={material} onChange={(e) => setMaterial(e.target.value)}>
          {(materials ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <div className="pair">
        <label className="field">
          <span>How much</span>
          <input type="number" inputMode="decimal" autoFocus value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="240" />
        </label>
        <label className="field">
          <span>Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {(units ?? []).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      </div>
      <button className="primary" disabled={!name.trim() || !(Number(amount) > 0)}
        onClick={save}>Save</button>
    </Sheet>
  )
}

function ArchiveForm({ asset, onDone, onClose }: {
  asset: Asset; onDone: () => void; onClose: () => void
}) {
  const [reason, setReason] = useState('sold')
  return (
    <Sheet title={`Close out ${asset.name}`} onClose={onClose}>
      <label className="field">
        <span>What happened?</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="sold">Sold</option>
          <option value="died">Died</option>
          <option value="culled">Culled</option>
        </select>
      </label>
      <button className="primary"
        onClick={async () => { await archiveAsset(asset.id, reason); onDone() }}>
        Save
      </button>
    </Sheet>
  )
}
