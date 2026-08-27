import { useEffect } from 'react'
import { useAsync } from '../lib/useAsync'
import { listAssets } from '../db/queries'
import type { AssetType } from '../db/types'
import { producibleMaterial } from '../lib/tiles'
import { sexRole } from '../lib/husbandry'

/** Sentinel `<option>` value for AssetSelect's `otherLabel` — never a real asset id. */
export const OTHER = '__other__'

export function AssetSelect({
  value, onChange, types, materials, producing, species, excludeId,
  includeGroupMembers, otherLabel, includeExternal, role, label = 'Which one?', allowNone = true,
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

  // Without a "— none —" option, a <select> with no matching value still
  // shows the first <option> — the browser picks it for display without
  // ever firing onChange. Sync the value so it isn't stuck at '' behind a
  // dropdown that looks filled in.
  useEffect(() => {
    if (!allowNone && !value && active.length > 0) onChange(active[0].id)
  }, [allowNone, value, active])

  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">— none —</option>}
        {active.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
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
