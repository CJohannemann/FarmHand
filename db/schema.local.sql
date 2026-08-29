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

create table if not exists farm (
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

create table if not exists term (
  id         text primary key,
  farm_id    text references farm(id),  -- null = system default
  vocabulary text not null,
  name       text not null,
  parent_id  text references term(id),
  created_at text not null,
  updated_at text not null,
  deleted_at text
);
create index if not exists term_farm_vocab on term (farm_id, vocabulary);

create table if not exists location (
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
create index if not exists location_farm_parent on location (farm_id, parent_id);

create table if not exists asset (
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
create index if not exists asset_farm_type_status on asset (farm_id, type, status);
create index if not exists asset_farm_parent on asset (farm_id, parent_id);

create table if not exists log (
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
create index if not exists log_farm_timestamp on log (farm_id, timestamp desc);
create index if not exists log_planned on log (farm_id, status, timestamp) where status = 'planned';
create index if not exists log_farm_type_timestamp on log (farm_id, type, timestamp desc);

create table if not exists log_asset (
  log_id   text not null references log(id),
  asset_id text not null references asset(id),
  role     text not null default 'subject',
  amount   real,
  unit     text,
  primary key (log_id, asset_id, role)
);
create index if not exists log_asset_asset_role on log_asset (asset_id, role);

create table if not exists quantity (
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
create index if not exists quantity_log on quantity (log_id);
create index if not exists quantity_farm_measure on quantity (farm_id, measure);

-- ----------------------------------------------------------------- receipts

-- A photographed receipt, hanging off the log that records the purchase.
--
-- Split across two tables on purpose. Everything needed to LIST receipts —
-- which purchase, when, how big — is small enough to sync like any other
-- row, so a phone that never took the photo can still show that a receipt
-- exists and include it in a year's export. The bytes are the opposite:
-- pulling every receipt a farm has ever taken onto a new device, just
-- because it signed in, would be tens of megabytes for something almost
-- nobody looks at twice. So receipt_blob is push-only (see PUSH_ONLY_TABLES
-- in src/lib/syncCore.ts) and fetched one at a time, on demand.
create table if not exists receipt (
  id          text primary key,
  farm_id     text not null references farm(id),
  log_id      text not null references log(id),
  captured_at text not null,
  mime        text not null default 'image/jpeg',
  byte_size   integer not null default 0,
  width       integer,
  height      integer,
  created_at  text not null,
  updated_at  text not null,
  deleted_at  text
);
create index if not exists receipt_log on receipt (log_id);
create index if not exists receipt_farm_captured on receipt (farm_id, captured_at desc);

-- Base64 rather than a BLOB: this column's whole job is to survive the trip
-- through PostgREST's JSON, and text goes as-is where bytea would arrive
-- hex-encoded and need decoding on both sides. The ~33% size premium over
-- raw bytes is paid back by the client downscaling every image to roughly
-- 200KB before it ever gets here (see src/lib/image.ts).
create table if not exists receipt_blob (
  receipt_id text primary key references receipt(id),
  data       text not null
);

-- ------------------------------------------------------------ active farm

-- Which farm the app is currently showing.
--
-- One account can belong to several farms — farm_member is keyed
-- (farm_id, user_id) and the server has always allowed it — and sync pulls
-- every farm the account can see, so this database holds all of them at
-- once. Every read scopes itself to whichever is active.
--
-- A one-row table rather than a value threaded through as a bind parameter,
-- and that is deliberate: it lets a query say
--   and farm_id = (select id from active_farm)
-- without renumbering its $1, $2, $3. Fifty-odd queries had to gain that
-- clause; doing it without touching a single existing placeholder is the
-- difference between a mechanical change and a bug hunt.
create table if not exists active_farm (
  id text not null references farm(id)
);

-- ------------------------------------------------------ local sync bookkeeping

-- Absent from schema.sql: the server has no use for these, and they must
-- never be pushed.

create table if not exists sync_state (
  key   text primary key,
  value text
);

create table if not exists sync_outbox (
  tbl       text not null,
  row_id    text not null,
  queued_at text not null,
  primary key (tbl, row_id)
);

-- Replaces Postgres's `set_config('farmhand.applying', ...)` session GUC,
-- which SQLite has no equivalent of — a trigger can only read this from a
-- table, not from an out-of-band JS flag. Always exactly one row.
create table if not exists sync_control (
  applying integer not null default 0
);
insert into sync_control (applying) select 0
  where not exists (select 1 from sync_control);

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

create trigger if not exists sync_farm_insert after insert on farm
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('farm', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger if not exists sync_farm_update after update on farm
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('farm', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger if not exists sync_term_insert after insert on term
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('term', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger if not exists sync_term_update after update on term
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('term', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger if not exists sync_location_insert after insert on location
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('location', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger if not exists sync_location_update after update on location
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('location', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger if not exists sync_asset_insert after insert on asset
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('asset', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger if not exists sync_asset_update after update on asset
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('asset', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger if not exists sync_log_insert after insert on log
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('log', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger if not exists sync_log_update after update on log
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('log', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

-- log_asset is keyed by a composite; flatten it into one string, same as
-- sync_enqueue() does on the Postgres side.
create trigger if not exists sync_log_asset_insert after insert on log_asset
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at)
  values ('log_asset', new.log_id || '|' || new.asset_id || '|' || new.role, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger if not exists sync_log_asset_update after update on log_asset
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at)
  values ('log_asset', new.log_id || '|' || new.asset_id || '|' || new.role, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger if not exists sync_quantity_insert after insert on quantity
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('quantity', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger if not exists sync_quantity_update after update on quantity
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('quantity', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

create trigger if not exists sync_receipt_insert after insert on receipt
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('receipt', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
create trigger if not exists sync_receipt_update after update on receipt
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at) values ('receipt', new.id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;

-- Insert only, no update trigger: a receipt's bytes are written once when
-- the photo is taken and never edited (retaking one makes a new receipt).
-- The same trigger also fires for a blob arriving from a lazy fetch, which
-- would queue a pointless push straight back to the server it just came
-- from — that path writes with sync_control.applying = 1, the same guard
-- every pull already uses, so the WHEN clause skips it.
create trigger if not exists sync_receipt_blob_insert after insert on receipt_blob
  when (select applying from sync_control) = 0
begin
  insert into sync_outbox (tbl, row_id, queued_at)
  values ('receipt_blob', new.receipt_id, datetime('now'))
  on conflict (tbl, row_id) do update set queued_at = datetime('now');
end;
