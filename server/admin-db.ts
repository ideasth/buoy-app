// server/admin-db.ts
// Export and (gated) import of the SQLite data.db file.
// Both endpoints are protected by X-Anchor-Sync-Secret via requireOrchestrator.
// Import is additionally gated by ANCHOR_DB_IMPORT_ENABLED=1 to prevent
// accidental writes — production deploys leave it unset.

import type { Express, Request, Response } from "express";
import express from "express";
import fs from "node:fs";
import fs_promises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { rawSqlite, storage } from "./storage";
import { backfillCoachSessionSummaries } from "./coach-summary-backfill";
import { runCoachTelemetrySweepNow } from "./coach-telemetry-sweeper";
import { listErrors, clearErrors, ringSize, recordError } from "./error-buffer";
import {
  classifyHeartbeat,
  parseHeartbeatBody,
  buildExpectedWindows,
} from "./cron-heartbeat";
import { getIcsCacheStatus } from "./ics";

// The cwd-relative path used by storage.ts (`new Database("data.db")`).
const DB_PATH = path.resolve(process.cwd(), "data.db");

const IMPORT_ENABLED = process.env.ANCHOR_DB_IMPORT_ENABLED === "1";

// Max import payload: 200 MB. data.db should never get close.
const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

type Authed = (req: Request, res: Response) => boolean;

// Predicate: returns true when the request authenticated via
// X-Anchor-Sync-Secret (used to gate full-URL exposure on /api/admin/health).
type SyncSecretCheck = (req: Request) => boolean;

export function registerAdminDbRoutes(
  app: Express,
  requireOrchestrator: Authed,
  // Optional: when provided, /api/admin/health accepts user-cookie auth too
  // (so the in-app /admin dashboard works without prompting for a secret).
  requireUserOrOrchestrator?: Authed,
  // Optional: lets /api/admin/health distinguish sync-secret callers from
  // cookie-only callers without re-implementing secret comparison here.
  // When omitted, full ICS URLs are never revealed.
  hasSyncSecret?: SyncSecretCheck,
) {
  // -------- EXPORT --------
  // GET /api/admin/db/export
  // Returns a consistent SQLite snapshot. Uses better-sqlite3's native backup
  // API (online backup), which is safe even with concurrent writers.
  app.get("/api/admin/db/export", async (req, res) => {
    if (!requireOrchestrator(req, res)) return;

    let tmpPath = "";
    try {
      // better-sqlite3's .backup() is the online-backup API: produces a
      // consistent snapshot even with concurrent writers.
      tmpPath = path.join(os.tmpdir(), `anchor-export-${Date.now()}.db`);
      await rawSqlite.backup(tmpPath);

      const stat = await fs_promises.stat(tmpPath);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="anchor-data-${stamp}.db"`,
      );

      const stream = fs.createReadStream(tmpPath);
      stream.on("error", (err) => {
        console.error("[admin-db] export stream error:", err);
        if (!res.headersSent) res.status(500).end("export stream failed");
      });
      stream.on("close", async () => {
        try {
          await fs_promises.unlink(tmpPath);
        } catch {
          /* swallow */
        }
      });
      stream.pipe(res);
    } catch (err: any) {
      console.error("[admin-db] export failed:", err?.message || err);
      if (tmpPath) {
        try {
          await fs_promises.unlink(tmpPath);
        } catch {
          /* swallow */
        }
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "export failed", detail: String(err?.message || err) });
      }
    }
  });

  // -------- IMPORT (DESTRUCTIVE — gated) --------
  // POST /api/admin/db/import
  // Body: raw SQLite file bytes (Content-Type: application/octet-stream)
  // Validates with PRAGMA integrity_check, backs up current DB, atomic swap.
  //
  // Required:
  //   - X-Anchor-Sync-Secret header
  //   - ANCHOR_DB_IMPORT_ENABLED=1 in env (off by default)
  //
  // After a successful import the server MUST be restarted to release the
  // old SQLite handle. The endpoint returns { restartRequired: true } and
  // does not attempt to swap the in-process handle.
  app.post(
    "/api/admin/db/import",
    express.raw({ type: "application/octet-stream", limit: MAX_IMPORT_BYTES }),
    async (req, res) => {
      if (!requireOrchestrator(req, res)) return;

      if (!IMPORT_ENABLED) {
        return res.status(403).json({
          error: "db import disabled",
          detail:
            "Set ANCHOR_DB_IMPORT_ENABLED=1 in the server environment to enable. Default is OFF.",
        });
      }

      const body = req.body as Buffer | undefined;
      if (!body || !Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: "empty body" });
      }

      // SQLite files start with the magic string "SQLite format 3\0".
      const magic = body.slice(0, 16).toString("utf8");
      if (!magic.startsWith("SQLite format 3")) {
        return res.status(400).json({
          error: "not a sqlite database",
          detail: `Magic header was: ${JSON.stringify(magic)}`,
        });
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const tmpPath = path.join(os.tmpdir(), `anchor-import-${stamp}.db`);
      const backupPath = `${DB_PATH}.bak.${stamp}`;

      try {
        // 1. Write incoming bytes to a temp file.
        await fs_promises.writeFile(tmpPath, body);

        // 2. Open read-only and run integrity check.
        const checkHandle = new Database(tmpPath, { readonly: true, fileMustExist: true });
        let integrity = "";
        try {
          const row = checkHandle.prepare("PRAGMA integrity_check").get() as any;
          integrity = (row && (row.integrity_check ?? Object.values(row)[0])) || "";
        } finally {
          checkHandle.close();
        }
        if (integrity !== "ok") {
          await fs_promises.unlink(tmpPath).catch(() => {});
          return res.status(400).json({
            error: "integrity check failed",
            integrity,
          });
        }

        // 3. Back up the current DB (and WAL/shm if present).
        if (fs.existsSync(DB_PATH)) {
          await fs_promises.copyFile(DB_PATH, backupPath);
        }
        const wal = `${DB_PATH}-wal`;
        const shm = `${DB_PATH}-shm`;
        if (fs.existsSync(wal)) await fs_promises.copyFile(wal, `${backupPath}-wal`);
        if (fs.existsSync(shm)) await fs_promises.copyFile(shm, `${backupPath}-shm`);

        // 4. Atomic swap. On Linux, rename across same filesystem is atomic.
        // Note: the running better-sqlite3 handle still points at the old
        // inode until the process restarts. That's acceptable — we tell the
        // caller to restart.
        await fs_promises.rename(tmpPath, DB_PATH);

        // Remove WAL/shm so the new DB starts clean — old WAL belongs to old DB.
        for (const p of [wal, shm]) {
          if (fs.existsSync(p)) {
            try {
              await fs_promises.unlink(p);
            } catch {
              /* swallow */
            }
          }
        }

        return res.json({
          ok: true,
          restartRequired: true,
          bytesImported: body.length,
          backupPath,
          note: "Restart the server (re-publish or restart the process) for the new DB to take effect.",
        });
      } catch (err: any) {
        console.error("[admin-db] import failed:", err?.message || err);
        try {
          await fs_promises.unlink(tmpPath);
        } catch {
          /* swallow */
        }
        return res.status(500).json({
          error: "import failed",
          detail: String(err?.message || err),
        });
      }
    },
  );

  // -------- STATUS --------
  // GET /api/admin/db/status — quick sanity check from a new thread.
  app.get("/api/admin/db/status", (req, res) => {
    if (!requireOrchestrator(req, res)) return;
    let size = 0;
    let exists = false;
    try {
      const stat = fs.statSync(DB_PATH);
      size = stat.size;
      exists = true;
    } catch {
      /* exists stays false */
    }
    res.json({
      dbPath: DB_PATH,
      exists,
      sizeBytes: size,
      importEnabled: IMPORT_ENABLED,
    });
  });

  // -------- HEALTH --------
  // GET /api/admin/health — read-only ops dashboard endpoint.
  //
  // Stage 12c (post-VPS-migration) shape:
  //   db                  — sqlite file size + import flag.
  //   backups             — last 5 OneDrive receipts (no local backup dir scan;
  //                         the wmu systemd timer writes straight to OneDrive
  //                         from /var/tmp, no persistent local backup dir).
  //   perplexityCrons     — the 3 recurring Perplexity crons that survive the
  //                         Stage 12b VPS offload, sourced from cron-inventory.
  //   systemdTimers       — the 6 wmu systemd timers (informational only; we
  //                         don't poll them here, the user runs
  //                         `systemctl list-timers` on the VPS to see live state).
  //   cronHeartbeats      — last heartbeat per Perplexity cron in the allowlist.
  //   icsFeeds            — upstream ICS feed cache status (URLs always masked).
  //   coachContextUsage   — last 30 days of coach-context bundle key hits.
  const PERPLEXITY_CRONS: Array<{
    id: string;
    name: string;
    cron: string;
    note: string;
  }> = [
    {
      id: "17df3d7e",
      name: "Outlook + Capture bridge",
      cron: "54 0,2,4,6,8,10,12,20,22 * * *",
      note: "Every 2h, 06:00–22:00 AEST. Retune to '54 23,1,3,5,7,9,11,19,21 * * *' on/after 2026-10-05 (AEDT cutover).",
    },
    {
      id: "2928f9fa",
      name: "Oliver's calendar sync (ICS-only)",
      cron: "0 8,20 * * *",
      note: "06:00 and 18:00 AEST daily. Retune to '0 7,19 * * *' on/after 2026-10-05 (AEDT cutover).",
    },
    {
      id: "c751741f",
      name: "Email Status pull (6-hourly)",
      cron: "0 20,2,8,14 * * *",
      note: "00:00, 06:00, 12:00, 18:00 AEST daily. Retune to '0 19,1,7,13 * * *' on/after 2026-10-05 (AEDT cutover).",
    },
  ];

  // wmu VPS systemd timers (Stage 12b offload). Schedules are Melbourne local
  // time set via OnCalendar in /etc/systemd/system/anchor-*.timer. These do
  // NOT need AEDT retuning — systemd handles the cutover automatically.
  const SYSTEMD_TIMERS: Array<{
    name: string;
    schedule: string;
    description: string;
  }> = [
    {
      name: "anchor-backup-datadb",
      schedule: "daily 02:00",
      description: "Pulls a consistent snapshot from /api/admin/db/export, compresses with zstd, uploads to onedrive:Backups/Anchor/YYYY/MM/, POSTs a backup receipt.",
    },
    {
      name: "anchor-prune-backups",
      schedule: "Sun 03:25",
      description: "Retention sweep: keep 90 daily, 1 yr weekly, forever monthly. Dry-run by default; deletes when ANCHOR_PRUNE_APPLY=1.",
    },
    {
      name: "anchor-warm-calendar",
      schedule: "daily 05:55 and 17:55",
      description: "Warms the calendar ICS cache by hitting /api/calendar.",
    },
    {
      name: "anchor-warm-morning",
      schedule: "daily 05:55",
      description: "Warms the morning-briefing endpoints (capture, today's plan).",
    },
    {
      name: "anchor-warm-weekly-review",
      schedule: "Sun 18:25",
      description: "Warms the weekly-review endpoints before the user's Sunday review.",
    },
    {
      name: "anchor-verify-backup-receipt",
      schedule: "Sat 06:31",
      description: "Posts an alert to the in-memory error ring if no backup receipt has landed in the last 36 hours.",
    },
  ];

  app.get("/api/admin/health", (req, res) => {
    const auth = requireUserOrOrchestrator ?? requireOrchestrator;
    if (!auth(req, res)) return;

    // DB.
    let dbExists = false;
    let dbSize = 0;
    try {
      const stat = fs.statSync(DB_PATH);
      dbExists = true;
      dbSize = stat.size;
    } catch {
      /* dbExists stays false */
    }

    // Last OneDrive backup receipt (posted by the wmu anchor-backup-datadb
    // systemd timer after each successful upload). Backups land directly on
    // OneDrive from /var/tmp on the VPS — there is no persistent local backup
    // dir to scan since the Stage 12b migration.
    let lastReceipt: ReturnType<typeof storage.latestBackupReceipt> = null;
    try {
      lastReceipt = storage.latestBackupReceipt();
    } catch {
      lastReceipt = null;
    }

    // Last 5 OneDrive backups (recent receipts), for the dashboard tile.
    let recentReceipts: ReturnType<typeof storage.recentBackupReceipts> = [];
    try {
      recentReceipts = storage.recentBackupReceipts(5);
    } catch {
      recentReceipts = [];
    }

    // Cron heartbeats (Option 3 canary). One row per known cron with the
    // most-recent heartbeat (or null) plus its anomaly_reason. The Admin UI
    // shows a red dot when anomalyReason is non-null.
    let cronHeartbeats: Array<{
      cronId: string;
      ranAt: number | null;
      anomalyReason: string | null;
      createdAt: number | null;
    }> = [];
    try {
      const allowlist = Object.keys(buildExpectedWindows());
      cronHeartbeats = allowlist.map((cronId) => {
        const r = storage.latestCronHeartbeat(cronId);
        return {
          cronId,
          ranAt: r ? r.ranAt : null,
          anomalyReason: r ? r.anomalyReason : null,
          createdAt: r ? r.createdAt : null,
        };
      });
    } catch {
      cronHeartbeats = [];
    }

    // ICS feeds (Admin dashboard). Privacy: full URLs are ONLY revealed when
    // the request authenticated via X-Anchor-Sync-Secret. Cookie-only callers
    // see the masked URL plus last-fetch + count metadata.
    // We no longer reveal the raw URL even when the sync-secret is presented
    // (Stage 12c — ICS publish URLs embed a PAT and there's no admin UX that
    // needs the unmasked form). hasSyncSecret is still imported for future
    // use; reference it once here to keep the dependency explicit without
    // tripping unused-import lints.
    void hasSyncSecret;
    const maskUrl = (u: string): string =>
      u ? u.replace(/\/\/.*@/, "//[secret]@") : "";
    let icsFeeds: Array<{
      label: string;
      urlMasked: string;
      hasUrl: boolean;
      lastFetchedAt: number | null;
      eventCount: number | null;
      cacheStatus: "fresh" | "stale" | "never";
    }> = [];
    try {
      const s = storage.getSettings();
      const feedDefs: Array<{ label: string; url: string }> = [
        { label: "Personal calendar", url: s.calendar_ics_url || "" },
        { label: "AUPFHS (Outlook publish)", url: s.aupfhs_ics_url || "" },
      ];
      const FRESH_MS = 30 * 60 * 1000; // 30 min — cache TTL is 15 min, give headroom
      icsFeeds = feedDefs.map(({ label, url }) => {
        const status = url ? getIcsCacheStatus(url) : null;
        let cacheStatus: "fresh" | "stale" | "never" = "never";
        if (status) {
          cacheStatus = Date.now() - status.fetchedAt < FRESH_MS ? "fresh" : "stale";
        }
        return {
          label,
          // Stage 12c: never return the raw URL from this endpoint, even when
          // the request authed via X-Anchor-Sync-Secret. The credential
          // portion of the URL (e.g. Outlook publish PAT) is sensitive and
          // there's no Admin UX that needs the raw form — the user maintains
          // the URLs in Settings, which has its own auth path. The masked
          // URL is sufficient for the cache-status display.
          urlMasked: maskUrl(url),
          hasUrl: Boolean(url),
          lastFetchedAt: status ? status.fetchedAt : null,
          eventCount: status ? status.eventCount : null,
          cacheStatus,
        };
      });
    } catch {
      icsFeeds = [];
    }

    // Coach context-bundle telemetry (last 30 days, top 10 keys).
    let coachContextUsage: Array<{ key: string; hits: number; sessions: number }> = [];
    let coachTelemetryEnabled = true;
    try {
      coachTelemetryEnabled = storage.getSettings().coach_telemetry_enabled !== false;
    } catch {
      coachTelemetryEnabled = true;
    }
    try {
      coachContextUsage = storage.summariseCoachContextUsage(30).slice(0, 10);
    } catch {
      coachContextUsage = [];
    }

    res.json({
      generatedAt: Date.now(),
      db: {
        path: DB_PATH,
        exists: dbExists,
        sizeBytes: dbSize,
        importEnabled: IMPORT_ENABLED,
      },
      backups: {
        lastReceipt,
        recent: recentReceipts,
        note: "Daily backups land directly on OneDrive from the wmu VPS via the anchor-backup-datadb systemd timer. There is no persistent local backup directory.",
      },
      perplexityCrons: PERPLEXITY_CRONS,
      systemdTimers: SYSTEMD_TIMERS,
      cronHeartbeats,
      icsFeeds,
      coachContextUsage,
      coachTelemetryEnabled,
    });
  });

  // POST /api/admin/coach/backfill-summaries
  // Manual catch-up for the boot-time backfill ceiling.
  // Body: { limit?: number } (default 50, capped 1–500)
  // Auth: X-Anchor-Sync-Secret only (no user cookie); admin maintenance.
  app.post(
    "/api/admin/coach/backfill-summaries",
    express.json({ limit: "1kb" }),
    async (req, res) => {
      if (!requireOrchestrator(req, res)) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const rawLimit = typeof body.limit === "number" && isFinite(body.limit) ? Math.floor(body.limit) : 50;
      const limit = Math.max(1, Math.min(rawLimit, 500));
      try {
        const r = await backfillCoachSessionSummaries(limit);
        res.json({ ok: true, ...r, limit });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: "backfill failed", detail: msg.slice(0, 400) });
      }
    },
  );

  // POST /api/admin/coach/telemetry-sweep
  // Manual one-shot retention sweep on coach_context_usage.
  // Returns rows removed and current retention window.
  // Auth: X-Anchor-Sync-Secret only.
  app.post("/api/admin/coach/telemetry-sweep", (req, res) => {
    if (!requireOrchestrator(req, res)) return;
    try {
      const r = runCoachTelemetrySweepNow();
      res.json({ ok: true, ...r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "sweep failed", detail: msg.slice(0, 400) });
    }
  });

  // POST /api/admin/backup-receipt
  // Recorded by the weekly backup cron after a successful OneDrive upload.
  // Payload: { onedriveUrl: string, mtime?: number, sizeBytes?: number, note?: string }
  // Auth: X-Anchor-Sync-Secret only (no user cookie); this is a cron endpoint.
  app.post("/api/admin/backup-receipt", express.json({ limit: "4kb" }), (req, res) => {
    if (!requireOrchestrator(req, res)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const onedriveUrl = typeof body.onedriveUrl === "string" ? body.onedriveUrl.trim() : "";
    if (!onedriveUrl || onedriveUrl.length > 2000) {
      return res.status(400).json({ error: "onedriveUrl required (string, <=2000 chars)" });
    }
    const mtime = typeof body.mtime === "number" && isFinite(body.mtime) ? body.mtime : null;
    const sizeBytes =
      typeof body.sizeBytes === "number" && isFinite(body.sizeBytes) ? body.sizeBytes : null;
    const note =
      typeof body.note === "string" && body.note.length <= 500 ? body.note : null;
    try {
      const r = storage.recordBackupReceipt({ onedriveUrl, mtime, sizeBytes, note });
      res.json({ ok: true, id: r.id, createdAt: r.createdAt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "failed to record receipt", detail: msg.slice(0, 400) });
    }
  });

  // GET /api/admin/recent-errors
  // Returns the in-memory error ring buffer (H-lite, no Sentry).
  // Auth: user cookie OR sync secret. Limit query parameter caps result count.
  app.get("/api/admin/recent-errors", (req, res) => {
    const guard = requireUserOrOrchestrator ?? requireOrchestrator;
    if (!guard(req, res)) return;
    const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
    res.json({
      ringSize: ringSize(),
      errors: listErrors(limit),
    });
  });

  // POST /api/admin/recent-errors/clear
  // Wipes the in-memory ring buffer. Sync-secret only (writes are stricter).
  app.post("/api/admin/recent-errors/clear", (req, res) => {
    if (!requireOrchestrator(req, res)) return;
    const removed = clearErrors();
    res.json({ ok: true, removed });
  });

  // POST /api/admin/cron-heartbeat
  // Recorded by every known cron as step 0 of its task body (best-effort).
  // Payload: { cronId: string, ranAt?: number (unix seconds) }
  // Auth: X-Anchor-Sync-Secret only (no user cookie); cron-only endpoint.
  //
  // Anomalies are recorded BOTH durably (cron_heartbeats.anomaly_reason) and
  // ephemerally in the in-memory error ring so they show up in the Admin UI
  // "Recent errors" card immediately. Clean heartbeats are silent.
  app.post(
    "/api/admin/cron-heartbeat",
    express.json({ limit: "2kb" }),
    (req, res) => {
      if (!requireOrchestrator(req, res)) return;
      const parsed = parseHeartbeatBody(req.body, Date.now());
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      try {
        const TWENTY_FOUR_H_MS = 24 * 3600 * 1000;
        const recent = storage.cronHeartbeatsSince(
          parsed.cronId,
          Date.now() - TWENTY_FOUR_H_MS,
        );
        const result = classifyHeartbeat({
          cronId: parsed.cronId,
          ranAtMs: parsed.ranAtMs,
          recentHeartbeatsMs: recent.map((r) => r.createdAt),
        });
        const stored = storage.recordCronHeartbeat({
          cronId: parsed.cronId,
          ranAt: parsed.ranAtMs,
          anomalyReason: result.anomaly,
        });
        if (result.anomaly) {
          // Surface in the in-memory error ring so the Admin UI shows it.
          try {
            recordError({
              err: new Error(
                `[cron-heartbeat anomaly:${result.anomaly}] ${result.detail}`,
              ),
              statusCode: null,
              method: "POST",
              path: "/api/admin/cron-heartbeat",
            });
          } catch {
            /* swallow — recordError must never block */
          }
        }
        res.json({
          ok: true,
          id: stored.id,
          createdAt: stored.createdAt,
          anomaly: result.anomaly,
          detail: result.anomaly ? result.detail : undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: "failed to record heartbeat", detail: msg.slice(0, 400) });
      }
    },
  );

  // GET /api/admin/cron-heartbeats
  // Returns the most-recent N heartbeats across all crons. For drilldown
  // beyond the per-cron summary in /api/admin/health.
  // Auth: user cookie OR sync secret.
  app.get("/api/admin/cron-heartbeats", (req, res) => {
    const guard = requireUserOrOrchestrator ?? requireOrchestrator;
    if (!guard(req, res)) return;
    const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50;
    try {
      res.json({ heartbeats: storage.recentCronHeartbeats(limit) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "failed to load heartbeats", detail: msg.slice(0, 400) });
    }
  });

  // POST /api/admin/email-priority-recompute
  // Re-evaluates isFlagged on every email_status row using the canonical
  // shared/email-priority.ts evaluator. Idempotent. Returns counts.
  // Auth: user cookie OR sync secret (read-only-style write that can't lose data).
  app.post("/api/admin/email-priority-recompute", (req, res) => {
    const guard = requireUserOrOrchestrator ?? requireOrchestrator;
    if (!guard(req, res)) return;
    try {
      const r = storage.recomputeAllEmailPriority();
      res.json({ ok: true, ...r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "recompute failed", detail: msg.slice(0, 400) });
    }
  });
}
