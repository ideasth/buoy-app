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
import { rawSqlite } from "./storage";

// The cwd-relative path used by storage.ts (`new Database("data.db")`).
const DB_PATH = path.resolve(process.cwd(), "data.db");

const IMPORT_ENABLED = process.env.ANCHOR_DB_IMPORT_ENABLED === "1";

// Max import payload: 200 MB. data.db should never get close.
const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

type Authed = (req: Request, res: Response) => boolean;

export function registerAdminDbRoutes(
  app: Express,
  requireOrchestrator: Authed,
  // Optional: when provided, /api/admin/health accepts user-cookie auth too
  // (so the in-app /admin dashboard works without prompting for a secret).
  requireUserOrOrchestrator?: Authed,
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
  // Returns DB size + import flag, local backup directory state (best-effort
  // — only readable when the server runs in the Computer sandbox), and a
  // static manifest of the scheduled crons that orchestrate this app.
  // Cron live status is NOT polled here; the published sandbox can't reach
  // pplx-tool. The user checks runs in the Perplexity scheduler UI.
  const BACKUPS_DIR = "/home/user/workspace/anchor-backups";
  const KNOWN_CRONS: Array<{
    id: string;
    name: string;
    cron: string;
    note: string;
  }> = [
    {
      id: "8e8b7bb5",
      name: "Anchor data.db weekly backup",
      cron: "0 17 * * 6",
      note: "Saturdays 17:00 UTC = Sundays 03:00 AEST. Retune to '0 16 * * 6' on/after 2026-10-05 (AEDT cutover).",
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

    // Backups (best-effort read of local Computer-sandbox path).
    let backupCount = 0;
    let lastLocalMtime: number | null = null;
    let lastLocalPath: string | null = null;
    let backupsReadable = false;
    try {
      const entries = fs.readdirSync(BACKUPS_DIR);
      backupsReadable = true;
      const dbFiles = entries.filter((f) => f.startsWith("anchor-") && f.endsWith(".db"));
      backupCount = dbFiles.length;
      for (const f of dbFiles) {
        try {
          const full = path.join(BACKUPS_DIR, f);
          const st = fs.statSync(full);
          const mtime = st.mtimeMs;
          if (lastLocalMtime === null || mtime > lastLocalMtime) {
            lastLocalMtime = mtime;
            lastLocalPath = full;
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* backupsReadable stays false (expected in published sandbox) */
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
        dir: BACKUPS_DIR,
        readable: backupsReadable,
        count: backupCount,
        lastLocalMtime,
        lastLocalPath,
        note: backupsReadable
          ? null
          : "Local backup dir not readable from this sandbox. Backups exist on the Computer-side filesystem and are uploaded to OneDrive by cron 8e8b7bb5.",
      },
      crons: KNOWN_CRONS,
    });
  });
}
