import { useState } from 'react'
import { didYouMean, suggestNames, type NameUse } from '../lib/nameMatch'

/**
 * A text field with a dropdown of the names already in use — the store,
 * the item, the kind — so the second person on the account picks "Lowe's"
 * instead of typing "Lowes", and "Pig feed" instead of "Hog feed".
 *
 * The list narrows with every letter, capitals ignored: "t" leaves only
 * what starts with T (see suggestNames). It sits in the page under the
 * field rather than in a <datalist>, which iOS shows only above the
 * keyboard; and it is a scrolling list rather than a row of buttons, which
 * a farm with twenty stores would turn into a wall. Something new gets a
 * last line saying it will be added as typed.
 *
 * Once the field is left, a name that looks like one already used without
 * being it gets "Already used: Lowe's — tap to use it".
 */
export function NameInput({ label, value, onChange, used, placeholder, autoFocus, noun = 'name' }: {
  label: string
  value: string
  onChange: (v: string) => void
  used: NameUse[]
  placeholder?: string
  autoFocus?: boolean
  /** What one of these is called, for "Add … as a new store". */
  noun?: string
}) {
  const [open, setOpen] = useState(false)
  const typed = value.trim()
  const offers = suggestNames(value, used)
  const exact = used.some((u) => u.name.toLowerCase() === typed.toLowerCase())
  // Not after one or two letters while the list is still narrowing —
  // 'Add "t" as a new store' is noise — only once nothing matches, or
  // enough is typed to be a name.
  const isNew = !!typed && !exact && (offers.length === 0 || typed.length >= 3)
  const meant = didYouMean(value, used)

  // Picking keeps the field's own focus, so the list can close on its own
  // terms instead of the blur racing the tap.
  const pick = (name: string) => { onChange(name); setOpen(false) }
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()

  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off"
        role="combobox" aria-expanded={open} aria-autocomplete="list"
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setOpen(false) }} />
      {open && (offers.length > 0 || isNew) && (
        <ul className="name-dropdown" role="listbox">
          {offers.map((u) => (
            <li key={u.name} role="option" aria-selected={false}
              onMouseDown={keepFocus} onClick={() => pick(u.name)}>
              <span>{u.name}</span>
              {u.count > 0 && <small>{u.count}×</small>}
            </li>
          ))}
          {isNew && (
            <li role="option" aria-selected={false} className="name-new"
              onMouseDown={keepFocus} onClick={() => setOpen(false)}>
              Add "{typed}" as a new {noun}
            </li>
          )}
        </ul>
      )}
      {!open && meant && (
        <span className="name-meant">
          Already used: <button type="button" className="chip on" onClick={() => onChange(meant)}>
            {meant}</button> — tap to use it
        </span>
      )}
    </label>
  )
}
