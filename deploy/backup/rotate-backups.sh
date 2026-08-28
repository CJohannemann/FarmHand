#!/usr/bin/env bash
#
# Runs ON THE HOME SERVER, on its own timer, as a user the VPS has no key
# for. Takes what landed in the drop directory, checks it is actually a
# restorable dump, files it into the archive, and prunes old ones.
#
# The separation is the point. The VPS can only add files to `drop`; nothing
# it can reach touches `archive`. So a compromised VPS can push garbage, or
# push nothing at all, but it cannot rewrite history — and the checks below
# are what turn "a file arrived" into "a backup exists".
#
#   bash rotate-backups.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f backup.env ] && . backup.env

ROOT="${FARMHAND_BACKUP_ROOT:-/srv/farmhand-backup}"
DROP="${FARMHAND_BACKUP_DROP:-$ROOT/drop}"
ARCHIVE="${FARMHAND_BACKUP_ARCHIVE:-$ROOT/archive}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
# A dump that suddenly collapses in size is the classic silent failure —
# a dump of an empty database is a few KB and looks like a success.
MIN_BYTES="${FARMHAND_BACKUP_MIN_BYTES:-51200}"

mkdir -p "$DROP" "$ARCHIVE"/{daily,weekly,monthly} "$ARCHIVE/config"

notify() {
  local message="$1"
  echo "$message"
  if [ -n "${NTFY_TOPIC:-}" ]; then
    curl -fsS -d "$message" "${NTFY_URL:-https://ntfy.sh}/${NTFY_TOPIC}" >/dev/null \
      || echo "ntfy notification failed" >&2
  fi
}

shopt -s nullglob
accepted=0

for f in "$DROP"/farmhand-config-*.tar.gz; do
  # --force-local: tar reads a path containing a colon as host:path, the old
  # rsh remote-tape syntax, and tries to resolve a hostname instead of
  # opening the file. Unreachable with these timestamped names on Linux, but
  # it costs one flag to not depend on that.
  if tar --force-local -tzf "$f" >/dev/null 2>&1; then
    mv -n "$f" "$ARCHIVE/config/$(basename "$f")"
  else
    notify "FarmHand backup: config archive $(basename "$f") is corrupt, quarantined"
    mv -n "$f" "$DROP/corrupt-$(basename "$f")"
  fi
done

for f in "$DROP"/farmhand-*.dump; do
  base="$(basename "$f")"
  size=$(stat -c %s "$f" 2>/dev/null || echo 0)

  if [ "$size" -lt "$MIN_BYTES" ]; then
    notify "FarmHand backup: $base is only ${size} bytes — refusing to archive it"
    mv -n "$f" "$DROP/suspect-$base"
    continue
  fi

  # The difference between a file and a backup.
  #
  # Two checks, because the strong one is not always available. Every
  # pg_dump custom-format file begins with the five bytes "PGDMP"; that
  # costs nothing and catches the case that matters most — a stream that
  # was never a dump at all, or one whose first bytes never arrived.
  if [ "$(head -c 5 "$f" 2>/dev/null)" != "PGDMP" ]; then
    notify "FarmHand backup: $base is not a pg_dump file at all — quarantined"
    mv -n "$f" "$DROP/corrupt-$base"
    continue
  fi

  # pg_restore --list walks the whole table of contents, so it also catches
  # a dump truncated halfway — the far likelier failure for something
  # streamed over a home connection. Verified in testing that WITHOUT this,
  # 60KB of random bytes is archived as a healthy backup, so its absence is
  # said out loud rather than passed over in silence.
  if command -v pg_restore >/dev/null 2>&1; then
    if ! pg_restore --list "$f" >/dev/null 2>&1; then
      notify "FarmHand backup: $base is not a readable pg_dump — quarantined"
      mv -n "$f" "$DROP/corrupt-$base"
      continue
    fi
  elif [ -z "${WARNED_NO_PG_RESTORE:-}" ]; then
    WARNED_NO_PG_RESTORE=1
    notify "FarmHand backup: pg_restore not installed — dumps are only\
 header-checked, not fully verified. Install postgresql-client."
  fi

  mv -n "$f" "$ARCHIVE/daily/$base"
  accepted=$((accepted + 1))

  # Hard links, not copies: one set of bytes with several names, so keeping a
  # weekly and a monthly costs nothing extra and the data survives until the
  # last name pointing at it is pruned.
  day="${base#farmhand-}"; day="${day%%T*}"
  dow=$(date -u -d "$day" +%u 2>/dev/null || echo 0)
  dom=$(date -u -d "$day" +%d 2>/dev/null || echo 0)
  [ "$dow" = "7" ] && ln -f "$ARCHIVE/daily/$base" "$ARCHIVE/weekly/$base"
  [ "$dom" = "01" ] && ln -f "$ARCHIVE/daily/$base" "$ARCHIVE/monthly/$base"
done

prune() {
  local dir="$1" keep="$2"
  local files=("$dir"/farmhand-*.dump)
  local n=${#files[@]}
  [ "$n" -le "$keep" ] && return 0
  printf '%s\n' "${files[@]}" | sort | head -n "$((n - keep))" | while read -r old; do
    rm -f "$old"
  done
}

prune "$ARCHIVE/daily" "$KEEP_DAILY"
prune "$ARCHIVE/weekly" "$KEEP_WEEKLY"
prune "$ARCHIVE/monthly" "$KEEP_MONTHLY"

# Via an array, not `ls -t <glob> | head -1`: nullglob is set above, so an
# empty archive makes that glob vanish and `ls -t` list the current
# directory instead of failing — which reported a directory name as the
# newest backup and its mtime as the backup's age. An empty archive has to
# read as "there is no backup", loudly, because that is the one state where
# a reassuring message is actively dangerous.
archived=("$ARCHIVE/daily"/farmhand-*.dump)
if [ ${#archived[@]} -eq 0 ]; then
  notify "FarmHand backup: no dump has ever been archived"
  exit 1
fi
newest=$(ls -t "${archived[@]}" | head -1)

# Silence is the enemy: a push that quietly stopped weeks ago looks exactly
# like a push that is working, right up until it is needed.
age_h=$(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 ))
if [ "$age_h" -gt "${STALE_HOURS:-36}" ]; then
  notify "FarmHand backup: newest backup is ${age_h}h old — the VPS may have stopped pushing"
fi

echo "Archived $accepted new dump(s). Newest: $(basename "$newest") (${age_h}h old)."
du -sh "$ARCHIVE" 2>/dev/null || true
