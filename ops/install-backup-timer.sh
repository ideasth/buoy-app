#!/usr/bin/env bash
# Install (or refresh) the Anchor backup systemd timers.
#
# Installs both:
#   - anchor-backup-datadb.{service,timer}  — daily 02:00 backup to OneDrive
#   - anchor-prune-backups.{service,timer}  — weekly Sun 03:00 retention prune
#
# Idempotent. Safe to re-run after editing the unit files or the scripts.
#
# Usage (as root, on the VPS):
#   sudo /opt/anchor/ops/install-backup-timer.sh
#
# Prerequisites:
#   - Repo present at /opt/anchor
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
[ -x "$REPO_DIR/ops/jobs/backup-datadb.sh" ] || fail "backup script not executable: $REPO_DIR/ops/jobs/backup-datadb.sh"
[ -x "$REPO_DIR/ops/jobs/prune-backups.sh" ]  || fail "prune script not executable: $REPO_DIR/ops/jobs/prune-backups.sh"
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
  Backup + prune timers installed.
============================================================

Useful commands:

  # Trigger a manual daily backup right now:
  sudo systemctl start anchor-backup-datadb.service

  # Trigger a manual prune right now (dry-run first is safer):
  sudo -u jod env ANCHOR_PRUNE_DRY_RUN=1 /opt/anchor/ops/jobs/prune-backups.sh
  sudo systemctl start anchor-prune-backups.service

  # Watch a job live:
  journalctl -u anchor-backup-datadb -f
  journalctl -u anchor-prune-backups -f

  # See today's logs:
  journalctl -u anchor-backup-datadb --since today
  journalctl -u anchor-prune-backups --since today

  # Disable / re-enable a timer:
  sudo systemctl disable --now anchor-backup-datadb.timer
  sudo systemctl enable --now  anchor-backup-datadb.timer

  # Re-install (after editing units or scripts):
  sudo ${REPO_DIR}/ops/install-backup-timer.sh

============================================================
EOF
