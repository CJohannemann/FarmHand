#!/usr/bin/env bash
#
# Update FarmHand on the VPS: pull, rebuild, publish the static build.
#
#   bash deploy/deploy.sh
#
# There is no backend service here to restart — the whole app is static
# files that talk to Supabase directly from the browser, so this is just
# pull -> install -> build -> copy. See deploy/README.md for one-time setup.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

[ -f deploy/deploy.env ] && . deploy/deploy.env
WEB_ROOT="${WEB_ROOT:-}"

step() { printf '\n=== %s ===\n' "$1"; }

step "checking for a .env"
if [ ! -f .env ]; then
  cat <<'WARN' >&2
STOP. No .env here. The build bakes VITE_SUPABASE_URL and
VITE_SUPABASE_ANON_KEY into the static files at build time, so without one
the deployed site runs in local-only mode with no sign-in and no sync.

Copy .env.example to .env and fill in the two Supabase values first.
WARN
  exit 1
fi
echo "ok"

step "pulling latest code"
git pull --ff-only

step "installing dependencies"
npm ci

step "building"
npm run build

if [ -n "$WEB_ROOT" ]; then
  step "publishing to $WEB_ROOT"
  if [ ! -d "$WEB_ROOT" ]; then
    echo "WEB_ROOT '$WEB_ROOT' does not exist - skipping copy" >&2
  else
    # Trailing slashes matter: copy the contents, not the dist folder itself.
    sudo rsync -a --delete dist/ "$WEB_ROOT/"
    echo "published"
  fi
else
  cat <<'INFO'
WEB_ROOT is not set, so the built files were left in dist/.
To automate this step, create deploy/deploy.env containing:

  WEB_ROOT=/var/www/farmhand
INFO
fi

printf '\nDeploy complete.\n'
