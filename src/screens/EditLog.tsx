import { useEffect, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  addReceipt, CATEGORIZABLE_MATERIALS, deleteLog, listTerms, purchaseLotFor, quantitiesFor,
  receiptsForLog, serviceCostFor, setLotCategory, setQuantity, stampEdited, updateLog,
} from '../db/queries'
import type { LogWithDetail, Measure } from '../db/types'
import type { PreparedImage } from '../lib/image'
import {
  hasNumericValue, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput, sanitizeNumeric,
} from '../lib/numeric'
import { ReceiptCapture } from './ReceiptCapture'
import { Sheet } from './Sheet'

const forInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function EditLog({
  log, onClose, onChanged,
}: {
  // Only what this form actually reads — both Records' full LogWithDetail
  // and AssetDetail's leaner AssetEvent (one row per subject/input/output
  // role on a log, not per log) carry all of this.
  log: Pick<LogWithDetail, 'id' | 'name' | 'notes' | 'timestamp'> & { type?: string }
  onClose: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState(log.name ?? '')
  const [notes, setNotes] = useState(log.notes ?? '')
  const [date, setDate] = useState(forInput(log.timestamp))
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const qtys = useAsync(() => quantitiesFor(log.id), [log.id])
  const [edited, setEdited] = useState<Record<string, string>>({})
  // A sale or purchase closed out with the price left blank got no price
  // row at all — without this, there was no way back to add it, and it
  // stayed invisible to Analytics for good.
  const canAddPrice = log.type === 'sale' || log.type === 'purchase'
  const hasPrice = (qtys.data ?? []).some((q) => q.measure === 'price')
  const [newPrice, setNewPrice] = useState('')

  // A purchase that bought Feed or Hay gets the same "For" field BuyForm
  // offers when the purchase is first recorded — the category didn't exist
  // yet for anything bought before this shipped, and this is the only way
  // back to it without retyping the whole purchase.
  const lot = useAsync(
    () => (log.type === 'purchase' ? purchaseLotFor(log.id) : Promise.resolve(null)),
    [log.id, log.type],
  )
  const { data: species } = useAsync(() => listTerms('species'), [])
  const categorizable = Boolean(lot.data?.material && CATEGORIZABLE_MATERIALS.includes(lot.data.material))
  const [category, setCategory] = useState('')
  useEffect(() => { setCategory(lot.data?.category ?? '') }, [lot.data])

  // A med visit or repair with no lot of its own charges a one-off service
  // lot instead, whose price lives on that lot's own purchase log rather
  // than this one — so editing it here has to reach over and update that
  // other log, not this one's own (nonexistent) quantities.
  const serviceCost = useAsync(
    () => (log.type === 'input_application' ? serviceCostFor(log.id) : Promise.resolve(null)),
    [log.id, log.type],
  )
  const [cost, setCost] = useState('')
  useEffect(() => {
    setCost(serviceCost.data ? String(serviceCost.data.value) : '')
  }, [serviceCost.data])

  // A photo taken later for a purchase logged without one — the same gap
  // canAddPrice already closes for a price left blank, but for the receipt
  // itself. Only offered once, same as the price field: a purchase with a
  // receipt already attached isn't missing anything to add back.
  const receipts = useAsync(
    () => (log.type === 'purchase' ? receiptsForLog(log.id) : Promise.resolve([])),
    [log.id, log.type],
  )
  const canAddReceipt = log.type === 'purchase' && (receipts.data?.length ?? 0) === 0
  const [newReceipt, setNewReceipt] = useState<PreparedImage | null>(null)

  const save = async () => {
    setBusy(true)
    // Tracked separately from the writes themselves: Save is tapped on a
    // record nobody actually touched (opened, looked, closed) far more often
    // than one that changed, and stamping edited_by/edited_at on every tap
    // regardless would make "has this been edited?" meaningless.
    let changed = false

    const trimmedName = name.trim() || null
    const trimmedNotes = notes.trim() || null
    if (trimmedName !== log.name || trimmedNotes !== log.notes
        || date !== forInput(log.timestamp)) {
      changed = true
    }
    await updateLog(log.id, {
      name: trimmedName,
      notes: trimmedNotes,
      // Keep the original time of day; only the date is editable here.
      timestamp: new Date(`${date}T${new Date(log.timestamp).toTimeString().slice(0, 8)}`),
    })
    for (const [id, raw] of Object.entries(edited)) {
      const q = (qtys.data ?? []).find((x) => x.id === id)
      if (q && hasNumericValue(raw) && Number(raw) !== q.value) {
        await setQuantity(log.id, q.measure as Measure, Number(raw))
        changed = true
      }
    }
    if (canAddPrice && !hasPrice && hasNumericValue(newPrice)) {
      await setQuantity(log.id, 'price', Number(newPrice), 'USD')
      changed = true
    }
    if (categorizable && lot.data && category !== (lot.data.category ?? '')) {
      await setLotCategory(lot.data.assetId, category || null)
      changed = true
    }
    if (serviceCost.data && hasNumericValue(cost)
        && Number(cost) !== serviceCost.data.value) {
      await setQuantity(serviceCost.data.purchaseLogId, 'price', Number(cost))
      changed = true
    }
    if (canAddReceipt && newReceipt) {
      await addReceipt(log.id, newReceipt)
      changed = true
    }
    if (changed) await stampEdited(log.id)
    setBusy(false)
    onChanged()
  }

  const remove = async () => {
    setBusy(true)
    await deleteLog(log.id)
    setBusy(false)
    onChanged()
  }

  return (
    <Sheet title="Edit record" onClose={onClose}>
      <label className="field">
        <span>What</span>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Eggs collected" />
      </label>

      <label className="field">
        <span>When</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      {categorizable && (
        <label className="field">
          <span>For (optional)</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">General — not just one kind of stock</option>
            {(species ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <small className="hint">
            Lets Analytics tell you what feed cost each kind of stock, not
            just feed as a whole.
          </small>
        </label>
      )}

      {serviceCost.data && (
        <label className="field">
          <span>Cost ($)</span>
          <input
            type="number" inputMode="decimal" min="0" value={cost}
            onChange={(e) => setCost(sanitizeNumeric(e.target.value))}
            onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput}
          />
        </label>
      )}

      {(qtys.data ?? []).map((q) => (
        <label className="field" key={q.id}>
          <span>{q.label ?? q.measure} ({q.unit})</span>
          <input
            type="number" inputMode="decimal" min="0"
            value={edited[q.id] ?? String(q.value)}
            onChange={(e) =>
              setEdited({ ...edited, [q.id]: sanitizeNumeric(e.target.value) })}
            onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput}
          />
        </label>
      ))}

      {canAddPrice && !hasPrice && (
        <label className="field">
          <span>{log.type === 'sale' ? 'Sold for ($)' : 'Paid ($)'}</span>
          <input
            type="number" inputMode="decimal" min="0" value={newPrice}
            onChange={(e) => setNewPrice(sanitizeNumeric(e.target.value))}
            onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput}
            placeholder="450"
          />
        </label>
      )}

      {canAddReceipt && <ReceiptCapture onChange={setNewReceipt} />}

      <label className="field">
        <span>Notes</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <button className="primary" disabled={busy} onClick={save}>Save</button>

      {!confirming ? (
        <button className="danger" onClick={() => setConfirming(true)}>
          Delete this record
        </button>
      ) : (
        <div className="confirm">
          <p>Delete it? This removes it from every device.</p>
          <div className="actions">
            <button onClick={() => setConfirming(false)}>Keep it</button>
            <button className="danger" disabled={busy} onClick={remove}>Delete</button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
