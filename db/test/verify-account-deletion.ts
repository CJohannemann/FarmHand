// delete_own_account(): leaving, without taking anyone else's records with
// you. Driven against a real Postgres (PGlite) with several signed-in users,
// same set_config() stand-in for auth.uid() as verify-invites.ts.
//
// The case worth testing is the refusal. Every table cascades from farm, so
// deleting a farm someone else is still using would erase their animals,
// logs and receipts on the strength of one person clicking a button.
//
//   npm run verify:account-deletion
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

await db.exec(`
  do $r$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
    then create role authenticated; end if; end $r$;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid
    language sql stable as $q$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $q$;
`)
await db.exec(fs.readFileSync(R + 'schema.sql', 'utf8').replace(/create extension[^;]*;/, ''))

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as any[]
const asUser = async (id: string | null) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id ?? ''])
}

const solo = '11111111-1111-1111-1111-111111111111'
const owner = '22222222-2222-2222-2222-222222222222'
const helper = '33333333-3333-3333-3333-333333333333'
await q(`insert into auth.users (id,email) values ($1,'solo@x.com'),($2,'owner@x.com'),($3,'helper@x.com')`,
  [solo, owner, helper])

console.log('\nA farm with other people on it is protected')
await asUser(owner)
const shared = (await q(`select create_farm('Shared farm') as id`))[0].id
await q(`insert into asset (farm_id,type,name) values ($1,'animal','Bluebell')`, [shared])
const code = (await q(`select code from create_invite('member')`))[0].code
await asUser(helper)
await q(`select redeem_invite($1)`, [code])

await asUser(owner)
let refused = ''
try { await q(`select delete_own_account()`) } catch (e) { refused = (e as Error).message }
check('the owner cannot delete while someone else is on the farm',
  /other people are still on a farm you own/.test(refused), refused)
check('the farm still exists', (await q(`select 1 from farm where id=$1`, [shared])).length === 1)
check("the helper's access is untouched",
  (await q(`select 1 from farm_member where farm_id=$1 and user_id=$2`, [shared, helper])).length === 1)
check('the animal is still there',
  (await q(`select 1 from asset where farm_id=$1`, [shared])).length === 1)

console.log('\nA member can leave; the farm carries on without them')
await asUser(helper)
await q(`select delete_own_account()`)
check('the helper is gone from auth.users',
  (await q(`select 1 from auth.users where id=$1`, [helper])).length === 0)
check('the farm survives', (await q(`select 1 from farm where id=$1`, [shared])).length === 1)
check("the owner's animal survives",
  (await q(`select 1 from asset where farm_id=$1`, [shared])).length === 1)
check('the membership went with them',
  (await q(`select 1 from farm_member where farm_id=$1`, [shared])).length === 1)

console.log('\nNow alone, the owner can delete — and the farm goes with them')
await asUser(owner)
await q(`select delete_own_account()`)
check('the farm is gone', (await q(`select 1 from farm where id=$1`, [shared])).length === 0)
check('its records cascaded away',
  (await q(`select 1 from asset where farm_id=$1`, [shared])).length === 0)
check('the owner is gone from auth.users',
  (await q(`select 1 from auth.users where id=$1`, [owner])).length === 0)

console.log('\nEverything a sole owner has goes, including receipts')
await asUser(solo)
const mine = (await q(`select create_farm('Just me') as id`))[0].id
const a = (await q(`insert into asset (farm_id,type,name) values ($1,'animal','Pig') returning id`, [mine]))[0].id
const l = (await q(`insert into log (farm_id,type,timestamp,name) values ($1,'purchase',now(),'Feed') returning id`, [mine]))[0].id
await q(`insert into log_asset (log_id,asset_id,role) values ($1,$2,'subject')`, [l, a])
await q(`insert into quantity (farm_id,log_id,measure,value,unit) values ($1,$2,'price',340,'USD')`, [mine, l])
const rc = (await q(`insert into receipt (farm_id,log_id) values ($1,$2) returning id`, [mine, l]))[0].id
await q(`insert into receipt_blob (receipt_id,data) values ($1,'QUJD')`, [rc])
check('set up with records and a receipt',
  (await q(`select 1 from receipt_blob where receipt_id=$1`, [rc])).length === 1)

await q(`select delete_own_account()`)
for (const t of ['asset', 'log', 'quantity', 'receipt']) {
  check(`${t} rows cascaded away`, (await q(`select 1 from "${t}" where farm_id=$1`, [mine])).length === 0)
}
check('log_asset cascaded away', (await q(`select 1 from log_asset where log_id=$1`, [l])).length === 0)
check('the receipt image cascaded away',
  (await q(`select 1 from receipt_blob where receipt_id=$1`, [rc])).length === 0)
check('the farm row is gone', (await q(`select 1 from farm where id=$1`, [mine])).length === 0)

console.log('\nSigned out, nothing happens')
await asUser(null)
let anon = ''
try { await q(`select delete_own_account()`) } catch (e) { anon = (e as Error).message }
check('an unauthenticated call is refused', /not authenticated/.test(anon), anon)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
