// The SQLite counterpart of verify-equipment.ts, minus the two checks that
// specifically exercised Postgres's terminal_event CHECK constraint
// (db/migrations/007_equipment_terminal.sql) — schema.local.sql deliberately
// carries no equivalent local constraint (see its header comment), so there
// is no "007 is idempotent" to port and "junk is rejected" is replaced with
// its intentional opposite. The remaining four scenarios (retirement itself,
// group archival cascading to members, a service-origin lot staying out of
// Stores while still counting as cost, and a big flock chunked-inserting in
// one statement per chunk) port unchanged.
//   npm run verify:equipment-local
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

console.log('\nEquipment can actually be retired')
for (const ev of ['sold', 'retired', 'scrapped']) {
  const t = uuid()
  run(`insert into asset (id, farm_id, type, name, created_at, updated_at)
       values (?,?,'equipment',?,?,?)`, [t, farm, `Tractor ${ev}`, now(), now()])
  try {
    run(`update asset set status='archived', terminal_event=? where id=?`, [ev, t])
    const row = q(`select status, terminal_event from asset where id=?`, [t])[0]
    check(`a tractor can be "${ev}"`,
      row.status === 'archived' && row.terminal_event === ev,
      `${row.status}/${row.terminal_event}`)
  } catch (e) {
    check(`a tractor can be "${ev}"`, false, e.message)
  }
}

// Deliberate behavior change from the Postgres side: no local CHECK
// constraint (see schema.local.sql), so this now succeeds rather than being
// rejected — the remote schema plus the app's TypeScript are what enforce
// valid values, not the local database.
const bad = uuid()
run(`insert into asset (id, farm_id, type, name, created_at, updated_at)
     values (?,?,'equipment','Bad',?,?)`, [bad, farm, now(), now()])
let accepted = true
try {
  run(`update asset set terminal_event='exploded' where id=?`, [bad])
} catch { accepted = false }
check('and junk is accepted locally now (intentional — see schema.local.sql)', accepted)

console.log('\nArchiving a group takes its members with it')
const flock = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'group','Layers','{"species":"Chicken","purpose":"eggs"}',?,?)`,
[flock, farm, now(), now()])
const birds = []
for (let i = 1; i <= 3; i++) {
  const b = uuid()
  birds.push(b)
  run(`insert into asset (id, farm_id, type, name, parent_id, attributes, created_at, updated_at)
       values (?,?,'animal',?,?,'{"species":"Chicken","purpose":"eggs"}',?,?)`,
  [b, farm, `Layers ${i}`, flock, now(), now()])
}
// One bird already died before the flock was sold.
run(`update asset set status='archived', terminal_event='died' where id=?`, [birds[0]])

// The two statements archiveAsset() now runs.
run(`update asset set status='archived', terminal_event='sold' where id=?`, [flock])
run(`update asset set status='archived', terminal_event='sold'
  where parent_id=? and deleted_at is null and status='active'`, [flock])

const live = q(`select count(*) as n from asset where parent_id=? and status='active'`, [flock])
check('no member is left active', live[0].n === 0, `${live[0].n} still active`)

const dead = q(`select terminal_event from asset where id=?`, [birds[0]])[0]
check('a bird that died earlier keeps its own ending',
  dead.terminal_event === 'died', dead.terminal_event)

console.log('\nA vet bill is a cost, not stock')
const svc = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'lot','Antibiotic','{"origin":"service","material":"Antibiotic"}',?,?)`,
[svc, farm, now(), now()])
const hay = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'lot','Hay','{"origin":"purchased","material":"Hay"}',?,?)`,
[hay, farm, now(), now()])
for (const [lot, price, weight] of [[svc, 75, null], [hay, 200, 40]]) {
  const log = uuid()
  run(`insert into log (id, farm_id, type, timestamp, name, created_at, updated_at)
       values (?,?,'purchase',?,'Bought',?,?)`, [log, farm, now(), now(), now()])
  run(`insert into log_asset (log_id,asset_id,role) values (?,?,'subject')`, [log, lot])
  run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at)
       values (?,?,?,'price',?,'USD',?,?)`, [uuid(), farm, log, price, now(), now()])
  if (weight !== null) {
    run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at)
         values (?,?,?,'weight',?,'Round Bale',?,?)`, [uuid(), farm, log, weight, now(), now()])
  }
}

// The filter lotBalances() now applies.
const inStores = q(`select a.id, a.name from asset a
  where a.type='lot' and a.deleted_at is null
    and coalesce(a.attributes->>'origin','') <> 'service'`)
const names = inStores.map((r) => r.name)
check('the vet bill stays out of Stores', !names.includes('Antibiotic'), names.join(','))
check('the hay is still there', names.includes('Hay'), names.join(','))

// Cost accounting must still see it — assetCosts() reads the purchase log,
// not lotBalances(), so filtering Stores must not make the charge vanish.
const charged = q(`select coalesce(sum(qn.value),0) as total
  from log_asset la
  join log p on p.id=la.log_id and p.type='purchase' and p.deleted_at is null
  join quantity qn on qn.log_id=p.id and qn.measure='price'
 where la.asset_id=? and la.role='subject'`, [svc])
check('but the $75 still counts as cost', Math.abs(charged[0].total - 75) < 0.01,
  `$${charged[0].total}`)

console.log('\nA big flock inserts in one statement per chunk')
const big = uuid()
run(`insert into asset (id, farm_id, type, name, created_at, updated_at)
     values (?,?,'group','Broilers',?,?)`, [big, farm, now(), now()])
const N = 250
const CHUNK = 200
let statements = 0
const batchNow = now()
for (let start = 1; start <= N; start += CHUNK) {
  const end = Math.min(start + CHUNK - 1, N)
  const values = []
  const tuples = []
  for (let i = start; i <= end; i++) {
    tuples.push(`(?, ?, 'animal', ?, ?, ?, ?, ?)`)
    values.push(uuid(), farm, `Broilers ${i}`, '{}', big, batchNow, batchNow)
  }
  run(`insert into asset (id, farm_id, type, name, attributes, parent_id, created_at, updated_at)
    values ${tuples.join(', ')}`, values)
  statements++
}
const made = q(`select count(*) as n from asset where parent_id=?`, [big])
check(`all ${N} birds exist`, made[0].n === N, `${made[0].n}`)
check('in 2 statements, not 250', statements === 2, `${statements}`)
const distinct = q(`select count(distinct name) as n from asset where parent_id=?`, [big])
check('each has its own name', distinct[0].n === N, `${distinct[0].n}`)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
