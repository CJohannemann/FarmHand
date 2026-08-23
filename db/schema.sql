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
  terminal_event text check (terminal_event in
                   ('sold','died','culled','harvested','consumed','processed')),
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

alter table farm enable row level security;
create policy farm_access on farm for all
  using (has_farm_access(id)) with check (has_farm_access(id));

alter table farm_member enable row level security;
create policy member_access on farm_member for all
  using (has_farm_access(farm_id));

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
