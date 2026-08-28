-- "What you log is yours, and it stays yours" — the landing page says it, so
-- there has to be a way out that doesn't involve emailing the person who
-- runs the server.
--
-- Deleting an account cannot be done from the client: auth.users is not
-- reachable under RLS, and handing the browser a service_role key to do it
-- would hand the browser every other farm's data along with it. So it is one
-- security definer function that acts only on the caller.
--
-- The refusal below is the important part. Every table cascades from farm,
-- so deleting a farm erases every asset, log, quantity and receipt on it. If
-- the caller owns a farm other people are still using, that would silently
-- destroy THEIR records — a family member's or an employee's — on the
-- strength of one person clicking delete. That case is refused and explained
-- rather than guessed at.
--
-- Idempotent; schema.sql carries the same definition for a fresh install.

create or replace function delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me uuid := auth.uid();
  shared_farm uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  -- Owner of a farm that other people are also on: stop.
  select fm.farm_id into shared_farm
    from farm_member fm
   where fm.user_id = me
     and fm.role = 'owner'
     and (select count(*) from farm_member o where o.farm_id = fm.farm_id) > 1
   limit 1;

  if shared_farm is not null then
    raise exception 'other people are still on a farm you own — remove them, or make someone else the owner, before deleting your account';
  end if;

  -- Farms where the caller is the last member left. Nobody else can reach
  -- these once the membership goes (every RLS policy here is written against
  -- farm_member), so they are deleted outright rather than left as orphans
  -- holding someone's records forever. The cascade does the rest.
  delete from farm f
   where f.id in (select farm_id from farm_member where user_id = me)
     and (select count(*) from farm_member o where o.farm_id = f.id) = 1;

  -- Memberships of farms that belong to somebody else: the caller leaves,
  -- the farm and its records stay exactly as they are.
  delete from farm_member where user_id = me;

  -- Last, so a failure above leaves the account intact rather than
  -- half-deleted and unreachable.
  delete from auth.users where id = me;
end
$fn$;

revoke all on function delete_own_account() from public;
grant execute on function delete_own_account() to authenticated;
