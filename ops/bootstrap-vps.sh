#!/usr/bin/env bash
# Anchor VPS bootstrap — ONE-TIME setup for a fresh Ubuntu 24.04 BinaryLane VPS.
#
# Brings a clean server to the point where deploy.sh works. Idempotent (safe to
# re-run; will skip steps that are already done).
#
# Run as the deploy user (jod), with sudo available.
# Reads the sync secret from /opt/anchor/.secrets/anchor_sync_secret — caller
# must drop that file in place first (use the secret-bootstrap skill).
#
# Usage:
#   curl -fsSLO https://raw.githubusercontent.com/ideasth/anchor-app/main/ops/bootstrap-vps.sh
#   chmod +x bootstrap-vps.sh
#   sudo ./bootstrap-vps.sh
#
# Exit codes:
#   0  success
#   1  generic failure
#   2  not running as root / no sudo

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEPLOY_USER="${ANCHOR_DEPLOY_USER:-jod}"
REPO_URL="${ANCHOR_REPO_URL:-https://github.com/ideasth/anchor-app.git}"
REPO_DIR="${ANCHOR_REPO_DIR:-/opt/anchor}"
NODE_MAJOR="${ANCHOR_NODE_MAJOR:-22}"
DOMAIN="${ANCHOR_DOMAIN:-anchor.thinhalo.com}"

log()  { printf '[bootstrap] %s\n' "$*"; }
fail() { local code="${1:-1}"; shift; log "FAIL: $*"; exit "$code"; }

# ---------------------------------------------------------------------------
# Sanity
# ---------------------------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
  fail 2 "must run as root (use sudo)"
fi

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  fail 1 "deploy user '$DEPLOY_USER' does not exist on this system"
fi

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------

log "Updating apt cache..."
apt-get update -qq

log "Installing base packages..."
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  ca-certificates curl gnupg lsb-release git build-essential \
  rclone zstd jq sqlite3 ufw

# ---------------------------------------------------------------------------
# 2. Node.js (via NodeSource)
# ---------------------------------------------------------------------------

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q "^v${NODE_MAJOR}\."; then
  log "Installing Node.js ${NODE_MAJOR}.x..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
log "Node: $(node --version), npm: $(npm --version)"

# ---------------------------------------------------------------------------
# 3. pm2 (globally)
# ---------------------------------------------------------------------------

if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing pm2..."
  npm install -g pm2
fi
log "pm2: $(pm2 --version)"

# ---------------------------------------------------------------------------
# 4. Caddy (for TLS + reverse proxy)
# ---------------------------------------------------------------------------

if ! command -v caddy >/dev/null 2>&1; then
  log "Installing Caddy from official APT repo..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y caddy
fi
log "Caddy: $(caddy version | head -1)"

# ---------------------------------------------------------------------------
# 5. Directory layout
# ---------------------------------------------------------------------------

log "Creating directory layout under $REPO_DIR..."
mkdir -p "$REPO_DIR" "$REPO_DIR/.secrets" "$REPO_DIR/.deploy-backups" "/var/log/anchor"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REPO_DIR" "/var/log/anchor"
chmod 700 "$REPO_DIR/.secrets"

# ---------------------------------------------------------------------------
# 6. Clone repo (as deploy user)
# ---------------------------------------------------------------------------

if [[ ! -d "$REPO_DIR/.git" ]]; then
  log "Cloning $REPO_URL into $REPO_DIR..."
  sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$REPO_DIR"
else
  log "Repo already cloned at $REPO_DIR"
fi

# ---------------------------------------------------------------------------
# 7. Caddyfile
# ---------------------------------------------------------------------------

CADDYFILE=/etc/caddy/Caddyfile

if ! grep -q "${DOMAIN}" "$CADDYFILE" 2>/dev/null; then
  log "Writing Caddyfile for ${DOMAIN}..."
  cat > "$CADDYFILE" <<EOF
${DOMAIN} {
    encode zstd gzip

    # Legacy paths from the PaaS era — strip /port/5000 prefix and proxy.
    handle /port/5000/* {
        uri strip_prefix /port/5000
        reverse_proxy 127.0.0.1:5000
    }

    # Everything else: straight proxy to the Anchor process.
    handle {
        reverse_proxy 127.0.0.1:5000
    }

    log {
        output file /var/log/caddy/access.log
        format console
    }
}
EOF
  systemctl reload caddy || systemctl restart caddy
else
  log "Caddyfile already contains ${DOMAIN}"
fi

# ---------------------------------------------------------------------------
# 8. Firewall
# ---------------------------------------------------------------------------

log "Configuring ufw (SSH + HTTP + HTTPS)..."
ufw --force enable
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw status verbose

# ---------------------------------------------------------------------------
# 9. pm2 systemd unit (as deploy user)
# ---------------------------------------------------------------------------

PM2_UNIT="/etc/systemd/system/pm2-${DEPLOY_USER}.service"
if [[ ! -f "$PM2_UNIT" ]]; then
  log "Generating pm2 systemd unit for $DEPLOY_USER..."
  sudo -u "$DEPLOY_USER" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER" \
    | tail -1 | bash
fi

# ---------------------------------------------------------------------------
# 10. Done — instructions for next step
# ---------------------------------------------------------------------------

cat <<EOF

============================================================
  Bootstrap complete.
============================================================

Next steps (as $DEPLOY_USER):

  1. Drop the sync secret into place if not already done:
       sudo -u $DEPLOY_USER bash -c 'cat > $REPO_DIR/.secrets/anchor_sync_secret'
       sudo chmod 600 $REPO_DIR/.secrets/anchor_sync_secret
       sudo chown $DEPLOY_USER:$DEPLOY_USER $REPO_DIR/.secrets/anchor_sync_secret

  2. Run the first deploy:
       sudo -u $DEPLOY_USER $REPO_DIR/ops/deploy.sh

  3. Verify:
       curl -s https://${DOMAIN}/api/health
       curl -s https://${DOMAIN}/port/5000/api/health

  4. Set up daily backups (Stage 11b — runs once OneDrive rclone is configured):
       sudo -u $DEPLOY_USER $REPO_DIR/ops/install-backup-timer.sh

EOF
