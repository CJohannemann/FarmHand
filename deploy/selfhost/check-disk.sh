#!/usr/bin/env bash
#
# Warns before the VPS runs out of disk — not specific to FarmHand's own
# data, since the baseball site, FarmHand's Postgres, and everything else
# on this box all share the same filesystem. Checks the root filesystem's
# used percentage; above THRESHOLD, sends a notification.
#
# Notification channels are all optional and independent — configure
# whichever you actually have:
#   NTFY_TOPIC   a topic name at ntfy.sh (or NTFY_URL for a self-hosted
#                instance) — free, no account, just install the ntfy app
#                and subscribe to the same topic name. See ntfy.sh.
#   MAIL_TO      an email address; requires `mail`/`mailx` and a working
#                local MTA (postfix, etc.) already set up on this VPS.
# Neither configured? Still logs to syslog/journal (see the timer below),
# so `journalctl -u farmhand-disk-check` shows a history either way.
#
#   bash deploy/selfhost/check-disk.sh
#
# Configure via environment or a small env file sourced here:
#   cp deploy/selfhost/check-disk.env.example deploy/selfhost/check-disk.env

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

THRESHOLD="${THRESHOLD:-80}"
[ -f check-disk.env ] && . check-disk.env

used=$(df --output=pcent / | tail -1 | tr -d '% ')
avail=$(df --output=avail / | tail -1 | tr -d ' ')
avail_human=$(numfmt --to=iec --from-unit=1024 "$((avail))" 2>/dev/null || echo "${avail} KB")

echo "Disk usage on /: ${used}% (${avail_human} free)"

if [ "$used" -lt "$THRESHOLD" ]; then
  exit 0
fi

message="VPS disk is ${used}% full (threshold ${THRESHOLD}%) — ${avail_human} free."
echo "WARNING: $message"

if [ -n "${NTFY_TOPIC:-}" ]; then
  curl -fsS -d "$message" "${NTFY_URL:-https://ntfy.sh}/${NTFY_TOPIC}" >/dev/null \
    || echo "ntfy notification failed" >&2
fi

if [ -n "${MAIL_TO:-}" ] && command -v mail >/dev/null; then
  echo "$message" | mail -s "VPS disk warning: ${used}% full" "$MAIL_TO" \
    || echo "mail notification failed" >&2
fi
