import { useEffect, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  CATEGORIZABLE_MATERIALS, deleteLog, listTerms, purchaseLotFor, quantitiesFor,
  setLotCategory, setQuantity, updateLog,
} from '../db/queries'
import type { LogWithDetail, Measure } from '../db/types'
import {
  hasNumericValue, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput, sanitizeNumeric,
} from '../lib/numeric'
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

  const save = async () => {
    setBusy(true)
    await updateLog(log.id, {
      name: name.trim() || null,
      notes: notes.trim() || null,
      // Keep the original time of day; only the date is editable here.
      timestamp: new Date(`${date}T${new Date(log.timestamp).toTimeString().slice(0, 8)}`),
    })
    for (const [id, raw] of Object.entries(edited)) {
      const q = (qtys.data ?? []).find((x) => x.id === id)
      if (q && hasNumericValue(raw)) await setQuantity(log.id, q.measure as Measure, Number(raw))
    }
    if (canAddPrice && !hasPrice && hasNumericValue(newPrice)) {
      await setQuantity(log.id, 'price', Number(newPrice), 'USD')
    }
    if (categorizable && lot.data) await setLotCategory(lot.data.assetId, category || null)
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
