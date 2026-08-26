// The SQLite counterpart of verify-purchase-delete.ts. deleteLog() itself
// (src/db/queries.ts) already got the same dialect treatment (no ::casts, ids
// and timestamps generated in JS) — mirrored here by hand for the same
// reason the original mirrors it: this file can't import queries.ts, which
// is wired to a Vite-only `?raw`-importing browser client.
//   npm run verify:purchase-delete-local
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { seedLocalVocabulary } from '../seedLocal.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
let fails = 0

const check = (label, ok, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))
const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const q = (sql, params = []) => db.prepare(sql).all(...params)
const run = (sql, params = []) => db.prepare(sql).run(...params)
await seedLocalVocabulary(async (sql, params = []) => run(sql, params))

const farm = uuid()
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`, [farm, 'Test', now(), now()])

function deleteLog(logId) {
  const [row] = q(`select type from log where id = ?`, [logId])
  const t = now()
  run(`update log set deleted_at = ?, updated_at = ? where id = ?`, [t, t, logId])
  run(`update quantity set deleted_at = ?, updated_at = ?
        where log_id = ? and deleted_at is null`, [t, t, logId])
  if (row?.type === 'purchase') {
    const subjects = q(
      `select asset_id from log_asset where log_id = ? and role = 'subject'`, [logId])
    for (const { asset_id } of subjects) {
      const [{ n }] = q(
        `select count(*) as n
           from log_asset la
           join log l on l.id = la.log_id and l.deleted_at is null
          where la.asset_id = ?`, [asset_id])
      if (n === 0) {
        run(`update asset set deleted_at = ?, updated_at = ?
              where id = ? and type = 'lot'`, [t, t, asset_id])
      }
    }
  }
}

function makePurchase(name) {
  const lot = uuid()
  run(`insert into asset (id,farm_id,type,name,attributes,created_at,updated_at)
       values (?,?,'lot',?,'{"material":"feed","origin":"purchased"}',?,?)`,
  [lot, farm, name, now(), now()])
  const log = uuid()
  run(`insert into log (id,farm_id,type,timestamp,name,created_at,updated_at)
       values (?,?,'purchase',?,?,?,?)`, [log, farm, now(), `Bought ${name}`, now(), now()])
  run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [log, lot])
  run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at)
       values (?,?,?,'weight',50,'lb',?,?)`, [uuid(), farm, log, now(), now()])
  return { lot, log }
}

console.log('\nDeleting a duplicate purchase removes its untouched lot')
const dup = makePurchase('Pig Feed (duplicate)')
deleteLog(dup.log)
const [dupLot] = q(`select deleted_at from asset where id = ?`, [dup.lot])
check('the phantom lot is gone too', dupLot.deleted_at !== null)

console.log('\nDeleting a purchase leaves an already-used lot alone')
const used = makePurchase('Pig Feed')
const feedLog = uuid()
run(`insert into log (id,farm_id,type,timestamp,name,created_at,updated_at)
     values (?,?,'input_application',?,'Fed',?,?)`, [feedLog, farm, now(), now(), now()])
run(`insert into log_asset (log_id,asset_id,role,amount,unit)
     values (?,?,'input',10,'lb')`, [feedLog, used.lot])
deleteLog(used.log)
const [usedLot] = q(`select deleted_at from asset where id = ?`, [used.lot])
check('the lot survives — something already drew from it', usedLot.deleted_at === null)

console.log('\nA non-purchase log deletion never touches an asset')
const harvestLot = uuid()
run(`insert into asset (id,farm_id,type,name,created_at,updated_at)
     values (?,?,'lot','Eggs',?,?)`, [harvestLot, farm, now(), now()])
const obs = uuid()
run(`insert into log (id,farm_id,type,timestamp,name,created_at,updated_at)
     values (?,?,'observation',?,'Note',?,?)`, [obs, farm, now(), now(), now()])
run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [obs, harvestLot])
deleteLog(obs)
const [untouchedLot] = q(`select deleted_at from asset where id = ?`, [harvestLot])
check('an unrelated asset is unaffected', untouchedLot.deleted_at === null)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
