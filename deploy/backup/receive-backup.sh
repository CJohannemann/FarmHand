#!/usr/bin/env bash
#
# Runs ON THE HOME SERVER. Never called by name — it is pinned as the forced
# command on the VPS's backup key, so that key can do this and nothing else:
#
#   command="/srv/farmhand-backup/receive-backup.sh",no-pty,no-port-forwarding,\
#   no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... farmhand-vps
#
# This is the whole security argument for letting the VPS push. The VPS is
# the internet-facing machine and therefore the one that gets compromised;
# an off-site copy is worthless if whoever owns that box can reach back and
# delete it. So this script only ever CREATES a new timestamped file in the
# drop directory. It cannot list, read, overwrite, or delete — there is no
# code path here that does, and the forced command means no other code path
# is reachable with that key.
#
# rotate-backups.sh, running as a different user the VPS has no key for,
# moves these into the real archive.

set -euo pipefail

DROP="${FARMHAND_BACKUP_DROP:-/srv/farmhand-backup/drop}"
MAX_BYTES="${FARMHAND_BACKUP_MAX_BYTES:-21474836480}"   # 20GB, a runaway guard

mkdir -p "$DROP"

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
case "${SSH_ORIGINAL_COMMAND:-}" in
  db)     name="farmhand-${stamp}.dump" ;;
  config) name="farmhand-config-${stamp}.tar.gz" ;;
  *)
    echo "receive-backup.sh: expected 'db' or 'config'" >&2
    exit 64
    ;;
esac

# O_EXCL via `set -o noclobber`: if a file of this name somehow exists, fail
# rather than truncate it. Belt and braces behind the timestamp — this
# script's one promise is that it never destroys an existing backup.
target="$DROP/$name"
set -o noclobber
: > "$target" || { echo "refusing to overwrite $target" >&2; exit 73; }
set +o noclobber

# head -c caps what an attacker (or a runaway loop) can write into the home
# filesystem in one connection.
head -c "$MAX_BYTES" > "$target"

size=$(stat -c %s "$target" 2>/dev/null || echo 0)
if [ "$size" -eq 0 ]; then
  rm -f "$target"        # only ever a file this same run just created
  echo "empty payload, nothing stored" >&2
  exit 65
fi

echo "stored $name ($size bytes)"
