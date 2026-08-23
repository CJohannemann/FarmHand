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
  const active = (data ?? []).filter((a) => a.status === 'active')

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
