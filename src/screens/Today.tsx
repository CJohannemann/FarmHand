import { useState } from 'react'
import { useSave } from '../lib/useSave'
import { useAsync } from '../lib/useAsync'
import {
  createLog, createPurchase, listAssets, listTerms, lotBalances, planTask,
  plannedLogs, recentLogs,
} from '../db/queries'
import type { LogWithDetail } from '../db/types'
import type { PreparedImage } from '../lib/image'
import { ReceiptCapture } from './ReceiptCapture'
import { HARVESTS, tilesFor, type HarvestSpec } from '../lib/tiles'
import {
  formatQty, hasNumericValue, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput,
  onNumericChange,
} from '../lib/numeric'
import { Sheet } from './Sheet'
import { AssetSelect } from './AssetSelect'
import { LogList } from './LogList'
import { EditLog } from './EditLog'
import { TaskList } from './TaskList'
import { WeatherPlace, WeatherStrip } from './Weather'

export function Today({ onGoToStock }: { onGoToStock: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<LogWithDetail | null>(null)
  // Today and yesterday only. This is the Today screen — a list still
  // showing last month's feeding because nothing has happened since is
  // answering a question nobody asked here. The whole history is one tap
  // away under Analytics > Records, which is what the empty state says.
  //
  // The cap is a safety valve rather than the point: two days of a busy
  // farm is rarely twenty entries, but it should not be able to push the
  // tab bar off the bottom of the screen if it is.
  const recent = useAsync(() => recentLogs(20, 2), [])
  const tasks = useAsync(() => plannedLogs(), [])
  const assets = useAsync(() => listAssets(), [])

  // Tiles follow the farm: no Eggs button without birds, no Honey without bees.
  const tiles = tilesFor(assets.data ?? [])
  const harvest = open ? HARVESTS[open] : undefined

  const done = () => {
    setOpen(null); recent.reload(); tasks.reload(); assets.reload()
  }

  return (
    <div className="screen">
      <h1>Today</h1>
      <p className="tagline">
        {new Date().toLocaleDateString(undefined,
          { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
      <WeatherPlace />

      <WeatherStrip />

      <div className="tiles">
        {tiles.map((t) => (
          <button key={t.kind} className="tile" onClick={() => setOpen(t.kind)}>
            <span className="glyph">{t.glyph}</span>
            {t.label}
          </button>
        ))}
      </div>

      {assets.data && assets.data.length === 0 && (
        <div className="empty" style={{ marginTop: '0.75rem' }}>
          <p style={{ margin: '0 0 0.75rem' }}>
            Buy, Note and Plan work for any farm — but the rest show up once
            you add what you keep: eggs once there are birds, milk once there
            is a cow, picking once something is planted.
          </p>
          <button className="primary" onClick={onGoToStock}>+ Add to your inventory</button>
        </div>
      )}

      {(tasks.data ?? []).length > 0 && (
        <>
          <h2 className="section">To do</h2>
          <TaskList
            tasks={tasks.data ?? []}
            onChanged={() => { tasks.reload(); recent.reload() }}
          />
        </>
      )}

      <h2 className="section">Recent</h2>
      <LogList logs={recent.data ?? []} loading={recent.loading} onSelect={setEditing}
        empty="Nothing in the last couple of days. Everything you have ever logged is under Analytics > Records." />

      {editing && (
        <EditLog log={editing} onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); recent.reload() }} />
      )}

      {harvest && (
        <ProduceForm spec={harvest} onDone={done} onClose={() => setOpen(null)} />
      )}
      {open === 'feed'   && <FeedForm   onDone={done} onClose={() => setOpen(null)} />}
      {open === 'buy'    && <BuyForm    onDone={done} onClose={() => setOpen(null)} />}
      {open === 'note'   && <NoteForm   onDone={done} onClose={() => setOpen(null)} />}
      {open === 'plan'   && <PlanForm   onDone={done} onClose={() => setOpen(null)} />}
    </div>
  )
}

type FormProps = { onDone: () => void; onClose: () => void }

/**
 * Eggs, milk, honey and picking are the same act: something the farm keeps
 * yielded something, and carried on existing. One form, four labels.
 */
function ProduceForm({ spec, onDone, onClose }: FormProps & { spec: HarvestSpec }) {
  const [amount, setAmount] = useState('')
  const [asset, setAsset] = useState('')
  const n = Number(amount)
  // 'pick' (produce, from a planting) has no producibleMaterial concept —
  // the type filter below already restricts it to plantings, which is all
  // the narrowing it needs.
  const producing =
    spec.kind === 'eggs' ? 'eggs' as const :
    spec.kind === 'milk' ? 'milk' as const :
    spec.kind === 'honey' ? 'honey' as const :
    undefined

  const save = async () => {
    await createLog({
      type: 'harvest',
      name: spec.title,
      assets: asset ? [{ id: asset, role: 'subject' }] : [],
      quantities: [{
        measure: spec.measure, value: n, unit: spec.unit,
        label: spec.material.toLowerCase(),
      }],
    })
    onDone()
  }
  const { run, busy, error } = useSave(save)

  return (
    <Sheet title={spec.title} onClose={onClose}>
      <label className="field">
        <span>{spec.prompt}</span>
        <input
          type="number" inputMode={spec.measure === 'count' ? 'numeric' : 'decimal'}
          min="0" autoFocus value={amount}
          onChange={onNumericChange(setAmount, { integer: spec.measure === 'count' })}
          onWheel={ignoreScrollOnNumberInput}
          onKeyDown={ignoreArrowKeysOnNumberInput} placeholder={spec.placeholder}
        />
      </label>
      <AssetSelect value={asset} onChange={setAsset} types={spec.from} producing={producing}
        label="Where from? (optional)" />
      <button className="primary" disabled={busy || !(n > 0)} onClick={run}>{busy ? "Saving…" : "Save"}</button>
      {error && <p className="error">{error}</p>}
    </Sheet>
  )
}

/**
 * Feeding from a lot draws it down for real — the amount here is what
 * lotBalances() reads back as "went out", so Stores shows what is actually
 * left instead of just what was ever bought. The unit rides whatever the
 * lot was bought in (round bales, pounds, whatever) rather than assuming lb.
 */
function FeedForm({ onDone, onClose }: FormProps) {
  const [subject, setSubject] = useState('')
  const [lot, setLot] = useState('')
  const [amount, setAmount] = useState('')
  const { data: lots } = useAsync(() => lotBalances(), [])
  const selected = lots?.find((l) => l.id === lot)
  const unit = selected?.unit ?? 'lb'

  const save = async () => {
    const assets = [
      ...(subject ? [{ id: subject, role: 'subject' as const }] : []),
      ...(lot ? [{ id: lot, role: 'input' as const,
            amount: Number(amount) > 0 ? Number(amount) : undefined, unit }] : []),
    ]
    await createLog({
      type: 'input_application',
      name: 'Fed',
      assets,
      quantities: Number(amount) > 0
        ? [{ measure: 'weight' as const, value: Number(amount), unit }]
        : [],
    })
    onDone()
  }
  const { run, busy, error } = useSave(save)

  return (
    <Sheet title="Feeding" onClose={onClose}>
      <AssetSelect value={subject} onChange={setSubject}
        types={['animal', 'group']} allowNone={false} label="Fed what?" />
      <AssetSelect value={lot} onChange={setLot} types={['lot']}
        materials={['Feed', 'Hay']} label="Which feed? (optional)" />
      <label className="field">
        <span>Quantity ({unit}, optional)</span>
        <input type="number" inputMode="decimal" min="0" value={amount}
          onChange={onNumericChange(setAmount)} onWheel={ignoreScrollOnNumberInput}
          onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="25" />
        {selected && (
          <small className="hint">
            {formatQty(selected.remaining)} {selected.unit} on hand
          </small>
        )}
      </label>
      <button className="primary" disabled={busy || !subject} onClick={run}>{busy ? "Saving…" : "Save"}</button>
      {error && <p className="error">{error}</p>}
    </Sheet>
  )
}

function NoteForm({ onDone, onClose }: FormProps) {
  const [text, setText] = useState('')
  const [asset, setAsset] = useState('')

  const save = async () => {
    await createLog({
      type: 'observation',
      name: 'Note',
      notes: text,
      assets: asset ? [{ id: asset, role: 'subject' }] : [],
    })
    onDone()
  }
  const { run, busy, error } = useSave(save)

  return (
    <Sheet title="Note" onClose={onClose}>
      <label className="field">
        <span>What happened?</span>
        <textarea rows={4} autoFocus value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Third calf looks off — watching her." />
      </label>
      <AssetSelect value={asset} onChange={setAsset} label="About what? (optional)" />
      <button className="primary" disabled={busy || !text.trim()} onClick={run}>{busy ? "Saving…" : "Save"}</button>
      {error && <p className="error">{error}</p>}
    </Sheet>
  )
}

function BuyForm({ onDone, onClose }: FormProps) {
  const [material, setMaterial] = useState('Feed')
  const [receipt, setReceipt] = useState<PreparedImage | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState('lb')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const { data: materials } = useAsync(() => listTerms('material'), [])
  const { data: units } = useAsync(() => listTerms('unit'), [])

  const save = async () => {
    await createPurchase({
      material,
      name: name.trim() || material,
      amount: Number(amount) || undefined,
      unit,
      cost: hasNumericValue(cost) ? Number(cost) : undefined,
      supplier: supplier.trim() || undefined,
      receipt: receipt ?? undefined,
    })
    onDone()
  }
  const { run, busy, error } = useSave(save)

  return (
    <Sheet title="Bought something" onClose={onClose}>
      <p className="hint">
        Recording what you paid is what lets the app work out cost per unit
        later.
      </p>
      <label className="field">
        <span>What kind?</span>
        <select value={material} onChange={(e) => setMaterial(e.target.value)}>
          {(materials ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Name it</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Grower feed — April" />
      </label>
      <div className="pair">
        <label className="field">
          <span>Quantity</span>
          <input type="number" inputMode="decimal" min="0" value={amount}
            onChange={onNumericChange(setAmount)} onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="600" />
        </label>
        <label className="field">
          <span>Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {(units ?? []).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>What did it cost ($)</span>
        <input type="number" inputMode="decimal" min="0" value={cost}
          onChange={onNumericChange(setCost)} onWheel={ignoreScrollOnNumberInput}
          onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="340" />
      </label>
      <label className="field">
        <span>Supplier (optional)</span>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
          placeholder="Co-op" />
      </label>
      <ReceiptCapture onChange={setReceipt} />
      <button className="primary" disabled={busy || !(Number(cost) > 0)} onClick={run}>
        {busy ? "Saving…" : "Save"}
      </button>
      {error && <p className="error">{error}</p>}
    </Sheet>
  )
}

function PlanForm({ onDone, onClose }: FormProps) {
  const [name, setName] = useState('')
  const [when, setWhen] = useState(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
  const [asset, setAsset] = useState('')
  const [notes, setNotes] = useState('')

  const save = async () => {
    await planTask({
      name: name.trim(),
      due: new Date(`${when}T09:00:00`),
      notes: notes.trim() || undefined,
      assetId: asset || undefined,
    })
    onDone()
  }
  const { run, busy, error } = useSave(save)

  return (
    <Sheet title="Plan something" onClose={onClose}>
      <p className="hint">
        Planned work lives in the same records as everything else, so ticking it
        off writes the history for you.
      </p>
      <label className="field">
        <span>What needs doing?</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Worm the cattle" />
      </label>
      <label className="field">
        <span>When</span>
        <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <AssetSelect value={asset} onChange={setAsset} label="What for? (optional)" />
      <label className="field">
        <span>Notes (optional)</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="primary" disabled={busy || !name.trim()} onClick={run}>{busy ? "Saving…" : "Save"}</button>
      {error && <p className="error">{error}</p>}
    </Sheet>
  )
}
