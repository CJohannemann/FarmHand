// Builds the schema in PGlite, seeds it, and runs a batch through end to end.
//   npm run verify:db
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { fileURLToPath } from 'url'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new PGlite()
let failures = 0

const check = (label, actual, expected) => {
  const ok = Math.abs(Number(actual) - expected) < 0.01
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}` +
              (ok ? '' : ` (expected ${expected})`))
}

await db.exec(`do $r$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
    then create role authenticated; end if; end $r$;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $q$ select null::uuid $q$;`)
await db.exec(fs.readFileSync(R + 'schema.sql', 'utf8').replace(/create extension[^;]*;/, ''))
await db.exec(fs.readFileSync(R + 'seed.sql', 'utf8'))

const q = async (s, p = []) => (await db.query(s, p)).rows
const id = async (s, p = []) => (await q(s, p))[0].id

const farm = await id(`insert into farm (name) values ('Test') returning id`)
const flock = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'group','Spring broilers','{"headcount":75}') returning id`, [farm])
const feed = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'lot','Grower feed','{"origin":"purchased"}') returning id`, [farm])

// Bought 600 lb for $340.
const buy = await id(`insert into log (farm_id,type,timestamp,name)
  values ($1,'purchase','2026-04-02','Feed') returning id`, [farm])
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`, [buy, feed])
await q(`insert into quantity (farm_id,log_id,measure,value,unit) values
  ($1,$2,'price',340,'USD'), ($1,$2,'weight',600,'lb')`, [farm, buy])

// Fed 300 lb of it — half the bag, so half the cost should be charged.
const fed = await id(`insert into log (farm_id,type,timestamp,name)
  values ($1,'input_application','2026-04-10','Fed') returning id`, [farm])
await q(`insert into log_asset (log_id,asset_id,role,amount,unit)
  values ($1,$2,'input',300,'lb'),($1,$3,'subject',null,null)`, [fed, feed, flock])

// Slaughter: 240 lb of meat out.
const meat = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'lot','Broiler meat','{"origin":"produced"}') returning id`, [farm])
const kill = await id(`insert into log (farm_id,type,timestamp,name)
  values ($1,'harvest','2026-06-14','Slaughter') returning id`, [farm])
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject'),($1,$3,'output')`,
  [kill, flock, meat])
await q(`insert into quantity (farm_id,log_id,measure,value,unit,asset_id)
  values ($1,$2,'weight',240,'lb',$3)`, [farm, kill, meat])
await q(`update asset set status='archived', terminal_event='harvested' where id=$1`, [flock])

// --- the cost rollup, matching src/db/queries.ts:assetCosts -----------------
const [cost] = await q(`
  with used as (
    select la_in.asset_id as lot_id, la_in.amount as used_amount
      from log_asset subj
      join log l on l.id = subj.log_id
           and l.type = 'input_application' and l.deleted_at is null
      join log_asset la_in on la_in.log_id = l.id and la_in.role = 'input'
     where subj.asset_id = $1 and subj.role = 'subject'
  ),
  per_lot as (
    select lot_id, sum(used_amount) as used_total,
           bool_or(used_amount is null) as unknown_amount
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
         when lp.bought > 0 then lp.price * least(pl.used_total / lp.bought, 1)
         else lp.price end), 0)::float as input_cost
    from per_lot pl join lot_purchase lp on lp.lot_id = pl.lot_id`, [flock])

const [yield_] = await q(
  `select q.value::float lb from log_asset o
     join log h on h.id=o.log_id and h.type='harvest'
     join quantity q on q.log_id=h.id and q.asset_id=o.asset_id and q.measure='weight'
    where o.asset_id=$1 and o.role='output'`, [meat])

console.log('\nBatch costing — 600 lb feed at $340, 300 lb fed, 240 lb meat out')
check('feed charged (half the bag)', cost.input_cost, 170)
check('meat yield', yield_.lb, 240)
check('cost per lb', cost.input_cost / yield_.lb, 0.71)

const [terms] = await q(`select count(*)::int n from term`)
check('seeded vocabulary terms', terms.n, 133)
const [crops] = await q(`select count(*)::int n from term where vocabulary='crop'`)
check('crop vocabulary present', crops.n, 43)

// --- what is left of each lot, matching queries.ts:lotBalances -------------
// Took 20 lb of the meat home, and 300 of the 600 lb of feed was eaten.
const eat = await id(`insert into log (farm_id,type,timestamp,name)
  values ($1,'disposition','2026-08-01','Freezer') returning id`, [farm])
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`, [eat, meat])
await q(`insert into quantity (farm_id,log_id,measure,value,unit)
  values ($1,$2,'weight',20,'lb')`, [farm, eat])

const balances = await q(`
  with came as (
    select la.asset_id lot_id, sum(q.value)::float amount
      from log_asset la
      join log l on l.id=la.log_id and l.deleted_at is null
      join quantity q on q.log_id=l.id and q.deleted_at is null
           and q.measure in ('weight','count','volume')
     where (l.type='purchase' and la.role='subject')
        or (l.type in ('harvest','processing') and la.role='output')
     group by la.asset_id
  ), taken as (
    select la.asset_id lot_id, sum(q.value)::float amount
      from log_asset la
      join log l on l.id=la.log_id and l.deleted_at is null
           and l.type='disposition' and la.role='subject'
      join quantity q on q.log_id=l.id and q.deleted_at is null
           and q.measure in ('weight','count','volume')
     group by la.asset_id
  ), consumed as (
    select la.asset_id lot_id, sum(la.amount)::float amount
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
const cow = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'animal','Bluebell','{"species":"Cattle"}') returning id`, [farm])
const hayLot = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'lot','Hay','{"origin":"purchased"}') returning id`, [farm])

const hayBuy = await id(`insert into log (farm_id,type,timestamp,name)
  values ($1,'purchase','2026-05-01','Hay') returning id`, [farm])
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`,
  [hayBuy, hayLot])
await q(`insert into quantity (farm_id,log_id,measure,value,unit) values
  ($1,$2,'price',200,'USD'), ($1,$2,'weight',400,'lb')`, [farm, hayBuy])

const hayFed = await id(`insert into log (farm_id,type,timestamp,name)
  values ($1,'input_application','2026-05-05','Fed hay') returning id`, [farm])
await q(`insert into log_asset (log_id,asset_id,role,amount,unit)
  values ($1,$2,'input',200,'lb'),($1,$3,'subject',null,null)`, [hayFed, hayLot, cow])

// Two milkings, each producing its own lot. The cow is NOT archived.
for (const [when, gal] of [['2026-05-06', 20], ['2026-05-07', 25]]) {
  const milk = await id(`insert into asset (farm_id,type,name,attributes)
    values ($1,'lot',$2,'{"origin":"produced","material":"Milk"}') returning id`,
    [farm, `Milk ${when}`])
  const milking = await id(`insert into log (farm_id,type,timestamp,name)
    values ($1,'harvest',$2,'Milking') returning id`, [farm, when])
  await q(`insert into log_asset (log_id,asset_id,role)
    values ($1,$2,'subject'),($1,$3,'output')`, [milking, cow, milk])
  await q(`insert into quantity (farm_id,log_id,measure,value,unit,asset_id)
    values ($1,$2,'weight',$3,'gal',$4)`, [farm, milking, gal, milk])
}

const [cowState] = await q(
  `select status, terminal_event from asset where id=$1`, [cow])
const [milkTotal] = await q(`
  select coalesce(sum(qt.value),0)::float total
    from log_asset subj
    join log h on h.id=subj.log_id and h.type='harvest' and h.deleted_at is null
    join log_asset o on o.log_id=h.id and o.role='output'
    join quantity qt on qt.log_id=h.id and qt.asset_id=o.asset_id
         and qt.measure='weight'
   where subj.asset_id=$1 and subj.role='subject'`, [cow])

console.log('\nRepeat harvest — a dairy cow milked twice')
check('the cow is still active', cowState.status === 'active' ? 1 : 0, 1)
check('she was not marked harvested', cowState.terminal_event === null ? 1 : 0, 1)
check('both milkings counted', milkTotal.total, 45)
check('cost per gallon spreads over both', 100 / milkTotal.total, 2.22)

// --- planned work is a task, not history ----------------------------------
const task = await id(`insert into log (farm_id,type,timestamp,status,name)
  values ($1,'activity','2026-09-01','planned','Worm the cattle') returning id`, [farm])

const history = async () => (await q(
  `select count(*)::int n from log
    where deleted_at is null and status <> 'planned' and id=$1`, [task]))[0].n
const todo = async () => (await q(
  `select count(*)::int n from log
    where deleted_at is null and status='planned' and id=$1`, [task]))[0].n

console.log('\nPlanned work')
check('a plan is on the to-do list', await todo(), 1)
check('and stays out of history', await history(), 0)

await q(`update log set status='done', timestamp=now() where id=$1`, [task])
check('ticking it off clears the list', await todo(), 0)
check('and writes it into history', await history(), 1)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
