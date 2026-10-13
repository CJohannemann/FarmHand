/**
 * What an animal cost to raise, for working out what to charge for it.
 *
 * assetCosts() answers the same question for one animal, but only from what
 * was traced to it: its purchase and the feedings that named a bag. On a
 * real farm most feed never gets a feeding log — the bag is bought, tipped
 * into the trough and forgotten — so that figure runs well under what was
 * actually spent, and pricing a pig off it sells at a loss.
 *
 * This adds the money that was spent *for* the species without being traced
 * to anyone: every Feed/Hay/Mineral purchase marked "For: Pig". Whatever part
 * of such a bag was logged at a feeding is charged to the animals fed, the
 * same way assetCosts() does it; whatever was never logged is split evenly
 * across the pigs on the farm the day it was bought. Never both — a bag is
 * one price, and it is counted once.
 *
 * Equipment is left out on purpose. A feeder outlasts any one batch of pigs
 * and nobody can say how many it will see, so any share of it charged here
 * would be a guess dressed up as a cost.
 *
 * Pure: the rows come from saleCostInputs() in queries.ts, so this can be
 * tested without a database.
 */

/** Materials whose purchases can be marked for one species — the same list
 * as CATEGORIZABLE_MATERIALS in queries.ts, which is what offers the field.
 * Also what counts as feed rather than "other" on the breakdown. */
const FEED_MATERIALS = ['Feed', 'Hay', 'Mineral']

export interface CostAnimal {
  id: string
  name: string
  parentId: string | null
  /** When it came onto the farm — ISO timestamp. */
  arrived: string
  /** When it left, or null if it is still here. */
  left: string | null
}

/** One log_asset row of a purchase or feeding touching this species. */
export interface CostLogRow {
  logId: string
  type: 'purchase' | 'input_application'
  timestamp: string
  assetId: string
  role: string
  /** How much of an input lot this feeding drew, if anyone typed it. */
  amount: number | null
  /** The log's price, for a purchase. */
  price: number | null
}

export interface CostLot {
  id: string
  name: string
  material: string | null
  category: string | null
  /** When it was bought — ISO timestamp. */
  purchasedAt: string
  price: number | null
  /** How much was bought, in the lot's own unit, if recorded. */
  bought: number | null
}

export interface AnimalCost {
  /** Its own purchase, or its share of the group's. */
  bought: number
  /** Feed traced to it at feedings, whether or not the bag was marked. */
  feedLogged: number
  /** Its even share of marked feed nobody logged a feeding for. */
  feedShared: number
  /** Vet visits, medicine, anything else drawn on it at a feeding/treatment. */
  other: number
  total: number
}

export interface SaleCostResult {
  byAnimal: Map<string, AnimalCost>
  /** Everything spent on purchases marked for this species. */
  markedSpend: number
  /** Of that, what was bought while none of this species were on the farm
   * and none arrived after — there is no animal to charge it to. */
  unassigned: number
  /** How many marked purchases went in. */
  markedCount: number
}

const ms = (iso: string) => new Date(iso).getTime()

/** Animals here at `t`: arrived by then and not yet gone. */
function onHandAt(animals: CostAnimal[], t: number): CostAnimal[] {
  return animals.filter((a) => ms(a.arrived) <= t && (a.left == null || ms(a.left) >= t))
}

/**
 * Who a marked bag nobody logged is shared by: the animals here the day it
 * was bought. Feed is usually bought a day or a week ahead of the animals
 * it is for, so a bag bought with none on the farm goes to whichever
 * arrive next rather than to nobody.
 */
export function sharersFor(animals: CostAnimal[], purchasedAt: string): CostAnimal[] {
  const t = ms(purchasedAt)
  const here = onHandAt(animals, t)
  if (here.length > 0) return here
  const next = animals.map((a) => ms(a.arrived)).filter((m) => m > t)
  if (next.length === 0) return []
  return onHandAt(animals, Math.min(...next))
}

export function saleCosts(
  species: string,
  animals: CostAnimal[],
  rows: CostLogRow[],
  lots: CostLot[],
): SaleCostResult {
  const byAnimal = new Map<string, AnimalCost>()
  for (const a of animals) {
    byAnimal.set(a.id, { bought: 0, feedLogged: 0, feedShared: 0, other: 0, total: 0 })
  }
  const members = new Map<string, string[]>()
  for (const a of animals) {
    if (!a.parentId) continue
    const list = members.get(a.parentId)
    if (list) list.push(a.id); else members.set(a.parentId, [a.id])
  }
  /**
   * A subject as the animals it stands for, each with its fraction. A group
   * fed or bought as one spreads evenly over its members; an asset of some
   * other species stands for nobody here, but still takes its share of the
   * log so these animals are not charged for what it ate.
   */
  const expand = (id: string): [string, number][] => {
    if (byAnimal.has(id)) return [[id, 1]]
    const m = members.get(id)
    return m ? m.map((x) => [x, 1 / m.length]) : []
  }

  const logs = new Map<string, CostLogRow[]>()
  for (const r of rows) {
    const list = logs.get(r.logId)
    if (list) list.push(r); else logs.set(r.logId, [r])
  }

  // Per input lot: each animal's share of what was drawn, and the same
  // summed over every subject (other species included) to divide by.
  interface Draw { amount: Map<string, number>; weight: Map<string, number>
    totalAmount: number; totalWeight: number; unknownAmount: boolean }
  const draws = new Map<string, Draw>()

  for (const entries of logs.values()) {
    const subjects = entries.filter((e) => e.role === 'subject')
    if (subjects.length === 0) continue
    const first = entries[0]

    if (first.type === 'purchase') {
      // Several animals bought on one cheque split it evenly — the only
      // split the record supports, same as assetCosts().
      const price = first.price ?? 0
      for (const s of subjects) {
        for (const [id, f] of expand(s.assetId)) {
          byAnimal.get(id)!.bought += price / subjects.length * f
        }
      }
      continue
    }

    for (const input of entries.filter((e) => e.role === 'input')) {
      let d = draws.get(input.assetId)
      if (!d) {
        d = { amount: new Map(), weight: new Map(), totalAmount: 0, totalWeight: 0, unknownAmount: false }
        draws.set(input.assetId, d)
      }
      if (input.amount == null) d.unknownAmount = true
      else d.totalAmount += input.amount
      d.totalWeight += 1
      for (const s of subjects) {
        for (const [id, f] of expand(s.assetId)) {
          const share = f / subjects.length
          d.weight.set(id, (d.weight.get(id) ?? 0) + share)
          if (input.amount != null) d.amount.set(id, (d.amount.get(id) ?? 0) + input.amount * share)
        }
      }
    }
  }

  let markedSpend = 0
  let unassigned = 0
  let markedCount = 0

  for (const lot of lots) {
    const price = lot.price ?? 0
    // A lot with no live purchase behind it (its purchase deleted) cost
    // nothing that is still on the books.
    const marked = lot.category === species && FEED_MATERIALS.includes(lot.material ?? '')
      && lot.price != null
    const isFeed = FEED_MATERIALS.includes(lot.material ?? '')
    if (marked) { markedSpend += price; markedCount++ }
    const d = draws.get(lot.id)

    let charged = 0
    if (d) {
      // Amounts on every feeding and a known size of bag: charge what was
      // drawn, and leave the rest of the bag for the even split below.
      // Otherwise there is nothing to measure by, so the bag goes to the
      // animals it was fed to, in proportion to how often.
      const measured = !d.unknownAmount && (lot.bought ?? 0) > 0
      const denom = measured ? Math.max(lot.bought!, d.totalAmount) : d.totalWeight
      const per = measured ? d.amount : d.weight
      for (const [id, x] of per) {
        const c = price * x / denom
        const row = byAnimal.get(id)!
        if (isFeed) row.feedLogged += c; else row.other += c
      }
      // Counted over every subject, other species included: their share of
      // the bag is theirs, not left over to split among these animals.
      charged = measured ? price * Math.min(d.totalAmount / lot.bought!, 1) : price
    }

    if (!marked) continue
    const rest = price - charged
    if (rest <= 0.000001) continue
    const sharers = sharersFor(animals, lot.purchasedAt)
    if (sharers.length === 0) { unassigned += rest; continue }
    for (const a of sharers) byAnimal.get(a.id)!.feedShared += rest / sharers.length
  }

  for (const c of byAnimal.values()) c.total = c.bought + c.feedLogged + c.feedShared + c.other
  return { byAnimal, markedSpend, unassigned, markedCount }
}
