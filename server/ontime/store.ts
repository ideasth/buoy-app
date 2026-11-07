// filepath: /home/user/workspace/anchor/server/ontime/store.ts
// Stage 25 (On Time) — SQLite persistence. Own tables, created idempotently,
// so no change to the main storage.ts migration block is needed.

import type { Database as Db } from "better-sqlite3";
import crypto from "node:crypto";
import { DEFAULT_CONFIG, mergeConfig, type OnTimeConfig } from "./config";
import type { PlannedCue } from "./plan";

export const TRIAGE_CATEGORIES = ["act_today", "reply_week", "waiting", "fyi"] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

export interface AlertRow {
  id: number;
  key: string;
  kind: string;
  fire_at: number;
  title: string;
  body: string;
  priority: number;
  event_uid: string | null;
  event_start_ms: number | null;
  leave_at_ms: number | null;
  status: "pending" | "sent" | "acked" | "skipped" | "failed";
  sent_at: number | null;
  acked_at: number | null;
  ack_action: string | null;
  snooze_count: number;
  escalated_at: number | null;
  ack_token: string;
  created_at: number;
  updated_at: number;
}

export interface TriageRow {
  id: number;
  source: "graph" | "upload";
  external_id: string;
  received_at: number;
  sender: string;
  sender_name: string;
  subject: string;
  snippet: string;
  web_link: string | null;
  category: TriageCategory | null;
  summary: string | null;
  deadline_text: string | null;
  deadline_date: string | null; // YYYY-MM-DD
  is_priority: number;
  rule_hits: string | null;
  model: string | null;
  status: "queued" | "new" | "done" | "dismissed";
  task_id: number | null;
  nudged_at: number | null;
  body_for_llm: string | null; // cleared after classification
  classified_at: number | null;
  created_at: number;
  updated_at: number;
}

export function initOnTimeSchema(db: Db): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS ontime_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ontime_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 3,
  event_uid TEXT,
  event_start_ms INTEGER,
  leave_at_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at INTEGER,
  acked_at INTEGER,
  ack_action TEXT,
  snooze_count INTEGER NOT NULL DEFAULT 0,
  escalated_at INTEGER,
  ack_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ontime_alerts_fire ON ontime_alerts(status, fire_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ontime_alerts_token ON ontime_alerts(ack_token);
CREATE TABLE IF NOT EXISTS email_triage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  sender TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  web_link TEXT,
  category TEXT,
  summary TEXT,
  deadline_text TEXT,
  deadline_date TEXT,
  is_priority INTEGER NOT NULL DEFAULT 0,
  rule_hits TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  task_id INTEGER,
  nudged_at INTEGER,
  body_for_llm TEXT,
  classified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_email_triage_status ON email_triage(status, received_at);
CREATE TABLE IF NOT EXISTS ontime_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`);
}

export class OnTimeStore {
  constructor(public db: Db, private clock: () => number = Date.now) {
    initOnTimeSchema(db);
  }

  // ---- config ----
  getConfig(): OnTimeConfig {
    const row = this.db.prepare(`SELECT json FROM ontime_config WHERE id = 1`).get() as { json: string } | undefined;
    if (!row) return { ...DEFAULT_CONFIG };
    try {
      return mergeConfig(DEFAULT_CONFIG, JSON.parse(row.json));
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  updateConfig(patch: Record<string, unknown>): OnTimeConfig {
    const next = mergeConfig(this.getConfig(), patch);
    this.db.prepare(
      `INSERT INTO ontime_config (id, json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(next), this.clock());
    return next;
  }

  // ---- kv ----
  kvGet(k: string): string | null {
    const r = this.db.prepare(`SELECT v FROM ontime_kv WHERE k = ?`).get(k) as { v: string } | undefined;
    return r?.v ?? null;
  }
  kvSet(k: string, v: string): void {
    this.db.prepare(
      `INSERT INTO ontime_kv (k, v, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    ).run(k, v, this.clock());
  }

  // ---- alerts ----
  /**
   * Reconcile planned cues for a window with stored alerts:
   *  - insert new keys
   *  - update fire_at/title/body of still-pending alerts if the plan moved
   *  - mark pending alerts in the window whose key vanished as skipped
   *    (event cancelled / moved out of window)
   */
  reconcile(cues: PlannedCue[], fromMs: number, toMs: number): { inserted: number; updated: number; removed: number } {
    const now = this.clock();
    let inserted = 0, updated = 0, removed = 0;
    const keys = new Set(cues.map((c) => c.key));
    const getByKey = this.db.prepare(`SELECT * FROM ontime_alerts WHERE key = ?`);
    const ins = this.db.prepare(
      `INSERT INTO ontime_alerts (key, kind, fire_at, title, body, priority, event_uid, event_start_ms, leave_at_ms, status, ack_token, created_at, updated_at)
       VALUES (@key, @kind, @fireAt, @title, @body, @priority, @eventUid, @eventStartMs, @leaveAtMs, 'pending', @token, @now, @now)`,
    );
    const upd = this.db.prepare(
      `UPDATE ontime_alerts SET fire_at = ?, title = ?, body = ?, priority = ?, leave_at_ms = ?, updated_at = ? WHERE id = ?`,
    );
    const tx = this.db.transaction(() => {
      for (const c of cues) {
        const existing = getByKey.get(c.key) as AlertRow | undefined;
        if (!existing) {
          ins.run({
            key: c.key, kind: c.kind, fireAt: c.fireAt, title: c.title, body: c.body,
            priority: c.priority, eventUid: c.eventUid ?? null, eventStartMs: c.eventStartMs ?? null,
            leaveAtMs: c.leaveAtMs ?? null, token: crypto.randomBytes(18).toString("base64url"), now,
          });
          inserted++;
        } else if (
          existing.status === "pending" && existing.snooze_count === 0 &&
          (existing.fire_at !== c.fireAt || existing.title !== c.title || existing.body !== c.body)
        ) {
          upd.run(c.fireAt, c.title, c.body, c.priority, c.leaveAtMs ?? null, now, existing.id);
          updated++;
        }
      }
      const pending = this.db.prepare(
        `SELECT id, key FROM ontime_alerts WHERE status = 'pending' AND snooze_count = 0 AND fire_at >= ? AND fire_at < ?`,
      ).all(fromMs, toMs) as Array<{ id: number; key: string }>;
      const skip = this.db.prepare(`UPDATE ontime_alerts SET status = 'skipped', updated_at = ? WHERE id = ?`);
      for (const p of pending) {
        if (!keys.has(p.key)) { skip.run(now, p.id); removed++; }
      }
    });
    tx();
    return { inserted, updated, removed };
  }

  /** One-off alert (email nudge). Idempotent on key. */
  insertOneOff(c: PlannedCue): boolean {
    const now = this.clock();
    const r = this.db.prepare(
      `INSERT OR IGNORE INTO ontime_alerts (key, kind, fire_at, title, body, priority, status, ack_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(c.key, c.kind, c.fireAt, c.title, c.body, c.priority, crypto.randomBytes(18).toString("base64url"), now, now);
    return r.changes > 0;
  }
  countKindSince(kind: string, sinceMs: number): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM ontime_alerts WHERE kind = ? AND fire_at >= ?`).get(kind, sinceMs) as { n: number }).n;
  }

  dueAlerts(now: number): AlertRow[] {
    return this.db.prepare(
      `SELECT * FROM ontime_alerts WHERE status = 'pending' AND fire_at <= ? ORDER BY fire_at ASC LIMIT 20`,
    ).all(now) as AlertRow[];
  }
  needsEscalation(now: number, afterMinutes: number): AlertRow[] {
    return this.db.prepare(
      `SELECT * FROM ontime_alerts WHERE kind = 'leave_now' AND status = 'sent' AND escalated_at IS NULL AND sent_at <= ?`,
    ).all(now - afterMinutes * 60_000) as AlertRow[];
  }
  markSent(id: number, body?: string): void {
    const now = this.clock();
    if (body != null) {
      this.db.prepare(`UPDATE ontime_alerts SET status = 'sent', sent_at = ?, body = ?, updated_at = ? WHERE id = ?`).run(now, body, now, id);
    } else {
      this.db.prepare(`UPDATE ontime_alerts SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
    }
  }
  markStatus(id: number, status: AlertRow["status"]): void {
    this.db.prepare(`UPDATE ontime_alerts SET status = ?, updated_at = ? WHERE id = ?`).run(status, this.clock(), id);
  }
  markEscalated(id: number): void {
    const now = this.clock();
    this.db.prepare(`UPDATE ontime_alerts SET escalated_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
  }
  getAlertByToken(token: string): AlertRow | undefined {
    return this.db.prepare(`SELECT * FROM ontime_alerts WHERE ack_token = ?`).get(token) as AlertRow | undefined;
  }
  getAlert(id: number): AlertRow | undefined {
    return this.db.prepare(`SELECT * FROM ontime_alerts WHERE id = ?`).get(id) as AlertRow | undefined;
  }
  ack(id: number, action: string): void {
    const now = this.clock();
    this.db.prepare(
      `UPDATE ontime_alerts SET status = 'acked', acked_at = ?, ack_action = ?, updated_at = ? WHERE id = ?`,
    ).run(now, action, now, id);
  }
  snooze(id: number, minutes: number): void {
    const now = this.clock();
    this.db.prepare(
      `UPDATE ontime_alerts SET status = 'pending', fire_at = ?, snooze_count = snooze_count + 1,
         sent_at = NULL, escalated_at = NULL, ack_action = 'snooze', updated_at = ? WHERE id = ?`,
    ).run(now + minutes * 60_000, now, id);
  }
  listAlerts(fromMs: number, toMs: number): AlertRow[] {
    return this.db.prepare(
      `SELECT * FROM ontime_alerts WHERE fire_at >= ? AND fire_at < ? ORDER BY fire_at ASC`,
    ).all(fromMs, toMs) as AlertRow[];
  }
  /** Lateness signal for Step 2 calibration: leave_now ack actions. */
  pruneAlerts(olderThanMs: number): number {
    return this.db.prepare(`DELETE FROM ontime_alerts WHERE fire_at < ?`).run(olderThanMs).changes;
  }

  // ---- email triage ----
  insertTriage(row: {
    source: "graph" | "upload"; externalId: string; receivedAt: number; sender: string;
    senderName: string; subject: string; snippet: string; webLink: string | null; bodyForLlm: string;
  }): { id: number; inserted: boolean } {
    const now = this.clock();
    const r = this.db.prepare(
      `INSERT OR IGNORE INTO email_triage (source, external_id, received_at, sender, sender_name, subject, snippet, web_link, status, body_for_llm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    ).run(row.source, row.externalId, row.receivedAt, row.sender, row.senderName, row.subject,
      row.snippet, row.webLink, row.bodyForLlm, now, now);
    if (r.changes > 0) return { id: Number(r.lastInsertRowid), inserted: true };
    const ex = this.db.prepare(`SELECT id FROM email_triage WHERE source = ? AND external_id = ?`)
      .get(row.source, row.externalId) as { id: number };
    return { id: ex.id, inserted: false };
  }
  nextQueued(): TriageRow | undefined {
    return this.db.prepare(
      `SELECT * FROM email_triage WHERE status = 'queued' ORDER BY received_at DESC LIMIT 1`,
    ).get() as TriageRow | undefined;
  }
  queuedCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM email_triage WHERE status = 'queued'`).get() as { n: number }).n;
  }
  saveClassification(id: number, c: {
    category: TriageCategory; summary: string; deadlineText: string | null; deadlineDate: string | null;
    isPriority: boolean; ruleHits: string[]; model: string | null;
  }): void {
    const now = this.clock();
    this.db.prepare(
      `UPDATE email_triage SET category = ?, summary = ?, deadline_text = ?, deadline_date = ?, is_priority = ?,
         rule_hits = ?, model = ?, status = 'new', body_for_llm = NULL, classified_at = ?, updated_at = ? WHERE id = ?`,
    ).run(c.category, c.summary, c.deadlineText, c.deadlineDate, c.isPriority ? 1 : 0,
      c.ruleHits.join(","), c.model, now, now, id);
  }
  getTriage(id: number): TriageRow | undefined {
    return this.db.prepare(`SELECT * FROM email_triage WHERE id = ?`).get(id) as TriageRow | undefined;
  }
  listTriage(opts: { includeClosed?: boolean; limit?: number } = {}): TriageRow[] {
    const where = opts.includeClosed ? "" : "WHERE status IN ('new','queued')";
    return this.db.prepare(
      `SELECT id, source, external_id, received_at, sender, sender_name, subject, snippet, web_link, category, summary,
              deadline_text, deadline_date, is_priority, rule_hits, model, status, task_id, nudged_at, NULL AS body_for_llm,
              classified_at, created_at, updated_at
       FROM email_triage ${where} ORDER BY received_at DESC LIMIT ?`,
    ).all(opts.limit ?? 300) as TriageRow[];
  }
  updateTriage(id: number, patch: { status?: string; category?: string; taskId?: number | null; nudgedAt?: number }): TriageRow | undefined {
    const cur = this.getTriage(id);
    if (!cur) return undefined;
    const status = patch.status && ["new", "done", "dismissed"].includes(patch.status) ? patch.status : cur.status;
    const category = patch.category && (TRIAGE_CATEGORIES as readonly string[]).includes(patch.category) ? patch.category : cur.category;
    const taskId = patch.taskId !== undefined ? patch.taskId : cur.task_id;
    const nudgedAt = patch.nudgedAt ?? cur.nudged_at;
    this.db.prepare(
      `UPDATE email_triage SET status = ?, category = ?, task_id = ?, nudged_at = ?, updated_at = ? WHERE id = ?`,
    ).run(status, category, taskId, nudgedAt, this.clock(), id);
    return this.getTriage(id);
  }
  /** Retention: drop snippets of closed items older than 30 days. */
  pruneTriage(olderThanMs: number): number {
    return this.db.prepare(
      `DELETE FROM email_triage WHERE status IN ('done','dismissed','new') AND received_at < ?`,
    ).run(olderThanMs).changes;
  }
  triageCounts(): Record<string, number> {
    const rows = this.db.prepare(
      `SELECT COALESCE(category,'queued') AS c, COUNT(*) AS n FROM email_triage WHERE status IN ('new','queued') GROUP BY c`,
    ).all() as Array<{ c: string; n: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.c] = r.n;
    return out;
  }
}
