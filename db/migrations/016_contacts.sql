-- A buyer (or anyone else worth keeping a name, phone and email for instead
-- of retyping into a "Note" every time a sale is recorded).
--
-- Deliberately not an asset: `asset` is read unfiltered in several places —
-- the whole Inventory list, the "add to inventory" empty state on Today, a
-- chore's "What for?" — and a buyer showing up in any of those would be
-- wrong. It gets its own table the same way location and receipt do.
--
-- Idempotent and safe to run against the live database (see
-- deploy/selfhost/apply-migrations.sh's per-migration loop); schema.sql
-- carries the same definitions for a fresh install.

create table if not exists contact (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references farm(id) on delete cascade,
  name       text not null,
  phone      text,
  email      text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists contact_farm_idx on contact (farm_id);

alter table contact enable row level security;
drop policy if exists tenant_all on contact;
create policy tenant_all on contact for all
  using (has_farm_access(farm_id)) with check (has_farm_access(farm_id));
