#!/usr/bin/env bash
#
# Runs ON THE VPS, on a timer: streams a database dump over SSH to the home
# server so the farm's records aren't only ever on one rented box.
#
# The dump is piped straight into ssh and never written to the VPS's own
# disk. That is deliberate, not incidental: this box shares one small
# filesystem with another site and already runs an 80%-full alarm, and
# receipt images make Postgres the largest thing on it. Staging a dump
# locally first is exactly the shape of "the backup filled the disk it was
# backing up".
#
# The receiving end is locked down — see deploy/backup/README.md. This host's
# key is pinned at home to a forced command that can only ever CREATE a new
# timestamped file: it cannot list, overwrite, or delete what is already
# there. That matters because this is the internet-facing machine, and the
# whole point of an off-site copy is that it survives this one being owned.
#
#   bash deploy/backup/push-backup.sh
#
# Configure via an env file next to this script:
#   cp deploy/backup/backup.env.example deploy/backup/backup.env

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

[ -f backup.env ] && . backup.env

: "${BACKUP_SSH_TARGET:?set BACKUP_SSH_TARGET in backup.env (e.g. backup@home.example.net)}"
BACKUP_SSH_KEY="${BACKUP_SSH_KEY:-$HOME/.ssh/farmhand_backup}"
BACKUP_SSH_PORT="${BACKUP_SSH_PORT:-22}"
COMPOSE_DIR="$(cd ../selfhost && pwd)"

ssh_to() {
  ssh -i "$BACKUP_SSH_KEY" -p "$BACKUP_SSH_PORT" \
      -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 \
      "$BACKUP_SSH_TARGET" "$@"
}

notify() {
  local message="$1"
  echo "$message"
  if [ -n "${NTFY_TOPIC:-}" ]; then
    curl -fsS -d "$message" "${NTFY_URL:-https://ntfy.sh}/${NTFY_TOPIC}" >/dev/null \
      || echo "ntfy notification failed" >&2
  fi
  if [ -n "${MAIL_TO:-}" ] && command -v mail >/dev/null; then
    echo "$message" | mail -s "FarmHand backup" "$MAIL_TO" \
      || echo "mail notification failed" >&2
  fi
}

fail() { notify "FarmHand backup FAILED: $1"; exit 1; }

cd "$COMPOSE_DIR"

# -Fc: compressed custom format, so a restore can run in parallel or pull
# back a single table. --no-owner because the box this is restored onto
# won't have this deployment's exact roles.
#
# PIPESTATUS, not $?: with a pipe, $? is only ssh's status, so a pg_dump that
# died halfway would look like a clean backup as long as ssh accepted what it
# had already been handed. That is the failure mode that silently produces
# months of truncated dumps.
set +e
docker compose exec -T db pg_dump -U postgres -Fc --no-owner postgres | ssh_to db
status=("${PIPESTATUS[@]}")
set -e
[ "${status[0]}" -eq 0 ] || fail "pg_dump exited ${status[0]}"
[ "${status[1]}" -eq 0 ] || fail "ssh to $BACKUP_SSH_TARGET exited ${status[1]}"

# The database alone cannot be restored into a working system: GoTrue signs
# tokens with JWT_SECRET, and rebuilding with a fresh one silently
# invalidates every session and password-reset link in existence.
if [ "${BACKUP_INCLUDE_CONFIG:-1}" = "1" ]; then
  set +e
  tar -cz .env docker-compose.yml | ssh_to config
  status=("${PIPESTATUS[@]}")
  set -e
  [ "${status[0]}" -eq 0 ] || fail "config tar exited ${status[0]}"
  [ "${status[1]}" -eq 0 ] || fail "ssh (config) exited ${status[1]}"
fi

echo "Backup pushed to $BACKUP_SSH_TARGET."
