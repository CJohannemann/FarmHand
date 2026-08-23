-- Creating your first farm is a chicken-and-egg problem: the RLS policy on
-- `farm` only lets you touch farms you belong to, but you cannot belong to a
-- farm that does not exist yet. This function runs as its owner, so it can
-- create both halves atomically, and is the only supported way to make a farm.
--
-- Accepts an optional id so a device that already has local data can push its
-- existing farm id up, keeping local and remote in agreement.

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
