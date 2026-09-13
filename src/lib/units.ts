import type { Measure } from '../db/types'

/**
 * What kind of quantity a unit measures.
 *
 * The forms that record a quantity don't ask — a farmer picking "gal" has
 * already said everything there is to say about whether that's a volume,
 * and a second dropdown asking them to confirm it would be a worse app.
 * So the unit is the only signal, and this is where it gets read.
 *
 * It matters because `measure` is what the balance queries group on
 * (lotBalances counts weight, count and volume alike, so getting this wrong
 * doesn't lose stock) and what Analytics reads to decide what a number
 * means. Twenty-four eggs recorded as a weight is not wrong by enough to
 * break anything, and wrong enough to be embarrassing in a report.
 *
 * Weight is the fallback for anything unlisted, including a unit a farm
 * typed in itself: it's the commonest case by a wide margin, and it's what
 * every one of these callsites assumed before this existed.
 */
const COUNTED = ['each', 'head', 'dozen', 'bale', 'jar']
// Bushels are a dry volume, whatever a farm stacks them in.
const POURED = ['gal', 'qt', 'pt', 'fl oz', 'L', 'mL', 'bushel']

export function measureForUnit(unit: string | null | undefined): Measure {
  const u = String(unit ?? '').trim()
  if (COUNTED.includes(u)) return 'count'
  if (POURED.includes(u)) return 'volume'
  return 'weight'
}

/**
 * How the unit picker is cut up — for display only, deliberately NOT the
 * same thing as measureForUnit above.
 *
 * They look like they should be one table and must not be. `measure` is
 * what gets stored on a quantity, and lotBalances only counts a withdrawal
 * whose measure is weight, count or volume — so classifying feet as
 * 'length' would quietly stop 50 ft drawn off a 200 ft roll from reducing
 * the roll. Grouping a dropdown carries no such risk, so it can say what a
 * foot really is while the stored measure stays what the balance queries
 * understand.
 *
 * Ordered by how often a farm reaches for each, not alphabetically. The
 * list was alphabetical, which filed "hour" between "head" and "jar" and
 * read as no order at all.
 */
const UNIT_GROUPS: { label: string; units: string[] }[] = [
  { label: 'Weight', units: ['lb', 'oz', 'kg', 'g', 'ton'] },
  { label: 'Volume', units: ['gal', 'qt', 'pt', 'fl oz', 'L', 'mL', 'bushel'] },
  { label: 'Count', units: ['each', 'head', 'dozen', 'Square Bale', 'Round Bale', 'jar'] },
  { label: 'Length', units: ['ft', 'in', 'yd', 'm'] },
  { label: 'Area', units: ['acre', 'sq ft', 'ha'] },
  { label: 'Time', units: ['hour', 'minute'] },
]

/**
 * The farm's units, in sections. Anything unrecognised — a unit typed in
 * by the farm itself, or one added to the vocabulary after this table —
 * falls to a trailing "Other" rather than being dropped, so a picker can
 * never quietly stop offering something.
 */
export function groupUnits(units: string[]): { label: string; units: string[] }[] {
  const out: { label: string; units: string[] }[] = []
  const placed = new Set<string>()
  for (const g of UNIT_GROUPS) {
    const rows = g.units.filter((u) => units.includes(u))
    if (rows.length === 0) continue
    rows.forEach((u) => placed.add(u))
    out.push({ label: g.label, units: rows })
  }
  const rest = units.filter((u) => !placed.has(u))
  if (rest.length > 0) out.push({ label: 'Other', units: rest })
  return out
}
