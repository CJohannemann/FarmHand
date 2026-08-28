-- One account, one farm.
--
-- farm_member is keyed (farm_id, user_id), so nothing stops an account from
-- belonging to several farms — and signing up before redeeming an invite
-- does exactly that. create_farm() fires for anyone with no membership yet,
-- so that person owns a brand-new empty farm; redeeming the invite they
-- were actually sent then adds a second membership beside it.
--
-- The damage is downstream, in the client: linkFarm() (src/lib/farm.ts)
-- reads farm_member with limit 1 to decide which farm this device is. With
-- two memberships that pick was ambiguous — Postgres promises no ordering
-- without an order by, so it could differ between two calls by the same
-- account. A device would adopt one farm, pull its records, then on a later
-- boot resolve to the other and report a conflict against data it had put
-- there itself. That ordering is now pinned client-side, but a stable
-- answer is still the wrong answer while the stray farm exists: it can be
-- the one that wins, leaving someone staring at an empty farm while their
-- real records sit in the farm they were invited to.
--
-- So the stray farm is retired at the moment it becomes redundant, and the
-- ones already out there are swept up below.
--
-- Idempotent and safe to run against the live database (see
-- deploy/selfhost/apply-schema.sh's per-migration loop); schema.sql carries
-- the same definitions for a fresh install.

-- Provably an artifact nobody ever used: no records of any kind, and one
-- lone member. Custom vocabulary counts as use — adding a species is a real
-- edit someone made on purpose — so a farm carrying any is never retired.
-- Deliberately conservative: every extra condition here can only ever mean
-- fewer farms are touched.
create or replace function farm_is_unused(f uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select not exists (select 1 from asset    where asset.farm_id    = f)
     and not exists (select 1 from log      where log.farm_id      = f)
     and not exists (select 1 from location where location.farm_id = f)
     and not exists (select 1 from quantity where quantity.farm_id = f)
     and not exists (select 1 from term     where term.farm_id     = f)
     and (select count(*) from farm_member where farm_member.farm_id = f) = 1;
$fn$;

-- Drops one user's membership in their own unused farms, never touching
-- `keep`. The membership row goes, not the farm row: a farm with no members
-- is already unreachable (every RLS policy here is written against
-- farm_member), so this is as final as a delete from the outside, while
-- staying a single re-insertable row rather than a cascade across seven
-- tables. Given these farms are provably empty that caution buys nothing
-- back except the ability to undo a mistake in this function itself, which
-- is exactly the thing worth being able to undo.
--
-- The `exists` guard is the safety rail: it refuses to act unless the user
-- is left holding a membership in a farm that is NOT itself unused. Someone
-- whose farms are all empty keeps every one of them rather than being
-- stranded with none.
create or replace function retire_stray_farms(for_user uuid, keep uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  removed integer;
begin
  delete from farm_member m
   where m.user_id = for_user
     and m.farm_id <> keep
     and m.role = 'owner'
     and farm_is_unused(m.farm_id)
     and exists (
       select 1 from farm_member o
        where o.user_id = for_user
          and o.farm_id <> m.farm_id
          and not farm_is_unused(o.farm_id)
     );
  get diagnostics removed = row_count;
  return removed;
end
$fn$;

revoke all on function farm_is_unused(uuid) from public;
revoke all on function retire_stray_farms(uuid, uuid) from public;

-- Joining a real farm is the moment an auto-created one becomes redundant.
-- Identical to schema.sql's definition apart from the retire call, which is
-- deliberately last: the join itself must be durable even if this finds
-- nothing to clean up.
create or replace function redeem_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  inv farm_invite%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into inv from farm_invite
   where farm_invite.code = invite_code
     and farm_invite.redeemed_at is null
     and farm_invite.expires_at > now()
   for update;

  if inv.id is null then
    raise exception 'that invite code is invalid, expired, or already used';
  end if;

  -- Re-opening the same link twice (a stale tab, a double-tap) should not
  -- error just because the first attempt already joined them.
  insert into farm_member (farm_id, user_id, role)
  values (inv.farm_id, auth.uid(), inv.role)
  on conflict (farm_id, user_id) do nothing;

  update farm_invite set redeemed_at = now(), redeemed_by = auth.uid()
   where farm_invite.id = inv.id;

  perform retire_stray_farms(auth.uid(), inv.farm_id);

  return inv.farm_id;
end
$fn$;

revoke all on function redeem_invite(text) from public;
grant execute on function redeem_invite(text) to authenticated;

-- The accounts already carrying a stray farm, from before the above
-- existed. Same conditions, same guard, applied once across every user:
-- sole-member unused farm they own, and a real farm elsewhere to fall back
-- to. Re-running this finds nothing left to do.
delete from farm_member m
 where m.role = 'owner'
   and farm_is_unused(m.farm_id)
   and exists (
     select 1 from farm_member o
      where o.user_id = m.user_id
        and o.farm_id <> m.farm_id
        and not farm_is_unused(o.farm_id)
   );
