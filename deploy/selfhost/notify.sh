#!/usr/bin/env bash
#
# Run once a day by farmhand-notify.timer: sends the phone notifications in
# send-notifications.ts (a heat coming up in a week). Safe to run by hand
# any time; an alert already sent is never sent again.
#
#   bash notify.sh             # send
#   bash notify.sh --dry-run   # say what would go, send nothing
#
# Run under systemd, PATH won't include an nvm-installed node — the same
# fallback PropertyManagement's notify.sh uses.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1; then
  for nvm_sh in "${NVM_DIR:-$HOME/.nvm}/nvm.sh" /usr/local/nvm/nvm.sh; do
    # shellcheck disable=SC1090
    [ -s "$nvm_sh" ] && . "$nvm_sh" && break
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node not on PATH and no nvm found — cannot send notifications." >&2
  exit 1
fi

# The sender is TypeScript, so it can use the app's own heat arithmetic
# (src/lib/husbandry.ts) rather than a copy that could drift. Node runs
# TypeScript directly from 22.6 on.
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=6)?0:1)'; then
  echo "send-notifications.ts needs Node 22.6 or newer (this is $(node --version))." >&2
  exit 1
fi

node --experimental-strip-types --no-warnings send-notifications.ts "$@"
