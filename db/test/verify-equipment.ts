// Four things a code review caught that no test would have: a tractor could
// not be retired, selling a flock left its birds active, a vet bill piled up
// in Stores forever, and a big flock was inserted one bird at a time.
//
//   npm run verify:equipment
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
for (const m of ['006_equipment.sql', '007_equipment_terminal.sql']) {
  await db.exec(fs.readFileSync(R + 'migrations/' + m, 'utf8'))
}

const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as any[]
const id = async (s: string, p: unknown[] = []) => (await q(s, p))[0].id as string
const farm = await id(`insert into farm (name) values ('Test') returning id`)

console.log('\nEquipment can actually be retired')
// Migration 007 is written to be re-run on every app start.
await db.exec(fs.readFileSync(R + 'migrations/007_equipment_terminal.sql', 'utf8'))
check('007 is idempotent', true)

for (const ev of ['sold', 'retired', 'scrapped']) {
  const t = await id(`insert into asset (farm_id,type,name) values ($1,'equipment',$2)
    returning id`, [farm, `Tractor ${ev}`])
  try {
    await q(`update asset set status='archived', terminal_event=$2 where id=$1`, [t, ev])
    const row = (await q(`select status, terminal_event from asset where id=$1`, [t]))[0]
    check(`a tractor can be "${ev}"`,
      row.status === 'archived' && row.terminal_event === ev,
      `${row.status}/${row.terminal_event}`)
  } catch (e) {
    check(`a tractor can be "${ev}"`, false, (e as Error).message)
  }
}

let rejected = false
const bad = await id(`insert into asset (farm_id,type,name) values ($1,'equipment','Bad')
  returning id`, [farm])
try {
  await q(`update asset set terminal_event='exploded' where id=$1`, [bad])
} catch { rejected = true }
check('but junk is still rejected', rejected)

console.log('\nArchiving a group takes its members with it')
const flock = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'group','Layers','{"species":"Chicken","purpose":"eggs"}') returning id`, [farm])
const birds: string[] = []
for (let i = 1; i <= 3; i++) {
  birds.push(await id(`insert into asset (farm_id,type,name,parent_id,attributes)
    values ($1,'animal',$2,$3,'{"species":"Chicken","purpose":"eggs"}') returning id`,
    [farm, `Layers ${i}`, flock]))
}
// One bird already died before the flock was sold.
await q(`update asset set status='archived', terminal_event='died' where id=$1`, [birds[0]])

// The two statements archiveAsset() now runs.
await q(`update asset set status='archived', terminal_event='sold' where id=$1`, [flock])
await q(`update asset set status='archived', terminal_event='sold'
  where parent_id=$1 and deleted_at is null and status='active'`, [flock])

const live = await q(`select count(*)::int as n from asset
  where parent_id=$1 and status='active'`, [flock])
check('no member is left active', live[0].n === 0, `${live[0].n} still active`)

const dead = (await q(`select terminal_event from asset where id=$1`, [birds[0]]))[0]
check('a bird that died earlier keeps its own ending',
  dead.terminal_event === 'died', dead.terminal_event)

console.log('\nA vet bill is a cost, not stock')
const svc = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'lot','Antibiotic','{"origin":"service","material":"Antibiotic"}')
  returning id`, [farm])
const hay = await id(`insert into asset (farm_id,type,name,attributes)
  values ($1,'lot','Hay','{"origin":"purchased","material":"Hay"}') returning id`, [farm])
for (const [lot, price, weight] of [[svc, 75, null], [hay, 200, 40]] as const) {
  const log = await id(`insert into log (farm_id,type,timestamp,name)
    values ($1,'purchase',now(),'Bought') returning id`, [farm])
  await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`, [log, lot])
  await q(`insert into quantity (farm_id,log_id,measure,value,unit)
    values ($1,$2,'price',$3,'USD')`, [farm, log, price])
  if (weight !== null) {
    await q(`insert into quantity (farm_id,log_id,measure,value,unit)
      values ($1,$2,'weight',$3,'Round Bale')`, [farm, log, weight])
  }
}

// The filter lotBalances() now applies.
const inStores = await q(`select a.id, a.name from asset a
  where a.type='lot' and a.deleted_at is null
    and coalesce(a.attributes->>'origin','') <> 'service'`)
const names = inStores.map((r) => r.name)
check('the vet bill stays out of Stores', !names.includes('Antibiotic'), names.join(','))
check('the hay is still there', names.includes('Hay'), names.join(','))

// Cost accounting must still see it — assetCosts() reads the purchase log,
// not lotBalances(), so filtering Stores must not make the charge vanish.
const charged = await q(`select coalesce(sum(qn.value),0)::float as total
  from log_asset la
  join log p on p.id=la.log_id and p.type='purchase' and p.deleted_at is null
  join quantity qn on qn.log_id=p.id and qn.measure='price'
 where la.asset_id=$1 and la.role='subject'`, [svc])
check('but the $75 still counts as cost', Math.abs(charged[0].total - 75) < 0.01,
  `$${charged[0].total}`)

console.log('\nA big flock inserts in one statement per chunk')
const big = await id(`insert into asset (farm_id,type,name) values ($1,'group','Broilers')
  returning id`, [farm])
const N = 250
const CHUNK = 200
let statements = 0
for (let start = 1; start <= N; start += CHUNK) {
  const end = Math.min(start + CHUNK - 1, N)
  const values: unknown[] = []
  const tuples: string[] = []
  for (let i = start; i <= end; i++) {
    const b = values.length
    tuples.push(`($${b + 1}, 'animal', $${b + 2}, $${b + 3}, $${b + 4})`)
    values.push(farm, `Broilers ${i}`, '{}', big)
  }
  await q(`insert into asset (farm_id,type,name,attributes,parent_id)
    values ${tuples.join(', ')}`, values)
  statements++
}
const made = await q(`select count(*)::int as n from asset where parent_id=$1`, [big])
check(`all ${N} birds exist`, made[0].n === N, `${made[0].n}`)
check('in 2 statements, not 250', statements === 2, `${statements}`)
const distinct = await q(`select count(distinct name)::int as n from asset
  where parent_id=$1`, [big])
check('each has its own name', distinct[0].n === N, `${distinct[0].n}`)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
