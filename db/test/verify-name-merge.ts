// Settings' "Tidy up names": merging one name into another.
//
// The case that prompted it: one person buys "Hog feed", the other "Pig
// feed", and Stores lists them as different things. Merging has to reach
// everywhere the name is — the bags, the purchase records that read
// "Bought Hog feed" — and nowhere else: not the eggs the farm collected,
// not another farm's records on the same device.
//
// Runs the app's own statements (src/db/namesSql.ts) under node:sqlite.
//
//   npm run verify:name-merge
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { MERGE_NAME_SQL, NAME_USAGE_SQL } from '../../src/db/namesSql.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}
const uuid = () => crypto.randomUUID()
const T = '2026-11-01T00:00:00.000Z'
/** $1-style placeholders expanded the way src/db/worker.ts does it. */
const sql = (text: string, params: unknown[] = []) => {
  const values: unknown[] = []
  const q = text.replace(/\$(\d+)/g, (_, n: string) => { values.push(params[Number(n) - 1]); return '?' })
  return db.prepare(q).all(...values as never[]) as Record<string, unknown>[]
}
const run = (text: string, params: unknown[] = []) => db.prepare(text).run(...params as never[])

const farm = uuid()
const other = uuid()
for (const f of [farm, other]) run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`, [f, 'F', T, T])
run(`insert into active_farm (id) values (?)`, [farm])

/** createPurchase(), as the Buy sheet calls it. */
const buy = (name: string, material: string, supplier: string | null, farmId = farm, origin = 'purchased') => {
  const lot = uuid()
  run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at) values (?,?,'lot',?,?,?,?)`,
    [lot, farmId, name, JSON.stringify({ origin, material, ...(supplier ? { supplier } : {}) }), T, T])
  const log = uuid()
  run(`insert into log (id, farm_id, type, timestamp, status, name, attributes, created_at, updated_at)
       values (?,?,'purchase',?,'done',?,'{}',?,?)`,
    [log, farmId, T, (origin === 'service' ? 'Paid for ' : 'Bought ') + name, T, T])
  run(`insert into log_asset (log_id, asset_id, role) values (?,?,'subject')`, [log, lot])
  return { lot, log }
}
const usage = (kind: 'store' | 'item' | 'kind') =>
  Object.fromEntries(sql(NAME_USAGE_SQL[kind]).map((r) => [r.name, Number(r.count)]))
const merge = (kind: 'store' | 'item' | 'kind', from: string, into: string) => {
  for (const s of MERGE_NAME_SQL[kind]) sql(s, [from, into])
}

const hog1 = buy('Hog feed', 'Feed', 'Lowes')
buy('Hog feed', 'Feed', "Lowe's")
const pig = buy('Pig feed', 'Feed', "Lowe's")
const lumber = buy('Building supplies', 'Lumber', ' Lowes ', farm, 'service')
// Eggs the farm produced, named the same as nothing bought — never touched.
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at) values (?,?,'lot','Hog feed',?,?,?)`,
  [uuid(), farm, JSON.stringify({ origin: 'produced', material: 'Feed' }), T, T])
// Another farm on the same device with its own Hog feed from Lowes.
const theirs = buy('Hog feed', 'Feed', 'Lowes', other)
// A kind the farm typed in itself.
run(`insert into term (id, farm_id, vocabulary, name, created_at, updated_at) values (?,?,'material','Lumber',?,?)`,
  [uuid(), farm, T, T])

console.log('\nWhat is in use')
const items = usage('item')
check('bought items, with counts', items['Hog feed'] === 2 && items['Pig feed'] === 1, JSON.stringify(items))
check('not the farm\'s own produce', items['Hog feed'] === 2)
const stores = usage('store')
check('stores, trimmed', stores['Lowes'] === 2 && stores["Lowe's"] === 2, JSON.stringify(stores))
check('not the other farm\'s', !Object.values(stores).some((n) => n > 2))

console.log('\nMerging Hog feed into Pig feed')
db.exec(`delete from sync_outbox`)
merge('item', 'Hog feed', 'Pig feed')
const name = (id: string) => (sql(`select name from asset where id = $1`, [id])[0] as { name: string }).name
const logName = (id: string) => (sql(`select name from log where id = $1`, [id])[0] as { name: string }).name
check('the bag is renamed', name(hog1.lot) === 'Pig feed')
check('and its purchase reads "Bought Pig feed"', logName(hog1.log) === 'Bought Pig feed', logName(hog1.log))
check('one item now, three purchases', usage('item')['Pig feed'] === 3 && !('Hog feed' in usage('item')))
check('the farm\'s produce keeps its name',
  (sql(`select count(*) n from asset where name = 'Hog feed' and attributes->>'origin' = 'produced'`)[0] as { n: number }).n === 1)
check('the other farm keeps its Hog feed', name(theirs.lot) === 'Hog feed')
check('the changes are queued to sync to other devices',
  (sql(`select count(*) n from sync_outbox where tbl in ('asset', 'log')`)[0] as { n: number }).n === 4)
check('the Pig feed already there is untouched', name(pig.lot) === 'Pig feed')

console.log('\nMerging Lowes into Lowe\'s')
merge('store', 'Lowes', "Lowe's")
const s2 = usage('store')
check('one store now', s2["Lowe's"] === 4 && !('Lowes' in s2), JSON.stringify(s2))
check('a supplier saved with stray spaces is caught too',
  (sql(`select attributes->>'supplier' s from asset where id = $1`, [lumber.lot])[0] as { s: string }).s === "Lowe's")
check('other attributes ride through',
  (sql(`select attributes->>'origin' o from asset where id = $1`, [lumber.lot])[0] as { o: string }).o === 'service')
check('the other farm\'s Lowes is theirs',
  (sql(`select attributes->>'supplier' s from asset where id = $1`, [theirs.lot])[0] as { s: string }).s === 'Lowes')

console.log('\nMerging the kind Lumber into Building supplies')
merge('kind', 'Lumber', 'Building supplies')
check('the purchase moves kind', usage('kind')['Building supplies'] === 1 && !('Lumber' in usage('kind')))
check('and the farm-made kind is retired from the list',
  (sql(`select count(*) n from term where name = 'Lumber' and deleted_at is null`)[0] as { n: number }).n === 0)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
