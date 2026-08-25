import { useEffect } from 'react'
import { useAsync } from '../lib/useAsync'
import { listAssets } from '../db/queries'
import type { AssetType } from '../db/types'

export function AssetSelect({
  value, onChange, types, label = 'Which one?', allowNone = true,
}: {
  value: string
  onChange: (v: string) => void
  types?: AssetType[]
  label?: string
  allowNone?: boolean
}) {
  const { data } = useAsync(() => listAssets(types), [types?.join(',')])
  // A group's individual members are reached through the group, same as on
  // the Stock tab — otherwise a 5-cow group lists as six confusing options
  // (the group, plus every animal split out of it) instead of one.
  const active = (data ?? []).filter((a) => a.status === 'active' && !a.parent_id)

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
        <small className="hint">Nothing added yet — see the Animals tab.</small>
      )}
    </label>
  )
}
