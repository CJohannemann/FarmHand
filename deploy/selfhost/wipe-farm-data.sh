#!/usr/bin/env bash
#
# Clear a farm's records without touching anyone's account.
#
# For getting rid of test data before a farm goes into real use. Keeps the
# farm itself, everyone's login, and who is a member of what — only the
# records go: animals, groups, lots, logs, quantities, locations, receipts.
#
#   bash deploy/selfhost/wipe-farm-data.sh                 # list farms
#   bash deploy/selfhost/wipe-farm-data.sh "Rosebud Acres" # wipe that one
#   bash deploy/selfhost/wipe-farm-data.sh "Rosebud Acres" --purge
#
# SOFT DELETE BY DEFAULT, and that is not timidity — it is the only thing
# that works. db/schema.sql says it plainly: "Hard deletes and offline sync
# do not mix: a device that has been offline for a week must be *told* a
# record died, not simply find it missing." Every device holds its own full
# copy of the farm. Deleting rows here would empty the server and leave
# every phone still showing all of it, with no way to ever learn otherwise.
# Stamping deleted_at is how a deletion travels.
#
# updated_at is bumped alongside it for the same reason: the incremental
# pull asks for rows changed since it last looked, so a deletion that does
# not move updated_at is a deletion no device will ever collect.
#
# --purge really removes the rows. Only reach for it if every device that
# has ever signed into this farm will also have its local data cleared
# (browser site data, or Settings > sign out and clear). Otherwise the
# phones and the server disagree permanently.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

psql() { docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

FARM_NAME="${1:-}"
MODE="${2:-soft}"

if [ -z "$FARM_NAME" ]; then
  echo "Farms on this server:"
  echo
  psql -c "
    select f.name,
           (select count(*) from asset a where a.farm_id = f.id and a.deleted_at is null) as assets,
           (select count(*) from log l where l.farm_id = f.id and l.deleted_at is null) as logs,
           (select count(*) from receipt r where r.farm_id = f.id and r.deleted_at is null) as receipts,
           (select count(*) from farm_member m where m.farm_id = f.id) as people
      from farm f order by f.name;"
  echo
  echo "Then: bash wipe-farm-data.sh \"<farm name>\""
  exit 0
fi

FARM_ID=$(psql -tAc "select id from farm where name = '${FARM_NAME//\'/\'\'}'")
if [ -z "$FARM_ID" ]; then
  echo "No farm called \"$FARM_NAME\". Run without arguments to list them." >&2
  exit 1
fi
if [ "$(printf '%s\n' "$FARM_ID" | wc -l)" -gt 1 ]; then
  echo "More than one farm is called \"$FARM_NAME\". Sort that out first." >&2
  exit 1
fi

echo "Farm:  $FARM_NAME"
echo "Id:    $FARM_ID"
echo
echo "This would clear:"
psql -c "
  select 'animals and groups' as records,
         count(*) from asset where farm_id = '$FARM_ID' and deleted_at is null
  union all select 'logs',      count(*) from log      where farm_id = '$FARM_ID' and deleted_at is null
  union all select 'quantities',count(*) from quantity where farm_id = '$FARM_ID' and deleted_at is null
  union all select 'locations', count(*) from location where farm_id = '$FARM_ID' and deleted_at is null
  union all select 'receipts',  count(*) from receipt  where farm_id = '$FARM_ID' and deleted_at is null;"
echo
echo "Keeps: the farm itself, every login, and who belongs to it."
echo "Keeps: your own added vocabulary (species, materials, units)."
if [ "$MODE" = "--purge" ]; then
  echo
  echo "MODE: --purge — rows are REMOVED, not marked deleted."
  echo "Every device signed into this farm must also have its local data"
  echo "cleared, or it will keep showing these records forever."
else
  echo "Mode:  soft delete, so the removal syncs out to every device."
fi
echo
printf 'Type the farm name to confirm: '
read -r TYPED
if [ "$TYPED" != "$FARM_NAME" ]; then
  echo "Not confirmed — nothing changed."
  exit 1
fi

if [ "$MODE" = "--purge" ]; then
  # Child rows first: log_asset and receipt_blob carry no farm_id of their
  # own and would otherwise block their parents on the foreign key.
  psql <<SQL
begin;
delete from log_asset where log_id in (select id from log where farm_id = '$FARM_ID');
delete from receipt_blob where receipt_id in (select id from receipt where farm_id = '$FARM_ID');
delete from receipt  where farm_id = '$FARM_ID';
delete from quantity where farm_id = '$FARM_ID';
delete from log      where farm_id = '$FARM_ID';
delete from asset    where farm_id = '$FARM_ID';
delete from location where farm_id = '$FARM_ID';
commit;
SQL
else
  # Order does not matter for a soft delete, but updated_at does: the
  # incremental pull asks for rows changed since it last looked.
  psql <<SQL
begin;
update asset    set deleted_at = now(), updated_at = now() where farm_id = '$FARM_ID' and deleted_at is null;
update log      set deleted_at = now(), updated_at = now() where farm_id = '$FARM_ID' and deleted_at is null;
update quantity set deleted_at = now(), updated_at = now() where farm_id = '$FARM_ID' and deleted_at is null;
update location set deleted_at = now(), updated_at = now() where farm_id = '$FARM_ID' and deleted_at is null;
update receipt  set deleted_at = now(), updated_at = now() where farm_id = '$FARM_ID' and deleted_at is null;
commit;
SQL
fi

echo
echo "Done. What is left:"
psql -c "
  select 'animals and groups' as records,
         count(*) from asset where farm_id = '$FARM_ID' and deleted_at is null
  union all select 'logs',     count(*) from log     where farm_id = '$FARM_ID' and deleted_at is null
  union all select 'receipts', count(*) from receipt where farm_id = '$FARM_ID' and deleted_at is null;"
echo
if [ "$MODE" = "--purge" ]; then
  echo "Now clear local data on every device, or they will disagree with this."
else
  echo "Open the app on each device and let it sync — the records will go."
fi
