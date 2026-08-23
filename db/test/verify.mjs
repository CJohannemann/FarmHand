import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { fileURLToPath } from 'url'
const R = fileURLToPath(new URL('../', import.meta.url))
const db = new PGlite()
await db.exec(`create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $q$ select null::uuid $q$;`)
await db.exec(fs.readFileSync(R+'schema.sql','utf8').replace(/create extension.*?;/,''))
await db.exec(fs.readFileSync(R+'seed.sql','utf8'))

const q = async (s,p=[]) => (await db.query(s,p)).rows
const id = async (s,p=[]) => (await q(s,p))[0].id

// --- the farm -------------------------------------------------------------
const farm = await id(`insert into farm (name) values ('Johannemann homestead') returning id`)
const coop = await id(`insert into location (farm_id,name,type) values ($1,'Coop','barn') returning id`,[farm])

// --- the flock, and the feed we bought for it ------------------------------
const flock = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'group','Spring broilers','{"headcount":75,"species":"Chicken"}') returning id`,[farm])
const feed = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'lot','Grower feed','{"origin":"purchased","material":"Feed"}') returning id`,[farm])

const buy = await id(`insert into log (farm_id,type,timestamp,name)
  values ($1,'purchase','2026-04-02','Grower feed — 12 bags') returning id`,[farm])
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`,[buy,feed])
await q(`insert into quantity (farm_id,log_id,measure,value,unit) values
  ($1,$2,'price',340,'USD'), ($1,$2,'weight',600,'lb')`,[farm,buy])

// --- feeding it to the flock ----------------------------------------------
const fed = await id(`insert into log (farm_id,type,timestamp,name,location_id)
  values ($1,'input_application','2026-04-10','Fed the broilers',$2) returning id`,[farm,coop])
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'input'),($1,$3,'subject')`,[fed,feed,flock])

// --- slaughter: flock in, meat lot out ------------------------------------
const meat = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'lot','Broiler meat — spring batch','{"origin":"produced","material":"Meat"}') returning id`,[farm])
const kill = await id(`insert into log (farm_id,type,timestamp,name)
  values ($1,'harvest','2026-06-14','Slaughter day') returning id`,[farm])
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject'),($1,$3,'output')`,[kill,flock,meat])
await q(`insert into quantity (farm_id,log_id,measure,value,unit,asset_id)
  values ($1,$2,'weight',240,'lb',$3)`,[farm,kill,meat])
await q(`update asset set status='archived', terminal_event='harvested' where id=$1`,[flock])

// --- taking some out of the freezer ---------------------------------------
const eat = await id(`insert into log (farm_id,type,timestamp,name,attributes)
  values ($1,'disposition','2026-08-01','Freezer — family','{"kind":"home_use"}') returning id`,[farm])
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`,[eat,meat])
await q(`insert into quantity (farm_id,log_id,measure,value,unit) values
  ($1,$2,'weight',20,'lb'), ($1,$2,'price',89.80,'USD')`,[farm,eat])

// --- the question the whole model exists to answer -------------------------
const cost = await q(`
  with feed_cost as (
    select coalesce(sum(qt.value),0) usd
    from log_asset flock_la
    join log applied on applied.id = flock_la.log_id and applied.type='input_application'
    join log_asset input_la on input_la.log_id = applied.id and input_la.role='input'
    join log_asset bought on bought.asset_id = input_la.asset_id and bought.role='subject'
    join log purchase on purchase.id = bought.log_id and purchase.type='purchase'
    join quantity qt on qt.log_id = purchase.id and qt.measure='price'
    where flock_la.asset_id = $1 and flock_la.role='subject'
  ), yield as (
    select qt.value lb
    from log_asset out_la
    join log h on h.id = out_la.log_id and h.type='harvest'
    join quantity qt on qt.log_id = h.id and qt.measure='weight'
    where out_la.asset_id = $2 and out_la.role='output'
  )
  select f.usd, y.lb, round(f.usd / y.lb, 2) as cost_per_lb from feed_cost f, yield y`,
  [flock, meat])

const [r] = cost
console.log(`\n  feed cost      $${r.usd}`)
console.log(`  meat yield      ${r.lb} lb`)
console.log(`  COST PER LB    $${r.cost_per_lb}   (grocery boneless breast ≈ $4.49)`)

const bal = await q(`
  select sum(case when l.type='harvest' then q.value else -q.value end) as lb_left
  from quantity q join log l on l.id=q.log_id
  join log_asset la on la.log_id=l.id and la.asset_id=$1
  where q.measure='weight'`,[meat])
console.log(`  freezer left    ${bal[0].lb_left} lb\n`)
