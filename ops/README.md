# Anchor `ops/` — VPS operations scripts

This directory contains the scripts that run **on the VPS** (`wmu`,
`anchor.thinhalo.com`, Ubuntu 24.04, BinaryLane Sydney) to keep Anchor
deployed and backed up. Nothing here runs in the Computer sandbox or in
CI; it's all server-side.

Standing rule from the Life Management space applies: scripts never
contain secrets in plaintext. They read from `/opt/anchor/.secrets/`
which is `chmod 600` and gitignored.

## Scripts

| Script | Purpose | When to run |
|---|---|---|
| `bootstrap-vps.sh` | One-time setup of a fresh Ubuntu 24.04 VPS: installs Node, pm2, Caddy, rclone, clones repo, writes Caddyfile, opens firewall. | Once per VPS, as root. |
| `deploy.sh` | Pull latest main, bake secrets, build, restart pm2, health check. Auto-rolls back on health failure. | Every code change. As deploy user (`jod`). |
| `backup-datadb.sh` *(coming Stage 11b)* | Pull fresh data.db from Anchor admin export, compress with zstd, upload to OneDrive via rclone. | Daily via systemd timer at 02:00 local. |
| `install-backup-timer.sh` *(coming Stage 11b)* | Install the systemd timer unit for `backup-datadb.sh`. Idempotent. | Once after OneDrive rclone is configured. |

## Environment variables (deploy.sh)

Override defaults via env vars before invoking. Empty/unset uses the default.

| Variable | Default | Purpose |
|---|---|---|
| `ANCHOR_REPO_DIR` | `/opt/anchor` | Where the repo lives on the VPS. |
| `ANCHOR_SECRETS_DIR` | `/opt/anchor/.secrets` | Directory holding `anchor_sync_secret` etc. |
| `ANCHOR_PM2_NAME` | `anchor` | pm2 process name. |
| `ANCHOR_HEALTH_URL` | `http://127.0.0.1:5000/api/health` | URL hit after restart. |
| `ANCHOR_BACKUP_DIR` | `/opt/anchor/.deploy-backups` | Records last good commit for rollback. |
| `ANCHOR_LOG_DIR` | `/var/log/anchor` | Per-deploy log files. |

## Failure modes

`deploy.sh` exit codes:

- `0` — success
- `1` — generic / sanity check failed
- `2` — secrets missing
- `3` — build failed
- `4` — pm2 restart failed
- `5` — health check failed (auto-rollback attempted)

Logs land in `$ANCHOR_LOG_DIR/deploy-YYYY-MM-DDTHHMMSSZ.log`. Old logs
trimmed after 30 days automatically.

## Recovery from a broken deploy

```bash
sudo -u jod /opt/anchor/ops/deploy.sh --rollback
```

Restores the previous good commit recorded in
`/opt/anchor/.deploy-backups/last-good-commit`, rebuilds, restarts.

## Local development

These scripts target the VPS only. For local dev:

- `npm run dev` to run the server in tsx watch mode
- `npm run build && npm run start` to simulate production locally
- Do **not** run `bootstrap-vps.sh` or `deploy.sh` locally — they expect
  the production filesystem layout (`/opt/anchor`, `/var/log/anchor`).
