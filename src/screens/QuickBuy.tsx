import { useRef, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { useSave } from '../lib/useSave'
import { createPurchase, createTerm, listAssets, listTerms, nameUsage } from '../db/queries'
import { ImageError, prepareImage, type PreparedImage } from '../lib/image'
import { loadScanMemory, saveScanMemory, ScanError, scanReceipt, type ScanResult } from '../lib/receiptScan'
import { isMixed, linesFromScan, quickFillFromScan, type ScanLine } from '../lib/scanToForm'
import { getScanKey } from '../lib/scanKey'
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
import { NameInput } from './NameInput'
import { ScanKeySetup } from './ScanKeySetup'

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
 * Little here is typed that someone else could type differently: the kind
 * is picked and feed is named from it ("Pig feed", see quickPurchaseName).
 * Anything else can carry its own name — "Fuel filter" rather than a row
 * in Stores that says only "Parts" — filled in from a scanned receipt, and
 * offered from the names already used, like the store.
 */
/** What the detailed sheet opens with when a scanned receipt is split. */
export interface DetailedStart {
  lines: ScanLine[]
  supplier: string
  receipt: PreparedImage | null
  date: string
}

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function QuickBuy({ onDone, onClose, onDetailed }: {
  onDone: () => void; onClose: () => void
  /** Switch to the line-by-line sheet — with a split receipt, if there is one. */
  onDetailed: (start?: DetailedStart) => void
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
  const [name, setName] = useState('')
  const [receipt, setReceipt] = useState<PreparedImage | null>(null)
  const [moreKinds, setMoreKinds] = useState(false)
  // The receipt's own date, once a scan has read one; until then, today.
  const [date, setDate] = useState(todayKey())

  // Scanning: a photo read by Gemini fills the fields above it in.
  const scanInput = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [scanError, setScanError] = useState<{ message: string; detail: string } | null>(null)
  const [scanned, setScanned] = useState<ScanResult | null>(null)
  const [needKey, setNeedKey] = useState(false)

  const { data: materials } = useAsync(() => listTerms('material'), [])
  const { data: units } = useAsync(() => listTerms('unit'), [])
  const { data: storesUsed } = useAsync(() => nameUsage('store'), [])
  const { data: kindsUsed } = useAsync(() => nameUsage('kind'), [])
  const { data: itemsUsed } = useAsync(() => nameUsage('item'), [])
  const { data: animals } = useAsync(() => listAssets(['animal', 'group']), [])
  // The species this farm keeps, not every species there is: four buttons
  // for what is actually in the barn beat a list of twelve.
  const species = [...new Set((animals ?? [])
    .filter((a) => a.status === 'active' && !a.attributes?.external)
    .map((a) => String(a.attributes?.species ?? '').trim())
    .filter(Boolean))].sort()

  const resolvedKind = kind === OTHER ? kindOther.trim() : kind
  const forStock = FOR_STOCK_KINDS.includes(resolvedKind)
  const purchaseName = quickPurchaseName(resolvedKind, forStock ? forSpecies : null, name)
  // How much was bought, for anything that sits in Stores to be used up —
  // feed by the pound, filters by the each. Not for building supplies and
  // the like, which are money spent and never on hand (SERVICE_MATERIALS).
  // Left blank, Stores says "amount not recorded" rather than a number.
  const showAmount = !!resolvedKind && !SERVICE_MATERIALS.includes(resolvedKind)
  const defaultUnit = (k: string) => FOR_STOCK_KINDS.includes(k) ? 'lb' : 'each'
  const pickKind = (k: string) => {
    setKind(k)
    if (!amount) setUnit(defaultUnit(k))
  }
  // Projects are what gets built — a barn, a fence — so the picker waits
  // for building supplies or a kind off the short list (Improvements,
  // Lumber…). Feed, hay and medicine are not, and showing it before
  // anything is picked was one more field asking a question nobody had.
  const showProject = kind === 'Building supplies' || moreKinds
    || (!!kind && !QUICK_KINDS.includes(kind))
  const projectPick = showProject ? project : ''
  const ready = Number(cost) > 0 && !!resolvedKind
    && !(projectPick === NEW_PROJECT && !projectName.trim())

  const read = async (image: PreparedImage) => {
    const key = await getScanKey()
    if (!key) { setNeedKey(true); return }
    setScanning(true); setScanError(null); setScanNote(null)
    try {
      const mem = loadScanMemory()
      const r = await scanReceipt(key, image, {
        kinds: materials ?? QUICK_KINDS, species, today: todayKey(),
        stores: (storesUsed ?? []).map((u) => u.name),
      }, undefined, undefined, mem).finally(() => saveScanMemory(mem))
      const f = quickFillFromScan(r, { quickKinds: QUICK_KINDS, stores: storesUsed ?? [], units: units ?? [] })
      if (f.cost) setCost(f.cost)
      if (f.kind) { setKind(f.kind); setMoreKinds(f.moreKinds) }
      setName(f.name)
      setAmount(f.amount)
      setUnit(f.unit || defaultUnit(f.kind))
      setForSpecies(f.forSpecies)
      if (f.supplier) setSupplier(f.supplier)
      if (f.date) setDate(f.date)
      setScanned(r)
      const missing = [!f.cost && 'the total', !f.kind && 'what it was', !f.date && 'the date'].filter(Boolean)
      setScanNote(missing.length
        ? `Filled in what could be read — add ${missing.join(' and ')}, then check it before saving.`
        : 'Filled in from the receipt — check it before saving.')
    } catch (e) {
      setScanError(e instanceof ScanError ? { message: e.message, detail: e.detail }
        : { message: "Couldn't read that receipt — fill it in by hand.", detail: String(e) })
    } finally {
      setScanning(false)
    }
  }

  const pickScan = async (file: File | null | undefined) => {
    if (scanInput.current) scanInput.current.value = ''
    if (!file) return
    setScanError(null)
    try {
      // The photo is the receipt too: attached, as well as read.
      const image = await prepareImage(file)
      setReceipt(image)
      await read(image)
    } catch (e) {
      setScanError({ message: e instanceof ImageError ? e.message : "That photo couldn't be opened.", detail: '' })
    }
  }

  const { run, busy, error } = useSave(async () => {
    if (!(materials ?? []).includes(resolvedKind)) await createTerm('material', resolvedKind)
    const projectId = await resolveProject(projectPick, projectName)
    await createPurchase({
      material: resolvedKind,
      name: purchaseName,
      cost: Number(cost),
      amount: showAmount && Number(amount) > 0 ? Number(amount) : undefined,
      unit: showAmount ? unit : undefined,
      supplier: supplier.trim() || undefined,
      category: forStock && forSpecies ? forSpecies : undefined,
      receipt: receipt ?? undefined,
      projectId: projectId ?? undefined,
      origin: SERVICE_MATERIALS.includes(resolvedKind) ? 'service' : undefined,
      // Noon, so the day holds whatever the timezone.
      timestamp: date !== todayKey() ? new Date(`${date}T12:00:00`) : undefined,
    })
    onDone()
  })

  const otherKinds = (materials ?? []).filter((m) => !QUICK_KINDS.includes(m))

  if (needKey) {
    return (
      <Sheet title="Receipt scanning" onClose={() => setNeedKey(false)}>
        <ScanKeySetup onSaved={() => { setNeedKey(false); if (receipt) read(receipt) }} />
      </Sheet>
    )
  }

  return (
    <Sheet title="Purchase" onClose={onClose}>
      {/* Read the receipt instead of typing it: Gemini fills in the store,
          date, total and kind, and the photo is attached as the receipt. */}
      <button type="button" className="scan-button" disabled={scanning}
        onClick={() => scanInput.current?.click()}>
        {scanning ? 'Reading the receipt…' : '📷 Scan a receipt'}
        <small>{scanning ? 'This can take up to a minute' : 'Fill this in from a photo'}</small>
      </button>
      <input ref={scanInput} type="file" accept="image/*" hidden
        onChange={(e) => pickScan(e.target.files?.[0])} />
      {scanNote && <p className="notice">{scanNote}</p>}
      {scanError && (
        <p className="error">
          {scanError.message}
          {/* What actually came back, small — so a screenshot of a failed
              scan says what went wrong, not just that something did. */}
          {scanError.detail && <small className="scan-detail">{scanError.detail}</small>}
        </p>
      )}
      {scanned && isMixed(scanned) && (
        <p className="hint">
          This receipt has different kinds of things on it.{' '}
          <button type="button" className="linkish" onClick={() => onDetailed({
            lines: linesFromScan(scanned, units ?? []), supplier, receipt, date,
          })}>
            Split it into {linesFromScan(scanned, units ?? []).length} lines
          </button>
        </p>
      )}

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
              onClick={() => { pickKind(k); setMoreKinds(false) }}>
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
          <select value={kind} onChange={(e) => pickKind(e.target.value)}>
            <option value="">— pick one —</option>
            {otherKinds.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value={OTHER}>Not listed — add it</option>
          </select>
        </label>
      )}
      {kind === OTHER && (
        <NameInput label="What is it?" value={kindOther} onChange={setKindOther}
          used={kindsUsed ?? []} placeholder="Twine" autoFocus noun="kind" />
      )}

      {/* Feed is named for its animal, below; everything else by what it
          is, so Stores lists "Fuel filter" and not one more "Parts". */}
      {!!resolvedKind && !forStock && (
        <NameInput label="Name (optional)" value={name} onChange={setName}
          used={itemsUsed ?? []} placeholder={resolvedKind} noun="item" />
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
      {showAmount && (
        <div className="pair">
          <label className="field">
            <span>Quantity (optional)</span>
            <input type="number" inputMode="decimal" min="0" value={amount}
              onChange={onNumericChange(setAmount)} onWheel={ignoreScrollOnNumberInput}
              onKeyDown={ignoreArrowKeysOnNumberInput} placeholder={forStock ? '50' : '1'} />
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

      {showProject && (
        <ProjectSelect value={project} onChange={setProject}
          newName={projectName} onNewName={setProjectName} />
      )}

      <NameInput label="Store (optional)" value={supplier} onChange={setSupplier}
        used={storesUsed ?? []} placeholder="Lowe's" noun="store" />

      {/* Shown once a receipt is scanned, today or not, so a date that
          couldn't be read is seen and fixed rather than quietly today. */}
      {(scanned || date !== todayKey()) && (
        <label className="field">
          <span>Receipt date</span>
          <input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value || todayKey())} />
        </label>
      )}

      <ReceiptCapture onChange={setReceipt} value={receipt} />

      <button className="primary" disabled={busy || !ready} onClick={run}>
        {busy ? 'Saving…'
          : resolvedKind && Number(cost) > 0
            ? `Save ${purchaseName} · ${formatMoney(Number(cost))}`
            : 'Save'}
      </button>
      {error && <p className="error">{error}</p>}

      <button type="button" className="linkish" style={{ marginTop: '0.75rem' }} onClick={() => onDetailed()}>
        Different things on one receipt you want listed separately? Break it down
      </button>
    </Sheet>
  )
}
