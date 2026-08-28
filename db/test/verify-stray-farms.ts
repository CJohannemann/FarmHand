// One account, one farm — the stray-farm retirement in db/schema.sql
// (farm_is_unused, retire_stray_farms, and redeem_invite's call to it),
// driven against a real Postgres (PGlite) with two signed-in users, same
// set_config() stand-in for auth.uid() as verify-invites.ts.
//
// The bug this pins down: signing up before redeeming an invite leaves an
// account owning an empty auto-created farm AND belonging to the farm it
// was invited to. The client picks one of those to be (linkFarm(), in
// src/lib/farm.ts) — and the stray one winning means someone stares at an
// empty farm while their real records sit in the farm they joined.
//
//   npm run verify:stray-farms
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
const farmsOf = async (u: string) =>
  (await q(`select farm_id from farm_member where user_id=$1`, [u])).map((r) => r.farm_id)

const chris = '11111111-1111-1111-1111-111111111111'
const dad = '22222222-2222-2222-2222-222222222222'
const wife = '33333333-3333-3333-3333-333333333333'
const loner = '44444444-4444-4444-4444-444444444444'
const vocab = '55555555-5555-5555-5555-555555555555'
await q(
  `insert into auth.users (id, email) values ($1,'chris@example.com'),($2,'dad@example.com'),($3,'wife@example.com'),($4,'loner@example.com'),($5,'vocab@example.com')`,
  [chris, dad, wife, loner, vocab],
)

console.log('\nChris starts a farm and puts a pig in it')
await asUser(chris)
const realFarm = (await q(`select create_farm('Home place') as id`))[0].id
await q(`insert into asset (farm_id, type, name) values ($1,'animal','Hamlet')`, [realFarm])

console.log('\nDad signs up before being invited — the stray farm')
await asUser(dad)
const strayFarm = (await q(`select create_farm('My farm') as id`))[0].id
check('dad owns a farm of his own', (await farmsOf(dad)).length === 1)
check('the stray farm is recognized as unused',
  (await q(`select farm_is_unused($1) as u`, [strayFarm]))[0].u === true)
check("Chris's farm is NOT unused — it has a pig",
  (await q(`select farm_is_unused($1) as u`, [realFarm]))[0].u === false)

console.log('\nDad redeems the invite — the stray farm is retired')
await asUser(chris)
const dadCode = (await q(`select code from create_invite('member')`))[0].code
await asUser(dad)
await q(`select redeem_invite($1)`, [dadCode])
const dadFarms = await farmsOf(dad)
check('dad is in exactly one farm', dadFarms.length === 1, JSON.stringify(dadFarms))
check("that one farm is Chris's, not the stray", dadFarms[0] === realFarm)
check('the stray farm row still exists, merely unreachable',
  (await q(`select 1 as x from farm where id=$1`, [strayFarm])).length === 1)

console.log('\nA farm holding real records is never retired')
await asUser(wife)
const wifeFarm = (await q(`select create_farm('Wife farm') as id`))[0].id
await q(`insert into asset (farm_id, type, name) values ($1,'animal','Bessie')`, [wifeFarm])
await asUser(chris)
const wifeCode = (await q(`select code from create_invite('member')`))[0].code
await asUser(wife)
await q(`select redeem_invite($1)`, [wifeCode])
const wifeFarms = await farmsOf(wife)
check('wife keeps both — her farm has records', wifeFarms.length === 2, JSON.stringify(wifeFarms))

console.log('\nCustom vocabulary counts as use')
await asUser(vocab)
const vocabFarm = (await q(`select create_farm('Vocab farm') as id`))[0].id
check('empty to begin with',
  (await q(`select farm_is_unused($1) as u`, [vocabFarm]))[0].u === true)
await q(`insert into term (farm_id, vocabulary, name) values ($1,'species','Alpaca')`, [vocabFarm])
check('a farm with custom vocabulary is not unused',
  (await q(`select farm_is_unused($1) as u`, [vocabFarm]))[0].u === false)

console.log('\nSomeone whose only farm is empty is never stranded')
await asUser(loner)
const lonerFarm = (await q(`select create_farm('Just me') as id`))[0].id
check('the empty farm is unused',
  (await q(`select farm_is_unused($1) as u`, [lonerFarm]))[0].u === true)
await q(`select retire_stray_farms($1, '00000000-0000-0000-0000-000000000000')`, [loner])
check('but it is kept — there is no other real farm to fall back to',
  (await farmsOf(loner)).length === 1)

console.log('\nThe one-off cleanup for memberships that predate all this')
// Rebuild the exact pre-fix state by hand: dad back in his stray farm.
await q(`insert into farm_member (farm_id, user_id, role) values ($1,$2,'owner')`,
  [strayFarm, dad])
check('dad is in two farms again', (await farmsOf(dad)).length === 2)
const sweep = `
  delete from farm_member m
   where m.role = 'owner'
     and farm_is_unused(m.farm_id)
     and exists (
       select 1 from farm_member o
        where o.user_id = m.user_id and o.farm_id <> m.farm_id
          and not farm_is_unused(o.farm_id))`
await q(sweep)
const swept = await farmsOf(dad)
check('the sweep leaves him in exactly one farm', swept.length === 1, JSON.stringify(swept))
check("and it is Chris's farm", swept[0] === realFarm)
check('the loner still has his farm after the sweep', (await farmsOf(loner)).length === 1)
check('wife still has both after the sweep', (await farmsOf(wife)).length === 2)
await q(sweep)
check('re-running the sweep is a no-op', (await farmsOf(dad)).length === 1)

// The SQL-level truth checkStillMember() (src/lib/members.ts) now relies on.
// Wife is the case that matters: she belongs to Chris's farm AND owns her
// own real one. Removing her from Chris's farm has to read as revoked on a
// device linked to Chris's farm — which an unfiltered "do I belong to
// anything?" cannot see, because her own farm keeps answering yes.
console.log('\nRevocation is per-farm, not "any farm at all"')
await db.exec(`grant select on farm_member to authenticated;`)
await asUser(chris)
const wifeUser = (await q(`select user_id from farm_member where farm_id=$1 and user_id=$2`,
  [realFarm, wife]))[0]?.user_id
check('wife is on Chris\'s farm to begin with', wifeUser === wife)
await q(`select remove_farm_member($1)`, [wife])

await asUser(wife)
await db.exec(`set role authenticated;`)
const scoped = await q(`select farm_id from farm_member where farm_id=$1 limit 1`, [realFarm])
const unscoped = await q(`select farm_id from farm_member limit 1`)
await db.exec(`reset role;`)

check('scoped check sees zero rows — correctly reads as revoked', scoped.length === 0)
check('unscoped check still sees a row — the bug this replaces',
  unscoped.length === 1, JSON.stringify(unscoped))
check('and that row is her own farm, not the one she was removed from',
  unscoped[0]?.farm_id === wifeFarm)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
