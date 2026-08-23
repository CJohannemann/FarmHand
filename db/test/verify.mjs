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

await db.exec(`create schema auth; create table auth.users (id uuid primary key);
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
check('seeded vocabulary terms', terms.n, 90)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
