-- FarmHand — local (on-device) schema, targeting SQLite.
--
-- This is NOT a port of schema.sql. schema.sql is the multi-tenant remote
-- schema (Supabase/Postgres) and stays exactly as it is — RLS, farm_member,
-- create_farm()/has_farm_access(), and enum types all exist to police access
-- between farms sharing one server, which a single farm's own on-device copy
-- has no use for.
--
-- The local database is always rebuilt from scratch (this file plus
-- seedLocal.ts's vocabulary, run once) rather than upgraded in place — see
-- the app's cutover-on-engine-change logic. So unlike schema.sql, this file
-- never needs an `alter table` migration file layered on top of it: a future
-- local schema change just changes this file and bumps the local engine's
-- version marker, the same way this migration itself does.
--
-- No CHECK constraints on enum-like columns (status, terminal_event,
-- unit_system, measure, ...): SQLite cannot alter an existing CHECK without
-- rebuilding the table (that limitation is exactly what forced
-- db/migrations/007_equipment_terminal.sql to exist on the Postgres side),
-- and the remote schema plus the app's own TypeScript already enforce these
-- values before anything reaches either database.

create table farm (
  id           text primary key,
  name         text not null,
  timezone     text not null default 'UTC',
  unit_system  text not null default 'imperial',
  latitude     real,
  longitude    real,
  place_name   text,
  created_at   text not null,
  updated_at   text not null,
  deleted_at   text
);

create table term (
  id         text primary key,
  farm_id    text references farm(id),  -- null = system default
  vocabulary text not null,
  name       text not null,
  parent_id  text references term(id),
  created_at text not null,
  updated_at text not null,
  deleted_at text
);
create index term_farm_vocab on term (farm_id, vocabulary);

create table location (
  id         text primary key,
  farm_id    text not null references farm(id),
  name       text not null,
  type       text not null,
  parent_id  text references location(id),
  geometry   text,  -- GeoJSON, as JSON text; deferred, column reserved
  created_at text not null,
  updated_at text not null,
  deleted_at text
);
create index location_farm_parent on location (farm_id, parent_id);

create table asset (
  id             text primary key,
  farm_id        text not null references farm(id),
  type           text not null,
  name           text not null,
  status         text not null default 'active',
  terminal_event text,
  parent_id      text references asset(id),
  attributes     text not null default '{}',  -- JSON text
  created_at     text not null,
  updated_at     text not null,
  deleted_at     text
);
create index asset_farm_type_status on asset (farm_id, type, status);
create index asset_farm_parent on asset (farm_id, parent_id);

create table log (
  id          text primary key,
  farm_id     text not null references farm(id),
  type        text not null,
  timestamp   text not null,
  status      text not null default 'done',
  name        text,
  notes       text,
  location_id text references location(id),
  created_by  text,  -- a remote auth.users id; no local FK, nothing to check it against
  attributes  text not null default '{}',  -- JSON text
  created_at  text not null,
  updated_at  text not null,
  deleted_at  text
);
create index log_farm_timestamp on log (farm_id, timestamp desc);
create index log_planned on log (farm_id, status, timestamp) where status = 'planned';
create index log_farm_type_timestamp on log (farm_id, type, timestamp desc);

create table log_asset (
  log_id   text not null references log(id),
  asset_id text not null references asset(id),
  role     text not null default 'subject',
  amount   real,
  unit     text,
  primary key (log_id, asset_id, role)
);
create index log_asset_asset_role on log_asset (asset_id, role);

create table quantity (
  id         text primary key,
  farm_id    text not null references farm(id),
  log_id     text not null references log(id),
  measure    text not null,
  value      real not null,
  unit       text not null,
  label      text,
  asset_id   text references asset(id),
  created_at text not null,
  updated_at text not null,
  deleted_at text
);
create index quantity_log on quantity (log_id);
create index quantity_farm_measure on quantity (farm_id, measure);

-- ------------------------------------------------------ local sync bookkeeping

-- Absent from schema.sql: the server has no use for these, and they must
-- never be pushed.

create table sync_state (
  key   text primary key,
  value text
);

create table sync_outbox (
  tbl       text not null,
  row_id    text not null,
  queued_at text not null,
  primary key (tbl, row_id)
);

-- Replaces Postgres's `set_config('farmhand.applying', ...)` session GUC,
-- which SQLite has no equivalent of — a trigger can only read this from a
-- table, not from an out-of-band JS flag. Always exactly one row.
create table sync_control (
  applying integer not null default 0
);
insert into sync_control (applying) values (0);

-- Every local write records its row id in sync_outbox via a trigger, which is
-- how a push knows what changed. Rows arriving from a pull are applied with
-- sync_control.applying = 1, which the WHEN clause below skips — otherwise
-- pulling would mark rows dirty and push them straight back, forever.
--
-- Two literal triggers per table (insert, update) rather than a generated
-- loop: SQLite has no plpgsql/format()/`do $$` block to drive that loop with
-- (the mechanism db/sync-local.sql uses on the Postgres side), and unlike
-- Postgres, a single SQLite trigger cannot fire on more than one event type,
-- so "insert or update" has to be two triggers rather than one.

create trigger sync_farm_insert after insert on farm
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('farm', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger sync_farm_update after update on farm
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('farm', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger sync_term_insert after insert on term
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('term', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger sync_term_update after update on term
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('term', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger sync_location_insert after insert on location
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('location', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger sync_location_update after update on location
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('location', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger sync_asset_insert after insert on asset
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('asset', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger sync_asset_update after update on asset
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('asset', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger sync_log_insert after insert on log
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('log', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger sync_log_update after update on log
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('log', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

-- log_asset is keyed by a composite; flatten it into one string, same as
-- sync_enqueue() does on the Postgres side.
create trigger sync_log_asset_insert after insert on log_asset
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at)
  values ('log_asset', new.log_id || '|' || new.asset_id || '|' || new.role, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger sync_log_asset_update after update on log_asset
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at)
  values ('log_asset', new.log_id || '|' || new.asset_id || '|' || new.role, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger sync_quantity_insert after insert on quantity
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('quantity', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger sync_quantity_update after update on quantity
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('quantity', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
