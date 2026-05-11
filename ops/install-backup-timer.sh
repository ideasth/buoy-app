#!/usr/bin/env bash
# Install (or refresh) the anchor-backup-datadb systemd timer.
#
# Idempotent. Safe to re-run after editing the unit files or the backup script.
#
# Usage (as root, on the VPS):
#   sudo /opt/anchor/ops/install-backup-timer.sh
#
# What it does:
#   1. Copies the .service and .timer files from the repo into /etc/systemd/system
#   2. Reloads systemd
#   3. Enables and starts the timer
#   4. Prints the next scheduled run
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
TIMER_NAME="anchor-backup-datadb.timer"
SERVICE_NAME="anchor-backup-datadb.service"

log() { printf '[install-backup-timer] %s\n' "$*"; }
fail() { log "FAIL: $*"; exit 1; }

# ---------------------------------------------------------------------------
# Sanity
# ---------------------------------------------------------------------------

[ $EUID -eq 0 ] || fail "must run as root (use sudo)"
[ -d "$UNITS_SRC" ] || fail "unit source dir missing: $UNITS_SRC"
[ -f "$UNITS_SRC/$SERVICE_NAME" ] || fail "missing $UNITS_SRC/$SERVICE_NAME"
[ -f "$UNITS_SRC/$TIMER_NAME" ] || fail "missing $UNITS_SRC/$TIMER_NAME"
[ -x "$REPO_DIR/ops/jobs/backup-datadb.sh" ] || fail "backup script not executable: $REPO_DIR/ops/jobs/backup-datadb.sh"
[ -r "$SECRET_FILE" ] || fail "sync secret missing: $SECRET_FILE"

# Confirm rclone remote configured for the jod user.
if ! sudo -u jod rclone listremotes 2>/dev/null | grep -q "^onedrive:"; then
  fail "rclone 'onedrive:' remote not configured for user jod — run rclone config first"
fi

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

log "Installing systemd units into $UNITS_DEST..."
install -m 0644 "$UNITS_SRC/$SERVICE_NAME" "$UNITS_DEST/$SERVICE_NAME"
install -m 0644 "$UNITS_SRC/$TIMER_NAME"   "$UNITS_DEST/$TIMER_NAME"

log "Reloading systemd..."
systemctl daemon-reload

log "Enabling + starting timer..."
systemctl enable --now "$TIMER_NAME"

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

echo
log "Timer status:"
systemctl status "$TIMER_NAME" --no-pager | head -20 || true

echo
log "Next scheduled runs:"
systemctl list-timers "$TIMER_NAME" --no-pager || true

echo
cat <<EOF
============================================================
  Backup timer installed.
============================================================

Useful commands:

  # Trigger a manual run right now (does not affect the schedule):
  sudo systemctl start ${SERVICE_NAME}

  # Watch the run live:
  journalctl -u ${SERVICE_NAME} -f

  # See the last run's output:
  journalctl -u ${SERVICE_NAME} --since today

  # Disable the timer (e.g. while travelling, large maintenance window):
  sudo systemctl disable --now ${TIMER_NAME}

  # Re-enable:
  sudo systemctl enable --now ${TIMER_NAME}

  # Re-install (after editing units or the backup script):
  sudo ${REPO_DIR}/ops/install-backup-timer.sh

============================================================
EOF
