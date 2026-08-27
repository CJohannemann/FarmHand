import { useEffect } from 'react'
import { useAsync } from '../lib/useAsync'
import { listAssets } from '../db/queries'
import type { AssetType } from '../db/types'
import { producibleMaterial } from '../lib/tiles'

export function AssetSelect({
  value, onChange, types, materials, producing, label = 'Which one?', allowNone = true,
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
  label?: string
  allowNone?: boolean
}) {
  const { data } = useAsync(() => listAssets(types), [types?.join(',')])
  // A group's individual members are reached through the group, same as on
  // the Stock tab — otherwise a 5-cow group lists as six confusing options
  // (the group, plus every animal split out of it) instead of one. A
  // service-origin lot (a vet's office-call fee, a truck's fuel fill-up) is
  // spent the instant it's recorded, never something to draw stock from —
  // lotBalances() already keeps these out of Stores; this is the other
  // place a lot gets listed, so it needs the same exclusion.
  const ofType = (data ?? []).filter((a) => a.status === 'active' && !a.parent_id
    && a.attributes?.origin !== 'service')
  const active = ofType.filter(
    (a) => (!materials || materials.includes(String(a.attributes?.material ?? '')))
      && (!producing || producibleMaterial(a) === producing),
  )

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
      </select>
      {active.length === 0 && (
        <small className="hint">
          {(materials || producing) && ofType.length > 0
            ? 'None on hand in a matching category yet.'
            : 'Nothing added yet — see Inventory.'}
        </small>
      )}
    </label>
  )
}
