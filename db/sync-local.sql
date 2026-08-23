-- Local-only sync bookkeeping. Deliberately absent from schema.sql: the server
-- has no use for these, and they must never be pushed.
--
-- Every local write records its row id in sync_outbox via a trigger, which is
-- how a push knows what changed. Rows arriving from a pull are applied with
-- `farmhand.applying` set, and the trigger skips those — otherwise pulling
-- would mark rows dirty and push them straight back, forever.
--
-- Safe to run repeatedly.

create table if not exists sync_state (
  key   text primary key,
  value text
);

create table if not exists sync_outbox (
  tbl       text not null,
  row_id    text not null,
  queued_at timestamptz not null default now(),
  primary key (tbl, row_id)
);

create or replace function sync_enqueue() returns trigger
language plpgsql as $t$
declare
  rid text;
begin
  if coalesce(current_setting('farmhand.applying', true), 'off') = 'on' then
    return null;
  end if;

  -- log_asset is keyed by a composite, so flatten it into one string.
  if TG_TABLE_NAME = 'log_asset' then
    rid := new.log_id::text || '|' || new.asset_id::text || '|' || new.role::text;
  else
    rid := new.id::text;
  end if;

  insert into sync_outbox (tbl, row_id) values (TG_TABLE_NAME, rid)
  on conflict (tbl, row_id) do update set queued_at = now();

  return null;
end
$t$;

do $install$
declare
  t text;
begin
  foreach t in array
    array['farm','term','location','asset','log','log_asset','quantity']
  loop
    execute format('drop trigger if exists sync_%I on %I', t, t);
    execute format(
      'create trigger sync_%I after insert or update on %I
       for each row execute function sync_enqueue()', t, t);
  end loop;
end
$install$;
