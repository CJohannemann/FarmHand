// Deleting a duplicate purchase used to leave its lot behind: still active,
// still offered everywhere a lot is picked from (Feed, Vet/Med, Stores),
// with nothing behind it — a phantom that never matched what was actually on
// hand. deleteLog() now takes the lot down with its purchase, but only when
// nothing else has touched that lot since (another purchase, a feeding, a
// disposition) — otherwise deleting the record that started a lot's history
// would erase where it came from while leaving the usage still on the books.
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
async function deleteLog(logId: string) {
  const [row] = await q(`select type from log where id = $1`, [logId])
  await q(`update log set deleted_at = now(), updated_at = now() where id = $1`, [logId])
  await q(`update quantity set deleted_at = now(), updated_at = now()
            where log_id = $1 and deleted_at is null`, [logId])
  if (row?.type === 'purchase') {
    const subjects = await q(
      `select asset_id from log_asset where log_id = $1 and role = 'subject'`, [logId])
    for (const { asset_id } of subjects) {
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

console.log('\nA non-purchase log deletion never touches an asset')
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
