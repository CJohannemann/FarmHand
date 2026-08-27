import { useState, type ReactNode } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  archiveAsset, assetCosts, childAssets, createAsset, createHarvest, createLog,
  createPurchase, getAsset, listTerms, logsForAsset, lotBalances, offspringOf, updateAsset,
  weightHistory, type AssetEvent,
} from '../db/queries'
import type { Asset } from '../db/types'
import { producibleMaterial } from '../lib/tiles'
import {
  formatMoney, formatQty, hasNumericValue, ignoreArrowKeysOnNumberInput,
  ignoreScrollOnNumberInput, onNumericChange, withThousands,
} from '../lib/numeric'
import { AssetSelect } from './AssetSelect'
import { logDate } from './LogList'
import { Sheet } from './Sheet'
import { EditAsset } from './EditAsset'
import { EditLog } from './EditLog'
import { GrowthChart } from './GrowthChart'

const EVENT_LABELS: Record<string, string> = {
  harvest: 'Harvest', weight: 'Weight', input_application: 'Fed',
  observation: 'Note', purchase: 'Bought', birth: 'Birth', death: 'Death',
  disposition: 'Used', movement: 'Moved', processing: 'Processed',
}

export function AssetDetail({
  asset, onBack, onChanged, onSelect,
}: {
  asset: Asset
  onBack: () => void
  onChanged: () => void
  /** Jump the same detail view to a different asset — used for a group's members. */
  onSelect?: (asset: Asset) => void
}) {
  const [sheet, setSheet] = useState<
    | 'harvest' | 'pull' | 'closeout' | 'edit' | 'treat' | 'split' | 'weigh'
    | 'maintain' | 'retire' | 'addmember' | null
  >(null)
  const [editingLog, setEditingLog] = useState<AssetEvent | null>(null)

  const livestock = asset.type === 'animal' || asset.type === 'group'
  const equipment = asset.type === 'equipment'
  // Only if this specific animal actually yields something repeatedly — a
  // beef cow has no more business with a Collect button than a pig does.
  const material = producibleMaterial(asset)
  const producer = (livestock && material !== null) || asset.type === 'planting'
  const events = useAsync(() => logsForAsset(asset.id), [asset.id])
  const costs = useAsync(() => assetCosts(asset.id), [asset.id])
  const weights = useAsync(() => weightHistory(asset.id), [asset.id])
  const members = useAsync(
    () => (asset.type === 'group' ? childAssets(asset.id) : Promise.resolve([])),
    [asset.id, asset.type],
  )
  const sireId = asset.type === 'animal' ? String(asset.attributes?.sireId ?? '') : ''
  const damId = asset.type === 'animal' ? String(asset.attributes?.damId ?? '') : ''
  const sireAsset = useAsync(
    () => (sireId ? getAsset(sireId) : Promise.resolve(null)), [sireId],
  )
  const damAsset = useAsync(
    () => (damId ? getAsset(damId) : Promise.resolve(null)), [damId],
  )
  const offspring = useAsync(
    () => (asset.type === 'animal' ? offspringOf(asset.id) : Promise.resolve([])),
    [asset.id, asset.type],
  )

  const refresh = () => {
    setSheet(null)
    events.reload(); costs.reload(); weights.reload(); members.reload()
    sireAsset.reload(); damAsset.reload(); offspring.reload()
    onChanged()
  }

  const c = costs.data
  const birthEvent = (events.data ?? []).find((e) => e.type === 'birth')
  // From the log list, not `c!.purchaseCost > 0` — a $0 purchase (born on
  // the farm, cost nothing) is a real recorded fact, not the absence of
  // one, and a plain amount check can't tell those apart.
  const hasPurchase = (events.data ?? []).some((e) => e.type === 'purchase')
  const showCosts = !!c && (hasPurchase || c.inputCost > 0 || c.outputs.length > 0)
  const showBloodline = asset.type === 'animal' && (
    sireId || damId || !!asset.attributes?.sireName || !!asset.attributes?.damName
  )
  // `!= null`, not `||` — 0 engine hours or 0 miles (a brand-new tractor or
  // vehicle) is a real recorded fact, same reasoning as hasPurchase above.
  const showEquipmentDetails = equipment && (
    asset.attributes?.year != null || !!asset.attributes?.serial
    || asset.attributes?.hours != null || asset.attributes?.mileage != null
    || !!asset.attributes?.fuel || !!asset.attributes?.plate
  )
  const liveMembers = (members.data ?? []).filter((m) => m.status === 'active').length
  const headcount = liveMembers || asset.attributes?.headcount

  return (
    <div className="screen">
      <button className="back" onClick={onBack}>‹ Back</button>

      <h1>{asset.name}</h1>
      <p className="tagline">
        {equipment
          ? String(asset.attributes?.kind ?? 'Equipment')
          : String(asset.attributes?.species ?? asset.type)}
        {equipment && asset.attributes?.year ? ` · ${String(asset.attributes.year)}` : ''}
        {equipment && asset.attributes?.make ? ` ${String(asset.attributes.make)}` : ''}
        {equipment && asset.attributes?.model ? ` ${String(asset.attributes.model)}` : ''}
        {headcount ? ` · ${formatQty(Number(headcount))} head` : ''}
        {asset.attributes?.tag ? ` · Tag ${String(asset.attributes.tag)}` : ''}
        {asset.attributes?.sex ? ` · ${String(asset.attributes.sex)}` : ''}
        {birthEvent ? ` · Born ${new Date(birthEvent.timestamp).toLocaleDateString(
          undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
        {asset.status === 'archived' ? ` · ${asset.terminal_event ?? 'archived'}` : ''}
      </p>

      {asset.type === 'group' && (members.data ?? []).length > 0 && (
        <>
          <h2 className="section">Members</h2>
          <ul className="assetlist">
            {(members.data ?? []).map((m) => (
              <li key={m.id} className={m.status === 'archived' ? 'gone' : ''}>
                <button className="assetrow" onClick={() => onSelect?.(m)}>
                  <span className="asset-name">{memberLabel(asset, m)}</span>
                  <span className="asset-meta">
                    {m.status === 'archived' ? (m.terminal_event ?? 'archived') : 'active'}
                    <span className="chev">›</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {showBloodline && (
        <>
          <h2 className="section">Bloodline</h2>
          <div className="costbox">
            {(sireId || !!asset.attributes?.sireName) && (
              <Row label="Sire" value={
                sireAsset.data
                  ? <button className="linkish" onClick={() => onSelect?.(sireAsset.data!)}>
                      {sireAsset.data.name}
                    </button>
                  : String(asset.attributes?.sireName ?? '—')
              } />
            )}
            {(damId || !!asset.attributes?.damName) && (
              <Row label="Dam" value={
                damAsset.data
                  ? <button className="linkish" onClick={() => onSelect?.(damAsset.data!)}>
                      {damAsset.data.name}
                    </button>
                  : String(asset.attributes?.damName ?? '—')
              } />
            )}
          </div>
        </>
      )}

      {(offspring.data ?? []).length > 0 && (
        <>
          <h2 className="section">Offspring</h2>
          <ul className="assetlist">
            {(offspring.data ?? []).map((o) => (
              <li key={o.id} className={o.status === 'archived' ? 'gone' : ''}>
                <button className="assetrow" onClick={() => onSelect?.(o)}>
                  <span className="asset-name">{o.name}</span>
                  <span className="asset-meta">
                    {o.status === 'archived' ? (o.terminal_event ?? 'archived') : 'active'}
                    <span className="chev">›</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {showEquipmentDetails && (
        <>
          <h2 className="section">Details</h2>
          <div className="costbox">
            {asset.attributes?.year != null && (
              <Row label="Year" value={String(asset.attributes.year)} />
            )}
            {!!asset.attributes?.serial && (
              <Row label="Serial / VIN" value={String(asset.attributes.serial)} />
            )}
            {asset.attributes?.hours != null && (
              <Row label="Engine hours" value={formatQty(Number(asset.attributes.hours))} />
            )}
            {asset.attributes?.mileage != null && (
              <Row label="Mileage" value={`${formatQty(Number(asset.attributes.mileage))} mi`} />
            )}
            {!!asset.attributes?.fuel && (
              <Row label="Fuel" value={String(asset.attributes.fuel)} />
            )}
            {!!asset.attributes?.plate && (
              <Row label="Plate" value={String(asset.attributes.plate)} />
            )}
          </div>
        </>
      )}

      {showCosts && (
        <>
          <h2 className="section">Cost</h2>
          <div className="costbox">
            {hasPurchase && (
              <Row label="Bought for" value={formatMoney(c!.purchaseCost)} />
            )}
            <Row label="Inputs" value={formatMoney(c!.inputCost)} />
            {c!.outputs.map((o, i) => (
              <Row key={i} label={o.name}
                value={o.amount ? `${formatQty(o.amount)} ${o.unit ?? ''}` : '—'} />
            ))}
            {c!.costPerUnit != null && (
              <Row strong label={`Cost per ${c!.unit ?? 'unit'}`}
                value={formatMoney(c!.costPerUnit)} />
            )}
          </div>
          {c!.costPerUnit == null && (c!.purchaseCost > 0 || c!.inputCost > 0) && (
            <p className="hint">
              Record a harvest to see cost per pound.
            </p>
          )}
        </>
      )}

      {/*
        Routine, repeatable taps first — what a farmer reaches for daily or
        weekly. Facts and endings come last: Edit now carries birthday and
        price paid too, and Close out replaces what used to be two separate
        buttons (Slaughter, Sold or died) with one "what happened?" choice.
      */}
      <div className="actions">
        {asset.status === 'active' && producer && (
          <button onClick={() => setSheet('harvest')}>
            {asset.type === 'planting' ? 'Pick / cut' : 'Collect'}
          </button>
        )}
        {asset.status === 'active' && livestock && (
          <button onClick={() => setSheet('weigh')}>Weigh</button>
        )}
        {asset.status === 'active' && livestock && (
          <button onClick={() => setSheet('treat')}>Vet/Med</button>
        )}
        {asset.status === 'active' && equipment && (
          <button onClick={() => setSheet('maintain')}>Maintenance</button>
        )}
        {asset.status === 'active' && asset.type === 'group' && (
          <button onClick={() => setSheet('addmember')}>Add to this group</button>
        )}
        {asset.status === 'active' && asset.type === 'group' && (
          <button onClick={() => setSheet('split')}>Name an individual</button>
        )}
        <button onClick={() => setSheet('edit')}>Edit</button>
        {asset.status === 'active' && livestock && (
          <button onClick={() => setSheet('closeout')}>Close out</button>
        )}
        {asset.status === 'active' && equipment && (
          <button onClick={() => setSheet('retire')}>Sold / retired</button>
        )}
        {asset.status === 'active' && asset.type === 'planting' && (
          <button onClick={() => setSheet('pull')}>Pull it out</button>
        )}
      </div>

      {(weights.data ?? []).length >= 2 && (
        <>
          <h2 className="section">Growth</h2>
          <GrowthChart points={weights.data!} />
        </>
      )}

      <h2 className="section">History</h2>
      {events.loading && <p className="muted">Loading…</p>}
      {!events.loading && (events.data ?? []).length === 0 && (
        <p className="empty">Nothing recorded against this yet.</p>
      )}
      <ul className="loglist">
        {(events.data ?? []).map((e) => (
          <li key={e.id + e.role}>
            <button className="logrow" onClick={() => setEditingLog(e)}>
              <div className="log-main">
                <span className="log-type">{e.name ?? EVENT_LABELS[e.type] ?? e.type}</span>
                {e.summary && <span className="log-qty">{withThousands(e.summary)}</span>}
              </div>
              {e.notes && <div className="log-note">{e.notes}</div>}
              <time className="log-time">{logDate(e.timestamp)}</time>
            </button>
          </li>
        ))}
      </ul>

      {(sheet === 'harvest' || sheet === 'pull') && (
        <HarvestForm
          asset={asset}
          endsSource={sheet === 'pull'}
          onClose={() => setSheet(null)}
          onDone={refresh}
        />
      )}
      {sheet === 'closeout' && (
        <CloseOutForm asset={asset} producible={material}
          onClose={() => setSheet(null)} onDone={refresh} />
      )}
      {sheet === 'treat' && (
        <TreatForm asset={asset} onClose={() => setSheet(null)} onDone={refresh} />
      )}
      {sheet === 'maintain' && (
        <MaintenanceForm asset={asset} onClose={() => setSheet(null)} onDone={refresh} />
      )}
      {sheet === 'retire' && (
        <RetireForm asset={asset} onClose={() => setSheet(null)} onDone={refresh} />
      )}
      {sheet === 'weigh' && (
        <WeightForm asset={asset} onClose={() => setSheet(null)} onDone={refresh} />
      )}
      {sheet === 'split' && (
        <SplitForm group={asset} onClose={() => setSheet(null)} onDone={refresh} />
      )}
      {sheet === 'addmember' && (
        <AddMemberForm group={asset} onClose={() => setSheet(null)} onDone={refresh} />
      )}
      {sheet === 'edit' && (
        <EditAsset
          asset={asset}
          hasBirthday={!!birthEvent}
          hasPurchase={hasPurchase}
          onClose={() => setSheet(null)}
          onChanged={refresh}
          onDeleted={() => { onChanged(); onBack() }}
        />
      )}
      {editingLog && (
        <EditLog
          log={editingLog}
          onClose={() => setEditingLog(null)}
          onChanged={() => { setEditingLog(null); refresh() }}
        />
      )}
    </div>
  )
}

function Row({ label, value, strong }: {
  label: string; value: ReactNode; strong?: boolean
}) {
  return (
    <div className={strong ? 'costrow strong' : 'costrow'}>
      <span>{label}</span><span>{value}</span>
    </div>
  )
}

/** Guesses at what a thing yields, so the common case is one tap fewer. */
function defaultProduct(
  asset: Asset, endsSource: boolean, producible: 'eggs' | 'milk' | 'honey' | null,
) {
  if (asset.type === 'planting') {
    const crop = String(asset.attributes?.crop ?? asset.name)
    return { material: 'Produce', unit: 'lb', label: crop }
  }
  if (endsSource) return { material: 'Meat', unit: 'lb', label: `${asset.name} — meat` }
  if (producible === 'honey') return { material: 'Honey', unit: 'lb', label: 'Honey' }
  if (producible === 'eggs') return { material: 'Eggs', unit: 'each', label: 'Eggs' }
  return { material: 'Milk', unit: 'gal', label: 'Milk' }
}

function HarvestForm({ asset, endsSource, onDone, onClose }: {
  asset: Asset; endsSource: boolean; onDone: () => void; onClose: () => void
}) {
  const guess = defaultProduct(asset, endsSource, producibleMaterial(asset))
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
          <span>Quantity</span>
          <input type="number" inputMode={unit === 'each' ? 'numeric' : 'decimal'}
            min="0" autoFocus value={amount}
            onChange={onNumericChange(setAmount, { integer: unit === 'each' })}
            onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="240" />
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

/**
 * One button for however an animal's time on the farm ends, instead of a
 * separate Slaughter and a separate Sold-or-died. Sold, died and culled
 * just archive it; processed also asks what it became, since that creates
 * a real product and carries the animal's costs through to it.
 */
function CloseOutForm({ asset, producible, onDone, onClose }: {
  asset: Asset
  producible: 'eggs' | 'milk' | 'honey' | null
  onDone: () => void
  onClose: () => void
}) {
  const [reason, setReason] = useState<'sold' | 'died' | 'culled' | 'processed'>('sold')
  const guess = defaultProduct(asset, true, producible)
  const [name, setName] = useState(guess.label)
  const [material, setMaterial] = useState(guess.material)
  const [unit, setUnit] = useState(guess.unit)
  const [amount, setAmount] = useState('')
  const { data: materials } = useAsync(() => listTerms('material'), [])
  const { data: units } = useAsync(() => listTerms('unit'), [])

  const save = async () => {
    if (reason === 'processed') {
      await createHarvest({
        sourceId: asset.id, outputName: name.trim(),
        material, amount: Number(amount), unit, endsSource: true,
      })
    } else {
      await archiveAsset(asset.id, reason)
    }
    onDone()
  }

  return (
    <Sheet title={`Close out ${asset.name}`} onClose={onClose}>
      <label className="field">
        <span>What happened?</span>
        <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
          <option value="sold">Sold</option>
          <option value="died">Died</option>
          <option value="culled">Culled</option>
          <option value="processed">Processed (for meat)</option>
        </select>
      </label>

      {reason === 'processed' && (
        <>
          <p className="hint">
            This creates what {asset.name} became, so its costs follow
            through to the product.
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
              <span>Quantity</span>
              <input type="number" inputMode={unit === 'each' ? 'numeric' : 'decimal'}
                min="0" value={amount}
                onChange={onNumericChange(setAmount, { integer: unit === 'each' })}
                onWheel={ignoreScrollOnNumberInput}
                onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="240" />
            </label>
            <label className="field">
              <span>Unit</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                {(units ?? []).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          </div>
        </>
      )}

      <button className="primary"
        disabled={reason === 'processed' && (!name.trim() || !(Number(amount) > 0))}
        onClick={save}>
        Save
      </button>
    </Sheet>
  )
}

/**
 * Two ways in, same shape as Feed: draw from a bottle or a parts bin
 * already in Stores (the amount comes off what's on hand), or — if this is
 * the first time buying it — log a new purchase on the spot. Either way
 * assetCosts() picks it up with no changes: an input_application already
 * prorates a lot's price by the amount used, or charges the whole lot once
 * when no amount was recorded, which is exactly a $75 vet visit or a flat
 * repair bill with nothing left over to track.
 *
 * Vet/Med and Maintenance are the same form under two names: one animal's
 * medicine cabinet, one tractor's parts bin — same shape, different
 * vocabulary and title.
 */
function InputForm({
  asset, vocabulary, title, notesPlaceholder, onDone, onClose,
}: {
  asset: Asset
  vocabulary: string
  title: string
  notesPlaceholder: string
  onDone: () => void
  onClose: () => void
}) {
  const [kind, setKind] = useState('')
  const [lot, setLot] = useState('')
  const [used, setUsed] = useState('')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const { data: kinds } = useAsync(() => listTerms(vocabulary), [vocabulary])
  const { data: lots } = useAsync(() => lotBalances(), [])
  const selected = lots?.find((l) => l.id === lot)

  const save = async () => {
    const lotId = lot || (hasNumericValue(cost)
      ? await createPurchase({
          material: kind, name: kind, cost: Number(cost), origin: 'service',
        })
      : undefined)
    await createLog({
      type: 'input_application',
      name: kind,
      notes: notes.trim() || undefined,
      assets: [
        { id: asset.id, role: 'subject' },
        ...(lotId ? [{
          id: lotId, role: 'input' as const,
          amount: lot && Number(used) > 0 ? Number(used) : undefined,
          unit: lot ? selected?.unit : undefined,
        }] : []),
      ],
    })
    onDone()
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <label className="field">
        <span>What kind?</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">— pick one —</option>
          {(kinds ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>

      <AssetSelect value={lot} onChange={setLot} types={['lot']}
        materials={vocabulary === 'treatment' ? ['Medicine', 'Mineral'] : ['Parts', 'Fuel']}
        label="From stores? (optional)" />

      {lot ? (
        <label className="field">
          <span>Quantity ({selected?.unit ?? 'used'}, optional)</span>
          <input type="number" inputMode="decimal" min="0" value={used}
            onChange={onNumericChange(setUsed)} onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="5" />
          {selected && (
            <small className="hint">
              {formatQty(selected.remaining)} {selected.unit} on hand
            </small>
          )}
        </label>
      ) : (
        <label className="field">
          <span>What did it cost ($, optional)</span>
          <input type="number" inputMode="decimal" min="0" value={cost}
            onChange={onNumericChange(setCost)} onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="75" />
        </label>
      )}

      <label className="field">
        <span>Notes (optional)</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder={notesPlaceholder} />
      </label>
      <button className="primary" disabled={!kind} onClick={save}>
        Save
      </button>
    </Sheet>
  )
}

function TreatForm({ asset, onDone, onClose }: {
  asset: Asset; onDone: () => void; onClose: () => void
}) {
  return (
    <InputForm asset={asset} vocabulary="treatment" title={`Vet/Med for ${asset.name}`}
      notesPlaceholder="Limping on a front leg — vet prescribed antibiotics."
      onDone={onDone} onClose={onClose} />
  )
}

function MaintenanceForm({ asset, onDone, onClose }: {
  asset: Asset; onDone: () => void; onClose: () => void
}) {
  return (
    <InputForm asset={asset} vocabulary="service" title={`Maintenance for ${asset.name}`}
      notesPlaceholder="Changed oil and filter, topped off coolant."
      onDone={onDone} onClose={onClose} />
  )
}

function RetireForm({ asset, onDone, onClose }: {
  asset: Asset; onDone: () => void; onClose: () => void
}) {
  const [reason, setReason] = useState<'sold' | 'retired' | 'scrapped'>('sold')

  const save = async () => {
    await archiveAsset(asset.id, reason)
    onDone()
  }

  return (
    <Sheet title={`Retire ${asset.name}`} onClose={onClose}>
      <label className="field">
        <span>What happened?</span>
        <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
          <option value="sold">Sold</option>
          <option value="retired">Retired</option>
          <option value="scrapped">Scrapped</option>
        </select>
      </label>
      <button className="primary" onClick={save}>Save</button>
    </Sheet>
  )
}

/**
 * Naming one of the herd is a rename, not a birth.
 *
 * Groups carry one real animal per head, so the individual already exists
 * as "Cattle (beef) 3" — this gives it a name you would actually use. It
 * used to create a *new* animal and decrement a `headcount` attribute,
 * which made sense when a group was only ever a number; against a
 * member-backed group that added a seventh head to a herd of six, since
 * both headcount readouts count live members first.
 *
 * Only still-unnamed members are offered: renaming Bessie back into the
 * pool would lose the name someone chose.
 */
function SplitForm({ group, onDone, onClose }: {
  group: Asset; onDone: () => void; onClose: () => void
}) {
  const [name, setName] = useState('')
  const [member, setMember] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: members } = useAsync(() => childAssets(group.id), [group.id])

  // The auto-generated "<group> <n>" names are the ones still up for grabs.
  const unnamed = (members ?? []).filter(
    (m) => m.status === 'active' && isUnnamedMember(group, m),
  )
  const target = member || unnamed[0]?.id || ''

  const save = async () => {
    setBusy(true)
    try {
      if (target) {
        await updateAsset(target, { name: name.trim() })
      } else {
        // No members to rename — an older group stored as a bare headcount.
        const attributes = { ...group.attributes }
        delete attributes.headcount
        await createAsset({
          type: 'animal', name: name.trim(), attributes, parentId: group.id,
        })
        const remaining = Number(group.attributes?.headcount ?? 0) - 1
        await updateAsset(group.id, {
          attributes: { ...group.attributes, headcount: Math.max(remaining, 0) },
        })
      }
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={`Name one from ${group.name}`} onClose={onClose}>
      <p className="hint">
        Gives one of the herd a name you would actually use — weight, cost
        and vet visits already track against it either way.
      </p>

      {unnamed.length > 1 && (
        <label className="field">
          <span>Which one?</span>
          <select value={target} onChange={(e) => setMember(e.target.value)}>
            {unnamed.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      )}

      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Bessie" />
      </label>
      <button className="primary" disabled={busy || !name.trim()} onClick={save}>
        Save
      </button>
    </Sheet>
  )
}

/**
 * A new head joining an existing herd — buying a fifth cow for a group that
 * already has four. `SplitForm` only ever peels a name off headcount the
 * group already carries; once every head has a real member record backing
 * it, there was previously no way to grow the group at all, which is what
 * pushed a newly bought animal into a disconnected top-level Animal instead.
 *
 * Left blank, the name falls back to the same "<group> <n>" pattern
 * `createGroupWithMembers` uses, so it reads through `memberLabel` by tag
 * and stays renameable later via "Name an individual" — behaving exactly
 * like the members the group started with.
 */
function AddMemberForm({ group, onDone, onClose }: {
  group: Asset; onDone: () => void; onClose: () => void
}) {
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [birthday, setBirthday] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: members } = useAsync(() => childAssets(group.id), [group.id])

  const finalName = name.trim() || `${group.name} ${(members ?? []).length + 1}`

  const save = async () => {
    setBusy(true)
    try {
      const attributes = { ...group.attributes }
      delete attributes.headcount
      if (tag.trim()) attributes.tag = tag.trim()
      const id = await createAsset({
        type: 'animal', name: finalName, attributes, parentId: group.id,
      })
      if (birthday) {
        await createLog({
          type: 'birth', name: 'Born', timestamp: new Date(`${birthday}T12:00:00`),
          assets: [{ id, role: 'subject' }],
        })
      }
      if (hasNumericValue(price)) {
        await createLog({
          type: 'purchase', name: `Bought ${finalName}`,
          assets: [{ id, role: 'subject' }],
          quantities: [{ measure: 'price', value: Number(price), unit: 'USD' }],
        })
      }
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={`Add to ${group.name}`} onClose={onClose}>
      <p className="hint">
        Joins the herd as a new member — species and purpose carry over from {group.name}.
      </p>
      <label className="field">
        <span>Name (optional)</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Bessie" />
      </label>
      <label className="field">
        <span>Tag number (optional)</span>
        <input value={tag} onChange={(e) => setTag(e.target.value)}
          placeholder="Ear tag, ID number, whatever you use" />
      </label>
      <label className="field">
        <span>Birthday (optional)</span>
        <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
      </label>
      <label className="field">
        <span>Bought for ($, optional)</span>
        <input type="number" inputMode="decimal" min="0" value={price}
          onChange={onNumericChange(setPrice)} onWheel={ignoreScrollOnNumberInput}
          onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="350" />
      </label>
      <button className="primary" disabled={busy} onClick={save}>Save</button>
    </Sheet>
  )
}

/** Group names are user text and land inside a RegExp — escape them. */
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whether a member still carries its auto-generated "<group> <n>" name — i.e. never named. */
function isUnnamedMember(group: Asset, member: Asset) {
  return new RegExp(`^${escapeRe(group.name)} \\d+$`).test(member.name)
}

/**
 * "Cattle (beef) 3" tells a commercial operator nothing a tag number
 * wouldn't — and clutters a Members list that's otherwise all real names.
 * Only stands in for an auto-generated name that was never replaced with
 * one; a member someone actually named (Bessie, tag or no tag) keeps that
 * name, since that's the point of naming it.
 */
function memberLabel(group: Asset, member: Asset): string {
  const tag = member.attributes?.tag
  if (tag && isUnnamedMember(group, member)) return String(tag)
  return member.name
}

/**
 * Same reasoning as Treat and Bought for: a weight belongs to one animal,
 * so it is recorded from that animal's own profile rather than a "which
 * one?" picker on Today. The Growth chart above reads this same history.
 */
function WeightForm({ asset, onDone, onClose }: {
  asset: Asset; onDone: () => void; onClose: () => void
}) {
  const [lb, setLb] = useState('')
  const [date, setDate] = useState(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
  const n = Number(lb)

  const save = async () => {
    await createLog({
      type: 'weight',
      name: 'Weight recorded',
      timestamp: new Date(`${date}T12:00:00`),
      assets: [{ id: asset.id, role: 'subject' }],
      quantities: [{ measure: 'weight', value: n, unit: 'lb' }],
    })
    onDone()
  }

  return (
    <Sheet title={`Weigh ${asset.name}`} onClose={onClose}>
      <label className="field">
        <span>Weight (lb)</span>
        <input type="number" inputMode="decimal" min="0" autoFocus value={lb}
          onChange={onNumericChange(setLb)} onWheel={ignoreScrollOnNumberInput}
          onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="240" />
      </label>
      <label className="field">
        <span>When</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <button className="primary" disabled={!(n > 0)} onClick={save}>Save</button>
    </Sheet>
  )
}
