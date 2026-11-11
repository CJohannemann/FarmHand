import { useState } from 'react'
import { didYouMean, suggestNames, type NameUse } from '../lib/nameMatch'

/**
 * A text field that offers the names already in use — the store, the
 * item, the kind — so the second person on the account picks "Lowe's"
 * instead of typing "Lowes", and "Pig feed" instead of "Hog feed".
 *
 * Suggestions sit under the field as buttons rather than in a <datalist>,
 * which iOS shows only above the keyboard, easy to miss. Something typed
 * that looks like a name already used, without being it, gets a "Did you
 * mean" first; anything genuinely new is saved as typed.
 */
export function NameInput({ label, value, onChange, used, placeholder, autoFocus }: {
  label: string
  value: string
  onChange: (v: string) => void
  used: NameUse[]
  placeholder?: string
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const meant = didYouMean(value, used)
  const offers = suggestNames(value, used).filter((u) => u.name !== meant)
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        autoFocus={autoFocus} autoComplete="off"
        onFocus={() => setFocused(true)}
        // Late enough that tapping a suggestion lands before it disappears.
        onBlur={() => setTimeout(() => setFocused(false), 150)} />
      {meant && (
        <span className="name-meant">
          Already used: <button type="button" className="chip on" onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(meant)}>{meant}</button> — tap to use it
        </span>
      )}
      {focused && offers.length > 0 && (
        <span className="chipwrap name-offers">
          {offers.map((u) => (
            <button key={u.name} type="button" className="chip"
              // Keep the field focused, so the list does not vanish mid-tap.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(u.name)}>
              {u.name}
            </button>
          ))}
        </span>
      )}
    </label>
  )
}
