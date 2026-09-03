// Deleting the log that created a lot used to leave the lot behind: still
// active, still listed in Stores, still offered everywhere a lot is picked
// from (Feed, Vet/Med), with nothing behind it — a phantom that never
// matched what was actually on hand. deleteLog() now takes the lot down with
// it, but only when nothing else has touched that lot since (another
// purchase, a feeding, a disposition) — otherwise deleting the record that
// started a lot's history would erase where it came from while leaving the
// usage still on the books.
//
// Two kinds of log create a lot, and they hold it in different roles: a
// purchase's subject IS the lot, while a harvest's subject is the animal or
// bed it came off and only its output is the new lot. Reported by someone
// who deleted a butchering from Records and still had the meat sitting in
// Stores — that path checked the wrong role and so cleaned up nothing.
//
//   npm run verify:purchase-delete
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { fileURLToPath } from 'url'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new PGlite()

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

await db.exec(`do $r$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
    then create role authenticated; end if; end $r$;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $q$ select null::uuid $q$;`)
await db.exec(fs.readFileSync(R + 'schema.sql', 'utf8').replace(/create extension[^;]*;/, ''))
await db.exec(fs.readFileSync(R + 'seed.sql', 'utf8'))

const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as any[]
const id = async (s: string, p: unknown[] = []) => (await q(s, p))[0].id as string
const farm = await id(`insert into farm (name) values ('Test') returning id`)

// Mirrors deleteLog() in src/db/queries.ts — kept in sync by hand, since
// that file imports a Vite-only `?raw` client and can't run under plain
// Node the way syncCore.ts can.
const CREATES_LOT: Record<string, string | undefined> =
  { purchase: 'subject', harvest: 'output', processing: 'output' }

async function deleteLog(logId: string) {
  const [row] = await q(`select type from log where id = $1`, [logId])
  await q(`update log set deleted_at = now(), updated_at = now() where id = $1`, [logId])
  await q(`update quantity set deleted_at = now(), updated_at = now()
            where log_id = $1 and deleted_at is null`, [logId])
  const createdRole = CREATES_LOT[row?.type ?? '']
  if (createdRole) {
    const created = await q(
      `select asset_id from log_asset where log_id = $1 and role = $2`, [logId, createdRole])
    for (const { asset_id } of created) {
      const [{ n }] = await q(
        `select count(*)::int as n
           from log_asset la
           join log l on l.id = la.log_id and l.deleted_at is null
          where la.asset_id = $1`, [asset_id])
      if (n === 0) {
        await q(`update asset set deleted_at = now(), updated_at = now()
                  where id = $1 and type = 'lot'`, [asset_id])
      }
    }
  }
}

async function makePurchase(name: string) {
  const lot = await id(
    `insert into asset (farm_id,type,name,attributes)
     values ($1,'lot',$2,'{"material":"feed","origin":"purchased"}') returning id`,
    [farm, name])
  const log = await id(
    `insert into log (farm_id,type,timestamp,name) values ($1,'purchase',now(),$2)
     returning id`, [farm, `Bought ${name}`])
  await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`, [log, lot])
  await q(
    `insert into quantity (farm_id,log_id,measure,value,unit) values ($1,$2,'weight',50,'lb')`,
    [farm, log])
  return { lot, log }
}

async function makeHarvest(sourceId: string, name: string) {
  const lot = await id(
    `insert into asset (farm_id,type,name,attributes)
     values ($1,'lot',$2,'{"material":"meat","origin":"produced"}') returning id`,
    [farm, name])
  const log = await id(
    `insert into log (farm_id,type,timestamp,name) values ($1,'harvest',now(),$2)
     returning id`, [farm, name])
  await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`,
    [log, sourceId])
  await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'output')`, [log, lot])
  await q(
    `insert into quantity (farm_id,log_id,measure,value,unit,asset_id)
     values ($1,$2,'weight',120,'lb',$3)`,
    [farm, log, lot])
  return { lot, log }
}

console.log('\nDeleting a duplicate purchase removes its untouched lot')
const dup = await makePurchase('Pig Feed (duplicate)')
await deleteLog(dup.log)
const [dupLot] = await q(`select deleted_at from asset where id = $1`, [dup.lot])
check('the phantom lot is gone too', dupLot.deleted_at !== null)

console.log('\nDeleting a purchase leaves an already-used lot alone')
const used = await makePurchase('Pig Feed')
const feedLog = await id(
  `insert into log (farm_id,type,timestamp,name) values ($1,'input_application',now(),'Fed')
   returning id`, [farm])
await q(
  `insert into log_asset (log_id,asset_id,role,amount,unit)
   values ($1,$2,'input',10,'lb')`, [feedLog, used.lot])
await deleteLog(used.log)
const [usedLot] = await q(`select deleted_at from asset where id = $1`, [used.lot])
check('the lot survives — something already drew from it', usedLot.deleted_at === null)

console.log('\nDeleting a butchering removes the meat it produced')
const pig = await id(
  `insert into asset (farm_id,type,name) values ($1,'animal','Pig') returning id`, [farm])
const { lot: pork, log: butchering } = await makeHarvest(pig, 'Pork')
await deleteLog(butchering)
const [porkLot] = await q(`select deleted_at from asset where id = $1`, [pork])
const [pigRow] = await q(`select deleted_at from asset where id = $1`, [pig])
check('the meat lot goes with the harvest that made it', porkLot.deleted_at !== null)
check('the animal it came off does not — that is the subject, not the output',
  pigRow.deleted_at === null)

console.log('\nDeleting a butchering leaves meat already taken from alone')
const { lot: eaten, log: butchering2 } = await makeHarvest(pig, 'Pork (some eaten)')
const takeLog = await id(
  `insert into log (farm_id,type,timestamp,name) values ($1,'disposition',now(),'Home use')
   returning id`, [farm])
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`,
  [takeLog, eaten])
await deleteLog(butchering2)
const [eatenLot] = await q(`select deleted_at from asset where id = $1`, [eaten])
check('the lot survives — the freezer withdrawal still refers to it',
  eatenLot.deleted_at === null)

console.log('\nA log that creates no lot never touches an asset')
const harvestLot = await id(
  `insert into asset (farm_id,type,name) values ($1,'lot','Eggs') returning id`, [farm])
const obs = await id(
  `insert into log (farm_id,type,timestamp,name) values ($1,'observation',now(),'Note')
   returning id`, [farm])
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`,
  [obs, harvestLot])
await deleteLog(obs)
const [untouchedLot] = await q(`select deleted_at from asset where id = $1`, [harvestLot])
check('an unrelated asset is unaffected', untouchedLot.deleted_at === null)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
