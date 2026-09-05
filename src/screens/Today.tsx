import { useEffect, useState } from 'react'
import { useSave } from '../lib/useSave'
import { useAsync } from '../lib/useAsync'
import {
  CATEGORIZABLE_MATERIALS, createLog, createPurchase, listAssets, listTerms, lotBalances,
  planTask, plannedLogs, recentLogs, type LotBalance,
} from '../db/queries'
import type { Asset, LogWithDetail } from '../db/types'
import type { PreparedImage } from '../lib/image'
import { ReceiptCapture } from './ReceiptCapture'
import { HARVESTS, tilesFor, type HarvestSpec } from '../lib/tiles'
import {
  formatQty, hasNumericValue, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput,
  onNumericChange,
} from '../lib/numeric'
import { getFarmLocation } from '../lib/weather'
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
  // Held here rather than inside WeatherPlace so that saving a location in
  // the strip's picker can refresh the place name above it — see
  // WeatherPlace's own comment for why its private copy never could.
  const farmLoc = useAsync(() => getFarmLocation(), [])

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
      <WeatherPlace placeName={farmLoc.data?.placeName ?? null} />

      <WeatherStrip onLocationChanged={farmLoc.reload} />

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

const SPECIES_PREFIX = 'species:'

const pluralSpecies = (species: string) =>
  species === 'Other' || species.endsWith('s') ? species : species + 's'

/** Animals and groups eligible to be fed — same filter AssetSelect applies. */
function feedEligible(assets: Asset[]): Asset[] {
  return assets.filter((a) => a.status === 'active' && !a.parent_id && !a.attributes?.external)
}

/**
 * "Fed what?" needs an option a dropdown of individuals doesn't have: the
 * whole herd. A round bale isn't eaten by one cow, and picking just one to
 * stand in for all five would charge that one animal the cost of feeding
 * the other four. Species with more than one active animal get an "All
 * X (n)" entry above their individuals; a lone animal of its species needs
 * no such entry — it already is the whole herd.
 */
function feedSubjectOptions(assets: Asset[]): { value: string; label: string }[] {
  const eligible = feedEligible(assets)
  const bySpecies = new Map<string, Asset[]>()
  const noSpecies: Asset[] = []
  for (const a of eligible) {
    if (a.type !== 'animal') continue
    const species = String(a.attributes?.species ?? '').trim()
    if (!species) { noSpecies.push(a); continue }
    const list = bySpecies.get(species)
    if (list) list.push(a); else bySpecies.set(species, [a])
  }

  const options: { value: string; label: string }[] = []
  for (const [species, members] of [...bySpecies].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.length > 1) {
      options.push({
        value: SPECIES_PREFIX + species,
        label: `All ${pluralSpecies(species)} (${members.length})`,
      })
    }
    for (const m of members) options.push({ value: m.id, label: m.name })
  }
  for (const a of noSpecies) options.push({ value: a.id, label: a.name })
  for (const g of eligible) {
    if (g.type === 'group') options.push({ value: g.id, label: g.name })
  }
  return options
}

/** Expands a picked "Fed what?" value into the real asset ids it covers. */
function feedSubjectIds(assets: Asset[], picked: string): string[] {
  if (!picked) return []
  if (!picked.startsWith(SPECIES_PREFIX)) return [picked]
  const species = picked.slice(SPECIES_PREFIX.length)
  return feedEligible(assets)
    .filter((a) => a.type === 'animal' && String(a.attributes?.species ?? '') === species)
    .map((a) => a.id)
}

const FEED_MATERIALS = ['Feed', 'Hay']

/** "Sep 5" — enough to tell one bag from the next without crowding the row. */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * Seven bags all called "Pig feed" are indistinguishable by name alone —
 * which is exactly what the picker used to show. What separates them is
 * how much is left, when it was bought, and who from, so the row carries
 * all three where they're known.
 */
function lotLabel(l: LotBalance): string {
  const parts: string[] = []
  // came_in is 0 both for "bought nothing" and for "bought, amount not
  // recorded" — only claim a balance when something was actually counted.
  if (l.came_in > 0) {
    parts.push(l.remaining > 0
      ? `${formatQty(l.remaining)} ${l.unit ?? ''} left`.replace('  ', ' ')
      : 'used up')
  }
  if (l.acquired) parts.push(shortDate(l.acquired))
  if (l.supplier) parts.push(l.supplier)
  return parts.length > 0 ? `${l.name} — ${parts.join(' · ')}` : l.name
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
  const { data: candidates } = useAsync(() => listAssets(['animal', 'group']), [])
  const selected = lots?.find((l) => l.id === lot)
  const unit = selected?.unit ?? 'lb'
  // lotBalances() already excludes service-origin lots and orders what's on
  // hand ahead of what's used up, so this only narrows it to what's edible.
  const feedLots = (lots ?? []).filter(
    (l) => FEED_MATERIALS.includes(l.material ?? ''))

  const options = feedSubjectOptions(candidates ?? [])
  // Same reasoning as AssetSelect's own allowNone={false}: a required
  // <select> with no blank option still shows its first entry without ever
  // firing onChange, so the state is kept in sync with what's on screen
  // rather than left stuck at '' behind a dropdown that looks filled in.
  useEffect(() => {
    if (!subject && options.length > 0) setSubject(options[0].value)
  }, [subject, options.length])
  const subjectIds = feedSubjectIds(candidates ?? [], subject)

  const save = async () => {
    const assets = [
      ...subjectIds.map((id) => ({ id, role: 'subject' as const })),
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
      <label className="field">
        <span>Fed what?</span>
        <select value={subject} onChange={(e) => setSubject(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {options.length === 0 && (
          <small className="hint">Nothing added yet — see Inventory.</small>
        )}
      </label>
      <label className="field">
        <span>Which feed? (optional)</span>
        <select value={lot} onChange={(e) => setLot(e.target.value)}>
          <option value="">— none —</option>
          {feedLots.map((l) => (
            <option key={l.id} value={l.id}>{lotLabel(l)}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Quantity ({unit}, optional)</span>
        <input type="number" inputMode="decimal" min="0" value={amount}
          onChange={onNumericChange(setAmount)} onWheel={ignoreScrollOnNumberInput}
          onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="25" />
        {selected && selected.came_in > 0 && (
          <small className="hint">
            {formatQty(selected.remaining)} {selected.unit} on hand
          </small>
        )}
      </label>
      <button className="primary" disabled={busy || subjectIds.length === 0} onClick={run}>
        {busy ? "Saving…" : "Save"}
      </button>
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
  const [category, setCategory] = useState('')
  const [receipt, setReceipt] = useState<PreparedImage | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState('lb')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const { data: materials } = useAsync(() => listTerms('material'), [])
  const { data: units } = useAsync(() => listTerms('unit'), [])
  const { data: species } = useAsync(() => listTerms('species'), [])
  const categorizable = CATEGORIZABLE_MATERIALS.includes(material)

  const save = async () => {
    await createPurchase({
      material,
      name: name.trim() || material,
      amount: Number(amount) || undefined,
      unit,
      cost: hasNumericValue(cost) ? Number(cost) : undefined,
      supplier: supplier.trim() || undefined,
      category: categorizable && category ? category : undefined,
      receipt: receipt ?? undefined,
    })
    onDone()
  }
  const { run, busy, error } = useSave(save)

  return (
    <Sheet title="Purchase" onClose={onClose}>
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
