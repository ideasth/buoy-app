#!/usr/bin/env bash
# Weekly retention pruning for OneDrive Anchor backups.
#
# Policy:
#   - Keep every daily snapshot from the last 90 days
#   - Keep the first snapshot of each ISO week from the last 365 days
#   - Keep the first snapshot of each calendar month indefinitely
#   - Everything else: delete
#
# Files live at:
#   onedrive:Backups/Anchor/YYYY/MM/anchor-data-YYYY-MM-DDTHHMMSSZ.db.zst
#
# Filenames are the source of truth for date. We never modify files — only
# delete the ones that fall outside all three retention windows.
#
# Runs as `jod` via a systemd timer weekly (Sundays at 03:00 local).
# Logs go to journalctl.
#
# Exit codes:
#   0  success (zero or more files deleted)
#   1  generic failure
#   2  rclone remote missing

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

RCLONE_REMOTE="${ANCHOR_RCLONE_REMOTE:-onedrive}"
RCLONE_PATH="${ANCHOR_RCLONE_PATH:-Backups/Anchor}"
DRY_RUN="${ANCHOR_PRUNE_DRY_RUN:-0}"

# Retention windows in days.
DAILY_KEEP_DAYS="${ANCHOR_DAILY_KEEP_DAYS:-90}"
WEEKLY_KEEP_DAYS="${ANCHOR_WEEKLY_KEEP_DAYS:-365}"
# Monthly: kept forever (no day-based cutoff).

log() { printf '[%s] [prune-backups] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { local code="${1:-1}"; shift; log "FAIL: $*"; exit "$code"; }

# ---------------------------------------------------------------------------
# Sanity
# ---------------------------------------------------------------------------

command -v rclone >/dev/null 2>&1 || fail 1 "rclone not installed"

if ! rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:"; then
  fail 2 "rclone remote '${RCLONE_REMOTE}:' not configured"
fi

log "Policy: keep daily for ${DAILY_KEEP_DAYS}d, weekly for ${WEEKLY_KEEP_DAYS}d, monthly forever"
[ "$DRY_RUN" = "1" ] && log "DRY RUN: no deletes will actually happen"

# ---------------------------------------------------------------------------
# 1. List every backup file
# ---------------------------------------------------------------------------

REMOTE_BASE="${RCLONE_REMOTE}:${RCLONE_PATH}"
log "Listing ${REMOTE_BASE}/ recursively..."

# rclone lsf -R returns relative paths like "2026/05/anchor-data-2026-05-12T120000Z.db.zst"
TMP_LIST=$(mktemp -t anchor-prune-list.XXXXXX)
trap 'rm -f "$TMP_LIST"' EXIT

if ! rclone lsf -R --files-only --include "anchor-data-*.db.zst" \
       "$REMOTE_BASE" > "$TMP_LIST" 2>/dev/null; then
  fail 1 "rclone lsf failed against $REMOTE_BASE"
fi

TOTAL=$(wc -l < "$TMP_LIST" | tr -d ' ')
log "Found $TOTAL backup file(s)"

if [ "$TOTAL" = "0" ]; then
  log "Nothing to prune."
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Classify with Python (cleaner date math than bash)
# ---------------------------------------------------------------------------

# Output of this block: lines of "KEEP|DELETE  reason  relative_path"
CLASSIFIED=$(mktemp -t anchor-prune-class.XXXXXX)
trap 'rm -f "$TMP_LIST" "$CLASSIFIED"' EXIT

python3 - "$TMP_LIST" "$CLASSIFIED" \
        "$DAILY_KEEP_DAYS" "$WEEKLY_KEEP_DAYS" <<'PY'
import os, re, sys
from datetime import datetime, timezone, timedelta

list_path, out_path, daily_keep, weekly_keep = sys.argv[1:5]
daily_keep = int(daily_keep)
weekly_keep = int(weekly_keep)

now = datetime.now(timezone.utc)
daily_cutoff = now - timedelta(days=daily_keep)
weekly_cutoff = now - timedelta(days=weekly_keep)

# Parse anchor-data-YYYY-MM-DDTHHMMSSZ.db.zst
name_re = re.compile(r"anchor-data-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db\.zst$")

parsed = []
with open(list_path) as f:
    for line in f:
        path = line.strip()
        if not path:
            continue
        base = os.path.basename(path)
        m = name_re.match(base)
        if not m:
            parsed.append((None, path, "UNPARSEABLE"))
            continue
        y, mo, d, h, mi, s = map(int, m.groups())
        try:
            dt = datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)
        except ValueError:
            parsed.append((None, path, "BAD_DATE"))
            continue
        parsed.append((dt, path, None))

# Sort newest first so we can pick the "first of week / month" deterministically.
parsed.sort(key=lambda r: (r[0] is None, -(r[0].timestamp() if r[0] else 0)))

# Walk and decide. For monthly + weekly buckets we keep the OLDEST snapshot
# of that period — that's the one that appeared first chronologically. We
# reverse-iterate to find oldest-per-bucket easily.
parsed_chrono = sorted([p for p in parsed if p[0] is not None], key=lambda r: r[0])
monthly_first = {}   # (year, month) -> path
weekly_first  = {}   # (iso_year, iso_week) -> path
for dt, path, _ in parsed_chrono:
    ym = (dt.year, dt.month)
    if ym not in monthly_first:
        monthly_first[ym] = path
    iso_year, iso_week, _ = dt.isocalendar()
    yw = (iso_year, iso_week)
    if yw not in weekly_first:
        weekly_first[yw] = path

out = open(out_path, "w")
kept = 0
deleted = 0
weird = 0
for dt, path, problem in parsed:
    if problem is not None:
        # Unparseable / bad date — leave it alone (don't delete what we don't
        # understand). Log it.
        out.write(f"KEEP\t{problem}\t{path}\n")
        weird += 1
        continue
    reasons = []
    if dt >= daily_cutoff:
        reasons.append("DAILY")
    iso_year, iso_week, _ = dt.isocalendar()
    if dt >= weekly_cutoff and weekly_first.get((iso_year, iso_week)) == path:
        reasons.append("WEEKLY_FIRST")
    if monthly_first.get((dt.year, dt.month)) == path:
        reasons.append("MONTHLY_FIRST")
    if reasons:
        out.write(f"KEEP\t{','.join(reasons)}\t{path}\n")
        kept += 1
    else:
        out.write(f"DELETE\toutside_all_windows\t{path}\n")
        deleted += 1

out.close()

print(f"summary: total={kept+deleted+weird} keep={kept} delete={deleted} unparseable={weird}", file=sys.stderr)
PY

# Capture the summary line that Python printed to stderr above.
# (We already see it on the journal because we don't redirect.)

# ---------------------------------------------------------------------------
# 3. Apply decisions
# ---------------------------------------------------------------------------

KEEP_COUNT=$(grep -c '^KEEP' "$CLASSIFIED" || true)
DEL_COUNT=$(grep -c '^DELETE' "$CLASSIFIED" || true)
log "Classified: keep=$KEEP_COUNT delete=$DEL_COUNT"

# Always log what we're keeping at INFO level (helps audit the policy).
log "Sample of kept files (first 10):"
grep '^KEEP' "$CLASSIFIED" | head -10 | while IFS=$'\t' read -r _ reason path; do
  log "  KEEP  [$reason]  $path"
done

if [ "$DEL_COUNT" = "0" ]; then
  log "Nothing to delete. Done."
  exit 0
fi

log "Files marked for deletion (full list):"
grep '^DELETE' "$CLASSIFIED" | while IFS=$'\t' read -r _ _ path; do
  log "  DELETE  $path"
done

if [ "$DRY_RUN" = "1" ]; then
  log "DRY RUN: skipping actual deletes."
  exit 0
fi

# Build a path list for rclone --files-from. rclone needs paths relative
# to the remote root for that flag.
DEL_LIST=$(mktemp -t anchor-prune-dels.XXXXXX)
trap 'rm -f "$TMP_LIST" "$CLASSIFIED" "$DEL_LIST"' EXIT

grep '^DELETE' "$CLASSIFIED" | awk -F'\t' '{print $3}' > "$DEL_LIST"

log "Deleting $DEL_COUNT file(s) via rclone..."
rclone delete \
  --files-from "$DEL_LIST" \
  --stats=0 \
  "$REMOTE_BASE" \
  || fail 1 "rclone delete failed"

log "Delete completed."

# Try to clean up any now-empty YYYY/MM directories (best effort; rclone
# refuses to delete non-empty paths so this is safe to call blindly).
log "Sweeping empty month directories..."
rclone rmdirs --leave-root "$REMOTE_BASE" 2>/dev/null || true

log "PRUNE OK"
log "  kept:    $KEEP_COUNT"
log "  deleted: $DEL_COUNT"
exit 0
