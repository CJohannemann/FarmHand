-- Phone notifications: where each phone that turned alerts on can be
-- reached, and a note of every alert already sent so none goes twice.
--
-- Written by the app only through the two functions below, which act on
-- the caller's own phone and nothing else. Read only by
-- deploy/selfhost/send-notifications.ts, which runs as the postgres
-- superuser on the server and so sees every farm's — the same way
-- PropertyManagement's sender does. Neither table syncs to phones (they
-- are not in SYNCED_TABLES), so nothing about anyone's phone ever lands
-- on another member's device.
--
-- Idempotent, safe to re-run; schema.sql carries the same for a fresh
-- install.

create table if not exists push_subscription (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscription_user_id_idx on push_subscription (user_id);
alter table push_subscription enable row level security;
-- No policies: nobody reads or writes this directly from the app.

-- One row per alert sent: "<farm>:<animal>:heat:2026-11-21". The date in
-- the key means the next cycle's heat is a new alert, and a re-run the
-- same day is not.
create table if not exists push_sent (
  key     text primary key,
  sent_at timestamptz not null default now()
);
alter table push_sent enable row level security;

-- This phone, for whoever is signed in on it. Moves the phone to them if
-- it was turned on under another account before.
create or replace function register_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into push_subscription (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end
$fn$;

-- Alerts off on this phone. Only the caller's own row.
create or replace function remove_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $fn$
  delete from push_subscription where endpoint = p_endpoint and user_id = auth.uid();
$fn$;

revoke all on function register_push_subscription(text, text, text) from public;
revoke all on function remove_push_subscription(text) from public;
grant execute on function register_push_subscription(text, text, text) to authenticated;
grant execute on function remove_push_subscription(text) to authenticated;
