#!/usr/bin/env bash
# Install (or refresh) all Anchor systemd timers.
#
# Installs these (service, timer) unit pairs:
#   - anchor-backup-datadb           — daily 02:00 OneDrive backup           (Stage 11b)
#   - anchor-prune-backups           — weekly Sun 03:00 retention prune       (Stage 11c)
#   - anchor-warm-calendar           — twice daily 05:55 / 17:55 cache warm   (Stage 12b)
#   - anchor-warm-morning            — daily 05:55 morning briefing warm     (Stage 12b)
#   - anchor-warm-weekly-review      — weekly Sun 18:25 review warm          (Stage 12b)
#   - anchor-verify-backup-receipt   — weekly Sat 06:30 backup health check  (Stage 12b)
#
# Idempotent. Safe to re-run after editing any unit file or job script.
#
# Usage (as root, on the VPS):
#   sudo /opt/anchor/ops/install-backup-timer.sh
#
# Prerequisites:
#   - Repo present at /opt/anchor (symlink or real dir)
#   - User `jod` exists and has rclone configured (rclone lsd onedrive: works)
#   - /opt/anchor/.secrets/anchor_sync_secret exists and is mode 600

set -euo pipefail

REPO_DIR="${ANCHOR_REPO_DIR:-/opt/anchor}"
SECRET_FILE="${ANCHOR_SECRET_FILE:-/opt/anchor/.secrets/anchor_sync_secret}"
UNITS_SRC="${REPO_DIR}/ops/systemd"
UNITS_DEST="/etc/systemd/system"

# All (service, timer) unit pairs we install. Add new ones here.
UNIT_PAIRS=(
  "anchor-backup-datadb"
  "anchor-prune-backups"
  "anchor-warm-calendar"
  "anchor-warm-morning"
  "anchor-warm-weekly-review"
  "anchor-verify-backup-receipt"
)

# Job scripts we expect to be present and executable.
JOB_SCRIPTS=(
  "ops/jobs/backup-datadb.sh"
  "ops/jobs/prune-backups.sh"
  "ops/jobs/warm-calendar.sh"
  "ops/jobs/warm-morning.sh"
  "ops/jobs/warm-weekly-review.sh"
  "ops/jobs/verify-backup-receipt.sh"
)

log() { printf '[install-backup-timer] %s\n' "$*"; }
fail() { log "FAIL: $*"; exit 1; }

# ---------------------------------------------------------------------------
# Sanity
# ---------------------------------------------------------------------------

[ $EUID -eq 0 ] || fail "must run as root (use sudo)"
[ -d "$UNITS_SRC" ] || fail "unit source dir missing: $UNITS_SRC"
for base in "${UNIT_PAIRS[@]}"; do
  [ -f "$UNITS_SRC/$base.service" ] || fail "missing $UNITS_SRC/$base.service"
  [ -f "$UNITS_SRC/$base.timer" ]   || fail "missing $UNITS_SRC/$base.timer"
done
for rel in "${JOB_SCRIPTS[@]}"; do
  if [ ! -x "$REPO_DIR/$rel" ]; then
    if [ -f "$REPO_DIR/$rel" ]; then
      log "  fixing exec bit on $rel"
      chmod +x "$REPO_DIR/$rel"
    else
      fail "job script missing: $REPO_DIR/$rel"
    fi
  fi
done
[ -r "$SECRET_FILE" ] || fail "sync secret missing: $SECRET_FILE"

# Confirm rclone remote configured for the jod user.
if ! sudo -u jod rclone listremotes 2>/dev/null | grep -q "^onedrive:"; then
  fail "rclone 'onedrive:' remote not configured for user jod — run rclone config first"
fi

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

log "Installing systemd units into $UNITS_DEST..."
for base in "${UNIT_PAIRS[@]}"; do
  install -m 0644 "$UNITS_SRC/$base.service" "$UNITS_DEST/$base.service"
  install -m 0644 "$UNITS_SRC/$base.timer"   "$UNITS_DEST/$base.timer"
  log "  installed $base.{service,timer}"
done

log "Reloading systemd..."
systemctl daemon-reload

log "Enabling + starting timers..."
for base in "${UNIT_PAIRS[@]}"; do
  systemctl enable --now "$base.timer"
  log "  enabled $base.timer"
done

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

echo
log "Next scheduled runs:"
systemctl list-timers 'anchor-*' --no-pager || true

echo
cat <<EOF
============================================================
  Anchor systemd timers installed.
============================================================

Useful commands:

  # Show all next firings:
  systemctl list-timers 'anchor-*' --no-pager

  # Trigger a job right now:
  sudo systemctl start anchor-backup-datadb.service
  sudo systemctl start anchor-prune-backups.service
  sudo systemctl start anchor-warm-calendar.service
  sudo systemctl start anchor-warm-morning.service
  sudo systemctl start anchor-warm-weekly-review.service
  sudo systemctl start anchor-verify-backup-receipt.service

  # Dry-run the prune logic without deleting:
  sudo -u jod env ANCHOR_PRUNE_DRY_RUN=1 /opt/anchor/ops/jobs/prune-backups.sh

  # Watch a job live:
  journalctl -u anchor-backup-datadb -f
  journalctl -u anchor-warm-morning -f

  # See today's logs:
  journalctl -u anchor-warm-calendar --since today

  # Disable / re-enable a timer:
  sudo systemctl disable --now anchor-warm-morning.timer
  sudo systemctl enable  --now anchor-warm-morning.timer

  # Re-install (after editing units or scripts):
  sudo ${REPO_DIR}/ops/install-backup-timer.sh

============================================================
EOF
