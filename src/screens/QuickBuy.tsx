import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { useSave } from '../lib/useSave'
import { createPurchase, createTerm, listAssets, listTerms } from '../db/queries'
import type { PreparedImage } from '../lib/image'
import {
  FOR_STOCK_KINDS, QUICK_KINDS, SERVICE_MATERIALS, quickPurchaseName,
} from '../lib/purchaseKinds'
import { pluralSpecies } from '../lib/husbandry'
import { groupUnits } from '../lib/units'
import {
  formatMoney, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput, onNumericChange,
} from '../lib/numeric'
import { Sheet } from './Sheet'
import { OTHER } from './AssetSelect'
import { ReceiptCapture } from './ReceiptCapture'
import { NEW_PROJECT, ProjectSelect, resolveProject } from './ProjectSelect'

/**
 * A receipt, as quickly as it can be put down: what it came to, what it was
 * for, where from, and a photo. The default Buy sheet.
 *
 * The detailed sheet asked for a kind, a name, a quantity, a unit and a
 * price for every line, which is right for feed tracked by the pound and
 * far too much for a lumber run — reported as "very complicated" by the
 * first person handed it. A receipt photo already itemises the nails and
 * the 2x6s; the farm needs the total and where it went.
 *
 * Nothing here is typed that someone else could type differently: the kind
 * is picked, the purchase is named from it ("Pig feed", see
 * quickPurchaseName), and only the store is free text.
 */
export function QuickBuy({ onDone, onClose, onDetailed }: {
  onDone: () => void; onClose: () => void
  /** Switch to the line-by-line sheet. */
  onDetailed: () => void
}) {
  const [cost, setCost] = useState('')
  const [kind, setKind] = useState('')
  const [kindOther, setKindOther] = useState('')
  const [forSpecies, setForSpecies] = useState('')
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState('lb')
  const [project, setProject] = useState('')
  const [projectName, setProjectName] = useState('')
  const [supplier, setSupplier] = useState('')
  const [receipt, setReceipt] = useState<PreparedImage | null>(null)
  const [moreKinds, setMoreKinds] = useState(false)

  const { data: materials } = useAsync(() => listTerms('material'), [])
  const { data: units } = useAsync(() => listTerms('unit'), [])
  const { data: animals } = useAsync(() => listAssets(['animal', 'group']), [])
  // The species this farm keeps, not every species there is: four buttons
  // for what is actually in the barn beat a list of twelve.
  const species = [...new Set((animals ?? [])
    .filter((a) => a.status === 'active' && !a.attributes?.external)
    .map((a) => String(a.attributes?.species ?? '').trim())
    .filter(Boolean))].sort()

  const resolvedKind = kind === OTHER ? kindOther.trim() : kind
  const forStock = FOR_STOCK_KINDS.includes(resolvedKind)
  const ready = Number(cost) > 0 && !!resolvedKind
    && !(project === NEW_PROJECT && !projectName.trim())

  const { run, busy, error } = useSave(async () => {
    if (!(materials ?? []).includes(resolvedKind)) await createTerm('material', resolvedKind)
    const projectId = await resolveProject(project, projectName)
    await createPurchase({
      material: resolvedKind,
      name: quickPurchaseName(resolvedKind, forStock ? forSpecies : null),
      cost: Number(cost),
      amount: forStock && Number(amount) > 0 ? Number(amount) : undefined,
      unit: forStock ? unit : undefined,
      supplier: supplier.trim() || undefined,
      category: forStock && forSpecies ? forSpecies : undefined,
      receipt: receipt ?? undefined,
      projectId: projectId ?? undefined,
      origin: SERVICE_MATERIALS.includes(resolvedKind) ? 'service' : undefined,
    })
    onDone()
  })

  const otherKinds = (materials ?? []).filter((m) => !QUICK_KINDS.includes(m))

  return (
    <Sheet title="Purchase" onClose={onClose}>
      <label className="field">
        <span>What did it come to? ($)</span>
        <input type="number" inputMode="decimal" min="0" autoFocus value={cost}
          onChange={onNumericChange(setCost)} onWheel={ignoreScrollOnNumberInput}
          onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="612.40" />
      </label>

      <div className="field">
        <span>What was it?</span>
        <div className="chipwrap">
          {QUICK_KINDS.map((k) => (
            <button key={k} type="button" className={kind === k ? 'chip on' : 'chip'}
              onClick={() => { setKind(k); setMoreKinds(false) }}>
              {k}
            </button>
          ))}
          <button type="button"
            className={moreKinds || (kind && !QUICK_KINDS.includes(kind)) ? 'chip on' : 'chip'}
            onClick={() => { setMoreKinds(true); setKind('') }}>
            Something else…
          </button>
        </div>
      </div>

      {moreKinds && (
        <label className="field">
          <span>Which?</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">— pick one —</option>
            {otherKinds.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value={OTHER}>Not listed — add it</option>
          </select>
        </label>
      )}
      {kind === OTHER && (
        <label className="field">
          <span>What is it?</span>
          <input autoFocus value={kindOther} onChange={(e) => setKindOther(e.target.value)}
            placeholder="Twine" />
        </label>
      )}

      {/* Which animals it is for is what Analytics adds feed up by — and it
          names the purchase, so it reads "Pig feed" whoever bought it. */}
      {forStock && (
        <div className="field">
          <span>For</span>
          <div className="chipwrap">
            <button type="button" className={forSpecies === '' ? 'chip on' : 'chip'}
              onClick={() => setForSpecies('')}>
              Everything
            </button>
            {species.map((s) => (
              <button key={s} type="button" className={forSpecies === s ? 'chip on' : 'chip'}
                onClick={() => setForSpecies(s)}>
                {pluralSpecies(s)}
              </button>
            ))}
          </div>
        </div>
      )}
      {forStock && (
        <div className="pair">
          <label className="field">
            <span>How much (optional)</span>
            <input type="number" inputMode="decimal" min="0" value={amount}
              onChange={onNumericChange(setAmount)} onWheel={ignoreScrollOnNumberInput}
              onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="50" />
          </label>
          <label className="field">
            <span>Unit</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {groupUnits(units ?? []).map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.units.map((u) => <option key={u} value={u}>{u}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      )}

      <ProjectSelect value={project} onChange={setProject}
        newName={projectName} onNewName={setProjectName} />

      <label className="field">
        <span>Store (optional)</span>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
          placeholder="Lowe's" />
      </label>

      <ReceiptCapture onChange={setReceipt} />

      <button className="primary" disabled={busy || !ready} onClick={run}>
        {busy ? 'Saving…'
          : resolvedKind && Number(cost) > 0
            ? `Save ${quickPurchaseName(resolvedKind, forStock ? forSpecies : null)} · ${formatMoney(Number(cost))}`
            : 'Save'}
      </button>
      {error && <p className="error">{error}</p>}

      <button type="button" className="linkish" style={{ marginTop: '0.75rem' }} onClick={onDetailed}>
        Different things on one receipt you want listed separately? Break it down
      </button>
    </Sheet>
  )
}
