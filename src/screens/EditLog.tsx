import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { deleteLog, quantitiesFor, setQuantity, updateLog } from '../db/queries'
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
