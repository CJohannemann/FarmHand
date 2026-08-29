/**
 * Which quick-entry tiles a farm should see.
 *
 * Hardcoding them meant a cattle-only farm stared at an Eggs button it would
 * never press, while a beekeeper had no way to record honey at all. The tiles
 * are derived from what the farm actually keeps instead.
 *
 * Pure and separately tested — the rules are small but easy to get subtly
 * wrong, and getting them wrong makes the first screen feel like it was built
 * for somebody else's farm.
 */

export interface TileSpec {
  kind: string
  label: string
  glyph: string
}

/** Everything a quick harvest needs to know to write itself. */
export interface HarvestSpec extends TileSpec {
  title: string
  prompt: string
  material: string
  unit: string
  measure: 'count' | 'weight' | 'volume'
  /** Which assets may be the subject. */
  from: ('animal' | 'group' | 'planting')[]
  placeholder: string
}

const LAYERS = ['Chicken', 'Duck', 'Goose', 'Turkey', 'Quail']
const MILKERS = ['Cattle', 'Goat', 'Sheep']
const BEES = ['Honeybee']

export type Purpose = 'eggs' | 'meat' | 'dairy' | 'wool'

/**
 * Which purposes are worth asking about for a species — shared by onboarding
 * and the Stock tab's Add/Edit forms, so "layers vs. broilers" is answerable
 * everywhere a species gets picked, not just at setup. Species left out have
 * no meaningful split (a Pig is a Pig), so neither form asks.
 */
export const SPECIES_PURPOSES: Record<string, Purpose[]> = {
  Chicken: ['eggs', 'meat'],
  Duck: ['eggs', 'meat'],
  Quail: ['eggs', 'meat'],
  Cattle: ['dairy', 'meat'],
  Goat: ['dairy', 'meat'],
  Sheep: ['wool', 'meat'],
}

/**
 * A fixed, short list — unlike species, this never needs a farm's own entry.
 *
 * "Attachment" rather than the catalogue's "implement": both name the same
 * thing hanging off the back of a tractor, and one of them is the word
 * people actually say.
 */
export const EQUIPMENT_KINDS = ['Tractor', 'Attachment', 'Vehicle', 'Other'] as const

/** Only Tractor and Vehicle have an engine worth naming a fuel for. */
export const FUEL_TYPES = ['Diesel', 'Gas', 'Electric', 'Other'] as const

export const HARVESTS: Record<string, HarvestSpec> = {
  eggs: {
    kind: 'eggs', label: 'Eggs', glyph: '🥚',
    title: 'Eggs collected', prompt: 'Quantity',
    material: 'Eggs', unit: 'each', measure: 'count',
    from: ['group', 'animal'], placeholder: '18',
  },
  milk: {
    kind: 'milk', label: 'Milk', glyph: '🥛',
    title: 'Milk collected', prompt: 'Quantity (gal)',
    material: 'Milk', unit: 'gal', measure: 'volume',
    from: ['animal', 'group'], placeholder: '4',
  },
  honey: {
    kind: 'honey', label: 'Honey', glyph: '🍯',
    title: 'Honey pulled', prompt: 'Quantity (lb)',
    material: 'Honey', unit: 'lb', measure: 'weight',
    from: ['group', 'animal'], placeholder: '30',
  },
  pick: {
    kind: 'pick', label: 'Pick', glyph: '🥬',
    title: 'Picked', prompt: 'Quantity (lb)',
    material: 'Produce', unit: 'lb', measure: 'weight',
    from: ['planting'], placeholder: '18',
  },
}

const FEED:  TileSpec = { kind: 'feed',   label: 'Feed',  glyph: '🌾' }
const BUY:   TileSpec = { kind: 'buy',    label: 'Buy',   glyph: '🧾' }
const NOTE:  TileSpec = { kind: 'note',   label: 'Note',  glyph: '📝' }
const PLAN:  TileSpec = { kind: 'plan',   label: 'Plan',  glyph: '📅' }

export interface AssetLike {
  type: string
  status?: string
  attributes?: Record<string, unknown> | null
}

/**
 * What one animal or group actually yields on an ongoing basis — the same
 * question tilesFor() asks farm-wide, asked of a single asset instead, so
 * AssetDetail's Collect button can offer eggs or milk only where one is
 * real. A beef herd and a dairy herd are both Cattle; only one of them
 * gives milk. `purpose` says which — unset defaults to worthy for a species
 * named here, since most groups never set it and the old species-only rule
 * should keep working.
 *
 * `category` is deliberately weaker than `species`: it only ever comes from
 * a custom entry someone typed under a heading, and "I keep this under
 * Livestock" is not a claim that it gives milk. An alpaca or a llama would
 * otherwise arrive with a Milk tile purely for having been added on the
 * livestock page. So a category-only match must say what it produces, and
 * an unset purpose there yields nothing.
 */
export function producibleMaterial(a: AssetLike): 'eggs' | 'milk' | 'honey' | null {
  const species = String(a.attributes?.species ?? '')
  const purpose = a.attributes?.purpose

  // Eggs stay permissive and milk does not, and the asymmetry is the point
  // rather than an oversight. A bird whose purpose nobody recorded almost
  // certainly lays — that is what backyard poultry is for — so guessing
  // right costs nothing and guessing wrong costs one unused tile. A bovine
  // whose purpose nobody recorded almost certainly does not milk: beef is
  // the common case by a wide margin, and the old rule put a Milk button on
  // the home screen of every farm that had ever added a cow. Reported
  // exactly that way, by someone with no dairy animals at all.
  if (LAYERS.includes(species) && (purpose === undefined || purpose === 'eggs')) return 'eggs'
  if (MILKERS.includes(species) && purpose === 'dairy') return 'milk'
  if (BEES.includes(species)) return 'honey'

  if (a.attributes?.category === 'poultry' && purpose === 'eggs') return 'eggs'
  if (a.attributes?.category === 'livestock' && purpose === 'dairy') return 'milk'
  return null
}

/**
 * Ordered by how often a farm would reach for each: what you collect daily
 * first, then chores, then the three that suit any farm.
 *
 * At most eight, and eight only on a farm that genuinely does all of it.
 * Treat and Weigh are not here: both belong to one specific animal, so they
 * live on that animal's own profile instead of asking "which one?" on a
 * screen meant to be one tap.
 */
export function tilesFor(assets: AssetLike[]): TileSpec[] {
  const live = assets.filter((a) => (a.status ?? 'active') === 'active')

  const eggWorthy = live.some((a) => producibleMaterial(a) === 'eggs')
  const milkWorthy = live.some((a) => producibleMaterial(a) === 'milk')
  const honeyWorthy = live.some((a) => producibleMaterial(a) === 'honey')

  const livestock = live.some((a) => a.type === 'animal' || a.type === 'group')
  const plantings = live.some((a) => a.type === 'planting')

  const tiles: TileSpec[] = []
  if (eggWorthy) tiles.push(HARVESTS.eggs)
  if (milkWorthy) tiles.push(HARVESTS.milk)
  if (plantings) tiles.push(HARVESTS.pick)
  if (honeyWorthy) tiles.push(HARVESTS.honey)
  if (livestock) tiles.push(FEED)

  // Buying, noting and planning suit every farm, including an empty one.
  tiles.push(BUY, NOTE, PLAN)
  return tiles
}

/**
 * Species where an unrecorded purpose would guess wrong, so the form insists.
 *
 * Only the milkers. Leaving a chicken's purpose blank is harmless —
 * producibleMaterial() reads it as a layer and is almost always right — but
 * leaving a cow's blank used to put a Milk tile on a beef farm's home
 * screen, and making it strict instead would silently take that tile away
 * from a dairy farm that skipped the chip. Asking is the only answer that
 * is right both ways.
 */
export function purposeRequired(species: string): boolean {
  return MILKERS.includes(species)
}
