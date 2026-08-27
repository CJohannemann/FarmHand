import { AssetSelect, OTHER } from './AssetSelect'

/**
 * A sire or dam — pick one already on this farm, or "Other" for a parent
 * bought or bred elsewhere, which reveals a plain-text name field. The
 * three states are mutually exclusive: picking a real record or switching
 * back to "— none —" both clear whatever name was typed.
 *
 * Saving with a typed name (see EditAsset/Stock's save()) turns it into a
 * minimal "external" asset behind the scenes rather than a bare string, so
 * it shows up as a normal pick here next time — buying five calves off the
 * same outside bull means typing his name once, not five times.
 * `includeExternal` is what makes those show up in this one picker despite
 * being hidden everywhere else (they're not real stock to feed or weigh).
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
      <AssetSelect value={id} onChange={(v) => { onId(v); if (v !== OTHER) onName('') }}
        types={['animal']} species={species} excludeId={excludeId}
        includeGroupMembers includeExternal
        otherLabel="Other — not on this farm" label={`${label} (optional)`} />
      {id === OTHER && (
        <label className="field">
          <span>{label}'s name</span>
          <input autoFocus value={name} onChange={(e) => onName(e.target.value)}
            placeholder="Duke" />
        </label>
      )}
    </>
  )
}
