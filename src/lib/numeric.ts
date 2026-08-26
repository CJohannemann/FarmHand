/**
 * Keeping negatives out of number fields.
 *
 * Every number this app asks for is a count, a weight, a dose or a price —
 * there is no such thing as -3 head of cattle or a -$40 bag of feed. The
 * `min="0"` attribute does not stop it: browsers only enforce min on form
 * submission and on the stepper arrows, so a typed or pasted "-5" sails
 * straight through to the database, where it quietly corrupts a lot
 * balance or a cost total that nothing later flags as wrong.
 *
 * So the value is filtered as it is typed instead. Kept as a pure string
 * function rather than a Number() round-trip because the field has to stay
 * usable mid-typing: "12." is on its way to "12.5" and must survive, and
 * clearing a field back to empty must stay possible.
 */

/**
 * Strips anything that is not a non-negative number. Returns the cleaned
 * string, which may be empty (a cleared field) or a partial number still
 * being typed ("12.").
 */
export function sanitizeNumeric(raw: string, opts?: { integer?: boolean }): string {
  // Drops minus signs wherever they appear, so neither "-5" nor a pasted
  // "1-2" can survive as something Number() would still parse.
  let out = raw.replace(opts?.integer ? /[^0-9]/g : /[^0-9.]/g, '')

  if (!opts?.integer) {
    // A second "." would make Number() return NaN, which reads as an empty
    // field and silently loses what was typed. Keep the first one only.
    const first = out.indexOf('.')
    if (first !== -1) {
      out = out.slice(0, first + 1) + out.slice(first + 1).replace(/\./g, '')
    }
  }
  return out
}

/**
 * Trims a float sum to something readable. Balances are summed in SQL, so
 * feeding 33.3 out of 100 lb three times leaves 0.10000000000000853 — true,
 * and not what anyone wants to read off a phone in a barn.
 */
export const roundQty = (n: number) => Math.round(n * 100) / 100

/** A dollar figure, always two decimals and comma-grouped: 28500 -> "$28,500.00". */
export function formatMoney(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

/**
 * A count or measurement, comma-grouped with no forced decimals — hours,
 * mileage, headcount, a lot balance. `roundQty` first, so a summed balance
 * displays the same trimmed value this used to show, just grouped: 32400 ->
 * "32,400", 33.30000000000001 -> "33.3".
 */
export function formatQty(n: number): string {
  return roundQty(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/**
 * Comma-groups the bare numbers inside a sentence someone else built —
 * SQL's `group_concat(value || ' ' || unit)` summaries ("28500.0 USD",
 * "18.0 each, 4.0 gal") being the one real caller. Never point this at text
 * that only looks numeric, like a serial number or a license plate — it
 * would cheerfully wreck a VIN.
 */
export function withThousands(text: string): string {
  return text.replace(/\d+(\.\d+)?/g, (match) => {
    const [intPart, decPart] = match.split('.')
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return decPart === undefined ? grouped : `${grouped}.${decPart}`
  })
}

/** Convenience for an onChange handler: sanitize, then hand to setState. */
export const onNumericChange =
  (set: (v: string) => void, opts?: { integer?: boolean }) =>
    (e: { target: { value: string } }) => set(sanitizeNumeric(e.target.value, opts))

/**
 * A trackpad scrolling past a number field, or a stray up/down arrow key
 * while it happens to have focus, otherwise silently nudges a headcount,
 * weight or price by one — a mis-tap that is easy to make and easy not to
 * notice. Both are opt-in browser conveniences for a <input type="number">,
 * not something any of these fields benefit from, so every one blocks them.
 */
export function ignoreScrollOnNumberInput(e: { currentTarget: { blur: () => void } }): void {
  e.currentTarget.blur()
}
export function ignoreArrowKeysOnNumberInput(
  e: { key: string; preventDefault: () => void },
): void {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault()
}
