#!/usr/bin/env bash
#
# Promote what the dev site is running to the live site.
#
#   bash deploy/promote.sh              # confirm, then promote and deploy
#   bash deploy/promote.sh --dry-run    # show what would go, change nothing
#   bash deploy/promote.sh --yes        # skip the confirmation prompt
#
# Run this from the DEV checkout (~/FarmHand-dev). It:
#
#   1. reads the commit the dev site is actually serving, out of the
#      build-info.json that deploy.sh published there,
#   2. checks that commit is a fast-forward of main — nothing on the live
#      site would be lost,
#   3. shows you the commits and flags any new db/migrations file,
#   4. pushes that exact commit to main,
#   5. runs deploy.sh in the prod checkout, pinned to it.
#
# The commit comes from the deployed stamp rather than from the dev
# branch's HEAD on purpose. Those are the same thing right up until you
# commit something after the last dev deploy, and at that moment "promote
# what I tested" and "promote the branch" stop meaning the same thing.
# Only the first one is safe, so only the first one is offered.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

[ -f deploy/deploy.env ] && . deploy/deploy.env
SITE="${SITE:-}"
BRANCH="${BRANCH:-dev}"
WEB_ROOT="${WEB_ROOT:-}"
PROD_REPO="${PROD_REPO:-$HOME/FarmHand}"
PROD_BRANCH="${PROD_BRANCH:-main}"

DRY_RUN=0
ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y)  ASSUME_YES=1; shift ;;
    -h|--help)
      sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^#\{1,2\} \{0,1\}//'
      exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n=== %s ===\n' "$1"; }
die()  { printf '\nSTOP. %s\n' "$1" >&2; exit 1; }

step "checking where this is being run"
[ "$SITE" = "dev" ] || die "deploy/deploy.env here says SITE='$SITE'. Run this from
the dev checkout ($REPO is not it), where deploy.env sets SITE=dev."
[ -n "$WEB_ROOT" ] || die "WEB_ROOT is not set in deploy/deploy.env, so there is no
dev site to read a deployed commit from."
[ -d "$PROD_REPO/.git" ] || die "PROD_REPO='$PROD_REPO' is not a git checkout.
Set PROD_REPO in deploy/deploy.env to the live site's checkout."
echo "dev: $REPO -> $WEB_ROOT"
echo "prod: $PROD_REPO ($PROD_BRANCH)"

step "reading what the dev site is serving"
STAMP="$WEB_ROOT/build-info.json"
[ -f "$STAMP" ] || die "No $STAMP. The dev site has not been published by
deploy.sh yet — run 'bash deploy/deploy.sh' here first, test it, then promote."
LIVE="$(sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{7,40\}\)".*/\1/p' "$STAMP")"
[ -n "$LIVE" ] || die "Could not read a commit out of $STAMP."
git cat-file -e "$LIVE^{commit}" 2>/dev/null \
  || die "The dev site is serving commit $LIVE, which is not in this checkout.
Has it been rebuilt from a different clone?"
echo "$(git log -1 --pretty='%h %s' "$LIVE")"
echo "built $(sed -n 's/.*"builtAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STAMP")"

# Committing after a dev deploy is normal; promoting the untested part of
# it is not. Say plainly which one is going.
AHEAD="$(git rev-list --count "$LIVE..HEAD" 2>/dev/null || echo 0)"
if [ "$AHEAD" != "0" ]; then
  printf '\nNote: %s is %s commit(s) ahead of what the dev site is serving.\n' \
    "$BRANCH" "$AHEAD"
  printf 'Those are NOT being promoted. Deploy dev again to include them.\n'
fi

step "fetching"
git fetch --quiet origin "$PROD_BRANCH"
REMOTE_PROD="origin/$PROD_BRANCH"

if git merge-base --is-ancestor "$LIVE" "$REMOTE_PROD"; then
  printf '\nNothing to promote — %s already contains %s.\n' \
    "$PROD_BRANCH" "$(git rev-parse --short "$LIVE")"
  exit 0
fi

git merge-base --is-ancestor "$REMOTE_PROD" "$LIVE" || die "This would not be a
fast-forward: $PROD_BRANCH has commits the dev site has never run.

  git log --oneline $LIVE..$REMOTE_PROD

Merge $PROD_BRANCH into $BRANCH, deploy dev again, test that, then promote."

step "what would go live"
git log --oneline --no-decorate "$REMOTE_PROD..$LIVE"

# A schema change is the one thing this promotion cannot carry. The two
# sites share one backend, so a migration has to be applied to the live
# database by hand — and it is applied to the database the testers are
# already using, before prod's code knows anything about it.
MIGRATIONS="$(git diff --name-only --diff-filter=A "$REMOTE_PROD..$LIVE" -- db/migrations/ || true)"
if [ -n "$MIGRATIONS" ]; then
  cat <<'WARN'

  ─────────────────────────────────────────────────────────────────
  THIS PROMOTION INCLUDES DATABASE MIGRATIONS
  ─────────────────────────────────────────────────────────────────
WARN
  printf '  %s\n' $MIGRATIONS
  cat <<'WARN'

  Apply these to the live database FIRST, then promote — the new code
  will call a schema that has to already be there:

    bash deploy/selfhost/apply-migrations.sh

  If dev has been exercising them, they are applied already (dev and
  prod share one database) and this is just a reminder to check.
WARN
fi

if [ "$DRY_RUN" = "1" ]; then
  printf '\nDry run — nothing pushed, nothing deployed.\n'
  exit 0
fi

if [ "$ASSUME_YES" != "1" ]; then
  printf '\nPromote %s to %s and deploy the live site? [y/N] ' \
    "$(git rev-parse --short "$LIVE")" "$PROD_BRANCH"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) printf 'Left alone.\n'; exit 0 ;;
  esac
fi

# Pushed straight from the commit to the remote branch rather than checking
# main out here: this checkout stays on dev, with nothing to put back if
# the deploy below fails. The push is not forced, so the server itself
# enforces the fast-forward one more time.
step "pushing $(git rev-parse --short "$LIVE") to $PROD_BRANCH"
git push origin "$LIVE:refs/heads/$PROD_BRANCH"

step "deploying the live site"
bash "$PROD_REPO/deploy/deploy.sh" --ref "$LIVE"

printf '\nPromoted. Live site is now on %s.\n' "$(git rev-parse --short "$LIVE")"
