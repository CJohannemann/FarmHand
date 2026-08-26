import { useState } from 'react'
import { recordDisposition, type LotBalance } from '../db/queries'
import {
  formatQty as round, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput, onNumericChange,
} from '../lib/numeric'
import { Sheet } from './Sheet'

const KINDS = [
  { id: 'home_use', label: 'Ate it / used at home' },
  { id: 'sold',     label: 'Sold it' },
  { id: 'given',    label: 'Gave it away' },
  { id: 'traded',   label: 'Traded it' },
  { id: 'fed_back', label: 'Fed it to livestock' },
  { id: 'lost',     label: 'Lost or spoiled' },
] as const

type Kind = typeof KINDS[number]['id']

/**
 * Drawing down a lot — what used to be the whole point of a separate Stores
 * tab. That tab listed the same lots the Stock tab already did, so it is
 * gone and this sheet opens from the lot's row on Stock instead.
 */
export function TakeFromLot({
  lot, onClose, onDone,
}: { lot: LotBalance; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<Kind>('home_use')
  const [amount, setAmount] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const n = Number(amount)
  const over = n > lot.remaining + 0.001

  const save = async () => {
    setBusy(true)
    await recordDisposition({
      lotId: lot.id,
      kind,
      amount: n,
      unit: lot.unit ?? 'lb',
      value: Number(value) || undefined,
    })
    setBusy(false)
    onDone()
  }

  return (
    <Sheet title={lot.name} onClose={onClose}>
      <div className="costbox">
        <div className="costrow"><span>Came in</span>
          <span>{round(lot.came_in)} {lot.unit ?? ''}</span></div>
        <div className="costrow"><span>Gone</span>
          <span>{round(lot.went_out)} {lot.unit ?? ''}</span></div>
        <div className="costrow strong"><span>Left</span>
          <span>{round(lot.remaining)} {lot.unit ?? ''}</span></div>
      </div>

      <label className="field" style={{ marginTop: '1.25rem' }}>
        <span>What happened to it?</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>

      <label className="field">
        <span>Quantity ({lot.unit ?? 'lb'})</span>
        <input type="number" inputMode="decimal" min="0" autoFocus value={amount}
          onChange={onNumericChange(setAmount)} onWheel={ignoreScrollOnNumberInput}
          onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="20" />
        {over && (
          <small className="hint warn">
            That is more than the {round(lot.remaining)} {lot.unit ?? ''} left.
            Saving anyway is fine — records are often behind reality.
          </small>
        )}
      </label>

      <label className="field">
        <span>
          {kind === 'sold' ? 'What you got paid ($)' : 'What it would have cost to buy ($)'}
        </span>
        <input type="number" inputMode="decimal" min="0" value={value}
          onChange={onNumericChange(setValue)} onWheel={ignoreScrollOnNumberInput}
          onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="89.80" />
        {kind === 'home_use' && (
          <small className="hint">
            Optional. Putting the shop price here is what lets the app tell you
            whether raising it beat buying it.
          </small>
        )}
      </label>

      <button className="primary" disabled={busy || !(n > 0)} onClick={save}>
        Save
      </button>
    </Sheet>
  )
}
