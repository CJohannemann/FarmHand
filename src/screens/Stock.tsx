import { useState } from 'react'
import { useSave } from '../lib/useSave'
import { useAsync } from '../lib/useAsync'
import {
  createAnimals, createAsset, createGroupWithMembers, createLog, createPlanting, createTerm,
  findOrCreateExternalParent,
  listAssets, listTerms, lotBalances, type LotBalance,
} from '../db/queries'
import type { Asset, AssetType } from '../db/types'
import {
  EQUIPMENT_KINDS, FUEL_TYPES, SPECIES_PURPOSES, purposeRequired, type Purpose,
} from '../lib/tiles'
import { equipmentGlyph, purposeLabel, sexTermsFor, speciesGlyph } from '../lib/husbandry'
import {
  formatMoney, formatQty, hasNumericValue, ignoreArrowKeysOnNumberInput,
  ignoreScrollOnNumberInput,
  onNumericChange,
} from '../lib/numeric'
import { OTHER } from './AssetSelect'
import { ParentField } from './ParentField'
import { Sheet } from './Sheet'
import { AssetDetail, isUnnamedMember } from './AssetDetail'
import { TakeFromLot } from './TakeFromLot'

const GROUPS: { type: AssetType; heading: string; blurb: string }[] = [
  // Named for what you end up with, not for what the table is called.
  // "Groups — flocks, batches, herds" reads as the right answer to anyone
  // adding five cows, because five cows are a herd; it is the wrong answer,
  // because each of them wants its own tag and its own sale price. Reported
  // twice by the same farm, which is a label problem rather than a bug.
  { type: 'animal',    heading: 'Animals',   blurb: 'One record each — own tag, weights, sale price' },
  { type: 'group',     heading: 'Group',     blurb: 'One record for the whole batch, however many head' },
  { type: 'planting',  heading: 'Plantings', blurb: 'A crop in a place, this season' },
  { type: 'lot',       heading: 'Stores',    blurb: 'Feed, seed, meat, produce' },
  { type: 'land',      heading: 'Land',      blurb: 'Fields, paddocks, beds' },
  { type: 'equipment', heading: 'Equipment', blurb: 'Tractors, attachments, vehicles' },
]

/**
 * Stores' card icon — there's no barn emoji in Unicode, and every close
 * substitute (a plain house, a storefront) read as generic rather than
 * "this is where the farm keeps things." An original two-tone glyph, sized
 * to sit inline with the emoji glyphs every other card uses.
 */
function BarnIcon() {
  return (
    <svg viewBox="0 0 48 48" width="1.3em" height="1.3em" aria-hidden="true">
      <path
        d="M6 20 C6 20 6 11 24 4 C42 11 42 20 42 20 L34 20 C34 20 32 13 24 9
           C16 13 14 20 14 20 Z"
        fill="#1c3f66"
      />
      <circle cx="24" cy="13.5" r="4.5" fill="#5aa9dd" stroke="#fff" strokeWidth="1.2" />
      <path d="M24 9v9M19.5 13.5h9" stroke="#fff" strokeWidth="1" />
      <rect x="8" y="20" width="32" height="20" fill="#1c3f66" />
      <rect x="17" y="24" width="14" height="2.6" rx="1.2" fill="#5aa9dd" />
      <rect x="18" y="26.6" width="12" height="13.4" fill="#5aa9dd" stroke="#fff" strokeWidth="1" />
      <path d="M18 26.6l12 13.4M30 26.6l-12 13.4" stroke="#fff" strokeWidth="1" />
      <rect x="4" y="40" width="40" height="3" rx="1.5" fill="#1c3f66" />
    </svg>
  )
}

/**
 * Section headings come from what a thing IS, not from the table it lives
 * in. "Lots" is a word out of the schema — nobody buys a lot, they buy hay,
 * and hay belongs under Feed. Same for a tractor, which belongs under
 * Tractors rather than Equipment. So lots are bucketed by their material and
 * machines by their kind, and the type-level heading survives only as the
 * fallback for anything that never got one.
 */
function bucketBy<T>(
  items: T[], key: (item: T) => string | null, fallback: string,
): { heading: string; items: T[] }[] {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const heading = (key(item) ?? '').trim() || fallback
    const bucket = buckets.get(heading)
    if (bucket) bucket.push(item)
    else buckets.set(heading, [item])
  }
  return [...buckets.entries()]
    .map(([heading, items]) => ({ heading, items }))
    .sort((a, b) => {
      // The fallback bucket is the leftovers — always last, whatever it
      // would sort as alphabetically.
      if (a.heading === fallback) return 1
      if (b.heading === fallback) return -1
      return a.heading.localeCompare(b.heading)
    })
}

/**
 * "Tractor" as a heading over three tractors reads wrong. Only applied to a
 * real kind — the fallback heading is a category name that already reads as
 * one ("Equipment"), and materials need no help either, being mass nouns
 * ("Feed", "Hay", "Straw") left exactly as they were typed.
 */
const pluralKind = (kind: string) =>
  kind === 'Other' || kind.endsWith('s') ? kind : kind + 's'

/** Whichever value the most items share — a section card's icon follows this, not just the first row. */
function mostCommon<T>(items: T[], key: (item: T) => string): string | null {
  const counts = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [k, count] of counts) {
    if (count > bestCount) { best = k; bestCount = count }
  }
  return best
}

/**
 * Buckets animals under their species, alphabetically, with anything that
 * has no species recorded last — those are the ones needing attention, and
 * burying them mid-list makes them easy to miss.
 */
function groupBySpecies(items: Asset[]): { species: string | null; items: Asset[] }[] {
  const buckets = new Map<string | null, Asset[]>()
  for (const a of items) {
    const species = String(a.attributes?.species ?? '').trim() || null
    const bucket = buckets.get(species)
    if (bucket) bucket.push(a)
    else buckets.set(species, [a])
  }
  return [...buckets.entries()]
    .map(([species, items]) => ({ species, items }))
    .sort((a, b) => {
      if (a.species === null) return 1
      if (b.species === null) return -1
      return a.species.localeCompare(b.species)
    })
}

/**
 * A member someone actually named — Bacon, or a pig moved in from standalone
 * — still reads as its own animal on Inventory; the group only takes over
 * for feeding and other batch logs. Only a member that never got past its
 * auto-generated "<group> N" placeholder stays folded into the group's own
 * card, since a card for "Cattle (beef) 3" would say nothing a headcount
 * doesn't already.
 */
function showsOwnCard(assets: Asset[], a: Asset): boolean {
  if (!a.parent_id) return true
  const group = assets.find((g) => g.id === a.parent_id)
  return !group || !isUnnamedMember(group, a)
}

export function Stock() {
  const [adding, setAdding] = useState(false)
  const [taking, setTaking] = useState<LotBalance | null>(null)
  // A stack, not a single value — so Back from a member returns to its
  // group, not all the way out to the top list. Selecting from the top
  // list starts a fresh stack; a group's Members list pushes onto it.
  const [stack, setStack] = useState<Asset[]>([])
  // Which species card is open, if any. `null` is a real value here — the
  // bucket of animals with no species recorded — so `undefined` means "no
  // card open" and the two cannot be confused.
  const [species, setSpecies] = useState<string | null | undefined>(undefined)
  // Which non-animal section is open, if any — Equipment, Land, Group,
  // Plantings, Stores. Animals already gets one card per species; every
  // other section used to dump its rows straight onto Inventory, which
  // meant a farm with real equipment (a tractor, a combine, a mower...)
  // scrolled through all of it just to find an animal card underneath.
  const [section, setSection] = useState<AssetType | undefined>(undefined)
  // Closed-out stock is hidden by default. A farm that sells a hundred hogs
  // a year would otherwise have this screen buried under years of sold
  // animals within months, with the ones it actually has lost among them —
  // and the records are not deleted, just not the thing you came here for.
  const [showClosed, setShowClosed] = useState(false)
  const { data, loading, reload } = useAsync(() => listAssets(), [])
  const assets = data ?? []
  // Lots come from lotBalances() rather than the asset list, because a lot
  // is only ever interesting as "how much is left" — and that query already
  // filters out the service lots (a vet bill, an oil change) that exist to
  // carry a price and nothing else.
  const lots = useAsync(() => lotBalances(), [])
  const reloadAll = () => { reload(); lots.reload() }

  // `underOwnHeading` rows already sit under a heading naming their species
  // or their kind — repeating it on every row is just noise, so an animal
  // shows its ear tag instead and a machine drops straight to make and model.
  /**
   * A list of stock with the closed-out part folded away behind a count.
   * The reveal is a line of text rather than a filter control: it states
   * how much is hidden, which is the only thing worth knowing before
   * deciding whether to look.
   */
  const assetList = (items: Asset[], underOwnHeading = false) => {
    const live = items.filter((a) => a.status === 'active')
    const closed = items.filter((a) => a.status !== 'active')
    const shown = showClosed ? [...live, ...closed] : live
    return (
      <>
        <ul className="assetlist">{shown.map((a) => row(a, underOwnHeading))}</ul>
        {closed.length > 0 && (
          <button type="button" className="linkish showclosed"
            onClick={() => setShowClosed(!showClosed)}>
            {showClosed
              ? `Hide ${formatQty(closed.length)} closed out`
              : `Show ${formatQty(closed.length)} closed out`}
          </button>
        )}
      </>
    )
  }

  const row = (a: Asset, underOwnHeading = false) => {
    const liveMembers = assets.filter(
      (m) => m.parent_id === a.id && m.status === 'active',
    ).length
    const headcount = liveMembers || a.attributes?.headcount
    const equipMeta = [
      underOwnHeading ? null : a.attributes?.kind,
      a.attributes?.make, a.attributes?.model,
    ].filter(Boolean).join(' ')
    const kind = a.type === 'equipment'
      ? equipMeta
      : underOwnHeading
        ? [a.attributes?.sex, a.attributes?.tag ? `Tag ${String(a.attributes.tag)}` : '']
          .filter(Boolean).join(' · ')
        : String(a.attributes?.species ?? a.attributes?.crop ?? '')
    return (
      <li key={a.id} className={a.status === 'archived' ? 'gone' : ''}>
        <button className="assetrow" onClick={() => setStack([a])}>
          <span className="asset-name">{a.name}</span>
          <span className="asset-meta">
            {kind}
            {headcount ? ` · ${formatQty(Number(headcount))} head` : ''}
            {a.status === 'archived'
              ? ` · ${a.terminal_event ?? 'archived'}` : ''}
            <span className="chev">›</span>
          </span>
        </button>
      </li>
    )
  }

  if (stack.length > 0) {
    const current = stack[stack.length - 1]
    // Re-read from the list so the header reflects any change just made.
    const fresh = assets.find((a) => a.id === current.id) ?? current
    return (
      <AssetDetail
        asset={fresh}
        onBack={() => setStack(stack.slice(0, -1))}
        onChanged={reload}
        onSelect={(a) => setStack([...stack, a])}
      />
    )
  }

  if (species !== undefined) {
    const mine = assets.filter((a) =>
      a.type === 'animal' && showsOwnCard(assets, a) && !a.attributes?.external
      && (String(a.attributes?.species ?? '').trim() || null) === species)
    return (
      <div className="screen">
        <button type="button" className="back" onClick={() => setSpecies(undefined)}>
          ‹ Back
        </button>
        <h1>{species ?? 'No species set'}</h1>
        <p className="tagline">
          {(() => {
            const live = mine.filter((a) => a.status === 'active').length
            const gone = mine.length - live
            // The list below still shows the closed-out ones, greyed, so the
            // count has to say why it disagrees with the number of rows.
            return gone > 0
              ? `${formatQty(live)} on hand · ${formatQty(gone)} closed out`
              : `${formatQty(live)} ${live === 1 ? 'animal' : 'animals'}`
          })()}
        </p>
        {assetList(mine, true)}
      </div>
    )
  }

  if (section !== undefined) {
    const g = GROUPS.find((x) => x.type === section)!
    return (
      <div className="screen">
        <button type="button" className="back" onClick={() => setSection(undefined)}>
          ‹ Back
        </button>
        <h1>{g.heading}</h1>
        {section === 'lot' && (
          // Stores is the one section not backed by the asset list — see
          // `lots` above. Its rows carry a balance and draw the lot down
          // rather than opening an asset page.
          bucketBy(lots.data ?? [], (l) => l.material, 'Other supplies').map(({ heading, items }) => (
            <div key={heading}>
              <h2 className="section">{heading}</h2>
              <ul className="assetlist">
                {items.map((l) => (
                  <li key={l.id} className={l.remaining > 0.001 ? '' : 'gone'}>
                    <button className="assetrow" onClick={() => setTaking(l)}>
                      <span className="asset-name">{l.name}</span>
                      <span className="asset-meta">
                        {l.remaining > 0.001 ? (
                          <strong className="remaining">
                            {formatQty(l.remaining)} {l.unit ?? ''}
                          </strong>
                        ) : `${formatQty(l.came_in)} ${l.unit ?? ''} in, none left`}
                        <span className="chev">›</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        {section === 'equipment' && (
          // A tractor and the bush hog behind it are different things to own
          // and different things to service — one heading over both hides that.
          bucketBy(
            assets.filter((a) => a.type === 'equipment' && !a.parent_id && !a.attributes?.external),
            (a) => String(a.attributes?.kind ?? ''), g.heading,
          ).map(({ heading, items }) => (
            <div key={heading}>
              <h2 className="section">{heading === g.heading ? heading : pluralKind(heading)}</h2>
              {assetList(items, true)}
            </div>
          ))
        )}
        {section !== 'lot' && section !== 'equipment' && assetList(
          assets.filter((a) => a.type === section && !a.parent_id && !a.attributes?.external),
        )}
        {taking && (
          <TakeFromLot lot={taking} onClose={() => setTaking(null)}
            onDone={() => { setTaking(null); lots.reload() }} />
        )}
      </div>
    )
  }

  return (
    <div className="screen">
      <h1>Inventory</h1>
      <p className="tagline">
        Animals, land, feed and machines — everything the records hang off.
      </p>

      <button className="primary" onClick={() => setAdding(true)}>
        + Add something
      </button>

      {loading && <p className="muted">Loading…</p>}

      {!loading && assets.length === 0 && (
        <p className="empty">
          Nothing here yet. Add your cattle, a flock, a bag of feed — or the
          tractor, so its services have somewhere to go.
        </p>
      )}

      {(() => {
        // An unnamed member of a group is reached through that group, not
        // listed flatly here too — a card for "Cattle (beef) 3" says
        // nothing a headcount doesn't. A member that got its own name (or
        // joined a group after already having one) keeps its own card. An
        // "external" stub (a sire/dam typed in once, kept around so it's
        // pickable for the next animal too) isn't stock either — it only
        // ever exists to be pointed at from a Bloodline field.
        const mine = assets.filter((a) =>
          a.type === 'animal' && showsOwnCard(assets, a) && !a.attributes?.external)
        const bySpecies = groupBySpecies(mine)
          .filter(({ items }) => items.some((a) => a.status === 'active'))
        if (bySpecies.length === 0) return null

        // Animals are tracked and named individually, so a flat list of "1",
        // "2", "Patti" says nothing about which is a pig and which the cow.
        // One card per species, tapped to see that species' animals — a herd
        // of forty would otherwise bury everything else on this screen.
        return (
          <section>
            <h2 className="section">Animals</h2>
            <div className="speciescards">
              {/* A species disappears when its last animal does.
                  Inventory answers "what do I have"; a pig icon over
                  "0 animals" answers it wrongly, and a farm that sells
                  out every autumn would be told it still has pigs for
                  months. The records are not gone — Analytics > Past
                  stock browses them by year. */}
              {bySpecies.map(({ species, items }) => (
                <button key={species ?? '—'} type="button" className="speciescard"
                  onClick={() => setSpecies(species)}>
                  <span className="glyph">{speciesGlyph(species)}</span>
                  <span className="speciescard-name">{species ?? 'No species set'}</span>
                  {/* On hand, not on record. A sold or butchered animal
                      keeps its record forever — that is the point of a soft
                      delete — but counting it here would tell someone they
                      have two pigs when one is in the freezer. */}
                  <span className="speciescard-count">
                    {(() => {
                      const live = items.filter((a) => a.status === 'active').length
                      return `${formatQty(live)} ${live === 1 ? 'animal' : 'animals'}`
                    })()}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )
      })()}

      {(() => {
        // Everything else — Group, Plantings, Stores, Land, Equipment — gets
        // one card apiece instead of dumping its rows straight onto
        // Inventory. A dozen tractors and attachments used to bury whatever
        // animal cards came after them; tapping the card is what used to be
        // just scrolling down.
        //
        // Group and Equipment follow whatever's actually in there most (see
        // `mostCommon` below); Stores stays a fixed storefront glyph instead
        // — a card that changed icon as materials came and went read as a
        // glitch rather than as information.
        const cards = GROUPS.filter((g) => g.type !== 'animal').map((g) => {
          if (g.type === 'lot') {
            const all = lots.data ?? []
            if (all.length === 0) return null
            return (
              <button key={g.type} type="button" className="speciescard"
                onClick={() => setSection('lot')}>
                <span className="glyph"><BarnIcon /></span>
                <span className="speciescard-name">{g.heading}</span>
                <span className="speciescard-count">{formatQty(all.length)} on hand</span>
              </button>
            )
          }
          const mine = assets.filter((a) => a.type === g.type
            && !a.parent_id && !a.attributes?.external)
          if (mine.length === 0) return null
          const live = mine.filter((a) => a.status === 'active').length
          const glyph = g.type === 'group'
            ? speciesGlyph(mostCommon(mine, (a) => String(a.attributes?.species ?? '')))
            : g.type === 'equipment'
              ? equipmentGlyph(mostCommon(mine, (a) => String(a.attributes?.kind ?? '')))
              : null
          return (
            <button key={g.type} type="button" className="speciescard"
              onClick={() => setSection(g.type)}>
              {glyph && <span className="glyph">{glyph}</span>}
              <span className="speciescard-name">{g.heading}</span>
              <span className="speciescard-count">{formatQty(live)} on hand</span>
            </button>
          )
        }).filter(Boolean)
        if (cards.length === 0) return null
        return <section><div className="speciescards">{cards}</div></section>
      })()}

      {adding && (
        <AddForm onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); reloadAll() }} />
      )}

      {taking && (
        <TakeFromLot lot={taking} onClose={() => setTaking(null)}
          onDone={() => { setTaking(null); lots.reload() }} />
      )}
    </div>
  )
}

function AddForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  // Blank until chosen — defaulting to any one kind (Animals or otherwise)
  // risks a tractor getting saved as a stray animal because nobody
  // reselected the dropdown.
  const [type, setType] = useState<AssetType | ''>('')
  const [name, setName] = useState('')
  const [species, setSpecies] = useState('')
  // "Other" reveals this, and typing here is what turns a one-off animal
  // into a real choice on every farm's own list next time — see createTerm.
  const [speciesOther, setSpeciesOther] = useState('')
  const [purpose, setPurpose] = useState<Purpose | undefined>(undefined)
  const [sex, setSex] = useState('')
  const [tag, setTag] = useState('')
  // How many individual animals to create. Groups have their own headcount
  // field; this is the "five cows, five records" case.
  const [count, setCount] = useState('1')
  const [sireId, setSireId] = useState('')
  const [sireName, setSireName] = useState('')
  const [damId, setDamId] = useState('')
  const [damName, setDamName] = useState('')
  const [headcount, setHeadcount] = useState('')
  const [birthday, setBirthday] = useState('')
  const [price, setPrice] = useState('')
  const [crop, setCrop] = useState('')
  const [variety, setVariety] = useState('')
  const [where, setWhere] = useState('')
  const [kind, setKind] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [serial, setSerial] = useState('')
  const [hours, setHours] = useState('')
  const [mileage, setMileage] = useState('')
  const [fuel, setFuel] = useState('')
  const [plate, setPlate] = useState('')
  const { data: speciesList } = useAsync(() => listTerms('species'), [])
  const { data: cropList } = useAsync(() => listTerms('crop'), [])

  const wantsSpecies = type === 'animal' || type === 'group'
  const many = type === 'animal' && Number(count) > 1
  // How many head one price covers — a flock's headcount, or a batch of
  // individually tracked animals. Used to show what each one worked out at,
  // since the number people have to hand is the invoice total.
  const perHeadOf = type === 'group' ? Number(headcount) : Number(count)
  const perHead = perHeadOf > 1 && hasNumericValue(price)
    ? Number(price) / perHeadOf
    : null
  const isAnimal = type === 'animal'
  const isPlanting = type === 'planting'
  const isEquipment = type === 'equipment'
  const resolvedSpecies = species === OTHER ? speciesOther.trim() : species
  const purposeOptions = SPECIES_PURPOSES[resolvedSpecies]
  // Cattle, goats and sheep only: what the app puts on the home screen
  // depends on the answer, and either guess is wrong for somebody.
  const mustPickPurpose = wantsSpecies && purposeRequired(resolvedSpecies) && !purpose
  // A commercial operation IDs by ear tag, never a name — a cow tracked
  // only that way shouldn't need a name invented for it just to save.
  const finalName = name.trim() || (isAnimal && !many ? tag.trim() : '')

  const save = async () => {
    if (!type) return
    if (isPlanting) {
      await createPlanting({
        name: finalName,
        crop,
        variety: variety.trim() || undefined,
        where: where.trim() || undefined,
      })
      onDone()
      return
    }
    if (species === OTHER && resolvedSpecies) await createTerm('species', resolvedSpecies)
    const attributes: Record<string, unknown> = {}
    if (wantsSpecies && resolvedSpecies) attributes.species = resolvedSpecies
    if (purposeOptions && purpose) attributes.purpose = purpose
    if (isEquipment && kind) attributes.kind = kind
    if (isEquipment && make.trim()) attributes.make = make.trim()
    if (isEquipment && model.trim()) attributes.model = model.trim()
    if (isEquipment && Number(year) > 0) attributes.year = Number(year)
    if (isEquipment && serial.trim()) attributes.serial = serial.trim()
    if (isEquipment && kind === 'Tractor' && hasNumericValue(hours)) attributes.hours = Number(hours)
    if (isEquipment && kind === 'Vehicle' && hasNumericValue(mileage)) attributes.mileage = Number(mileage)
    if (isEquipment && (kind === 'Tractor' || kind === 'Vehicle') && fuel) attributes.fuel = fuel
    if (isEquipment && kind === 'Vehicle' && plate.trim()) attributes.plate = plate.trim()
    if (isAnimal && sex) attributes.sex = sex
    if (isAnimal && tag.trim()) attributes.tag = tag.trim()
    // A typed name becomes a real (if minimal) record behind the scenes,
    // reusing one already saved under that name — so buying five calves
    // off the same outside bull means typing his name once, not five.
    if (isAnimal && sireId && sireId !== OTHER) attributes.sireId = sireId
    else if (isAnimal && sireName.trim()) {
      attributes.sireId = await findOrCreateExternalParent(sireName, resolvedSpecies, 'sire')
    }
    if (isAnimal && damId && damId !== OTHER) attributes.damId = damId
    else if (isAnimal && damName.trim()) {
      attributes.damId = await findOrCreateExternalParent(damName, resolvedSpecies, 'dam')
    }
    // Three shapes, and the count is what picks between the last two: a
    // group of seventy-five broilers, five cattle as five records, or one
    // named animal. Five cows in a herd they do not need is the wrong
    // shape — each will get its own tag, weights and sale price.
    const ids = type === 'group' && Number(headcount) > 0
      ? [await createGroupWithMembers({
          name: finalName, count: Number(headcount), attributes,
        })]
      : isAnimal
        ? await createAnimals({ name: finalName, count: Math.max(1, Number(count) || 1), attributes })
        : [await createAsset({ type, name: finalName, attributes })]

    // Both logs go on every animal created. Five cows bought together were
    // one purchase and share a birthday; hanging either on only the first
    // would leave the other four with no cost and no age.
    const subjects = ids.map((id) => ({ id, role: 'subject' as const }))
    if (isAnimal && birthday) {
      await createLog({
        type: 'birth', name: 'Born', timestamp: new Date(`${birthday}T12:00:00`),
        assets: subjects,
      })
    }
    if ((isAnimal || isEquipment || type === 'group') && hasNumericValue(price)) {
      await createLog({
        type: 'purchase', name: `Bought ${finalName}`,
        assets: subjects,
        quantities: [{ measure: 'price', value: Number(price), unit: 'USD' }],
      })
    }
    onDone()
  }
  const { run, busy, error } = useSave(save)

  return (
    <Sheet title="Add" onClose={onClose}>
      <label className="field">
        <span>What kind?</span>
        <select value={type} onChange={(e) => setType(e.target.value as AssetType)}>
          <option value="">— Select —</option>
          {GROUPS.map((g) => (
            <option key={g.type} value={g.type}>
              {g.heading}{g.blurb ? ` — ${g.blurb}` : ''}
            </option>
          ))}
        </select>
      </label>

      {wantsSpecies && (
        <label className="field">
          <span>Species</span>
          <select autoFocus value={species}
            onChange={(e) => {
              setSpecies(e.target.value); setPurpose(undefined); setSex('')
              if (e.target.value !== OTHER) setSpeciesOther('')
            }}>
            <option value="">— pick one —</option>
            {(speciesList ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            <option value={OTHER}>Other — raising something else</option>
          </select>
        </label>
      )}

      {wantsSpecies && species === OTHER && (
        <label className="field">
          <span>What is it?</span>
          <input autoFocus value={speciesOther} onChange={(e) => setSpeciesOther(e.target.value)}
            placeholder="Alpaca" />
          <small className="hint">
            Saved to your farm's own list — pick it straight from Species next time.
          </small>
        </label>
      )}

      {wantsSpecies && purposeOptions && (
        <>
          <div className="chipwrap" style={{ marginBottom: mustPickPurpose ? 0 : '1rem' }}>
            {purposeOptions.map((p) => (
              <button key={p} type="button" className={`chip${purpose === p ? ' on' : ''}`}
                onClick={() => setPurpose(purpose === p ? undefined : p)}>
                {purposeLabel(p, species)}
              </button>
            ))}
          </div>
          {mustPickPurpose && (
            <p className="hint" style={{ marginBottom: '1rem' }}>
              Pick one — it decides whether Milk appears on your Today screen.
            </p>
          )}
        </>
      )}

      {/* Held back until a species is picked: the words themselves depend on
          it, and offering "Gilt" before knowing it's a pig invites nonsense. */}
      {isAnimal && species && (
        <label className="field">
          <span>What is it? (optional)</span>
          <div className="chipwrap">
            {sexTermsFor(species).map((s) => (
              <button key={s} type="button" className={`chip${sex === s ? ' on' : ''}`}
                onClick={() => setSex(sex === s ? '' : s)}>
                {s}
              </button>
            ))}
          </div>
        </label>
      )}

      <label className="field">
        <span>Name{isAnimal ? ' (optional with a tag)' : ''}</span>
        <input autoFocus={!wantsSpecies} value={name} onChange={(e) => setName(e.target.value)}
          placeholder={type === 'group' ? 'Spring broilers' : 'Bluebell'} />
      </label>

      {isAnimal && (
        <label className="field">
          <span>How many?</span>
          <input type="number" inputMode="numeric" min="1" value={count}
            onChange={onNumericChange(setCount, { integer: true })}
            onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
            placeholder="1" />
          <small className="hint">
            {many
              ? `Creates ${Number(count)} separate records, numbered — each with its own tag, weights and sale price. Use Groups instead for a flock you treat as one.`
              : 'More than one? They are created as separate animals, not a group.'}
          </small>
        </label>
      )}

      {/* One ear tag cannot belong to five animals, so the field goes when
          there is more than one. They are tagged individually afterwards,
          on each animal's own screen. */}
      {isAnimal && !many && (
        <label className="field">
          <span>Tag number{name.trim() ? ' (optional)' : ''}</span>
          <input value={tag} onChange={(e) => setTag(e.target.value)}
            placeholder="Ear tag, ID number, whatever you use" />
        </label>
      )}

      {isAnimal && (
        <label className="field">
          <span>Birthday (optional)</span>
          <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        </label>
      )}

      {isAnimal && (
        <ParentField role="sire" species={resolvedSpecies}
          id={sireId} onId={setSireId} name={sireName} onName={setSireName} />
      )}

      {isAnimal && (
        <ParentField role="dam" species={resolvedSpecies}
          id={damId} onId={setDamId} name={damName} onName={setDamName} />
      )}

      {isEquipment && (
        <div className="chipwrap" style={{ marginBottom: '1rem' }}>
          {EQUIPMENT_KINDS.map((k) => (
            <button key={k} type="button" className={`chip${kind === k ? ' on' : ''}`}
              onClick={() => setKind(kind === k ? '' : k)}>
              {k}
            </button>
          ))}
        </div>
      )}

      {isEquipment && (
        <div className="pair">
          <label className="field">
            <span>Make (optional)</span>
            <input value={make} onChange={(e) => setMake(e.target.value)}
              placeholder="Kubota" />
          </label>
          <label className="field">
            <span>Model (optional)</span>
            <input value={model} onChange={(e) => setModel(e.target.value)}
              placeholder="L3901" />
          </label>
        </div>
      )}

      {isEquipment && (
        <div className="pair">
          <label className="field">
            <span>Year (optional)</span>
            <input type="number" inputMode="numeric" min="0" value={year}
              onChange={onNumericChange(setYear, { integer: true })}
              onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
              placeholder="2020" />
          </label>
          <label className="field">
            <span>Serial / VIN (optional)</span>
            <input value={serial} onChange={(e) => setSerial(e.target.value)} />
          </label>
        </div>
      )}

      {isEquipment && (kind === 'Tractor' || kind === 'Vehicle') && (
        <div className="pair">
          <label className="field">
            <span>{kind === 'Tractor' ? 'Engine hours (optional)' : 'Mileage (optional)'}</span>
            {kind === 'Tractor' ? (
              <input type="number" inputMode="numeric" min="0" value={hours}
                onChange={onNumericChange(setHours, { integer: true })}
                onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
                placeholder="1240" />
            ) : (
              <input type="number" inputMode="numeric" min="0" value={mileage}
                onChange={onNumericChange(setMileage, { integer: true })}
                onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
                placeholder="32400" />
            )}
          </label>
          <label className="field">
            <span>Fuel (optional)</span>
            <select value={fuel} onChange={(e) => setFuel(e.target.value)}>
              <option value="">— none —</option>
              {FUEL_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </div>
      )}

      {isEquipment && kind === 'Vehicle' && (
        <label className="field">
          <span>License plate (optional)</span>
          <input value={plate} onChange={(e) => setPlate(e.target.value)} />
        </label>
      )}

      {(isAnimal || isEquipment || type === 'group') && (
        <label className="field">
          <span>{perHead ? 'Total paid for all of them ($, optional)' : 'Bought for ($, optional)'}</span>
          <input type="number" inputMode="decimal" min="0" value={price}
            onChange={onNumericChange(setPrice)} onWheel={ignoreScrollOnNumberInput}
            onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="350" />
          {/* The number a farmer has is the invoice total, so that is what
              the field asks for — and the division nobody wants to do in
              their head is shown back straight away, before saving. */}
          {perHead !== null && (
            <small className="hint">
              {formatMoney(perHead)} each, across {formatQty(perHeadOf)} head.
            </small>
          )}
        </label>
      )}

      {type === 'group' && (
        <label className="field">
          <span>How many?</span>
          <input type="number" inputMode="numeric" min="0" value={headcount}
            onChange={onNumericChange(setHeadcount, { integer: true })}
            onWheel={ignoreScrollOnNumberInput} onKeyDown={ignoreArrowKeysOnNumberInput}
            placeholder="75" />
        </label>
      )}

      {isPlanting && (
        <>
          <label className="field">
            <span>Crop</span>
            <select value={crop} onChange={(e) => setCrop(e.target.value)}>
              <option value="">— pick one —</option>
              {(cropList ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Variety (optional)</span>
            <input value={variety} onChange={(e) => setVariety(e.target.value)}
              placeholder="Salanova" />
          </label>
          <label className="field">
            <span>Where (optional)</span>
            <input value={where} onChange={(e) => setWhere(e.target.value)}
              placeholder="Bed 7" />
          </label>
          <p className="hint">
            Saving also records that you planted it today, so the season has a
            start date to measure from.
          </p>
        </>
      )}

      <button
        className="primary"
        disabled={busy || !type || !finalName || (isPlanting && !crop) || mustPickPurpose}
        onClick={run}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      {error && <p className="error">{error}</p>}
    </Sheet>
  )
}
