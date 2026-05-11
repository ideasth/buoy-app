#!/usr/bin/env bash
# Anchor deploy script — runs ON the VPS (wmu, BinaryLane Sydney, Ubuntu 24.04).
#
# Idempotent. Safe to re-run. Pulls latest main, bakes secrets, builds,
# restarts the pm2 process, verifies /api/health responds.
#
# Usage (on the VPS):
#   /opt/anchor/ops/deploy.sh             # standard deploy from main
#   /opt/anchor/ops/deploy.sh --no-pull   # skip git pull (build from current tree)
#   /opt/anchor/ops/deploy.sh --branch X  # deploy a non-main branch
#   /opt/anchor/ops/deploy.sh --rollback  # checkout previous commit + rebuild
#
# Exit codes:
#   0  success
#   1  generic failure (something logged to stderr)
#   2  secrets missing
#   3  build failed
#   4  pm2 restart failed
#   5  health check failed (pm2 reverted to previous build)

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_DIR="${ANCHOR_REPO_DIR:-/opt/anchor}"
SECRETS_DIR="${ANCHOR_SECRETS_DIR:-/opt/anchor/.secrets}"
SYNC_SECRET_FILE="${SECRETS_DIR}/anchor_sync_secret"
LLM_KEYS_FILE="${SECRETS_DIR}/baked-llm-keys.ts"   # optional; only used if exists
PM2_APP_NAME="${ANCHOR_PM2_NAME:-anchor}"
HEALTH_URL="${ANCHOR_HEALTH_URL:-http://127.0.0.1:5000/api/health}"
BACKUP_DIR="${ANCHOR_BACKUP_DIR:-/opt/anchor/.deploy-backups}"
LOG_DIR="${ANCHOR_LOG_DIR:-/var/log/anchor}"
BRANCH="main"
DO_PULL=1
DO_ROLLBACK=0

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-pull)   DO_PULL=0; shift ;;
    --branch)    BRANCH="$2"; shift 2 ;;
    --rollback)  DO_ROLLBACK=1; shift ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------

mkdir -p "$LOG_DIR" "$BACKUP_DIR"
DEPLOY_TS="$(date -u +%Y-%m-%dT%H%M%SZ)"
LOG_FILE="$LOG_DIR/deploy-${DEPLOY_TS}.log"

# Tee everything to a per-deploy log and to stdout.
exec > >(tee -a "$LOG_FILE") 2>&1

log()   { printf '[%s] [deploy] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
fail()  { local code="${1:-1}"; shift; log "FAIL: $*"; exit "$code"; }

trap 'log "deploy.sh failed at line $LINENO (exit $?)"' ERR

log "Starting deploy ${DEPLOY_TS} (branch=${BRANCH} pull=${DO_PULL} rollback=${DO_ROLLBACK})"
log "Repo:    $REPO_DIR"
log "Log:     $LOG_FILE"

# ---------------------------------------------------------------------------
# 1. Sanity checks
# ---------------------------------------------------------------------------

[ -d "$REPO_DIR/.git" ] || fail 1 "$REPO_DIR is not a git repo"
[ -f "$SYNC_SECRET_FILE" ] || fail 2 "missing $SYNC_SECRET_FILE — run secret-bootstrap"

cd "$REPO_DIR"

# Confirm we're on a clean tree before pulling (no surprise local edits).
if [[ -n "$(git status --porcelain)" ]]; then
  log "WARNING: working tree has uncommitted changes:"
  git status --porcelain
  if [[ $DO_ROLLBACK -eq 1 ]]; then
    fail 1 "rollback refused: working tree dirty, stash or commit first"
  fi
  log "Proceeding anyway (deploy will overwrite generated files)."
fi

# Snapshot the current HEAD so we can roll back if health fails.
PREV_COMMIT="$(git rev-parse HEAD)"
log "Current HEAD: $PREV_COMMIT"

# ---------------------------------------------------------------------------
# 2. Sync code
# ---------------------------------------------------------------------------

if [[ $DO_ROLLBACK -eq 1 ]]; then
  if [[ ! -f "$BACKUP_DIR/last-good-commit" ]]; then
    fail 1 "rollback requested but no $BACKUP_DIR/last-good-commit found"
  fi
  ROLLBACK_COMMIT="$(cat "$BACKUP_DIR/last-good-commit")"
  log "Rolling back to $ROLLBACK_COMMIT"
  git checkout "$ROLLBACK_COMMIT"
elif [[ $DO_PULL -eq 1 ]]; then
  log "Fetching origin..."
  git fetch --all --prune
  log "Checking out $BRANCH..."
  git checkout "$BRANCH"
  log "Pulling latest..."
  git pull --ff-only origin "$BRANCH"
  NEW_HEAD="$(git rev-parse HEAD)"
  log "New HEAD: $NEW_HEAD"
  if [[ "$NEW_HEAD" == "$PREV_COMMIT" ]]; then
    log "No new commits. Continuing anyway (rebuild may still be desired)."
  fi
else
  log "Skipping git pull (--no-pull)"
fi

CURRENT_COMMIT="$(git rev-parse HEAD)"
CURRENT_COMMIT_MSG="$(git log -1 --pretty='%s')"
log "Deploying commit: $CURRENT_COMMIT — $CURRENT_COMMIT_MSG"

# ---------------------------------------------------------------------------
# 3. Bake secrets
# ---------------------------------------------------------------------------

log "Baking sync secret into server/baked-secret.ts"
SECRET_VAL="$(cat "$SYNC_SECRET_FILE")"
[[ -n "$SECRET_VAL" ]] || fail 2 "sync secret file is empty"
printf 'export const BAKED_SYNC_SECRET = %s;\n' "$(printf '%s' "$SECRET_VAL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  > server/baked-secret.ts

# Optional LLM keys file — only bake if a source exists.
if [[ -f "$LLM_KEYS_FILE" ]]; then
  log "Baking LLM keys from $LLM_KEYS_FILE"
  cp "$LLM_KEYS_FILE" server/baked-llm-keys.ts
else
  log "No LLM keys file at $LLM_KEYS_FILE — leaving server/baked-llm-keys.ts as-is"
  # If the file doesn't exist at all, create an empty stub so build doesn't fail.
  if [[ ! -f server/baked-llm-keys.ts ]]; then
    echo 'export const BAKED_LLM_KEYS: Record<string,string> = {};' > server/baked-llm-keys.ts
  fi
fi

# ---------------------------------------------------------------------------
# 4. Install deps + build
# ---------------------------------------------------------------------------

log "Running npm ci (this may take 30-60s on first run)..."
npm ci --no-audit --no-fund 2>&1 | tail -5 || fail 3 "npm ci failed"

log "Running npm run build..."
if ! npm run build 2>&1 | tail -20; then
  fail 3 "build failed — see log above"
fi

[ -f dist/index.cjs ] || fail 3 "build completed but dist/index.cjs missing"
BUNDLE_HASH="$(md5sum dist/index.cjs | awk '{print $1}')"
log "Built bundle md5: $BUNDLE_HASH"

# ---------------------------------------------------------------------------
# 5. Restart pm2
# ---------------------------------------------------------------------------

if ! command -v pm2 >/dev/null 2>&1; then
  fail 1 "pm2 not installed — see VPS bootstrap docs"
fi

if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  log "Restarting pm2 process '$PM2_APP_NAME'"
  pm2 restart "$PM2_APP_NAME" --update-env || fail 4 "pm2 restart failed"
else
  log "pm2 process '$PM2_APP_NAME' not found — starting fresh"
  cd "$REPO_DIR"
  pm2 start "npm run start" --name "$PM2_APP_NAME" --time || fail 4 "pm2 start failed"
fi

pm2 save >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 6. Health check
# ---------------------------------------------------------------------------

log "Waiting 3s for app to bind to port..."
sleep 3

HEALTH_OK=0
for i in 1 2 3 4 5; do
  if curl -sf --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTH_OK=1
    log "Health check passed on attempt $i ($HEALTH_URL)"
    break
  fi
  log "Health check attempt $i failed, retrying..."
  sleep 2
done

if [[ $HEALTH_OK -ne 1 ]]; then
  log "Health check FAILED after 5 attempts. Attempting auto-rollback..."
  if [[ "$CURRENT_COMMIT" != "$PREV_COMMIT" ]]; then
    git checkout "$PREV_COMMIT" || true
    npm ci --no-audit --no-fund >/dev/null 2>&1 || true
    npm run build >/dev/null 2>&1 || true
    pm2 restart "$PM2_APP_NAME" --update-env || true
    log "Rollback attempted to $PREV_COMMIT. Investigate $LOG_FILE."
  fi
  fail 5 "health check failed"
fi

# ---------------------------------------------------------------------------
# 7. Record success
# ---------------------------------------------------------------------------

echo "$CURRENT_COMMIT" > "$BACKUP_DIR/last-good-commit"
echo "$DEPLOY_TS" > "$BACKUP_DIR/last-good-deploy-ts"

log "DEPLOY OK"
log "  commit:   $CURRENT_COMMIT"
log "  bundle:   $BUNDLE_HASH"
log "  pm2 app:  $PM2_APP_NAME"
log "  health:   $HEALTH_URL OK"
log "  log:      $LOG_FILE"

# Trim deploy logs older than 30 days.
find "$LOG_DIR" -name 'deploy-*.log' -type f -mtime +30 -delete 2>/dev/null || true

exit 0
