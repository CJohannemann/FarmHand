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
