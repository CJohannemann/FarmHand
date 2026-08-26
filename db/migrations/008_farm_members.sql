-- Multi-user farm access: an owner can invite specific people into their
-- existing farm (their own login, not a shared account or an accidental
-- new empty farm), see who's on it, and manage their roles. See
-- db/schema.sql's farm_invite table and the functions below for the full
-- design. Idempotent and safe to run once against the existing live
-- database (see deploy/selfhost/apply-schema.sh's per-migration loop) —
-- schema.sql carries the same additions for a fresh install.

create table if not exists farm_invite (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references farm(id) on delete cascade,
  code        text not null unique,
  role        farm_role not null default 'member',
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz
);
create index if not exists farm_invite_pending_code_idx on farm_invite (code)
  where redeemed_at is null;

create or replace function has_farm_role(f uuid, roles farm_role[])
returns boolean language sql stable security definer as $fn$
  select exists (
    select 1 from farm_member
    where farm_member.farm_id = f and farm_member.user_id = auth.uid()
      and farm_member.role = any(roles)
  );
$fn$;

-- Was a single permissive "for all" policy — harmless while every farm had
-- one user, a real gap once "owner-only manage" became a real boundary.
-- Dropping it is what actually matters here: RLS policies are OR'd
-- together, so leaving it in place alongside the new, narrower ones below
-- would make this whole migration a no-op.
drop policy if exists member_access on farm_member;
drop policy if exists farm_member_read on farm_member;
drop policy if exists farm_member_write on farm_member;
drop policy if exists farm_member_update on farm_member;
drop policy if exists farm_member_delete on farm_member;
create policy farm_member_read on farm_member for select
  using (has_farm_access(farm_id));
create policy farm_member_write on farm_member for insert
  with check (has_farm_role(farm_id, array['owner']::farm_role[]));
create policy farm_member_update on farm_member for update
  using (has_farm_role(farm_id, array['owner']::farm_role[]))
  with check (has_farm_role(farm_id, array['owner']::farm_role[]));
create policy farm_member_delete on farm_member for delete
  using (has_farm_role(farm_id, array['owner']::farm_role[]));

alter table farm_invite enable row level security;

create or replace function create_invite(wanted_role farm_role default 'member')
returns table(code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  f uuid;
  new_code text;
begin
  select farm_member.farm_id into f from farm_member
   where farm_member.user_id = auth.uid() and farm_member.role = 'owner'
   limit 1;
  if f is null then
    raise exception 'only a farm''s owner can invite members';
  end if;

  new_code := array_to_string(
    array(select substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                         floor(random() * 32)::int + 1, 1)
            from generate_series(1, 8)),
    '');

  return query
    insert into farm_invite (farm_id, code, role, created_by)
    values (f, new_code, wanted_role, auth.uid())
    returning farm_invite.code, farm_invite.expires_at;
end
$fn$;

revoke all on function create_invite(farm_role) from public;
grant execute on function create_invite(farm_role) to authenticated;

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

  insert into farm_member (farm_id, user_id, role)
  values (inv.farm_id, auth.uid(), inv.role)
  on conflict (farm_id, user_id) do nothing;

  update farm_invite set redeemed_at = now(), redeemed_by = auth.uid()
   where farm_invite.id = inv.id;

  return inv.farm_id;
end
$fn$;

revoke all on function redeem_invite(text) from public;
grant execute on function redeem_invite(text) to authenticated;

create or replace function remove_farm_member(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  f uuid;
begin
  select farm_member.farm_id into f from farm_member
   where farm_member.user_id = auth.uid() and farm_member.role = 'owner'
   limit 1;
  if f is null then
    raise exception 'only a farm''s owner can remove members';
  end if;
  if target = auth.uid() then
    raise exception 'the owner cannot remove themself';
  end if;

  delete from farm_member
   where farm_member.farm_id = f and farm_member.user_id = target;
end
$fn$;

revoke all on function remove_farm_member(uuid) from public;
grant execute on function remove_farm_member(uuid) to authenticated;

create or replace function update_farm_member_role(target uuid, new_role farm_role)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  f uuid;
begin
  select farm_member.farm_id into f from farm_member
   where farm_member.user_id = auth.uid() and farm_member.role = 'owner'
   limit 1;
  if f is null then
    raise exception 'only a farm''s owner can change member roles';
  end if;
  if target = auth.uid() and new_role <> 'owner' then
    raise exception 'the owner cannot demote themself';
  end if;

  update farm_member set role = new_role
   where farm_member.farm_id = f and farm_member.user_id = target;
end
$fn$;

revoke all on function update_farm_member_role(uuid, farm_role) from public;
grant execute on function update_farm_member_role(uuid, farm_role) to authenticated;

create or replace function list_farm_members()
returns table(user_id uuid, email text, role farm_role, joined_at timestamptz)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  f uuid;
begin
  select farm_member.farm_id into f from farm_member
   where farm_member.user_id = auth.uid() limit 1;
  if f is null then
    raise exception 'not a member of any farm';
  end if;

  return query
    select fm.user_id, u.email::text, fm.role, fm.created_at
      from farm_member fm
      join auth.users u on u.id = fm.user_id
     where fm.farm_id = f
     order by fm.created_at;
end
$fn$;

revoke all on function list_farm_members() from public;
grant execute on function list_farm_members() to authenticated;
