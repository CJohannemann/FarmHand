import { useState } from 'react'
import { createLog, deleteAsset, recordDisposition, type LotBalance } from '../db/queries'
import {
  formatMoney, formatQty as round, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput, onNumericChange,
} from '../lib/numeric'
import { measureForUnit } from '../lib/units'
import { useFarmTimezone } from '../lib/weather'
import { logDate } from './LogList'
import { AssetSelect } from './AssetSelect'
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
 * The same choices for something bought — a filter, a bottle of wormer —
 * in its own words. "Ate it" and "fed it to livestock" are for what the
 * farm grew; nobody eats an air filter.
 */
const BOUGHT_KINDS: { id: Kind; label: string }[] = [
  { id: 'home_use', label: 'Used it' },
  { id: 'sold',     label: 'Sold it' },
  { id: 'given',    label: 'Gave it away' },
  { id: 'traded',   label: 'Traded it' },
  { id: 'lost',     label: 'Lost or broken' },
]

/** What can be named as what a bought thing was used on. */
const USED_ON = ['equipment', 'animal', 'group', 'structure', 'land'] as const

/**
 * Drawing down a lot — what used to be the whole point of a separate Stores
 * tab. That tab listed the same lots the Stock tab already did, so it is
 * gone and this sheet opens from the lot's row on Stock instead.
 *
 * Something bought gets fewer questions than something grown. What it cost
 * is already on its purchase, so that is shown rather than asked ("what
 * would it have cost to buy" is for eggs, to weigh raising them against the
 * shop). A counted thing starts at one, so using the one air filter on hand
 * is a single tap. And it can be put down as used on the tractor (or an
 * animal, a building): logged on that tractor's record the way Maintenance's
 * "From stores?" logs it, so the filter's cost lands on the tractor.
 */
export function TakeFromLot({
  lot, onClose, onDone,
}: { lot: LotBalance; onClose: () => void; onDone: () => void }) {
  const bought = lot.origin === 'purchased'
  const counted = measureForUnit(lot.unit) === 'count'
  const remaining = Number(lot.remaining)
  const cameIn = Number(lot.came_in)
  const paid = lot.paid == null ? null : Number(lot.paid)
  const timeZone = useFarmTimezone()

  const [kind, setKind] = useState<Kind>('home_use')
  const [amount, setAmount] = useState(
    counted && remaining > 0 ? String(Math.min(1, remaining)) : '')
  const [value, setValue] = useState('')
  const [usedOn, setUsedOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const n = Number(amount)
  const over = n > remaining + 0.001
  const kinds = bought ? BOUGHT_KINDS : KINDS
  const onSomething = bought && kind === 'home_use' && !!usedOn
  // What this much of it cost, from what was paid for all of it.
  const share = paid != null && cameIn > 0 && n > 0 ? paid * (n / cameIn) : null

  const save = async () => {
    setBusy(true)
    const unit = lot.unit ?? 'lb'
    if (onSomething) {
      await createLog({
        type: 'input_application',
        name: lot.name,
        assets: [
          { id: usedOn, role: 'subject' },
          { id: lot.id, role: 'input', amount: n, unit },
        ],
        quantities: [],
      })
    } else {
      await recordDisposition({
        lotId: lot.id,
        kind,
        amount: n,
        unit,
        value: Number(value) || undefined,
      })
    }
    setBusy(false)
    onDone()
  }

  const remove = async () => {
    setBusy(true)
    await deleteAsset(lot.id)
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
        {paid != null && (
          <div className="costrow"><span>Paid</span>
            <span>
              {formatMoney(paid)}
              {lot.acquired ? ` · ${logDate(lot.acquired, timeZone)}` : ''}
              {lot.supplier ? ` · ${lot.supplier}` : ''}
            </span></div>
        )}
      </div>

      <label className="field" style={{ marginTop: '1.25rem' }}>
        <span>What happened to it?</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>

      {bought && kind === 'home_use' && (
        <AssetSelect value={usedOn} onChange={setUsedOn} types={[...USED_ON]}
          label="Used on (optional)" />
      )}

      <label className="field">
        <span>Quantity ({lot.unit ?? 'lb'})</span>
        <input type="number" inputMode="decimal" min="0" autoFocus={!amount} value={amount}
          onChange={onNumericChange(setAmount)} onWheel={ignoreScrollOnNumberInput}
          onKeyDown={ignoreArrowKeysOnNumberInput} placeholder={counted ? '1' : '20'} />
        {share != null && !over && (
          <small className="hint">
            {n >= cameIn - 0.001 ? `All of it — ${formatMoney(share)}.` : `${formatMoney(share)} of what was paid.`}
            {onSomething && ' Charged to what it was used on.'}
          </small>
        )}
        {over && (
          <small className="hint warn">
            That is more than the {round(lot.remaining)} {lot.unit ?? ''} left.
            Saving anyway is fine — records are often behind reality.
          </small>
        )}
      </label>

      {/* Bought, its cost is already known (above): only a sale has a
          price to ask for. */}
      {(!bought || kind === 'sold') && (
        <label className="field">
          <span>
            {kind === 'sold' ? 'What you got paid ($)' : 'What it would have cost to buy ($)'}
          </span>
          <input type="number" inputMode="decimal" min="0" value={value}
            onChange={onNumericChange(setValue)} onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="Optional" />
          {kind === 'home_use' && (
            <small className="hint">
              Optional. Putting the shop price here is what lets the app tell you
              whether raising it beat buying it.
            </small>
          )}
        </label>
      )}

      <button className="primary" disabled={busy || !(n > 0)} onClick={save}>
        Save
      </button>

      {/*
        The way out for a lot that should not be here at all — one entered by
        mistake, or one left behind when the harvest that created it was
        deleted (which keeps the lot on purpose, so the withdrawals against
        it are not left pointing at nothing).
        Deliberately below Save and styled as danger: taking stock out is
        what this sheet is for, and removing the record of it is not the
        obvious next tap.
      */}
      {!confirming ? (
        <button className="danger" disabled={busy} onClick={() => setConfirming(true)}>
          Delete this record
        </button>
      ) : (
        <div className="confirm">
          <p>
            Remove {lot.name} from Stores? This deletes the lot itself, on
            every device.
            {lot.remaining > 0.001
              ? ` It still shows ${round(lot.remaining)} ${lot.unit ?? ''} on hand — take that
                  out above instead if you actually used it, so the cost lands
                  where it went.`
              : ''}
          </p>
          <p className="hint">
            Anything already logged against it — what it cost, what was fed or
            taken from it — stays in your records.
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
