// What to charge: what the animals being sold cost to raise.
//
// The number this produces is a price someone quotes to a customer, so the
// ways it can be wrong are the ways a farm loses money without noticing:
//
//  - feed nobody logged a feeding for silently left out (the reason this
//    screen exists — the per-animal Cost panel only sees traced feed),
//  - a bag counted twice, once where it was logged and again in the split,
//  - another species' share, or a pig long since sold, soaking up the cost,
//  - equipment creeping in, which the farmer asked to leave out.
//
// Runs the app's own statements (src/db/saleCostSql.ts) against the local
// schema in node:sqlite, then the app's own split (src/lib/saleCost.ts).
//
//   npm run verify:sale-cost
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import {
  SALE_COST_ANIMALS_SQL, SALE_COST_LOGS_SQL, SALE_COST_LOTS_SQL,
} from '../../src/db/saleCostSql.ts'
import { saleCosts, shareLabel, sharersFor, weightSalePrice, type CostAnimal } from '../../src/lib/saleCost.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

const uuid = () => crypto.randomUUID()
const run = (sql: string, params: unknown[] = []) =>
  db.prepare(sql).run(...params as never[])
/** The app's statements use $1 placeholders; the worker turns each into
 * its own `?` with the value repeated (expandParams() in src/db/worker.ts),
 * and so does this. */
const all = <T>(sql: string, params: unknown[] = []) => {
  const expanded: unknown[] = []
  const text = sql.replace(/\$(\d+)/g, (_, n: string) => { expanded.push(params[Number(n) - 1]); return '?' })
  return db.prepare(text).all(...expanded as never[]) as T[]
}

const farm = uuid()
const T0 = '2026-01-01T00:00:00.000Z'
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`, [farm, 'Ours', T0, T0])
run(`insert into active_farm (id) values (?)`, [farm])

const asset = (type: string, name: string, attributes: object, at: string,
  opts: { parent?: string; status?: string; farmId?: string } = {}) => {
  const id = uuid()
  run(`insert into asset (id, farm_id, type, name, status, parent_id, attributes, created_at, updated_at)
       values (?,?,?,?,?,?,?,?,?)`,
    [id, opts.farmId ?? farm, type, name, opts.status ?? 'active', opts.parent ?? null,
      JSON.stringify(attributes), at, at])
  return id
}
const log = (type: string, at: string,
  assets: { id: string; role?: string; amount?: number }[],
  quantities: { measure: string; value: number; unit: string }[] = [],
  opts: { status?: string; deleted?: boolean } = {}) => {
  const id = uuid()
  run(`insert into log (id, farm_id, type, timestamp, status, name, attributes, created_at, updated_at, deleted_at)
       values (?,?,?,?,?,?,?,?,?,?)`,
    [id, farm, type, at, opts.status ?? 'done', type, '{}', at, at, opts.deleted ? at : null])
  for (const a of assets) {
    run(`insert into log_asset (log_id, asset_id, role, amount) values (?,?,?,?)`,
      [id, a.id, a.role ?? 'subject', a.amount ?? null])
  }
  for (const q of quantities) {
    run(`insert into quantity (id, farm_id, log_id, measure, value, unit, created_at, updated_at)
         values (?,?,?,?,?,?,?,?)`, [uuid(), farm, id, q.measure, q.value, q.unit, at, at])
  }
  return id
}
const usd = (v: number) => ({ measure: 'price', value: v, unit: 'USD' })
const lb = (v: number) => ({ measure: 'weight', value: v, unit: 'lb' })

/** createPurchase(), as Today's Buy sheet calls it. */
const buy = (name: string, material: string, cost: number, at: string,
  opts: { category?: string; amount?: number; origin?: string } = {}) => {
  const lot = asset('lot', name, {
    origin: opts.origin ?? 'purchased', material,
    ...(opts.category ? { category: opts.category } : {}),
  }, at)
  log('purchase', at, [{ id: lot }],
    [usd(cost), ...(opts.amount ? [lb(opts.amount)] : [])])
  return lot
}
const feed = (subjects: string[], lot: string, at: string, amount?: number,
  opts: { status?: string } = {}) =>
  log('input_application', at,
    [...subjects.map((id) => ({ id })), { id: lot, role: 'input', amount }], [], opts)

/** Everything the screen does, from the database down. */
const costsFor = (species: string) => {
  const animals = all<{ id: string; name: string; parent_id: string | null
    arrived: string; left_at: string | null }>(SALE_COST_ANIMALS_SQL, [species])
    .map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, arrived: r.arrived, left: r.left_at }))
  const rows = all<{ log_id: string; type: 'purchase' | 'input_application'; timestamp: string
    asset_id: string; role: string; amount: number | null; price: number | null }>(
    SALE_COST_LOGS_SQL, [species])
    .map((r) => ({ logId: r.log_id, type: r.type, timestamp: r.timestamp, assetId: r.asset_id,
      role: r.role, amount: r.amount, price: r.price }))
  const lots = all<{ id: string; name: string; material: string | null; category: string | null
    purchased_at: string; price: number | null; bought: number | null }>(
    SALE_COST_LOTS_SQL, [species])
    .map((r) => ({ id: r.id, name: r.name, material: r.material, category: r.category,
      purchasedAt: r.purchased_at, price: r.price, bought: r.bought }))
  return { animals, result: saleCosts(species, animals, rows, lots) }
}

// --------------------------------------------------------------- the farm

// A pig sold in the spring, before this year's two arrived. Feed bought
// while it was here is its cost, not theirs.
const old = asset('animal', 'Spring pig', { species: 'Pig' }, '2026-01-10T00:00:00.000Z',
  { status: 'archived' })
log('sale', '2026-03-01T00:00:00.000Z', [{ id: old }], [usd(300)])
buy('Pig feed', 'Feed', 50, '2026-02-01T00:00:00.000Z', { category: 'Pig', amount: 50 })

// Two pigs bought in June. Entered into the app a week late, which is the
// common case — the purchase log is what says when they really came.
const A = asset('animal', 'Pinky', { species: 'Pig' }, '2026-06-08T00:00:00.000Z')
const B = asset('animal', 'Hamlet', { species: 'Pig' }, '2026-06-08T00:00:00.000Z')
log('purchase', '2026-06-01T00:00:00.000Z', [{ id: A }], [usd(100)])
log('purchase', '2026-06-01T00:00:00.000Z', [{ id: B }], [usd(120)])

// Feed bought the week before the pigs, marked for them. Nobody on the
// farm that day, so it belongs to whoever arrived next: A and B.
buy('Pig feed', 'Feed', 16, '2026-05-25T00:00:00.000Z', { category: 'Pig', amount: 50 })

// The everyday case: a marked bag tipped in the trough, never logged.
buy('Pig feed', 'Feed', 20, '2026-06-02T00:00:00.000Z', { category: 'Pig', amount: 50 })

// Half a marked bag logged to A; the other half never logged.
const half = buy('Pig feed', 'Feed', 30, '2026-06-10T00:00:00.000Z', { category: 'Pig', amount: 50 })
feed([A], half, '2026-06-11T00:00:00.000Z', 25)

// A bag nobody marked, fed to A without saying how much.
const plain = buy('Cracked corn', 'Feed', 12, '2026-06-12T00:00:00.000Z', { amount: 50 })
feed([A], plain, '2026-06-13T00:00:00.000Z')

// Hay shared between A and a goat. Half of it is the goat's.
const goat = asset('animal', 'Billy', { species: 'Goat' }, '2026-01-01T00:00:00.000Z')
const hay = buy('Hay', 'Hay', 8, '2026-06-14T00:00:00.000Z')
feed([A, goat], hay, '2026-06-15T00:00:00.000Z')

// A vet visit drawn on B, the way AssetDetail's treatment form records it.
const vet = buy('Vet visit', 'Vet', 40, '2026-06-20T00:00:00.000Z', { origin: 'service' })
feed([B], vet, '2026-06-20T00:00:00.000Z')

// Equipment. A feeder bought as a lot, even marked for pigs, and a feeder
// bought as equipment. Neither is a cost of these pigs.
buy('Pig feeder', 'Equipment', 279.99, '2026-06-03T00:00:00.000Z', { category: 'Pig' })
const feeder = asset('equipment', 'Feeder', { kind: 'Feeder' }, '2026-06-03T00:00:00.000Z')
log('purchase', '2026-06-03T00:00:00.000Z', [{ id: feeder }], [usd(150)])

// A feeding still on the calendar has not eaten anything yet, and a
// purchase deleted by mistake was never spent.
const later = buy('Pig feed', 'Feed', 99, '2026-06-21T00:00:00.000Z', { category: 'Pig', amount: 50 })
feed([A], later, '2026-12-01T00:00:00.000Z', 50, { status: 'planned' })
const gone = asset('lot', 'Pig feed', { origin: 'purchased', material: 'Feed', category: 'Pig' },
  '2026-06-22T00:00:00.000Z')
log('purchase', '2026-06-22T00:00:00.000Z', [{ id: gone }], [usd(500)], { deleted: true })

// A group of two weaners bought in July on one cheque, and a marked bag
// bought after they came — four pigs on the farm to share it.
const G = asset('group', 'Weaners', { species: 'Pig' }, '2026-07-01T00:00:00.000Z')
const C = asset('animal', 'Weaners 1', { species: 'Pig' }, '2026-07-01T00:00:00.000Z', { parent: G })
const D = asset('animal', 'Weaners 2', { species: 'Pig' }, '2026-07-01T00:00:00.000Z', { parent: G })
log('purchase', '2026-07-01T00:00:00.000Z', [{ id: G }], [usd(200)])
buy('Pig feed', 'Feed', 40, '2026-07-05T00:00:00.000Z', { category: 'Pig', amount: 50 })

// The group fed as one, measured: 10 lb of a 50 lb $25 bag, so $5 traced
// to the weaners ($2.50 each) and $20 left for all four.
const gbag = buy('Pig feed', 'Feed', 25, '2026-07-06T00:00:00.000Z', { category: 'Pig', amount: 50 })
feed([G], gbag, '2026-07-07T00:00:00.000Z', 10)

// Another farm on the same device, with a pig and a marked bag of its own.
const other = uuid()
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`, [other, 'Next door', T0, T0])
asset('animal', 'Their pig', { species: 'Pig' }, '2026-06-01T00:00:00.000Z', { farmId: other })
const theirs = asset('lot', 'Pig feed', { origin: 'purchased', material: 'Feed', category: 'Pig' },
  '2026-06-02T00:00:00.000Z', { farmId: other })
run(`insert into log (id, farm_id, type, timestamp, status, name, attributes, created_at, updated_at)
     values (?,?,'purchase',?,'done','Bought',?,?,?)`,
  [uuid(), other, '2026-06-02T00:00:00.000Z', '{}', T0, T0])
void theirs

// ---------------------------------------------------------------------------
const { animals, result } = costsFor('Pig')
const c = (id: string) => result.byAnimal.get(id)!

console.log('\nWho counts as a pig, and when they were here')
check('this farm\'s five pigs, not the neighbour\'s and not the goat',
  animals.length === 5, animals.map((a) => a.name).join(', '))
const pinky = animals.find((a) => a.id === A)!
check('arrived dates from the purchase, not from when it was typed in',
  pinky.arrived === '2026-06-01T00:00:00.000Z', pinky.arrived)
check('a pig still here has not left', pinky.left === null)
const spring = animals.find((a) => a.id === old)!
check('a sold pig left on the day of its sale', spring.left === '2026-03-01T00:00:00.000Z',
  String(spring.left))
const weaner = animals.find((a) => a.id === C)!
check('a group member arrived with its group\'s purchase',
  weaner.arrived === '2026-07-01T00:00:00.000Z', weaner.arrived)

console.log('\nWhat each was bought for')
check('A: its own purchase', near(c(A).bought, 100), String(c(A).bought))
check('B: its own purchase', near(c(B).bought, 120), String(c(B).bought))
check('a group bought on one cheque splits it between members',
  near(c(C).bought, 100) && near(c(D).bought, 100), `${c(C).bought}, ${c(D).bought}`)

console.log('\nMarked feed nobody logged is split across the pigs here that day')
// B: 8 (May bag, shared with A) + 10 (June 2 bag) + 7.5 (unlogged half of
// June 10 bag) + 49.5 (June 21 bag, whose only feeding is still planned)
// + 10 (July 5 bag, four ways) + 5 (July 6 remainder, four ways)
check('B\'s share', near(c(B).feedShared, 8 + 10 + 7.5 + 49.5 + 10 + 5), String(c(B).feedShared))
check('A gets the same share of the same bags', near(c(A).feedShared, c(B).feedShared))
check('the weaners only share the bags bought after they came',
  near(c(C).feedShared, 10 + 5), String(c(C).feedShared))
check('the spring pig carries the bag bought while it alone was here',
  near(c(old).feedShared, 50), String(c(old).feedShared))

console.log('\nLogged feed goes to who ate it, and is counted once')
// A: 15 (half the June 10 bag) + 12 (unmarked corn, amount unknown → whole
// bag) + 4 (half the hay; the other half is the goat's)
check('A\'s logged feed', near(c(A).feedLogged, 15 + 12 + 4), String(c(A).feedLogged))
check('B ate none of it', near(c(B).feedLogged, 0), String(c(B).feedLogged))
check('a group fed as one splits the draw between its members',
  near(c(C).feedLogged, 2.5) && near(c(D).feedLogged, 2.5), `${c(C).feedLogged}`)

console.log('\nVet visits and other inputs')
check('B\'s vet visit is B\'s', near(c(B).other, 40), String(c(B).other))
check('and nobody else\'s', near(c(A).other, 0))

console.log('\nLeft out')
const everyone = [...result.byAnimal.values()].reduce((s, x) => s + x.total, 0)
// Purchases of the pigs, every marked bag, the corn, the pigs' half of the
// hay and the vet. Not the goat's half, the feeders, the deleted bag, or
// the spring pig's sale price, which is income rather than cost.
const expected = 100 + 120 + 200
  + 50 + 16 + 20 + 30 + 99 + 40 + 25
  + 12 + 4 + 40
check('equipment, deleted purchases and the goat\'s hay add nothing',
  near(everyone, expected), `${everyone.toFixed(2)} vs ${expected}`)
check('a planned feeding charges nothing to the pig it names',
  near(c(A).feedLogged, 15 + 12 + 4) && near(c(A).feedShared, c(B).feedShared))
check('marked spend is every marked Feed/Hay/Mineral purchase, equipment excluded',
  near(result.markedSpend, 50 + 16 + 20 + 30 + 99 + 40 + 25), String(result.markedSpend))
check('the deleted $500 bag is not in it', result.markedCount === 7, String(result.markedCount))

check('A\'s total: bought, its logged feed, its share of the rest',
  near(c(A).total, 100 + (15 + 12 + 4) + (8 + 10 + 7.5 + 49.5 + 10 + 5)), String(c(A).total))

console.log('\nNobody to charge it to')
const sheep = asset('animal', 'Dolly', { species: 'Sheep' }, '2026-01-01T00:00:00.000Z',
  { status: 'archived' })
log('sale', '2026-02-01T00:00:00.000Z', [{ id: sheep }], [usd(150)])
buy('Sheep mix', 'Feed', 18, '2026-04-01T00:00:00.000Z', { category: 'Sheep' })
const sheepCosts = costsFor('Sheep').result
check('a bag bought after the last sheep left is reported, not charged',
  near(sheepCosts.unassigned, 18) && near(sheepCosts.byAnimal.get(sheep)!.total, 0),
  String(sheepCosts.unassigned))

console.log('\nsharersFor')
const herd: CostAnimal[] = [
  { id: 'x', name: 'x', parentId: null, arrived: '2026-01-01T00:00:00.000Z', left: '2026-02-01T00:00:00.000Z' },
  { id: 'y', name: 'y', parentId: null, arrived: '2026-03-01T00:00:00.000Z', left: null },
]
check('on hand that day', sharersFor(herd, '2026-01-15T00:00:00.000Z').map((a) => a.id).join() === 'x')
check('a gap between batches goes to the next batch',
  sharersFor(herd, '2026-02-15T00:00:00.000Z').map((a) => a.id).join() === 'y')

console.log('\nTwo of a pen of four sold; the pen is still fed as one')
// A separate species keeps this pen's numbers apart from the pigs above.
const pen = asset('group', 'Pen', { species: 'Hog' }, '2026-08-01T00:00:00.000Z')
const hogs = [1, 2, 3, 4].map((i) =>
  asset('animal', `Pen ${i}`, { species: 'Hog' }, '2026-08-01T00:00:00.000Z', { parent: pen }))
// Before the sale: all four eat, $40 of a 40 lb $40 bag → $10 each.
const before = buy('Hog feed', 'Feed', 40, '2026-08-02T00:00:00.000Z', { category: 'Hog', amount: 40 })
feed([pen], before, '2026-08-03T00:00:00.000Z', 40)
// Two go to the butcher, sold by hanging weight with no price yet.
for (const h of hogs.slice(0, 2)) {
  run(`update asset set status = 'archived', terminal_event = 'sold' where id = ?`, [h])
  log('sale', '2026-10-20T00:00:00.000Z', [{ id: h }])
}
// After it: the same pen fed, $20 of a 20 lb $20 bag — the two left eat it.
const after = buy('Hog feed', 'Feed', 20, '2026-10-21T00:00:00.000Z', { category: 'Hog', amount: 20 })
feed([pen], after, '2026-10-22T00:00:00.000Z', 20)
const hog = costsFor('Hog').result
const fed = (i: number) => hog.byAnimal.get(hogs[i])!.feedLogged
check('the two sold pigs carry only the feed from before they left',
  near(fed(0), 10) && near(fed(1), 10), `${fed(0)}, ${fed(1)}`)
check('the two still here split the feeding after the sale',
  near(fed(2), 20) && near(fed(3), 20), `${fed(2)}, ${fed(3)}`)

console.log('\nWhat a hanging-weight sale comes to')
check('rate times weight', weightSalePrice({ ratePerLb: 4.5, processingFee: 0 }, 180) === 810)
check('plus a processing fee the farm collects',
  weightSalePrice({ ratePerLb: 4.5, processingFee: 95 }, 180) === 905)
check('rounded to the cent',
  weightSalePrice({ ratePerLb: 3.33, processingFee: 0 }, 101.5) === 338, // 337.995
  String(weightSalePrice({ ratePerLb: 3.33, processingFee: 0 }, 101.5)))

console.log('\nHalf a hog each')
// One 180 lb carcass at $4.50, split between two families: each pays for
// their half of the weight, plus their own processing fee if the farm
// collects it.
const halfHog = (fee: number) => weightSalePrice({ ratePerLb: 4.5, processingFee: fee, share: 0.5 }, 180)
check('a half is half the carcass at the rate', halfHog(0) === 405, String(halfHog(0)))
check('the fee is that buyer\'s whole fee, not halved', halfHog(60) === 465, String(halfHog(60)))
check('the two halves add up to the whole hog', halfHog(0) * 2 === weightSalePrice({ ratePerLb: 4.5, processingFee: 0 }, 180))
check('a quarter', weightSalePrice({ ratePerLb: 6, processingFee: 0, share: 0.25 }, 400) === 600)
check('shares read as fractions', shareLabel(0.5) === '½' && shareLabel(1 / 3) === '⅓' && shareLabel(0.75) === '¾')
check('and anything unusual as a percentage', shareLabel(0.2) === '20%', shareLabel(0.2))

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
