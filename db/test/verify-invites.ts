// Drives the new invite/membership RPCs (db/schema.sql's create_invite,
// redeem_invite, remove_farm_member, update_farm_member_role,
// list_farm_members) against a real Postgres (PGlite), simulating two
// different signed-in users by switching a session-local "who is this"
// setting between statements — the app's actual auth.uid() reads the JWT's
// `sub` claim the same way, just via PostgREST instead of set_config().
//
// Also verifies the RLS tightening on farm_member actually enforces
// "owner-only writes", not just that the policy SQL parses: connects as the
// `authenticated` role (not the table-owning role everything else in this
// file runs as) and confirms a non-owner's direct insert is rejected.
//
//   npm run verify:invites
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

// A configurable stand-in for Supabase's auth.uid() — reads a session
// variable the test can change between statements, rather than the other
// verify*.ts files' fixed `select null::uuid`, since exercising these RPCs
// as two different people is the entire point here.
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
// authenticated normally gets broad DML + RLS-restricted access via the
// real supabase/postgres image's own bootstrapping, which this bare PGlite
// instance doesn't have — granted directly so the RLS check below fails
// because of the *policy*, not a missing grant.
await db.exec(`grant select, insert, update, delete on farm_member to authenticated;`)

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as any[]
const asUser = async (id: string | null) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id ?? ''])
}

const owner = '11111111-1111-1111-1111-111111111111'
const employee = '22222222-2222-2222-2222-222222222222'
const stranger = '33333333-3333-3333-3333-333333333333'
await q(`insert into auth.users (id, email) values ($1,'owner@example.com'),($2,'employee@example.com'),($3,'stranger@example.com')`,
  [owner, employee, stranger])

console.log('\nOwner creates a farm and invites someone')
await asUser(owner)
const [{ create_farm: farmId }] = await q(`select create_farm('Test Farm') as create_farm`)
const [{ code, expires_at }] = await q(`select * from create_invite('member')`)
check('invite code looks right', /^[A-Z0-9]{8}$/.test(code), code)
check('invite expires in the future', new Date(expires_at) > new Date())

// A single sample only has a modest chance of catching an off-by-one in the
// code generator (this exact bug shipped once already: Postgres's ::int
// cast rounds rather than truncates, so `(random()*32)::int` occasionally
// evaluated to 32 — one past the 32-character alphabet — and substr()
// silently returned '' for that position instead of erroring, producing a
// 7-character code). Many samples make that failure mode reliably visible
// instead of a ~1-in-5 chance per run.
//
// Deliberately 200 separate round trips, not one query cross-joining
// generate_series with create_invite() — confirmed directly that Postgres
// evaluates a FROM-clause function call that doesn't reference the other
// side of the join exactly once and reuses that single result for every
// row, volatile or not, which silently turned this into 200 copies of one
// call instead of 200 independent ones.
const manyCodes: string[] = []
for (let i = 0; i < 200; i++) {
  const [{ code: c }] = await q(`select code from create_invite('member')`)
  manyCodes.push(c)
}
check('200 generated codes are all exactly 8 characters',
  manyCodes.every((c) => typeof c === 'string' && c.length === 8),
  manyCodes.filter((c) => c.length !== 8).join(', '))
check('200 generated codes are all distinct',
  new Set(manyCodes).size === manyCodes.length,
  `${new Set(manyCodes).size} distinct of 200`)

console.log('\nA different signed-in user redeems it')
await asUser(employee)
const [{ redeem_invite: redeemedFarmId }] = await q(`select redeem_invite($1) as redeem_invite`, [code])
check('redeeming returns the right farm', redeemedFarmId === farmId)
const [member] = await q(
  `select role from farm_member where farm_id=$1 and user_id=$2`, [farmId, employee])
check('employee is now a member', member?.role === 'member', JSON.stringify(member))

console.log('\nThe same code cannot be used twice')
await asUser(stranger)
let secondRedeemError = ''
try { await q(`select redeem_invite($1)`, [code]) } catch (e) { secondRedeemError = (e as Error).message }
check('second redemption is rejected', /invalid, expired, or already used/.test(secondRedeemError),
  secondRedeemError)
const [strangerRow] = await q(
  `select 1 as x from farm_member where farm_id=$1 and user_id=$2`, [farmId, stranger])
check('stranger did not get added', strangerRow === undefined)

console.log('\nAn expired invite cannot be redeemed')
await asUser(owner)
const [{ code: staleCode }] = await q(`select * from create_invite('viewer')`)
await q(`update farm_invite set expires_at = now() - interval '1 minute' where code=$1`, [staleCode])
await asUser(stranger)
let expiredError = ''
try { await q(`select redeem_invite($1)`, [staleCode]) } catch (e) { expiredError = (e as Error).message }
check('expired invite is rejected', /invalid, expired, or already used/.test(expiredError), expiredError)

console.log('\nA non-owner cannot manage members')
await asUser(employee)
let deniedInvite = '', deniedRemove = '', deniedRole = ''
try { await q(`select create_invite('member')`) } catch (e) { deniedInvite = (e as Error).message }
try { await q(`select remove_farm_member($1)`, [owner]) } catch (e) { deniedRemove = (e as Error).message }
try { await q(`select update_farm_member_role($1,'manager')`, [owner]) } catch (e) { deniedRole = (e as Error).message }
check('cannot create an invite', /only a farm's owner/.test(deniedInvite), deniedInvite)
check('cannot remove a member', /only a farm's owner/.test(deniedRemove), deniedRemove)
check('cannot change a role', /only a farm's owner/.test(deniedRole), deniedRole)

console.log('\nlist_farm_members() shows the roster to any member, owner or not')
const roster = await q(`select * from list_farm_members()`)
const emails = roster.map((r) => r.email).sort()
check('both members are visible', JSON.stringify(emails) ===
  JSON.stringify(['employee@example.com', 'owner@example.com']), JSON.stringify(emails))

console.log('\nRLS actually enforces owner-only writes to farm_member, not just the RPCs')
await db.exec(`set role authenticated;`)
await asUser(employee)
let directInsertError = ''
try {
  await q(`insert into farm_member (farm_id, user_id, role) values ($1,$2,'owner')`,
    [farmId, stranger])
} catch (e) { directInsertError = (e as Error).message }
await db.exec(`reset role;`)
check('a non-owner cannot write farm_member directly, bypassing the RPCs',
  /row-level security|permission denied/i.test(directInsertError), directInsertError)

console.log('\nOwner removes the employee')
await asUser(owner)
await q(`select remove_farm_member($1)`, [employee])
const [gone] = await q(`select 1 as x from farm_member where farm_id=$1 and user_id=$2`, [farmId, employee])
check('employee no longer a member', gone === undefined)

console.log('\nThe owner cannot remove or demote themself')
let selfRemoveError = '', selfDemoteError = ''
try { await q(`select remove_farm_member($1)`, [owner]) } catch (e) { selfRemoveError = (e as Error).message }
try { await q(`select update_farm_member_role($1,'member')`, [owner]) } catch (e) { selfDemoteError = (e as Error).message }
check('cannot remove themself', /cannot remove themself/.test(selfRemoveError), selfRemoveError)
check('cannot demote themself', /cannot demote themself/.test(selfDemoteError), selfDemoteError)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
