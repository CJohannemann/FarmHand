-- Where the farm is, so weather can be fetched for it.
--
-- Lives on `farm` rather than per-device because it is a property of the
-- place, not the phone — and it syncs, so a second device does not have to be
-- told again. Idempotent, and run on every app start so existing databases
-- pick it up.

alter table farm add column if not exists latitude   numeric;
alter table farm add column if not exists longitude  numeric;
alter table farm add column if not exists place_name text;
