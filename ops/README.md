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
| `jobs/backup-datadb.sh` | Pull fresh data.db from `/api/admin/db/export`, compress with zstd, upload to OneDrive via rclone, POST a receipt to `/api/admin/backup-receipt`. | Daily via systemd timer at 02:00 local. |
| `jobs/prune-backups.sh` | Walk `onedrive:Backups/Anchor/` and delete snapshots that fall outside the retention policy (90d daily / 365d weekly-first / monthly-first forever). Supports `ANCHOR_PRUNE_DRY_RUN=1`. | Weekly via systemd timer at Sun 03:00 local. |
| `install-backup-timer.sh` | Install both the backup and prune systemd unit pairs. Idempotent — re-running picks up edits to units or scripts. | Once after rclone is configured; again after editing any units or scripts. |

## systemd units (in `ops/systemd/`)

| Unit | Purpose |
|---|---|
| `anchor-backup-datadb.service` | Type=oneshot job that runs `jobs/backup-datadb.sh` as `jod`. Hardened (NoNewPrivileges, ProtectSystem=strict, ReadWritePaths constrained). Logs to journalctl under SyslogIdentifier `anchor-backup-datadb`. |
| `anchor-backup-datadb.timer` | Calls the service daily at 02:00 local time, with 10min random jitter and `Persistent=true` so a missed run catches up at boot. |
| `anchor-prune-backups.service` | Type=oneshot job that runs `jobs/prune-backups.sh` as `jod`. Same hardening as the backup service. Logs under SyslogIdentifier `anchor-prune-backups`. Low priority (`Nice=15`). |
| `anchor-prune-backups.timer` | Calls the prune service weekly on Sundays at 03:00 local (one hour after the daily backup), with 30min random jitter and `Persistent=true`. |

## Retention policy (`prune-backups.sh`)

Three windows are OR'd — a snapshot survives if it matches **any** of:

1. **Daily window** — taken in the last `ANCHOR_DAILY_KEEP_DAYS` days (default `90`).
2. **Weekly anchor** — first snapshot of its ISO week, within the last `ANCHOR_WEEKLY_KEEP_DAYS` days (default `365`).
3. **Monthly anchor** — first snapshot of its calendar month. Kept forever.

Filenames are the source of truth for date — `anchor-data-YYYY-MM-DDTHHMMSSZ.db.zst`. Anything unparseable is kept (never delete what we don't understand). Deletes go through `rclone delete --files-from`; empty `YYYY/MM/` directories are swept with `rclone rmdirs` afterwards. Set `ANCHOR_PRUNE_DRY_RUN=1` to log decisions without deleting.

Footprint sketch — if backups are ~1 MB compressed each, steady-state holdings are roughly: 90 daily + 52 weekly + 12 monthly per year, so the first year fits in ~150 MB and grows by ~12 MB/year thereafter.

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

`backup-datadb.sh` exit codes:

- `0` — success
- `1` — generic failure (export, compress, upload, or receipt POST)
- `2` — rclone remote missing

`prune-backups.sh` exit codes:

- `0` — success (zero or more files deleted)
- `1` — generic failure
- `2` — rclone remote missing

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
