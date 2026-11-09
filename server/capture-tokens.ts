// filepath: server/capture-tokens.ts
// Stage 26c — per-device capture tokens for "Share to Buoy" (Apple Shortcut).
//
// A capture token can do exactly one thing: POST /api/capture. It is checked
// only inside that route handler, so it authenticates nothing else (every
// other /api route still needs a session or the sync secret).
//
// Only a SHA-256 hash is stored. The raw token is shown once, at creation.
// Rate limit: 30 captures per minute per device (in memory).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { validateCapture, saveCapture, type CaptureDeps } from "./capture";

export const TOKEN_PREFIX = "bcap_";
export const RATE_LIMIT_PER_MIN = 30;

export interface CaptureTokenRow {
  id: number;
  label: string;
  hint: string; // last 4 chars, for recognising the device
  createdAt: number;
  lastUsedAt: number | null;
  useCount: number;
  revokedAt: number | null;
}

type Db = {
  exec: (sql: string) => void;
  prepare: (sql: string) => { run: (...a: unknown[]) => { lastInsertRowid: number | bigint; changes: number }; get: (...a: unknown[]) => any; all: (...a: unknown[]) => any[] };
};

const hash = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");

export function readBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

export class CaptureTokenStore {
  private hits = new Map<number, number[]>();

  constructor(private db: Db, private now: () => number = Date.now) {
    db.exec(`
CREATE TABLE IF NOT EXISTS capture_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);`);
  }

  create(label: string): { row: CaptureTokenRow; token: string } {
    const clean = label.trim().slice(0, 60) || "Device";
    const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const info = this.db
      .prepare(`INSERT INTO capture_tokens (label, token_hash, hint, created_at) VALUES (?, ?, ?, ?)`)
      .run(clean, hash(token), token.slice(-4), this.now());
    return { row: this.get(Number(info.lastInsertRowid))!, token };
  }

  get(id: number): CaptureTokenRow | undefined {
    return this.db
      .prepare(
        `SELECT id, label, hint, created_at AS createdAt, last_used_at AS lastUsedAt, use_count AS useCount, revoked_at AS revokedAt
         FROM capture_tokens WHERE id = ?`,
      )
      .get(id);
  }

  list(): CaptureTokenRow[] {
    return this.db
      .prepare(
        `SELECT id, label, hint, created_at AS createdAt, last_used_at AS lastUsedAt, use_count AS useCount, revoked_at AS revokedAt
         FROM capture_tokens ORDER BY revoked_at IS NOT NULL, created_at DESC`,
      )
      .all();
  }

  revoke(id: number): boolean {
    return this.db.prepare(`UPDATE capture_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).run(this.now(), id).changes > 0;
  }

  /** Returns the active token's id, or null. Constant-time compare on the hash. */
  verify(raw: string | null): number | null {
    if (!raw || !raw.startsWith(TOKEN_PREFIX) || raw.length > 200) return null;
    const h = hash(raw);
    const row = this.db.prepare(`SELECT id, token_hash AS tokenHash FROM capture_tokens WHERE token_hash = ? AND revoked_at IS NULL`).get(h);
    if (!row) return null;
    const a = Buffer.from(row.tokenHash, "hex");
    const b = Buffer.from(h, "hex");
    return a.length === b.length && timingSafeEqual(a, b) ? row.id : null;
  }

  /** Sliding one-minute window. Returns false when the device is over the limit. */
  allow(id: number): boolean {
    const t = this.now();
    const recent = (this.hits.get(id) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= RATE_LIMIT_PER_MIN) {
      this.hits.set(id, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(id, recent);
    return true;
  }

  markUsed(id: number): void {
    this.db.prepare(`UPDATE capture_tokens SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?`).run(this.now(), id);
  }
}

/** POST /api/capture handler. The token is checked only here. */
export function shareCaptureHandler(tokens: CaptureTokenStore, deps: CaptureDeps) {
  return (req: Request, res: Response) => {
    const tokenId = tokens.verify(readBearer(req.header("authorization")));
    if (tokenId == null) return res.status(401).json({ error: "invalid_token" });
    if (!tokens.allow(tokenId)) return res.status(429).json({ error: "rate_limited" });
    const body = { ...(req.body ?? {}) };
    delete body.projectId; // share captures always land as "check" tasks
    const v = validateCapture(body);
    if (!v.ok) return res.status(v.status).json({ error: v.error });
    const r = saveCapture(deps, v.value);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    tokens.markUsed(tokenId);
    res.json({ ok: true, id: r.id, title: r.title });
  };
}
