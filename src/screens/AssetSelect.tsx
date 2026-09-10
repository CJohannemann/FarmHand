import { Fragment, useEffect } from 'react'
import { useAsync } from '../lib/useAsync'
import { listAssets } from '../db/queries'
import type { Asset, AssetType } from '../db/types'
import { producibleMaterial } from '../lib/tiles'
import { sexRole } from '../lib/husbandry'

/** Sentinel `<option>` value for AssetSelect's `otherLabel` — never a real asset id. */
export const OTHER = '__other__'

/**
 * What each kind of thing is called over its section of the list, in the
 * order a farm would look for them.
 *
 * "Herds & flocks" rather than "Groups": a group is what the schema calls
 * it, and nobody standing in a barn has ever called their layers a group.
 * Stores likewise matches the heading Inventory already uses for lots.
 */
const KIND_LABEL: Record<AssetType, string> = {
  animal: 'Animals',
  group: 'Herds & flocks',
  planting: 'Plantings',
  land: 'Land',
  structure: 'Buildings',
  equipment: 'Equipment',
  lot: 'Stores',
}

/** The order those sections appear in — roughly what a chore is likeliest for. */
const KIND_ORDER: AssetType[] = [
  'animal', 'group', 'planting', 'land', 'structure', 'equipment', 'lot',
]

/**
 * Splits a mixed list into labelled sections, one per kind.
 *
 * An unfiltered picker — "What for?" on a chore, "About what?" on a note —
 * is the whole farm in one dropdown, and alphabetical order files a
 * tractor between two pigs and puts the flock below the mineral block,
 * off the bottom of a phone's popup. The rows a farm wants are almost
 * always all of one kind, so the kinds are what the list should be cut
 * into. Same reasoning as the feeding dropdown's species sections.
 *
 * Order within a section is left exactly as listAssets() returned it —
 * live before closed out, then by name.
 *
 * Anything whose type is not in KIND_ORDER lands in a trailing "Other"
 * rather than being dropped. KIND_LABEL is a Record over AssetType, so
 * adding a type to the schema without naming it here is a type error — but
 * forgetting to add it to KIND_ORDER would not be, and a picker that
 * silently stops offering something is a far worse way to find that out
 * than one extra heading.
 */
function byKind(assets: Asset[]): { label: string; assets: Asset[] }[] {
  const out: { label: string; assets: Asset[] }[] = []
  const placed = new Set<string>()
  for (const type of KIND_ORDER) {
    const rows = assets.filter((a) => a.type === type)
    if (rows.length === 0) continue
    rows.forEach((a) => placed.add(a.id))
    out.push({ label: KIND_LABEL[type], assets: rows })
  }
  const rest = assets.filter((a) => !placed.has(a.id))
  if (rest.length > 0) out.push({ label: 'Other', assets: rest })
  return out
}

export function AssetSelect({
  value, onChange, types, materials, producing, species, excludeId,
  includeGroupMembers, otherLabel, includeExternal, role, label = 'Which one?', allowNone = true,
  autoSelectSingle,
}: {
  value: string
  onChange: (v: string) => void
  types?: AssetType[]
  /**
   * Narrows a lot list to what's actually relevant here — without it, "From
   * stores?" on a vet visit offered every lot the farm has ever bought,
   * fertilizer and a truck fill-up included, alongside actual medicine.
   */
  materials?: string[]
  /**
   * Narrows an animal/group list to whatever actually yields this — without
   * it, "Where from?" on an egg collection offered every animal and group
   * on the farm, cattle and pigs included alongside the actual layers.
   */
  producing?: 'eggs' | 'milk' | 'honey'
  /** A sire/dam is always the same species as the animal being edited. */
  species?: string
  /** An animal can't be its own parent. */
  excludeId?: string
  /**
   * A sire or dam is inherently one individual, unlike "which animal ate
   * this" — so a named member split out of a group needs to be pickable
   * here even though every other picker reaches it through the group
   * instead, to avoid a 5-cow group listing as six confusing options.
   */
  includeGroupMembers?: boolean
  /**
   * Adds a trailing option (value `OTHER`) for "it's not in this list" —
   * the caller decides what that means, typically revealing a free-text
   * field of its own once `value === OTHER`.
   */
  otherLabel?: string
  /**
   * An "external" asset — a sire/dam typed in once because it isn't real
   * stock, kept around only so the next animal can pick it instead of
   * retyping it — isn't a farm-day answer to "which animal," so every
   * other picker leaves it out by default.
   */
  includeExternal?: boolean
  /**
   * A Sire picker excludes known dams (and known-castrated males, which
   * are just as male but can't sire anything either); a Dam picker
   * excludes known sires. An animal with no sex recorded, or a juvenile
   * term (Calf, Piglet...) too young to say, is left in either list —
   * "unknown" isn't the same claim as "wrong."
   */
  role?: 'sire' | 'dam'
  label?: string
  allowNone?: boolean
  /**
   * When there's only one eligible option, pick it instead of leaving an
   * "optional" field blank for something that isn't actually a choice —
   * e.g. "Where from?" on an egg collection when the farm has exactly one
   * flock of layers. Left off elsewhere: a blank sire/dam or "From stores?"
   * genuinely can mean "none," so only opt a picker in when a pre-filled
   * value is always the right guess.
   */
  autoSelectSingle?: boolean
}) {
  const { data } = useAsync(() => listAssets(types), [types?.join(',')])
  // A service-origin lot (a vet's office-call fee, a truck's fuel fill-up)
  // is spent the instant it's recorded, never something to draw stock
  // from — lotBalances() already keeps these out of Stores; this is the
  // other place a lot gets listed, so it needs the same exclusion.
  const ofType = (data ?? []).filter((a) => a.status === 'active'
    && (includeGroupMembers || !a.parent_id)
    && (includeExternal || !a.attributes?.external)
    && a.attributes?.origin !== 'service')
  const active = ofType.filter((a) => {
    const wrongRole = role && (() => {
      const r = sexRole(String(a.attributes?.species ?? ''), String(a.attributes?.sex ?? ''))
      return r === 'neither' || (r !== 'unknown' && r !== role)
    })()
    return (!materials || materials.includes(String(a.attributes?.material ?? '')))
      && (!producing || producibleMaterial(a) === producing)
      && (!species || a.attributes?.species === species)
      && a.id !== excludeId
      && !wrongRole
  })

  const groups = byKind(active)

  // Without a "— none —" option, a <select> with no matching value still
  // shows the first <option> — the browser picks it for display without
  // ever firing onChange. Sync the value so it isn't stuck at '' behind a
  // dropdown that looks filled in.
  useEffect(() => {
    if (!allowNone && !value && active.length > 0) onChange(active[0].id)
    else if (allowNone && autoSelectSingle && !value && active.length === 1) onChange(active[0].id)
  }, [allowNone, autoSelectSingle, value, active])

  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">— none —</option>}
        {/* One <optgroup> per kind, but only once there is more than one
            kind to tell apart — a single heading over the whole list is a
            label saying what the picker already said. A <select> takes
            nothing but <option> and <optgroup> as children, so the flat
            case has to stay a Fragment rather than any real wrapper. */}
        {groups.length > 1
          ? groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.assets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </optgroup>
          ))
          : <Fragment>{active.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}</Fragment>}
        {otherLabel && <option value={OTHER}>{otherLabel}</option>}
      </select>
      {active.length === 0 && (
        <small className="hint">
          {(materials || producing || species) && ofType.length > 0
            ? 'None on hand in a matching category yet.'
            : 'Nothing added yet — see Inventory.'}
        </small>
      )}
    </label>
  )
}
