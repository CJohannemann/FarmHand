-- Receipt photos, attached to the purchase log they document.
--
-- Stored in Postgres rather than an object store because this deployment
-- doesn't run one: docker-compose.yml is db + rest + auth only, and says so
-- deliberately ("no Realtime, Storage, Studio, or Kong"). Standing up
-- storage-api and imgproxy would put two more containers on a VPS that
-- already shares a disk with another site and runs an 80%-full alarm. The
-- client downscales every image to roughly 200KB before it is ever sent
-- (src/lib/image.ts), which is what makes a table a reasonable home: a few
-- hundred purchases a year is tens of megabytes, not gigabytes.
--
-- The unused `attachment` table in schema.sql is NOT reused here. It carries
-- a storage_key pointing at a file in an object store — the architecture
-- this rejects — and nothing has ever written to it.
--
-- Idempotent and safe to run against the live database (see
-- deploy/selfhost/apply-migrations.sh's per-migration loop); schema.sql
-- carries the same definitions for a fresh install.

create table if not exists receipt (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references farm(id) on delete cascade,
  log_id      uuid not null references log(id) on delete cascade,
  captured_at timestamptz not null default now(),
  mime        text not null default 'image/jpeg',
  byte_size   bigint not null default 0,
  width       integer,
  height      integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists receipt_log_idx on receipt (log_id);
create index if not exists receipt_farm_captured_idx on receipt (farm_id, captured_at desc);

-- Base64 text, not bytea: this column's whole job is to survive the trip
-- through PostgREST's JSON, and text goes as-is where bytea would arrive
-- hex-encoded and need decoding on both sides.
create table if not exists receipt_blob (
  receipt_id uuid primary key references receipt(id) on delete cascade,
  data       text not null
);

alter table receipt enable row level security;
drop policy if exists tenant_all on receipt;
create policy tenant_all on receipt for all
  using (has_farm_access(farm_id)) with check (has_farm_access(farm_id));

-- receipt_blob carries no farm_id of its own; it inherits via its receipt,
-- the same shape log_asset uses.
alter table receipt_blob enable row level security;
drop policy if exists receipt_blob_access on receipt_blob;
create policy receipt_blob_access on receipt_blob for all
  using (exists (select 1 from receipt
                 where receipt.id = receipt_id and has_farm_access(receipt.farm_id)))
  with check (exists (select 1 from receipt
                 where receipt.id = receipt_id and has_farm_access(receipt.farm_id)));
