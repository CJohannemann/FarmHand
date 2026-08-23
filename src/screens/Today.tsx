import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  createLog, createPurchase, listAssets, listTerms, planTask, plannedLogs,
  recentLogs,
} from '../db/queries'
import type { LogWithDetail } from '../db/types'
import { HARVESTS, tilesFor, type HarvestSpec } from '../lib/tiles'
import { Sheet } from './Sheet'
import { AssetSelect } from './AssetSelect'
import { LogList } from './LogList'
import { EditLog } from './EditLog'
import { TaskList } from './TaskList'
import { WeatherStrip } from './Weather'

export function Today() {
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<LogWithDetail | null>(null)
  const recent = useAsync(() => recentLogs(8), [])
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
        <p className="hint" style={{ marginTop: '0.75rem' }}>
          More buttons appear as you add stock — eggs once there are birds, milk
          once there is a cow, picking once something is planted.
        </p>
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
      <LogList logs={recent.data ?? []} loading={recent.loading} onSelect={setEditing} />

      {editing && (
        <EditLog log={editing} onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); recent.reload() }} />
      )}

      {harvest && (
        <ProduceForm spec={harvest} onDone={done} onClose={() => setOpen(null)} />
      )}
      {open === 'weight' && <WeightForm onDone={done} onClose={() => setOpen(null)} />}
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

  return (
    <Sheet title={spec.title} onClose={onClose}>
      <label className="field">
        <span>{spec.prompt}</span>
        <input
          type="number" inputMode="decimal" autoFocus value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder={spec.placeholder}
        />
      </label>
      <AssetSelect value={asset} onChange={setAsset} types={spec.from}
        label="Where from? (optional)" />
      <button className="primary" disabled={!(n > 0)} onClick={save}>Save</button>
    </Sheet>
  )
}

function WeightForm({ onDone, onClose }: FormProps) {
  const [asset, setAsset] = useState('')
  const [lb, setLb] = useState('')
  const n = Number(lb)

  const save = async () => {
    await createLog({
      type: 'weight',
      name: 'Weight recorded',
      assets: [{ id: asset, role: 'subject' }],
      quantities: [{ measure: 'weight', value: n, unit: 'lb' }],
    })
    onDone()
  }

  return (
    <Sheet title="Record a weight" onClose={onClose}>
      <AssetSelect value={asset} onChange={setAsset}
        types={['animal', 'group']} allowNone={false} label="Which animal?" />
      <label className="field">
        <span>Weight (lb)</span>
        <input type="number" inputMode="decimal" value={lb}
          onChange={(e) => setLb(e.target.value)} placeholder="240" />
      </label>
      <button className="primary" disabled={!asset || !(n > 0)} onClick={save}>
        Save
      </button>
    </Sheet>
  )
}

function FeedForm({ onDone, onClose }: FormProps) {
  const [subject, setSubject] = useState('')
  const [lot, setLot] = useState('')
  const [amount, setAmount] = useState('')

  const save = async () => {
    const assets = [
      ...(subject ? [{ id: subject, role: 'subject' as const }] : []),
      ...(lot ? [{ id: lot, role: 'input' as const,
            amount: Number(amount) > 0 ? Number(amount) : undefined, unit: 'lb' }] : []),
    ]
    await createLog({
      type: 'input_application',
      name: 'Fed',
      assets,
      quantities: Number(amount) > 0
        ? [{ measure: 'weight' as const, value: Number(amount), unit: 'lb' }]
        : [],
    })
    onDone()
  }

  return (
    <Sheet title="Feeding" onClose={onClose}>
      <AssetSelect value={subject} onChange={setSubject}
        types={['animal', 'group']} allowNone={false} label="Fed what?" />
      <AssetSelect value={lot} onChange={setLot} types={['lot']}
        label="Which feed? (optional)" />
      <label className="field">
        <span>Amount (lb, optional)</span>
        <input type="number" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder="25" />
      </label>
      <button className="primary" disabled={!subject} onClick={save}>Save</button>
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

  return (
    <Sheet title="Note" onClose={onClose}>
      <label className="field">
        <span>What happened?</span>
        <textarea rows={4} autoFocus value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Third calf looks off — watching her." />
      </label>
      <AssetSelect value={asset} onChange={setAsset} label="About what? (optional)" />
      <button className="primary" disabled={!text.trim()} onClick={save}>Save</button>
    </Sheet>
  )
}

function BuyForm({ onDone, onClose }: FormProps) {
  const [material, setMaterial] = useState('Feed')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const { data: materials } = useAsync(() => listTerms('material'), [])

  const save = async () => {
    await createPurchase({
      material,
      name: name.trim() || material,
      amount: Number(amount) || undefined,
      unit: 'lb',
      cost: Number(cost) || undefined,
      supplier: supplier.trim() || undefined,
    })
    onDone()
  }

  return (
    <Sheet title="Bought something" onClose={onClose}>
      <p className="hint">
        Recording what you paid is what lets the app work out cost per pound
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
      <label className="field">
        <span>How much (lb)</span>
        <input type="number" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder="600" />
      </label>
      <label className="field">
        <span>What did it cost ($)</span>
        <input type="number" inputMode="decimal" value={cost}
          onChange={(e) => setCost(e.target.value)} placeholder="340" />
      </label>
      <label className="field">
        <span>Supplier (optional)</span>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
          placeholder="Co-op" />
      </label>
      <button className="primary" disabled={!(Number(cost) > 0)} onClick={save}>
        Save
      </button>
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
      <button className="primary" disabled={!name.trim()} onClick={save}>Save</button>
    </Sheet>
  )
}
