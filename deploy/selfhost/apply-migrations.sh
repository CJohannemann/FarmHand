#!/usr/bin/env bash
#
# Applies every file in db/migrations/, in order, to the self-hosted
# Postgres — without touching schema.sql or seed.sql. Those two are for a
# brand-new database only (see apply-schema.sh); every migration, in
# contrast, is written to be safe to run again, including ones already
# applied. Use this one after pulling a new migration onto an existing
# install.
#
#   bash deploy/selfhost/apply-migrations.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
REPO="$(cd ../.. && pwd)"

for f in "$REPO"/db/migrations/*.sql; do
  echo "=== migration: $(basename "$f") ==="
  docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done

# PostgREST caches the schema at startup and does not notice a plain `alter
# table` run over a raw psql connection like the loop above — Supabase's
# hosted platform wires an event trigger that NOTIFYs it automatically, but
# nothing here sets one up. Without this, a migration that adds a column
# applies cleanly and then every write to that column still fails with
# "Could not find the '<column>' column of '<table>' in the schema cache"
# until something reminds PostgREST to look again. SIGUSR1 is PostgREST's own
# documented reload signal — no restart, no dropped connections.
echo
echo "=== reloading PostgREST's schema cache ==="
docker compose kill -s SIGUSR1 rest

echo
echo "All migrations applied."
