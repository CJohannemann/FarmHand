#!/usr/bin/env bash
#
# Build and publish FarmHand from THIS checkout.
#
#   bash deploy/deploy.sh              # build and publish
#   bash deploy/deploy.sh --ref <sha>  # ...and insist on landing exactly there
#
# There is no backend service here to restart — the whole app is static
# files that talk to Supabase directly from the browser, so this is just
# pull -> install -> build -> copy. See deploy/README.md for one-time setup.
#
# The same script runs both sites. Which one it is comes from
# deploy/deploy.env in the checkout it is run from:
#
#   ~/FarmHand      SITE=prod  BRANCH=main  WEB_ROOT=/var/www/farmhand
#   ~/FarmHand-dev  SITE=dev   BRANCH=dev   WEB_ROOT=/var/www/farmhand-dev
#
# It refuses to run if the checkout is not on the branch its deploy.env
# names — the one mistake this arrangement makes easy is running the wrong
# one in the wrong directory, and that check is what makes it loud instead
# of silently publishing dev's code to the live site.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

[ -f deploy/deploy.env ] && . deploy/deploy.env
SITE="${SITE:-prod}"
BRANCH="${BRANCH:-main}"
WEB_ROOT="${WEB_ROOT:-}"

REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ref)   REF="${2:-}"; shift 2 ;;
    --ref=*) REF="${1#*=}"; shift ;;
    -h|--help)
      sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^#\{1,2\} \{0,1\}//'
      exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n=== %s ===\n' "$1"; }

step "checking this is the $SITE checkout"
CURRENT="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT" != "$BRANCH" ]; then
  cat >&2 <<STOP
STOP. deploy/deploy.env in $REPO says this is the '$SITE' site, built from
the '$BRANCH' branch — but this checkout is on '$CURRENT'.

Either you are in the wrong directory, or this checkout has been left on
another branch. Nothing has been built or published.
STOP
  exit 1
fi
echo "$SITE, on $BRANCH, in $REPO"

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

COMMIT="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"

# --ref is an assertion, not a checkout: promote.sh has already pushed the
# tested commit to this branch, and this proves the pull actually landed on
# it. A prod deploy that quietly built something else — because the push
# had not propagated, or someone pushed again in between — is precisely
# what "test it on dev first" is supposed to rule out.
if [ -n "$REF" ]; then
  WANTED="$(git rev-parse "$REF^{commit}")"
  if [ "$COMMIT" != "$WANTED" ]; then
    cat >&2 <<STOP

STOP. Expected this checkout to be at $REF after pulling:
  wanted  $WANTED
  got     $COMMIT

Nothing has been built or published. Check that the promotion actually
pushed, then run this again.
STOP
    exit 1
  fi
  echo "at $SHORT, as expected"
fi

step "installing dependencies"
npm ci

step "building"
# Vite picks up VITE_-prefixed variables from the environment as well as
# from .env, so the site's identity comes from deploy.env rather than
# having to be kept in step by hand in two .env files. This is what puts
# the "dev build" banner on the dev site and nowhere else.
export VITE_SITE_ENV="$SITE"
export VITE_BUILD_COMMIT="$SHORT"
npm run build

# Published alongside the app so "what is actually live right now" is
# answerable with curl instead of by guessing from a build timestamp —
# and so promote.sh can read the exact commit the dev site is serving
# rather than trusting that the dev branch has not moved since.
step "stamping the build"
SUBJECT="$(git log -1 --pretty=%s | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
cat > dist/build-info.json <<JSON
{
  "site": "$SITE",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "short": "$SHORT",
  "subject": "$SUBJECT",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "$SHORT — $SUBJECT"

if [ -n "$WEB_ROOT" ]; then
  step "publishing to $WEB_ROOT"
  if [ ! -d "$WEB_ROOT" ]; then
    echo "WEB_ROOT '$WEB_ROOT' does not exist - skipping copy" >&2
    exit 1
  fi
  # Trailing slashes matter: copy the contents, not the dist folder itself.
  sudo rsync -a --delete dist/ "$WEB_ROOT/"
  echo "published"
else
  cat <<'INFO'
WEB_ROOT is not set, so the built files were left in dist/.
To automate this step, create deploy/deploy.env containing:

  WEB_ROOT=/var/www/farmhand
INFO
fi

printf '\n%s deploy complete — %s (%s)\n' "$SITE" "$SHORT" "$BRANCH"
