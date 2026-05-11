#!/usr/bin/env bash
# Weekly check that the Stage 11 backup loop is healthy.
# Runs Saturdays 06:30 local — after the Friday-night 02:00 backup has run.
# Migrated from Perplexity cron d08f13f1 on 2026-05-12 (Stage 12b).
#
# Behaviour:
#   - GET /api/admin/health
#   - Parse backups.lastReceipt
#   - If null              → exit 2 (systemd logs failure; surfaces in list-timers)
#   - If older than 36h    → exit 3
#   - Else                 → log OK and exit 0
#
# 36h is chosen because the daily backup timer (anchor-backup-datadb) fires
# every ~24h. Anything older than 36h means at least one daily run was missed
# — investigate the same day rather than waiting a week.
#
# This is run by a oneshot service; non-zero exit shows up as failed in
# `systemctl list-timers` and `journalctl -u anchor-verify-backup-receipt`.
# Notification can be added later if the user wants email/push alerts.

set -euo pipefail

JOB_TAG="anchor-verify-backup-receipt"
ANCHOR_BASE="${ANCHOR_BASE:-https://anchor.thinhalo.com}"
ANCHOR_SECRET_FILE="${ANCHOR_SECRET_FILE:-/opt/anchor/.secrets/anchor_sync_secret}"
STALE_AFTER_SECS="${ANCHOR_BACKUP_STALE_SECS:-$((36 * 3600))}"

log() { printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$JOB_TAG" "$*"; }

[ -r "$ANCHOR_SECRET_FILE" ] || { log "FAIL: secret missing"; exit 1; }
SECRET=$(cat "$ANCHOR_SECRET_FILE")

TMP=$(mktemp -t anchor-health.XXXXXX.json)
trap 'rm -f "$TMP"' EXIT

HTTP_CODE=$(curl -sS --max-time 30 \
  -H "X-Anchor-Sync-Secret: $SECRET" \
  -o "$TMP" -w '%{http_code}' \
  "$ANCHOR_BASE/api/admin/health" || echo 'curl-err')

if [ "$HTTP_CODE" != "200" ]; then
  log "FAIL: /api/admin/health returned HTTP $HTTP_CODE"
  head -c 400 "$TMP" >&2 || true
  exit 1
fi

# Parse with python3 — bash doesn't speak JSON.
python3 - "$TMP" "$STALE_AFTER_SECS" <<'PY'
import json, os, sys
from datetime import datetime, timezone

health_path, stale_after = sys.argv[1:3]
stale_after = int(stale_after)

try:
    h = json.load(open(health_path))
except Exception as e:
    print(f"FAIL: could not parse /api/admin/health body: {e}", file=sys.stderr)
    sys.exit(1)

backups = h.get("backups") or {}
last = backups.get("lastReceipt")

if last is None:
    print("FAIL: backups.lastReceipt is null — no backup recorded yet", file=sys.stderr)
    sys.exit(2)

# Prefer mtime (seconds), fall back to createdAt (ms).
mtime = last.get("mtime")
created_ms = last.get("createdAt")
if isinstance(mtime, (int, float)) and mtime > 0:
    when = float(mtime)
elif isinstance(created_ms, (int, float)) and created_ms > 0:
    when = float(created_ms) / 1000.0
else:
    print(f"FAIL: cannot read mtime/createdAt from lastReceipt: {last!r}", file=sys.stderr)
    sys.exit(2)

now = datetime.now(timezone.utc).timestamp()
age = now - when
when_iso = datetime.fromtimestamp(when, tz=timezone.utc).isoformat()
size = last.get("sizeBytes")
url = last.get("onedriveUrl") or "(no url)"

if age > stale_after:
    print(f"FAIL: backup STALE — when={when_iso} age={age/86400:.1f}d size={size} url={url}", file=sys.stderr)
    sys.exit(3)

print(f"OK: backup current — when={when_iso} age={age/3600:.1f}h size={size} url={url}")
PY

log "verify-backup-receipt: OK"
