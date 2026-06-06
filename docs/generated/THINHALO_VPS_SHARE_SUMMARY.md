# Thinhalo VPS share summary

## Purpose

This file is a generated, operator-safe summary of the current Buoy app state for sharing into thinhalo VPS context. It is derived from canonical Buoy records and is not the source of truth.

## App identity

- Canonical app URL: Not captured in current canonical docs.
- Back-compat URL: Not captured in current canonical docs.
- Public repo: github.com/ideasth/buoy-app
- VPS host: Not captured in current canonical docs. (Not captured in current canonical docs.)
- Reverse proxy: Not captured in current canonical docs.
- pm2 process: Not captured in current canonical docs.

## Runtime topology

- Single VPS deployment model with one Node process behind Not captured in current canonical docs..
- Application listens on loopback port 5000 behind the reverse proxy.
- Canonical VPS repo path: Not captured in current canonical docs.
- Legacy Anchor naming remains in selected paths and hostnames for compatibility where documented.

## Public surfaces

- buoy.thinhalo.com — Apex Buoy app.
- anchor.thinhalo.com — Back-compat apex hostname served from the same backend.
- buoy-family.thinhalo.com — Family calendar surface.
- oliver-availability.thinhalo.com — Sanitised availability surface.

## Deploy workflow

- Canonical deploy command: Not captured in current canonical docs.
- High-level steps: pull main, regenerate baked secret from VPS secret store, install dependencies, build, reload pm2, probe health, and write a deploy log.
- Deploy logs are written under /var/log/buoy as deploy-UTC-timestamp.log files.

## Backups and health

- OneDrive is the canonical backup store.
- Backup receipt freshness is verified and surfaced through the existing admin-health model.
- The admin health view summarises cron heartbeats, VPS timers, backup receipts, and masked ICS feed status.
- There is no persistent local backup directory treated as canonical storage.

## Scheduled tasks

- Perplexity crons currently cover Outlook capture, ICS-only calendar sync, email status pull, and a one-shot AEDT cutover reminder.
- VPS systemd timers currently cover backup snapshotting, backup pruning, calendar warming, morning warming, weekly-review warming, and backup-receipt verification.
- This summary feature does not create or retune any scheduled task.

## Pipeline snapshot


## Source files

- CONTEXT.md
- PROJECT_DIRECTION_QUIETLY_DISTRIBUTABLE.md

## Generated

- Timestamp: 2026-06-06 12:27:04 Australia/Melbourne
- Generator: scripts/generate-share-summary.mjs
- Mode: manual
