// filepath: /home/user/workspace/anchor/server/ontime/routes.ts
// Stage 25 (On Time) — HTTP routes + engine bootstrap. Registered from
// server/routes.ts once getMergedPlannerEvents exists. All routes need a
// signed-in user or the orchestrator secret, except the ack endpoint,
// which is authorised by its single-use random token (ntfy action buttons
// on the phone/watch cannot carry a session cookie).

import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import type { Database as Db } from "better-sqlite3";
import { OnTimeStore } from "./store";
import { OnTimeEngine, type EngineDeps } from "./engine";
import { planCues, runningLateSmsUrl, type PlanEvent } from "./plan";
import { ntfyConfigured, secretsDir, sendNtfy } from "./notify";
import { readGraphCreds } from "./graph";
import { parseUpload, parseZip } from "./upload";
import express from "express";
import { addDaysKey, melbDateKey, melbToUtcMs } from "./time";

export interface OnTimeRouteDeps {
  db: Db;
  guard: (req: Request, res: Response) => boolean;
  getEvents: () => Promise<any[]>;
  listTravelLocations: () => any[];
  getTravelOverride: (uid: string) => any;
  homeAddress: () => string | null;
  resolveTravel: (o: { event: any; locations: any[]; override: any; homeAddress: string | null }) => any;
  getTop3Titles: (dateKey: string) => string[];
  createTask: (t: { title: string; dueAt: number; notes: string }) => number | null;
  startEngine?: boolean;
  getCaptureDigest?: EngineDeps["getCaptureDigest"];
}

export function toPlanEvents(deps: OnTimeRouteDeps, events: any[]): PlanEvent[] {
  const locations = deps.listTravelLocations();
  const home = deps.homeAddress();
  const out: PlanEvent[] = [];
  for (const ev of events) {
    // Stage 28 — Daisy's and unprefixed shared events are information only.
    if (ev?.infoOnly) continue;
    const startMs = Date.parse(ev.start);
    const endMs = Date.parse(ev.end ?? ev.start);
    if (!Number.isFinite(startMs)) continue;
    let allow: number | null = null;
    let locName: string | null = null;
    try {
      const m = deps.resolveTravel({ event: ev, locations, override: deps.getTravelOverride(ev.uid) ?? null, homeAddress: home });
      allow = typeof m?.allowMinutes === "number" && m.allowMinutes > 0 ? m.allowMinutes : null;
      locName = m?.matchedLocation?.name ?? null;
    } catch { /* no travel */ }
    out.push({
      uid: String(ev.uid), summary: String(ev.summary ?? ""), location: ev.location ?? undefined,
      startMs, endMs: Number.isFinite(endMs) ? endMs : startMs, allDay: Boolean(ev.allDay),
      travelAllowMinutes: allow, travelLocationName: locName,
    });
  }
  return out;
}

function secretPresent(name: string): boolean {
  try { return fs.statSync(path.join(secretsDir(), name)).size > 0; } catch { return false; }
}

let engineSingleton: OnTimeEngine | null = null;
export function getOnTimeEngine(): OnTimeEngine | null { return engineSingleton; }

export function registerOnTimeRoutes(app: Express, deps: OnTimeRouteDeps): { store: OnTimeStore; engine: OnTimeEngine } {
  const store = new OnTimeStore(deps.db);
  const getPlanEvents = async () => toPlanEvents(deps, await deps.getEvents());
  const engine = new OnTimeEngine({
    store, getPlanEvents, getTop3Titles: deps.getTop3Titles,
    createDeadlineTask: deps.createTask, send: sendNtfy,
    getCaptureDigest: deps.getCaptureDigest,
  });
  engineSingleton = engine;

  app.get("/api/ontime/config", (req, res) => {
    if (!deps.guard(req, res)) return;
    res.json({
      config: store.getConfig(),
      ntfyTokenPresent: secretPresent("ntfy_token"),
      graphCredsPresent: readGraphCreds() != null,
    });
  });

  app.put("/api/ontime/config", (req, res) => {
    if (!deps.guard(req, res)) return;
    const cfg = store.updateConfig((req.body ?? {}) as Record<string, unknown>);
    void engine.refreshPlan();
    res.json({ config: cfg });
  });

  app.get("/api/ontime/status", (req, res) => {
    if (!deps.guard(req, res)) return;
    const cfg = store.getConfig();
    const now = Date.now();
    const upcoming = store.listAlerts(now - 3_600_000, now + 20 * 3_600_000)
      .filter((a) => a.status === "pending").slice(0, 5)
      .map((a) => ({ id: a.id, kind: a.kind, fireAt: a.fire_at, title: a.title }));
    res.json({
      enabled: cfg.enabled, emailEnabled: cfg.emailEnabled,
      ntfyConfigured: ntfyConfigured(cfg), ntfyTokenPresent: secretPresent("ntfy_token"),
      graphCredsPresent: readGraphCreds() != null,
      engine: engine.status, triageQueued: store.queuedCount(), triageCounts: store.triageCounts(),
      upcoming,
    });
  });

  // Dry run: what WOULD fire today + tomorrow. Never sends anything.
  app.get("/api/ontime/preview", async (req, res) => {
    if (!deps.guard(req, res)) return;
    const days = Math.min(7, Math.max(1, Number(req.query.days ?? 2) || 2));
    const cfg = store.getConfig();
    const today = melbDateKey(Date.now());
    const from = melbToUtcMs(today, "00:00");
    const to = melbToUtcMs(addDaysKey(today, days), "00:00");
    try {
      const evs = await getPlanEvents();
      const cues = planCues(evs, cfg, from, to);
      res.json({ from, to, cues });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/ontime/alerts", (req, res) => {
    if (!deps.guard(req, res)) return;
    const now = Date.now();
    const from = Number(req.query.from ?? now - 24 * 3_600_000);
    const to = Number(req.query.to ?? now + 24 * 3_600_000);
    res.json({
      alerts: store.listAlerts(from, to).map(({ ack_token, ...rest }) => rest),
    });
  });

  // Test message. Works even while the master switch is off.
  app.post("/api/ontime/test", async (req, res) => {
    if (!deps.guard(req, res)) return;
    const cfg = store.getConfig();
    if (!ntfyConfigured(cfg)) return res.status(400).json({ error: "ntfy server/topic not set" });
    const r = await sendNtfy(cfg, {
      title: "Buoy On Time test",
      message: "If this reached your phone and watch, On Time can reach you.",
      priority: 4, tags: ["white_check_mark"], click: `${cfg.publicBaseUrl}/#/on-time`,
      actions: [{ action: "view", label: "Running late", url: runningLateSmsUrl(cfg, 10) }],
    });
    res.status(r.ok ? 200 : 502).json(r);
  });

  // Action buttons from ntfy (phone / watch). Token-authorised.
  const ack = (req: Request, res: Response) => {
    const token = String(req.params.token ?? "");
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return res.status(400).type("text/plain").send("Bad token");
    const r = engine.handleAck(token, String(req.query.a ?? "ok"));
    res.status(r.status).type("text/plain").send(r.text);
  };
  app.post("/api/ontime/ack/:token", ack);
  app.get("/api/ontime/ack/:token", ack);

  app.post("/api/ontime/run-now", async (req, res) => {
    if (!deps.guard(req, res)) return;
    await engine.tick(true);
    res.json({ ok: true, status: engine.status });
  });

  // ---- email triage ----
  app.get("/api/ontime/triage", (req, res) => {
    if (!deps.guard(req, res)) return;
    const includeClosed = req.query.all === "1";
    res.json({ items: store.listTriage({ includeClosed }), counts: store.triageCounts(), queued: store.queuedCount() });
  });

  app.patch("/api/ontime/triage/:id", (req, res) => {
    if (!deps.guard(req, res)) return;
    const id = Number(req.params.id);
    const b = (req.body ?? {}) as { status?: string; category?: string };
    const row = store.updateTriage(id, { status: b.status, category: b.category });
    if (!row) return res.status(404).json({ error: "not found" });
    const { body_for_llm, ...rest } = row;
    res.json(rest);
  });

  // Manual upload (.eml / .msg as base64, or pasted text) — e.g. Safer Care Victoria.
  app.post("/api/ontime/email-upload", async (req, res) => {
    if (!deps.guard(req, res)) return;
    try {
      const b = (req.body ?? {}) as { filename?: string; contentBase64?: string; text?: string };
      const p = await parseUpload(b);
      const r = store.insertTriage({
        source: "upload", externalId: p.externalId, receivedAt: p.receivedAt, sender: p.sender,
        senderName: p.senderName, subject: p.subject, snippet: p.body.slice(0, 400), webLink: null, bodyForLlm: p.body,
      });
      void engine.drainTriage();
      res.json({ id: r.id, duplicate: !r.inserted, subject: p.subject, sender: p.sender });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // Stage 25.1 — bulk upload: one zip of .eml/.msg files, sent as raw bytes.
  // Sorting continues in the background until the queue is empty.
  app.post(
    "/api/ontime/email-upload-zip",
    express.raw({ type: () => true, limit: "300mb" }),
    async (req, res) => {
      if (!deps.guard(req, res)) return;
      try {
        const buf = req.body as Buffer;
        if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: "empty upload" });
        const z = await parseZip(buf);
        let inserted = 0, duplicates = 0;
        for (const p of z.parsed) {
          const r = store.insertTriage({
            source: "upload", externalId: p.externalId, receivedAt: p.receivedAt, sender: p.sender,
            senderName: p.senderName, subject: p.subject, snippet: p.body.slice(0, 400), webLink: null, bodyForLlm: p.body,
          });
          if (r.inserted) inserted++; else duplicates++;
        }
        void engine.drainTriage();
        res.json({
          emails: z.emailEntries, added: inserted, duplicates, skippedOld: z.skippedOld,
          skippedLarge: z.skippedLarge, failed: z.failed, queued: store.queuedCount(),
        });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  app.post("/api/ontime/email-sync-now", async (req, res) => {
    if (!deps.guard(req, res)) return;
    await engine.pollMail();
    void engine.drainTriage();
    res.json({ fetched: engine.status.lastMailFetched, error: engine.status.lastMailError, queued: store.queuedCount() });
  });

  // Re-read the last N days (default: config emailBackfillDays, 30).
  app.post("/api/ontime/email-backfill", async (req, res) => {
    if (!deps.guard(req, res)) return;
    const raw = (req.body ?? {}) as { days?: unknown };
    const days = raw.days === undefined ? undefined : Number(raw.days);
    if (days !== undefined && (!Number.isFinite(days) || days < 1 || days > 60)) {
      return res.status(400).json({ error: "days must be 1-60" });
    }
    await engine.rebackfill(days);
    void engine.drainTriage();
    res.json({ fetched: engine.status.lastMailFetched, error: engine.status.lastMailError, queued: store.queuedCount() });
  });

  if (deps.startEngine !== false) engine.start();
  return { store, engine };
}
