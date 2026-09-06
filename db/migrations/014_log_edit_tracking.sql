-- Who last changed a record, and when — the "lite" edit trail. `created_by`
-- says who logged something originally; this is the companion for "and has
-- anyone touched it since", set by updateLog() only when an edit actually
-- changes something, not on every save.
--
-- Idempotent: IF NOT EXISTS on both columns, safe to run again.

alter table log add column if not exists edited_by uuid references auth.users(id) on delete set null;
alter table log add column if not exists edited_at timestamptz;
