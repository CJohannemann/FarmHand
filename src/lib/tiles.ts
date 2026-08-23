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

const LAYERS = ['Chicken', 'Duck', 'Goose', 'Turkey']
const MILKERS = ['Cattle', 'Goat', 'Sheep']
const BEES = ['Honeybee']

export const HARVESTS: Record<string, HarvestSpec> = {
  eggs: {
    kind: 'eggs', label: 'Eggs', glyph: '🥚',
    title: 'Eggs collected', prompt: 'How many?',
    material: 'Eggs', unit: 'each', measure: 'count',
    from: ['group', 'animal'], placeholder: '18',
  },
  milk: {
    kind: 'milk', label: 'Milk', glyph: '🥛',
    title: 'Milk collected', prompt: 'How much (gal)?',
    material: 'Milk', unit: 'gal', measure: 'volume',
    from: ['animal', 'group'], placeholder: '4',
  },
  honey: {
    kind: 'honey', label: 'Honey', glyph: '🍯',
    title: 'Honey pulled', prompt: 'How much (lb)?',
    material: 'Honey', unit: 'lb', measure: 'weight',
    from: ['group', 'animal'], placeholder: '30',
  },
  pick: {
    kind: 'pick', label: 'Pick', glyph: '🥬',
    title: 'Picked', prompt: 'How much (lb)?',
    material: 'Produce', unit: 'lb', measure: 'weight',
    from: ['planting'], placeholder: '18',
  },
}

const WEIGH: TileSpec = { kind: 'weight', label: 'Weigh', glyph: '⚖️' }
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
 * Ordered by how often a farm would reach for each: what you collect daily
 * first, then chores, then the three that suit any farm.
 *
 * At most nine, which fills the three-column grid exactly — and nine only
 * happens on a farm that genuinely does all of it.
 */
export function tilesFor(assets: AssetLike[]): TileSpec[] {
  const live = assets.filter((a) => (a.status ?? 'active') === 'active')
  const species = new Set(
    live.map((a) => String(a.attributes?.species ?? '')).filter(Boolean),
  )
  const has = (list: string[]) => list.some((s) => species.has(s))

  const livestock = live.some((a) => a.type === 'animal' || a.type === 'group')
  const plantings = live.some((a) => a.type === 'planting')

  const tiles: TileSpec[] = []
  if (has(LAYERS)) tiles.push(HARVESTS.eggs)
  if (has(MILKERS)) tiles.push(HARVESTS.milk)
  if (plantings) tiles.push(HARVESTS.pick)
  if (has(BEES)) tiles.push(HARVESTS.honey)
  if (livestock) tiles.push(FEED, WEIGH)

  // Buying, noting and planning suit every farm, including an empty one.
  tiles.push(BUY, NOTE, PLAN)
  return tiles
}
