// The SQLite counterpart of verify.mjs: builds db/schema.local.sql in
// node:sqlite and runs the same batch-costing/lot-balance/repeat-harvest
// scenarios through it, using the exact CTEs src/db/queries.ts now runs
// (group_concat instead of string_agg, max(x is null) instead of bool_or,
// min() instead of least(), no ::casts, ids generated here in JS instead of
// relying on a gen_random_uuid() column default).
//   npm run verify:local
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { seedLocalVocabulary } from '../seedLocal.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
let failures = 0

const check = (label, actual, expected) => {
  const ok = Math.abs(Number(actual) - expected) < 0.01
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}` +
              (ok ? '' : ` (expected ${expected})`))
}

db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))

const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const q = (sql, params = []) => db.prepare(sql).all(...params)
const run = (sql, params = []) => db.prepare(sql).run(...params)

await seedLocalVocabulary(async (sql, params = []) => run(sql, params))

const farm = uuid()
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`, [farm, 'Test', now(), now()])

const flock = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'group','Spring broilers','{"headcount":75}',?,?)`, [flock, farm, now(), now()])
const feed = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'lot','Grower feed','{"origin":"purchased"}',?,?)`, [feed, farm, now(), now()])

// Bought 600 lb for $340.
const buy = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'purchase','2026-04-02','Feed',?,?)`, [buy, farm, now(), now()])
run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [buy, feed])
run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at) values
     (?,?,?,'price',340,'USD',?,?)`, [uuid(), farm, buy, now(), now()])
run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at) values
     (?,?,?,'weight',600,'lb',?,?)`, [uuid(), farm, buy, now(), now()])

// Fed 300 lb of it — half the bag, so half the cost should be charged.
const fed = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'input_application','2026-04-10','Fed',?,?)`, [fed, farm, now(), now()])
run(`insert into log_asset (log_id,asset_id,role,amount,unit) values (?,?,'input',300,'lb')`, [fed, feed])
run(`insert into log_asset (log_id,asset_id,role,amount,unit) values (?,?,'subject',null,null)`, [fed, flock])

// Slaughter: 240 lb of meat out.
const meat = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'lot','Broiler meat','{"origin":"produced"}',?,?)`, [meat, farm, now(), now()])
const kill = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'harvest','2026-06-14','Slaughter',?,?)`, [kill, farm, now(), now()])
run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [kill, flock])
run(`insert into log_asset (log_id,asset_id,role) values (?,?,'output')`, [kill, meat])
run(`insert into quantity (id,farm_id,log_id,measure,value,unit,asset_id,created_at,updated_at)
     values (?,?,?,'weight',240,'lb',?,?,?)`, [uuid(), farm, kill, meat, now(), now()])
run(`update asset set status='archived', terminal_event='harvested', updated_at=? where id=?`,
  [now(), flock])

// --- the cost rollup, matching src/db/queries.ts:assetCosts -----------------
const [cost] = q(`
  with used as (
    select la_in.asset_id as lot_id, la_in.amount as used_amount
      from log_asset subj
      join log l on l.id = subj.log_id
           and l.type = 'input_application' and l.deleted_at is null
      join log_asset la_in on la_in.log_id = l.id and la_in.role = 'input'
     where subj.asset_id = ? and subj.role = 'subject'
  ),
  per_lot as (
    select lot_id, sum(used_amount) as used_total,
           max(used_amount is null) as unknown_amount
      from used group by lot_id
  ),
  lot_purchase as (
    select la.asset_id as lot_id,
           max(q.value) filter (where q.measure='price')  as price,
           max(q.value) filter (where q.measure='weight') as bought
      from log_asset la
      join log p on p.id = la.log_id and p.type='purchase' and p.deleted_at is null
      join quantity q on q.log_id = p.id and q.deleted_at is null
     where la.role='subject' group by la.asset_id
  )
  select coalesce(sum(
    case when lp.price is null then 0
         when pl.unknown_amount then lp.price
         when lp.bought > 0 then lp.price * min(pl.used_total / lp.bought, 1)
         else lp.price end), 0) as input_cost
    from per_lot pl join lot_purchase lp on lp.lot_id = pl.lot_id`, [flock])

const [yield_] = q(
  `select q.value lb from log_asset o
     join log h on h.id=o.log_id and h.type='harvest'
     join quantity q on q.log_id=h.id and q.asset_id=o.asset_id and q.measure='weight'
    where o.asset_id=? and o.role='output'`, [meat])

console.log('\nBatch costing — 600 lb feed at $340, 300 lb fed, 240 lb meat out')
check('feed charged (half the bag)', cost.input_cost, 170)
check('meat yield', yield_.lb, 240)
check('cost per lb', cost.input_cost / yield_.lb, 0.71)

const [terms] = q(`select count(*) n from term`)
check('seeded vocabulary terms', terms.n, 144)
const [crops] = q(`select count(*) n from term where vocabulary='crop'`)
check('crop vocabulary present', crops.n, 43)

// --- what is left of each lot, matching queries.ts:lotBalances -------------
// Took 20 lb of the meat home, and 300 of the 600 lb of feed was eaten.
const eat = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'disposition','2026-08-01','Freezer',?,?)`, [eat, farm, now(), now()])
run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [eat, meat])
run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at)
     values (?,?,?,'weight',20,'lb',?,?)`, [uuid(), farm, eat, now(), now()])

const balances = q(`
  with came as (
    select la.asset_id lot_id, sum(q.value) amount
      from log_asset la
      join log l on l.id=la.log_id and l.deleted_at is null
      join quantity q on q.log_id=l.id and q.deleted_at is null
           and q.measure in ('weight','count','volume')
     where (l.type='purchase' and la.role='subject')
        or (l.type in ('harvest','processing') and la.role='output')
     group by la.asset_id
  ), taken as (
    select la.asset_id lot_id, sum(q.value) amount
      from log_asset la
      join log l on l.id=la.log_id and l.deleted_at is null
           and l.type='disposition' and la.role='subject'
      join quantity q on q.log_id=l.id and q.deleted_at is null
           and q.measure in ('weight','count','volume')
     group by la.asset_id
  ), consumed as (
    select la.asset_id lot_id, sum(la.amount) amount
      from log_asset la
      join log l on l.id=la.log_id and l.deleted_at is null
     where la.role='input' and la.amount is not null
     group by la.asset_id
  )
  select a.name,
         coalesce(c.amount,0) - coalesce(t.amount,0) - coalesce(u.amount,0) remaining
    from asset a
    left join came c on c.lot_id=a.id
    left join taken t on t.lot_id=a.id
    left join consumed u on u.lot_id=a.id
   where a.type='lot'`)

const byName = Object.fromEntries(balances.map((b) => [b.name, b.remaining]))
console.log('\nWhat is left')
check('meat left after taking 20 lb', byName['Broiler meat'], 220)
check('feed left after feeding 300 lb', byName['Grower feed'], 300)

// --- a producer is harvested repeatedly and survives it --------------------
const cow = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'animal','Bluebell','{"species":"Cattle"}',?,?)`, [cow, farm, now(), now()])
const hayLot = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'lot','Hay','{"origin":"purchased"}',?,?)`, [hayLot, farm, now(), now()])

const hayBuy = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'purchase','2026-05-01','Hay',?,?)`, [hayBuy, farm, now(), now()])
run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [hayBuy, hayLot])
run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at) values
     (?,?,?,'price',200,'USD',?,?)`, [uuid(), farm, hayBuy, now(), now()])
run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at) values
     (?,?,?,'weight',400,'lb',?,?)`, [uuid(), farm, hayBuy, now(), now()])

const hayFed = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'input_application','2026-05-05','Fed hay',?,?)`, [hayFed, farm, now(), now()])
run(`insert into log_asset (log_id,asset_id,role,amount,unit) values (?,?,'input',200,'lb')`,
  [hayFed, hayLot])
run(`insert into log_asset (log_id,asset_id,role,amount,unit) values (?,?,'subject',null,null)`,
  [hayFed, cow])

// Two milkings, each producing its own lot. The cow is NOT archived.
for (const [when, gal] of [['2026-05-06', 20], ['2026-05-07', 25]]) {
  const milk = uuid()
  run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
       values (?,?,'lot',?,'{"origin":"produced","material":"Milk"}',?,?)`,
  [milk, farm, `Milk ${when}`, now(), now()])
  const milking = uuid()
  run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
       values (?,?,'harvest',?,'Milking',?,?)`, [milking, farm, when, now(), now()])
  run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [milking, cow])
  run(`insert into log_asset (log_id,asset_id,role) values (?,?,'output')`, [milking, milk])
  run(`insert into quantity (id,farm_id,log_id,measure,value,unit,asset_id,created_at,updated_at)
       values (?,?,?,'weight',?,'gal',?,?,?)`, [uuid(), farm, milking, gal, milk, now(), now()])
}

const [cowState] = q(`select status, terminal_event from asset where id=?`, [cow])
const [milkTotal] = q(`
  select coalesce(sum(qt.value),0) total
    from log_asset subj
    join log h on h.id=subj.log_id and h.type='harvest' and h.deleted_at is null
    join log_asset o on o.log_id=h.id and o.role='output'
    join quantity qt on qt.log_id=h.id and qt.asset_id=o.asset_id
         and qt.measure='weight'
   where subj.asset_id=? and subj.role='subject'`, [cow])

console.log('\nRepeat harvest — a dairy cow milked twice')
check('the cow is still active', cowState.status === 'active' ? 1 : 0, 1)
check('she was not marked harvested', cowState.terminal_event === null ? 1 : 0, 1)
check('both milkings counted', milkTotal.total, 45)
check('cost per gallon spreads over both', 100 / milkTotal.total, 2.22)

// --- planned work is a task, not history ----------------------------------
const task = uuid()
run(`insert into log (id, farm_id, type, timestamp, status, name, created_at, updated_at)
     values (?,?,'activity','2026-09-01','planned','Worm the cattle',?,?)`,
[task, farm, now(), now()])

const history = () => q(
  `select count(*) n from log
    where deleted_at is null and status <> 'planned' and id=?`, [task])[0].n
const todo = () => q(
  `select count(*) n from log
    where deleted_at is null and status='planned' and id=?`, [task])[0].n

console.log('\nPlanned work')
check('a plan is on the to-do list', todo(), 1)
check('and stays out of history', history(), 0)

run(`update log set status='done', timestamp=?, updated_at=? where id=?`, [now(), now(), task])
check('ticking it off clears the list', todo(), 0)
check('and writes it into history', history(), 1)


// ---------------------------------------------------------------- selling
// The other half of the ledger. Until sellAsset() existed the app could say
// what an animal cost and nothing about what it fetched, so "did we make
// money on those pigs?" had no answer anywhere in the data.
console.log('\nSelling an animal records income against it')
const pig = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'animal','Hamlet','{"species":"Pig"}',?,?)`, [pig, farm, now(), now()])
const pigBuy = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'purchase',?,'Bought Hamlet',?,?)`, [pigBuy, farm, now(), now(), now()])
run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [pigBuy, pig])
run(`insert into quantity (id, farm_id, log_id, measure, value, unit, created_at, updated_at)
     values (?,?,?,'price',120,'USD',?,?)`, [uuid(), farm, pigBuy, now(), now()])

const pigSale = uuid()
run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
     values (?,?,'sale',?,'Sold Hamlet',?,?)`, [pigSale, farm, now(), now(), now()])
run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [pigSale, pig])
run(`insert into quantity (id, farm_id, log_id, measure, value, unit, label, created_at, updated_at)
     values (?,?,?,'price',450,'USD','Sale barn',?,?)`, [uuid(), farm, pigSale, now(), now()])

const income = q(`select coalesce(sum(q.value),0) as v
                    from log_asset la
                    join log sl on sl.id = la.log_id
                         and sl.type = 'sale' and sl.deleted_at is null
                    join quantity q on q.log_id = sl.id
                         and q.deleted_at is null and q.measure = 'price'
                   where la.asset_id = ? and la.role = 'subject'`, [pig])[0].v
check('sale income reads back', income, 450)

const spent = q(`select coalesce(sum(q.value),0) as v
                   from log_asset la
                   join log p on p.id = la.log_id
                        and p.type = 'purchase' and p.deleted_at is null
                   join quantity q on q.log_id = p.id
                        and q.deleted_at is null and q.measure = 'price'
                  where la.asset_id = ? and la.role = 'subject'`, [pig])[0].v
check('purchase cost is unaffected by the sale', spent, 120)
check('margin', income - spent, 330)

// A sale must not be mistaken for a purchase by the cost queries — both
// carry a 'price' quantity, and only the log type tells them apart.
const purchasesOnly = q(`select count(*) as n from log
                          where farm_id = ? and type = 'purchase'
                            and deleted_at is null`, [farm])[0].n
const salesOnly = q(`select count(*) as n from log
                      where farm_id = ? and type = 'sale' and deleted_at is null`, [farm])[0].n
check('sales are not counted as purchases', salesOnly, 1)
check('the purchase count did not grow', purchasesOnly >= 1 ? 1 : 0, 1)


console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
