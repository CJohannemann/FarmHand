-- FarmHand — initial Postgres schema
-- Targets Supabase (auth.users assumed). Offline-first: all primary keys are
-- client-generatable UUIDs, so a device with no signal can create records that
-- will never collide when it syncs.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- tenancy --

create table farm (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  timezone     text not null default 'UTC',
  unit_system  text not null default 'imperial'
                 check (unit_system in ('imperial','metric')),
  latitude     numeric,          -- for weather; see migrations/003
  longitude    numeric,
  place_name   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create type farm_role as enum ('owner','manager','member','viewer');

create table farm_member (
  farm_id    uuid not null references farm(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       farm_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);

-- An owner-generated, single-use code that lets one specific new person
-- join an existing farm as a real member with their own login, instead of
-- every device sharing one account or a fresh sign-up always starting its
-- own empty farm. Never read directly by a client — redeem_invite() below
-- is the only way in or out of this table from the outside.
create table farm_invite (
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
create index farm_invite_pending_code_idx on farm_invite (code)
  where redeemed_at is null;

-- Every table below carries farm_id. Tenant isolation is enforced by RLS
-- against farm_member, never by application code.

-- -------------------------------------------------------------- taxonomy --

create table term (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid references farm(id) on delete cascade,  -- null = system default
  vocabulary text not null,   -- species | breed | variety | treatment | material
                              -- | method | log_category | supplier | unit
  name       text not null,
  parent_id  uuid references term(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on term (farm_id, vocabulary);

-- ------------------------------------------------------------- locations --

create table location (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references farm(id) on delete cascade,
  name       text not null,
  type       text not null,   -- farm | field | paddock | bed | barn | pen
                              -- | greenhouse | storage
  parent_id  uuid references location(id) on delete set null,
  geometry   jsonb,           -- GeoJSON; deferred, column reserved
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on location (farm_id, parent_id);

-- ---------------------------------------------------------------- assets --

create type asset_type as enum
  ('animal','group','planting','land','equipment','structure','lot');

create table asset (
  id             uuid primary key default gen_random_uuid(),
  farm_id        uuid not null references farm(id) on delete cascade,
  type           asset_type not null,
  name           text not null,
  status         text not null default 'active'
                   check (status in ('active','archived')),
  terminal_event text
                   constraint asset_terminal_event_check check (terminal_event in
                   ('sold','died','culled','harvested','consumed','processed',
                    'retired','scrapped')),
  parent_id      uuid references asset(id) on delete set null,
  attributes     jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index on asset (farm_id, type, status);
create index on asset (farm_id, parent_id);
create index on asset using gin (attributes);

-- ------------------------------------------------------------------ logs --

create table log (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references farm(id) on delete cascade,
  type        text not null,   -- observation | activity | harvest | seeding
                               -- | transplant | input_application | birth | death
                               -- | weight | breeding | movement | sale | purchase
                               -- | maintenance | processing | disposition
  timestamp   timestamptz not null,
  status      text not null default 'done'
                check (status in ('planned','done','cancelled')),
  name        text,
  notes       text,
  location_id uuid references location(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  attributes  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
-- The two dominant read patterns: a farm's timeline, and its open task list.
create index on log (farm_id, timestamp desc);
create index on log (farm_id, status, timestamp) where status = 'planned';
create index on log (farm_id, type, timestamp desc);

create type asset_role as enum ('subject','input','output');

create table log_asset (
  log_id   uuid not null references log(id) on delete cascade,
  asset_id uuid not null references asset(id) on delete cascade,
  role     asset_role not null default 'subject',
  -- Partial consumption: how much of an input lot this log actually used.
  amount   numeric,
  unit     text,
  primary key (log_id, asset_id, role)
);
create index on log_asset (asset_id, role);

-- ------------------------------------------------------------ quantities --

create table quantity (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references farm(id) on delete cascade,
  log_id     uuid not null references log(id) on delete cascade,
  measure    text not null
               check (measure in ('weight','count','volume','area','length',
                                  'temperature','price','time')),
  value      numeric not null,
  unit       text not null,
  label      text,
  asset_id   uuid references asset(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on quantity (log_id);
create index on quantity (farm_id, measure);

-- ----------------------------------------------------------------- files --

create table attachment (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references farm(id) on delete cascade,
  log_id      uuid references log(id) on delete cascade,
  asset_id    uuid references asset(id) on delete cascade,
  storage_key text not null,
  mime_type   text,
  bytes       bigint,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- --------------------------------------------------------- row security --

create or replace function has_farm_access(f uuid)
returns boolean language sql stable security definer as $fn$
  select exists (
    select 1 from farm_member
    where farm_member.farm_id = f and farm_member.user_id = auth.uid()
  );
$fn$;

-- Same shape as has_farm_access(), narrowed to specific roles — the check
-- behind "only the owner can manage members/invites".
create or replace function has_farm_role(f uuid, roles farm_role[])
returns boolean language sql stable security definer as $fn$
  select exists (
    select 1 from farm_member
    where farm_member.farm_id = f and farm_member.user_id = auth.uid()
      and farm_member.role = any(roles)
  );
$fn$;

alter table farm enable row level security;
create policy farm_access on farm for all
  using (has_farm_access(id)) with check (has_farm_access(id));

alter table farm_member enable row level security;
-- Any member can see the roster; only the owner can change it. Was a single
-- permissive "for all" policy — harmless while every farm had one user, a
-- real gap once "owner-only manage" became a real boundary (any member
-- could otherwise insert/update/delete any farm_member row directly via
-- PostgREST, bypassing the app's own owner-only UI entirely).
create policy farm_member_read on farm_member for select
  using (has_farm_access(farm_id));
create policy farm_member_write on farm_member for insert
  with check (has_farm_role(farm_id, array['owner']::farm_role[]));
create policy farm_member_update on farm_member for update
  using (has_farm_role(farm_id, array['owner']::farm_role[]))
  with check (has_farm_role(farm_id, array['owner']::farm_role[]));
create policy farm_member_delete on farm_member for delete
  using (has_farm_role(farm_id, array['owner']::farm_role[]));

-- Never touched directly by a client (see farm_invite's own comment above)
-- — RLS here is a backstop, not the access path. Enabling it with no
-- policies at all denies every direct client query outright; the security
-- definer RPCs below reach it anyway, since those run as the function
-- owner rather than under RLS.
alter table farm_invite enable row level security;

alter table term enable row level security;
create policy tenant_all on term for all
  using (farm_id is null or has_farm_access(farm_id))
  with check (has_farm_access(farm_id));

alter table location enable row level security;
create policy tenant_all on location for all
  using (has_farm_access(farm_id)) with check (has_farm_access(farm_id));

alter table asset enable row level security;
create policy tenant_all on asset for all
  using (has_farm_access(farm_id)) with check (has_farm_access(farm_id));

alter table log enable row level security;
create policy tenant_all on log for all
  using (has_farm_access(farm_id)) with check (has_farm_access(farm_id));

alter table quantity enable row level security;
create policy tenant_all on quantity for all
  using (has_farm_access(farm_id)) with check (has_farm_access(farm_id));

alter table attachment enable row level security;
create policy tenant_all on attachment for all
  using (has_farm_access(farm_id)) with check (has_farm_access(farm_id));

-- log_asset carries no farm_id of its own; it inherits via its log.
alter table log_asset enable row level security;
create policy log_asset_access on log_asset for all
  using (exists (select 1 from log
                 where log.id = log_id and has_farm_access(log.farm_id)));

-- ------------------------------------------------------------ sync notes --

-- Soft deletes only. Hard deletes and offline sync do not mix: a device that
-- has been offline for a week must be *told* a record died, not simply find it
-- missing. updated_at drives the incremental pull and wants a trigger.

-- ------------------------------------------------------ farm creation --

create or replace function create_farm(farm_name text, wanted_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into farm (id, name)
  values (coalesce(wanted_id, gen_random_uuid()), farm_name)
  on conflict (id) do nothing
  returning id into new_id;

  -- Someone already owns a farm with this id.
  if new_id is null then
    raise exception 'farm already exists';
  end if;

  insert into farm_member (farm_id, user_id, role)
  values (new_id, auth.uid(), 'owner');

  return new_id;
end
$fn$;

revoke all on function create_farm(text, uuid) from public;
grant execute on function create_farm(text, uuid) to authenticated;

-- ------------------------------------------------------ farm membership --

-- Owner-only: generates a single-use code for one specific new person to
-- join this farm as a real member with their own login. Excludes
-- ambiguous-looking characters (0/O, 1/I) since this is meant to be read
-- aloud or typed by hand, not just pasted from a link.
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

-- Anyone signed in can call this — the invite code itself is what's
-- authorizing, not the caller's existing membership (they usually have
-- none yet). The only way a client ever touches farm_invite; the table's
-- own RLS (no policies at all) blocks every other path outright. `for
-- update` so two simultaneous redemptions of the same leaked code can't
-- both succeed.
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

  return inv.farm_id;
end
$fn$;

revoke all on function redeem_invite(text) from public;
grant execute on function redeem_invite(text) to authenticated;

-- Owner-only. Refuses to let the owner remove themself — that would leave
-- the farm with no owner at all, and no other RPC here can create one.
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

-- Owner-only, same self-protection as remove_farm_member — an owner can
-- promote someone else to owner, but can't demote themself with no other
-- owner in place (would leave the farm unmanageable by anyone).
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

-- Readable by any member, not just the owner — everyone can see the team
-- roster; only the owner gets the manage controls (the three functions
-- above). Joins auth.users for the email address, which PostgREST has no
-- direct access to otherwise.
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
