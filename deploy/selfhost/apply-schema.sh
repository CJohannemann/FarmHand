#!/usr/bin/env bash
#
# Applies FarmHand's schema (schema.sql, seed.sql, then every migration in
# order) to the self-hosted Postgres. Run once, after `docker compose up -d
# db auth` — this depends on GoTrue having already bootstrapped the auth
# schema and auth.uid(), which schema.sql's row-level security references.
# See README.md for the full order of operations.
#
# Runs psql *inside* the db container rather than requiring it installed on
# the host — one less thing to apt install on a space-conscious VPS.
#
#   bash deploy/selfhost/apply-schema.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
REPO="$(cd ../.. && pwd)"

run() {
  echo "=== $1 ==="
  docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$2"
}

run "schema" "$REPO/db/schema.sql"
run "seed"   "$REPO/db/seed.sql"
for f in "$REPO"/db/migrations/*.sql; do
  run "migration: $(basename "$f")" "$f"
done

echo
echo "Sanity check — should print a blank/null row, not an error:"
docker compose exec -T db psql -U postgres -d postgres -c "select auth.uid();"
