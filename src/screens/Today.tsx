import { Fragment, useEffect, useState } from 'react'
import { useSave } from '../lib/useSave'
import { useAsync } from '../lib/useAsync'
import {
  CATEGORIZABLE_MATERIALS, createHarvest, createLog, createPurchase, expectedBirths,
  listAssets, listContacts, listTerms, lotBalances, lotIsUsedUp, plannedLogs, recentLogs,
  recordDisposition, setLotCategory, type LotBalance,
} from '../db/queries'
import type { Asset, AssetType, LogWithDetail } from '../db/types'
import type { PreparedImage } from '../lib/image'
import { useMembersMap } from '../lib/members'
import { ReceiptCapture } from './ReceiptCapture'
import { HARVESTS, tilesFor, type HarvestSpec } from '../lib/tiles'
import {
  formatMoney, formatQty, ignoreArrowKeysOnNumberInput,
  ignoreScrollOnNumberInput, onNumericChange,
} from '../lib/numeric'
import { dueLabel, pluralSpecies, upcomingBirth } from '../lib/husbandry'
import { getFarmLocation } from '../lib/weather'
import { Sheet } from './Sheet'
import { AssetSelect } from './AssetSelect'
import { BuyerSelect, EMPTY_BUYER_DRAFT, resolveBuyer, type BuyerDraft } from './BuyerSelect'
import { LogList } from './LogList'
import { EditLog } from './EditLog'
import { TaskList, type BirthRow } from './TaskList'
import { ChoreSheet } from './ChoreSheet'
import { Schedule } from './Schedule'
import { WeatherPlace, WeatherStrip } from './Weather'

export function Today({ onGoToStock, onGoToAnimal }: {
  onGoToStock: () => void
  /** Opens one animal's own profile on the Inventory tab. */
  onGoToAnimal: (assetId: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<LogWithDetail | null>(null)
  // The chore whose details are open, if any — the same sheet the Plan
  // tile and "+ Add a chore" open empty.
  const [chore, setChore] = useState<LogWithDetail | null>(null)
  // The month calendar, rendered in this screen's place rather than as a
  // tab of its own — the same shape Stock uses to open an animal's profile.
  const [schedule, setSchedule] = useState(false)
  // Today and yesterday only. This is the Today screen — a list still
  // showing last month's feeding because nothing has happened since is
  // answering a question nobody asked here. The whole history is one tap
  // away under Analytics > Records, which is what the empty state says.
  //
  // The cap is a safety valve rather than the point: two days of a busy
  // farm is rarely twenty entries, but it should not be able to push the
  // tab bar off the bottom of the screen if it is.
  const recent = useAsync(() => recentLogs(20, 2), [])
  const membersById = useMembersMap()
  const tasks = useAsync(() => plannedLogs(), [])
  // Who is due, drawn from the breeding logs rather than from a planned
  // task written at the same time: moving a breeding date moves the due
  // date with it, and a breeding deleted takes its row off the list.
  // Nothing to keep in step, and nothing left behind.
  const births = useAsync(() => expectedBirths(), [])
  const assets = useAsync(() => listAssets(), [])
  // Held here rather than inside WeatherPlace so that saving a location in
  // the strip's picker can refresh the place name above it — see
  // WeatherPlace's own comment for why its private copy never could.
  const farmLoc = useAsync(() => getFarmLocation(), [])

  // Tiles follow the farm: no Eggs button without birds, no Honey without bees.
  const tiles = tilesFor(assets.data ?? [])
  const harvest = open ? HARVESTS[open] : undefined

  const done = () => {
    setOpen(null); setChore(null)
    recent.reload(); tasks.reload(); assets.reload(); births.reload()
  }

  const dueRows: BirthRow[] = (births.data ?? [])
    .map((b) => upcomingBirth(b))
    .filter((b) => b !== null)
    .sort((a, b) => a.days - b.days)
    .map((b) => ({
      assetId: b.assetId,
      species: b.species,
      title: `${b.name} due to ${b.term.verb}`,
      when: [
        `${b.due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${dueLabel(b.days)}`,
        b.sire ? `by ${b.sire}` : '',
      ].filter(Boolean).join(' · '),
      late: b.days < 0,
    }))

  // What the Schedule card says it is holding. Counted off what this screen
  // has already loaded rather than a query of its own — the point is a
  // reason to tap, not a second source of truth.
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59)
  const choresThisMonth = (tasks.data ?? [])
    .filter((t) => new Date(t.timestamp) <= monthEnd).length
  // dueRows is already only what upcomingBirth() lets through — inside its
  // ~30-day lead window — so "still coming" is the whole count minus the
  // overdue ones. No date arithmetic of its own to get wrong.
  const birthsComing = dueRows.filter((b) => !b.late).length
  const scheduleSummary = [
    choresThisMonth > 0
      ? `${choresThisMonth} ${choresThisMonth === 1 ? 'chore' : 'chores'}` : '',
    birthsComing > 0
      ? `${birthsComing} due to give birth` : '',
  ].filter(Boolean).join(' · ')

  if (schedule) {
    return (
      <Schedule onBack={() => { setSchedule(false); tasks.reload() }}
        onOpenAnimal={onGoToAnimal} />
    )
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

      {/*
        Chores sit above Recent, and stay on screen even when the list is
        empty: "what still needs doing" is the question this screen exists
        to answer, and an empty list is worth saying out loud rather than
        leaving the screen silent about it.

        No "add" control of its own — the Chore tile above opens the same
        sheet, and two ways to do one thing a thumb's width apart reads as
        two different things.
      */}
      <h2 className="section">Farm chores</h2>
      <TaskList
        tasks={tasks.data ?? []}
        births={dueRows}
        onOpen={setChore}
        onOpenAnimal={onGoToAnimal}
        onChanged={() => { tasks.reload(); recent.reload() }}
      />
      {!tasks.loading && (tasks.data ?? []).length === 0 && dueRows.length === 0 && (
        <p className="empty">
          Nothing on the list. Tap <strong>Chore</strong> above to add one —
          fencing, worming, a vet appointment, anything that needs doing.
        </p>
      )}

      {/* The whole month, one tap away. The list above is "what's next";
          this is "what does the month look like" — a different question,
          and one a list sorted soonest-first cannot answer. */}
      <ul className="assetlist" style={{ marginTop: '0.75rem' }}>
        <li>
          <button className="assetrow" onClick={() => setSchedule(true)}>
            <span className="asset-name">Schedule</span>
            <span className="asset-meta">
              {scheduleSummary || 'Nothing planned yet'}
              <span className="chev">›</span>
            </span>
          </button>
        </li>
      </ul>

      <h2 className="section">Recent</h2>
      <LogList logs={recent.data ?? []} loading={recent.loading} onSelect={setEditing}
        membersById={membersById}
        empty="Nothing in the last couple of days. Everything you have ever logged is under Analytics > Records." />

      {editing && (
        <EditLog log={editing} onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); recent.reload() }} />
      )}

      {harvest && (
        <ProduceForm spec={harvest} onDone={done} onClose={() => setOpen(null)} />
      )}
      {open === 'feed'   && <FeedForm   onDone={done} onClose={() => setOpen(null)} />}
      {open === 'sell'   && <SellForm   onDone={done} onClose={() => setOpen(null)} />}
      {open === 'buy'    && <BuyForm    onDone={done} onClose={() => setOpen(null)} />}
      {open === 'note'   && <NoteForm   onDone={done} onClose={() => setOpen(null)} />}
      {open === 'plan'   && <ChoreSheet onDone={done} onClose={() => setOpen(null)} />}
      {chore && (
        <ChoreSheet chore={chore} onDone={done} onClose={() => setChore(null)} />
      )}
    </div>
  )
}

type FormProps = { onDone: () => void; onClose: () => void }

/**
 * Eggs, milk, honey and picking are the same act: something the farm keeps
 * yielded something, and carried on existing. One form, four labels.
 *
 * Goes through createHarvest() (not a bare quantity log) so it adds to a
 * running "on hand" lot the way a harvest anywhere else in the app does —
 * eggs collected here and never seen again in Stores was exactly the gap
 * reported: this was writing a diary entry, not stock.
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
    await createHarvest({
      sourceId: asset || undefined,
      outputName: spec.title,
      material: spec.material,
      amount: n,
      unit: spec.unit,
      measure: spec.measure,
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
        label="Where from? (optional)" autoSelectSingle />
      <button className="primary" disabled={busy || !(n > 0)} onClick={run}>{busy ? "Saving…" : "Save"}</button>
      {error && <p className="error">{error}</p>}
    </Sheet>
  )
}

/**
 * Selling out of Stores, in one tap from the first screen.
 *
 * This is not a new way to record a sale — it is the same
 * recordDisposition() the lot's own sheet on Inventory writes, reached
 * without going to find the lot first. That sheet still exists and still
 * does more (gave it away, fed it back, spoiled); this one does the thing
 * a farm does weekly, and defaults to it rather than opening on "ate it at
 * home" and making every sale start with a correction.
 *
 * Livestock is deliberately not on the list. Selling an animal ends it —
 * it archives the record and closes out its costs — which is a different
 * act from selling a dozen eggs, and belongs where the animal's other
 * endings are rather than on a tile meant for the routine. The hint below
 * says where to find it instead of leaving someone hunting.
 *
 * Purchased stock is left off too. "Sold what?" is asking what the farm
 * produced and sold, not offering back the pig feed it bought last week —
 * that read as the app not knowing the difference between the two. Selling
 * a purchased lot (a farm reselling part of a hay load) is still possible,
 * just from that lot's own sheet on Inventory rather than this shortcut.
 */
function SellForm({ onDone, onClose }: FormProps) {
  const [lot, setLot] = useState('')
  const [amount, setAmount] = useState('')
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [buyerId, setBuyerId] = useState('')
  const [buyerDraft, setBuyerDraft] = useState<BuyerDraft>(EMPTY_BUYER_DRAFT)
  const { data: lots } = useAsync(() => lotBalances(), [])
  const { data: contacts } = useAsync(() => listContacts(), [])

  // Same rule as the feed picker: what is actually still there, plus
  // whatever is already selected so a lot cannot vanish mid-edit.
  const sellable = (lots ?? []).filter((l) =>
    l.origin !== 'purchased' && (!lotIsUsedUp(l) || l.id === lot))
  const selected = sellable.find((l) => l.id === lot)
  const unit = selected?.unit ?? 'lb'
  const n = Number(amount)
  // Only where there is a balance to exceed: a lot bought without its
  // amount recorded has no ceiling to warn about, and treating an unknown
  // as zero would block a sale that is perfectly real.
  const over = !!selected && selected.came_in > 0 && n > selected.remaining + 0.001

  // One lot in stores is not a choice worth making someone make — same
  // reasoning as the "Where from?" picker on an egg collection.
  useEffect(() => {
    if (!lot && sellable.length === 1) setLot(sellable[0].id)
  }, [lot, sellable.length])

  const save = async () => {
    await recordDisposition({
      lotId: lot,
      kind: 'sold',
      amount: n,
      unit,
      value: Number(price) > 0 ? Number(price) : undefined,
      buyer: await resolveBuyer(contacts ?? [], buyerId, buyerDraft),
      notes: notes.trim() || undefined,
    })
    onDone()
  }
  const { run, busy, error } = useSave(save)

  return (
    <Sheet title="Sold" onClose={onClose}>
      <label className="field">
        <span>Sold what?</span>
        <select value={lot} onChange={(e) => setLot(e.target.value)}>
          <option value="">— pick one —</option>
          {sellable.map((l) => (
            <option key={l.id} value={l.id}>{lotLabel(l)}</option>
          ))}
        </select>
        {sellable.length === 0 && (
          <small className="hint">
            Nothing the farm produced yet — collecting eggs, milk, honey or
            produce puts it here. To sell something you bought in, open that
            lot under Inventory {'>'} Stores.
          </small>
        )}
      </label>

      <div className="pair">
        <label className="field">
          <span>How much{selected ? ` (${unit})` : ''}</span>
          <input type="number" inputMode="decimal" min="0" autoFocus value={amount}
            onChange={onNumericChange(setAmount)} onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="24" />
        </label>
        <label className="field">
          <span>For ($)</span>
          <input type="number" inputMode="decimal" min="0" value={price}
            onChange={onNumericChange(setPrice)} onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="8" />
        </label>
      </div>

      {selected && selected.came_in > 0 && (
        <p className={over ? 'hint warn' : 'hint'}>
          {over
            ? `Only ${formatQty(selected.remaining)} ${unit} left — saving this `
              + 'anyway takes the balance below zero.'
            : `${formatQty(selected.remaining)} ${unit} on hand.`}
        </p>
      )}

      <BuyerSelect contacts={contacts ?? []} buyerId={buyerId} onBuyerId={setBuyerId}
        draft={buyerDraft} onDraft={setBuyerDraft} />

      <label className="field">
        <span>Note (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Half off for cash" />
      </label>

      <button className="primary" disabled={busy || !lot || !(n > 0)} onClick={run}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      {error && <p className="error">{error}</p>}
      <p className="hint">
        Selling an animal is a different thing — it closes the animal out and
        settles what it cost. That one lives on the animal's own page, under
        Close out.
      </p>
    </Sheet>
  )
}

const SPECIES_PREFIX = 'species:'

/** Animals and groups eligible to be fed — same filter AssetSelect applies. */
function feedEligible(assets: Asset[]): Asset[] {
  return assets.filter((a) => a.status === 'active' && !a.parent_id && !a.attributes?.external)
}

interface SubjectOption { value: string; label: string }
/** A run of options under one heading — null label renders with no
 * <optgroup> wrapper, for the whole-herd section at the top. */
interface SubjectGroup { label: string | null; options: SubjectOption[] }

/**
 * "Fed what?" needs an option a dropdown of individuals doesn't have: the
 * whole herd. A round bale isn't eaten by one cow, and picking just one to
 * stand in for all five would charge that one animal the cost of feeding
 * the other four.
 *
 * Every such whole-herd option — "All cattle (5)", a named group like
 * "Spring layers" — sits together at the top, ahead of any individual, so
 * the choice that keeps a bale's cost from landing on one animal is the
 * first thing offered rather than buried inside its own species. Below
 * that, individuals are grouped by species (an <optgroup> each) instead of
 * running together alphabetically by name, which is how a farm actually
 * thinks about "who's eating this" — cattle as a set, then which cow.
 */
function feedSubjectOptions(assets: Asset[]): SubjectGroup[] {
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
  const sortedSpecies = [...bySpecies].sort(([a], [b]) => a.localeCompare(b))

  const wholeHerd: SubjectOption[] = []
  for (const [species, members] of sortedSpecies) {
    if (members.length > 1) {
      wholeHerd.push({
        value: SPECIES_PREFIX + species,
        label: `All ${pluralSpecies(species)} (${members.length})`,
      })
    }
  }
  for (const g of eligible) {
    if (g.type === 'group') wholeHerd.push({ value: g.id, label: g.name })
  }

  const groups: SubjectGroup[] = []
  if (wholeHerd.length > 0) groups.push({ label: null, options: wholeHerd })
  for (const [species, members] of sortedSpecies) {
    groups.push({ label: pluralSpecies(species), options: members.map((m) => ({ value: m.id, label: m.name })) })
  }
  if (noSpecies.length > 0) {
    groups.push({ label: 'Other', options: noSpecies.map((a) => ({ value: a.id, label: a.name })) })
  }
  return groups
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

/**
 * What the Feeding sheet will offer to draw from. Minerals are put out for
 * stock the same way feed is — a block that never appears here is one whose
 * cost never reaches the animals that ate it.
 */
const FEED_MATERIALS = ['Feed', 'Hay', 'Mineral']

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
 * Splits the lot list into labelled sections, one per kind of stock the feed
 * was bought for — the divider a long undifferentiated list was crying out
 * for, and <optgroup> is the only thing a <select> will take one from.
 *
 * Grouping on the purchase category rather than the lot's name is what puts
 * "Chicken feed" and "Chicken Scratch" under one heading instead of filing
 * them apart alphabetically.
 *
 * Row order inside each section is left exactly as lotBalances() returned
 * it — on hand first, then by name, then oldest first within a name.
 * Untagged lots fall to a General section at the end, the same place
 * Inventory puts animals with no species set.
 */
function groupFeedLots(lots: LotBalance[]): { label: string; lots: LotBalance[] }[] {
  const buckets = new Map<string, LotBalance[]>()
  for (const l of lots) {
    const key = l.category?.trim() || ''
    const bucket = buckets.get(key)
    if (bucket) bucket.push(l)
    else buckets.set(key, [l])
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === '') return 1
      if (b === '') return -1
      return a.localeCompare(b)
    })
    .map(([key, lots]) => ({
      label: key ? pluralSpecies(key) : 'General',
      lots,
    }))
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
  const { data: species } = useAsync(() => listTerms('species'), [])
  const selected = lots?.find((l) => l.id === lot)
  const unit = selected?.unit ?? 'lb'
  // Edible, and still actually there. A bag that has been fed out is not a
  // thing you can feed from, and leaving it in the list is one more
  // identical-looking row to pick the wrong one out of.
  //
  // lotIsUsedUp draws the one distinction that matters here: a lot bought
  // without its amount recorded has no balance to run out and stays
  // pickable, while one drawn to nothing — or one whose incoming record was
  // deleted out from under it — does not.
  //
  // Safe to hide because a balance is derived from logs, never stored:
  // deleting the feeding that emptied a lot puts it straight back here.
  // Verified in db/test/verify-local.mjs.
  const feedLots = (lots ?? []).filter((l) =>
    FEED_MATERIALS.includes(l.material ?? '')
    && (!lotIsUsedUp(l) || l.id === lot))
  const feedGroups = groupFeedLots(feedLots)

  const optionGroups = feedSubjectOptions(candidates ?? [])
  const options = optionGroups.flatMap((g) => g.options)
  // Same reasoning as AssetSelect's own allowNone={false}: a required
  // <select> with no blank option still shows its first entry without ever
  // firing onChange, so the state is kept in sync with what's on screen
  // rather than left stuck at '' behind a dropdown that looks filled in.
  useEffect(() => {
    if (!subject && options.length > 0) setSubject(options[0].value)
  }, [subject, options.length])
  const subjectIds = feedSubjectIds(candidates ?? [], subject)

  // Which stock the chosen lot is for, settable right here rather than only
  // back on the purchase. A bale bought by the load isn't obviously for one
  // species when it's paid for — it becomes so the first time it's fed —
  // and that is the moment someone is actually looking at it.
  //
  // Follows the lot rather than being typed fresh each feeding: this sets
  // the lot's own category, so a bale tagged once stays grouped under that
  // heading for every feeding after. Deliberately not inferred from who is
  // being fed — silently retagging a lot because today it went to the
  // horses is not something anyone asked for.
  const [category, setCategory] = useState('')
  useEffect(() => { setCategory(selected?.category ?? '') }, [selected?.id])

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
    // Only when it actually changed — an untouched dropdown shouldn't write
    // to the lot on every feeding.
    if (selected && category !== (selected.category ?? '')) {
      await setLotCategory(selected.id, category || null)
    }
    onDone()
  }
  const { run, busy, error } = useSave(save)

  return (
    <Sheet title="Feeding" onClose={onClose}>
      <label className="field">
        <span>Fed what?</span>
        <select value={subject} onChange={(e) => setSubject(e.target.value)}>
          {optionGroups.map((g, i) => {
            const rows = g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
            // A <select>'s only valid children are <option> and <optgroup> —
            // the whole-herd section (null label) has to stay a Fragment,
            // not a real wrapper element, or the browser drops it silently.
            return g.label
              ? <optgroup key={g.label} label={g.label}>{rows}</optgroup>
              : <Fragment key={i}>{rows}</Fragment>
          })}
        </select>
        {options.length === 0 && (
          <small className="hint">Nothing added yet — see Inventory.</small>
        )}
      </label>
      <label className="field">
        <span>Which feed? (optional)</span>
        <select value={lot} onChange={(e) => setLot(e.target.value)}>
          <option value="">— none —</option>
          {/* One <optgroup> per kind of stock, so a long list reads as
              sections rather than one run of near-identical rows. A single
              section would just be a heading over the whole list, so the
              grouping only earns its place once there's more than one. */}
          {feedGroups.length > 1
            ? feedGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.lots.map((l) => (
                  <option key={l.id} value={l.id}>{lotLabel(l)}</option>
                ))}
              </optgroup>
            ))
            : feedLots.map((l) => (
              <option key={l.id} value={l.id}>{lotLabel(l)}</option>
            ))}
        </select>
      </label>
      {selected && (
        <label className="field">
          <span>For (optional)</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">General — not just one kind of stock</option>
            {(species ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <small className="hint">
            Sticks to this {(selected.material ?? 'feed').toLowerCase()}, so it
            stays under that heading next time.
          </small>
        </label>
      )}
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

/**
 * A note is about a thing on the farm, not a bag it was fed from — "About
 * what?" left unfiltered offered every purchased lot alongside the animals,
 * and seven bags all called "Pig feed" buried the one cow anyone was
 * actually trying to pick. Stores has its own note-taking (the lot's own
 * sheet on Inventory), so it's left off here the same way Feed materials
 * are left off AssetSelect's other unfiltered pickers.
 */
const NOTE_SUBJECT_TYPES: AssetType[] =
  ['animal', 'group', 'planting', 'land', 'structure', 'equipment']

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
      <AssetSelect value={asset} onChange={setAsset} types={NOTE_SUBJECT_TYPES}
        label="About what? (optional)" />
      <button className="primary" disabled={busy || !text.trim()} onClick={run}>{busy ? "Saving…" : "Save"}</button>
      {error && <p className="error">{error}</p>}
    </Sheet>
  )
}

/** One line of a multi-item trip — everything BuyForm asks per item, kept as
 * strings the way the inputs themselves hold them until save() parses them. */
interface PurchaseLine {
  material: string
  category: string
  name: string
  amount: string
  unit: string
  cost: string
}

/**
 * One trip to the store is rarely one thing bought — pig feed, chicken feed
 * and scratch on the same receipt, say. Supplier and the receipt photo are
 * asked once and shared; each item still becomes its own purchase (own lot,
 * own accurate cost) rather than splitting one total evenly across them,
 * which is right for several animals bought as a batch but wrong here — a
 * $180 receipt of three differently-priced bags isn't three $60 bags.
 */
function BuyForm({ onDone, onClose }: FormProps) {
  const [material, setMaterial] = useState('Feed')
  const [category, setCategory] = useState('')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState('lb')
  const [cost, setCost] = useState('')
  const [items, setItems] = useState<PurchaseLine[]>([])
  const [receipt, setReceipt] = useState<PreparedImage | null>(null)
  const [supplier, setSupplier] = useState('')
  const { data: materials } = useAsync(() => listTerms('material'), [])
  const { data: units } = useAsync(() => listTerms('unit'), [])
  const { data: species } = useAsync(() => listTerms('species'), [])
  const categorizable = CATEGORIZABLE_MATERIALS.includes(material)

  // The item being composed right now, if it's actually fillable. Cost is
  // the one field every purchase needs (see the hint below it), so a blank
  // or zero cost means there's nothing here worth adding — not a half-typed
  // row to carry along.
  const draft = (): PurchaseLine | null => (Number(cost) > 0 ? {
    material, category: categorizable && category ? category : '',
    name: name.trim() || material, amount, unit, cost,
  } : null)

  const addItem = () => {
    const d = draft()
    if (!d) return
    setItems([...items, d])
    setMaterial('Feed'); setCategory(''); setName(''); setAmount(''); setUnit('lb'); setCost('')
  }
  const removeItem = (i: number) => setItems(items.filter((_, x) => x !== i))

  const save = async () => {
    const d = draft()
    const all = d ? [...items, d] : items
    for (const it of all) {
      await createPurchase({
        material: it.material,
        name: it.name,
        amount: Number(it.amount) || undefined,
        unit: it.unit,
        cost: Number(it.cost),
        supplier: supplier.trim() || undefined,
        category: it.category || undefined,
        receipt: receipt ?? undefined,
      })
    }
    onDone()
  }
  const { run, busy, error } = useSave(save)
  const total = items.length + (draft() ? 1 : 0)

  return (
    <Sheet title="Purchase" onClose={onClose}>
      <p className="hint">
        Recording what you paid is what lets the app work out cost per unit
        later.
      </p>

      {items.length > 0 && (
        <div className="chipwrap" style={{ marginBottom: '1rem' }}>
          {items.map((it, i) => (
            <button key={i} type="button" className="chip remove" onClick={() => removeItem(i)}>
              {it.name} · {formatMoney(Number(it.cost))} ✕
            </button>
          ))}
        </div>
      )}

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

      <button type="button" className="linkish" disabled={!(Number(cost) > 0)} onClick={addItem}>
        + Bought something else in the same order
      </button>

      <label className="field">
        <span>Supplier (optional)</span>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
          placeholder="Co-op" />
      </label>
      <ReceiptCapture onChange={setReceipt} />
      {items.length > 0 && (
        <p className="hint">
          Supplier and receipt apply to all {total} items above.
        </p>
      )}

      <button className="primary" disabled={busy || total === 0} onClick={run}>
        {busy ? 'Saving…' : total > 1 ? `Save ${total} items` : 'Save'}
      </button>
      {error && <p className="error">{error}</p>}
    </Sheet>
  )
}
