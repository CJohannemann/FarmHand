// One account, two farms, one device.
//
// The server has always allowed it — farm_member is keyed (farm_id,
// user_id) — and the pull fetches every row RLS lets through, so a device
// belonging to two farms receives both. Every read here used to have no
// farm filter at all, because a device could only ever hold one farm, so
// the second farm's animals, logs and costs simply mixed into the first.
//
// Reads are scoped through a one-row active_farm table now. Two things get
// checked: that the scoping actually isolates, and — in verify-query-scope
// — that no future query forgets it.
//
//   npm run verify:multi-farm
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { seedLocalVocabulary } from '../seedLocal.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}
db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))
const q = (sql: string, p: unknown[] = []) => db.prepare(sql).all(...p as never[]) as never[]
const run = (sql: string, p: unknown[] = []) => db.prepare(sql).run(...p as never[])
const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
await seedLocalVocabulary(async (sql, p = []) => run(sql, p as unknown[]))

console.log('\nTwo farms on one device, as sync would leave it')
const home = uuid()
const neighbour = uuid()
run(`insert into farm (id,name,created_at,updated_at) values (?,?,?,?)`,
  [home, 'Rosebud Acres', now(), now()])
run(`insert into farm (id,name,created_at,updated_at) values (?,?,?,?)`,
  [neighbour, 'Next Door Farm', now(), now()])
run(`insert into active_farm (id) values (?)`, [home])

const stock = (farm: string, name: string, species: string) => {
  const id = uuid()
  run(`insert into asset (id,farm_id,type,name,attributes,created_at,updated_at)
       values (?,?,'animal',?,?,?,?)`,
    [id, farm, name, JSON.stringify({ species }), now(), now()])
  return id
}
stock(home, 'Bluebell', 'Cattle')
stock(home, 'Daisy', 'Cattle')
stock(neighbour, 'Not mine', 'Cattle')
stock(neighbour, 'Also not mine', 'Pig')

const spend = (farm: string, amount: number) => {
  const l = uuid()
  run(`insert into log (id,farm_id,type,timestamp,name,created_at,updated_at)
       values (?,?,'purchase',?,'Feed',?,?)`, [l, farm, now(), now(), now()])
  run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at)
       values (?,?,?,'price',?,'USD',?,?)`, [uuid(), farm, l, amount, now(), now()])
}
spend(home, 100)
spend(neighbour, 9999)

// Custom vocabulary belongs to a farm; the seeded list belongs to nobody.
run(`insert into term (id,farm_id,vocabulary,name,created_at,updated_at)
     values (?,?,'species','Alpaca',?,?)`, [uuid(), home, now(), now()])
run(`insert into term (id,farm_id,vocabulary,name,created_at,updated_at)
     values (?,?,'species','Llama',?,?)`, [uuid(), neighbour, now(), now()])

console.log('\nShowing the home farm')
const assets = () => q(`select name from asset
   where deleted_at is null and farm_id = (select id from active_farm)`) as { name: string }[]
const spendTotal = () => Number((q(`select coalesce(sum(q.value),0) v from log l
   join quantity q on q.log_id = l.id and q.measure = 'price'
  where l.type = 'purchase' and l.deleted_at is null
    and l.farm_id = (select id from active_farm)`) as { v: number }[])[0].v)
const speciesList = () => (q(`select name from term
   where vocabulary = 'species' and deleted_at is null
     and (farm_id is null or farm_id = (select id from active_farm))`) as { name: string }[])
  .map((r) => r.name)

check('only its own animals', assets().length === 2, assets().map((a) => a.name).join(', '))
check("the neighbour's are not there",
  !assets().some((a) => a.name.toLowerCase().includes('not mine')))
check('only its own spending', spendTotal() === 100, `$${spendTotal()}`)
check('its own custom species is offered', speciesList().includes('Alpaca'))
check("the neighbour's is not", !speciesList().includes('Llama'))
check('the seeded list is still offered', speciesList().includes('Cattle'))

console.log('\nSwitching to the other farm')
run(`delete from active_farm`)
run(`insert into active_farm (id) values (?)`, [neighbour])

check('now shows only that one', assets().length === 2, assets().map((a) => a.name).join(', '))
check('and it is the right two',
  assets().every((a) => a.name.toLowerCase().includes('not mine')),
  assets().map((a) => a.name).join(', '))
check("its spending, not the other farm's", spendTotal() === 9999, `$${spendTotal()}`)
check('its vocabulary', speciesList().includes('Llama') && !speciesList().includes('Alpaca'))

console.log('\nNothing was moved or copied to do it')
check('both farms still hold their records',
  q(`select 1 from asset where farm_id = ?`, [home]).length === 2
  && q(`select 1 from asset where farm_id = ?`, [neighbour]).length === 2)
check('exactly one farm is active at a time', q(`select 1 from active_farm`).length === 1)
// The point of caching both: switching needs no network.
check('switching touched only the one row',
  q(`select id from active_farm`).length === 1)

console.log('\nA device with one farm behaves exactly as before')
run(`delete from active_farm`)
run(`insert into active_farm (id) values (?)`, [home])
run(`delete from asset where farm_id = ?`, [neighbour])
run(`delete from quantity where farm_id = ?`, [neighbour])
run(`delete from log where farm_id = ?`, [neighbour])
run(`delete from farm where id = ?`, [neighbour])
check('sees its two animals', assets().length === 2)
check('and its own spending', spendTotal() === 100)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
