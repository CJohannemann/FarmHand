import { AssetSelect } from './AssetSelect'

/**
 * A sire or dam — pick one already on this farm, or, for a parent bought
 * or bred elsewhere, just type its name. The two are mutually exclusive:
 * picking one clears the other, since a single fact can't be both a real
 * record and a plain name at once.
 */
export function ParentField({
  label, species, excludeId, id, onId, name, onName,
}: {
  label: string
  species: string
  excludeId?: string
  id: string
  onId: (v: string) => void
  name: string
  onName: (v: string) => void
}) {
  return (
    <>
      <AssetSelect value={id} onChange={(v) => { onId(v); if (v) onName('') }}
        types={['animal']} species={species} excludeId={excludeId} includeGroupMembers
        label={`${label} (optional)`} />
      {!id && (
        <label className="field">
          <span>Or type a name — not on this farm</span>
          <input value={name} onChange={(e) => onName(e.target.value)} placeholder="Duke" />
        </label>
      )}
    </>
  )
}
