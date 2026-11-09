// filepath: test/stage26c-share-capture.test.ts
// Stage 26c — Share to Buoy: hashed per-device tokens, 401/413/429,
// token opens only POST /api/capture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CaptureTokenStore, readBearer, shareCaptureHandler, RATE_LIMIT_PER_MIN, TOKEN_PREFIX } from "../server/capture-tokens";
import { isAllowlistedPath, requireAuth } from "../server/auth";
import type { CaptureDeps } from "../server/capture";

const mkStore = (now = () => 1_800_000_000_000) => {
  const db = new Database(":memory:");
  return { db, store: new CaptureTokenStore(db as any, now) };
};

describe("CaptureTokenStore", () => {
  it("stores only a hash and verifies the raw token", () => {
    const { db, store } = mkStore();
    const { row, token } = store.create("  Oliver's iPhone ");
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(row).toMatchObject({ label: "Oliver's iPhone", hint: token.slice(-4), useCount: 0, revokedAt: null });
    const raw = db.prepare("SELECT * FROM capture_tokens").all() as any[];
    expect(JSON.stringify(raw)).not.toContain(token);
    expect(store.verify(token)).toBe(row.id);
    expect(store.verify(token + "x")).toBeNull();
    expect(store.verify(null)).toBeNull();
    expect(store.verify("nope")).toBeNull();
  });
  it("revoked tokens stop working", () => {
    const { store } = mkStore();
    const { row, token } = store.create("Mac");
    expect(store.revoke(row.id)).toBe(true);
    expect(store.revoke(row.id)).toBe(false);
    expect(store.verify(token)).toBeNull();
  });
  it("rate limits at 30 a minute per device, then recovers", () => {
    let t = 1_800_000_000_000;
    const { store } = mkStore(() => t);
    const a = store.create("A").row.id;
    const b = store.create("B").row.id;
    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) expect(store.allow(a)).toBe(true);
    expect(store.allow(a)).toBe(false);
    expect(store.allow(b)).toBe(true);
    t += 60_001;
    expect(store.allow(a)).toBe(true);
  });
  it("readBearer", () => {
    expect(readBearer("Bearer bcap_abc")).toBe("bcap_abc");
    expect(readBearer("bearer  bcap_abc ")).toBe("bcap_abc");
    expect(readBearer("Basic xyz")).toBeNull();
    expect(readBearer(undefined)).toBeNull();
  });
});

describe("auth allowlist", () => {
  it("only the exact /api/capture path skips the session gate", () => {
    expect(isAllowlistedPath("/api/capture")).toBe(true);
    expect(isAllowlistedPath("/api/capture/item")).toBe(false);
    expect(isAllowlistedPath("/api/capture-tokens")).toBe(false);
    expect(isAllowlistedPath("/api/tasks")).toBe(false);
  });
});

describe("POST /api/capture over HTTP", () => {
  let server: Server;
  let base = "";
  let token = "";
  const created: any[] = [];
  beforeAll(async () => {
    const { store } = mkStore(() => Date.now());
    token = store.create("Test phone").token;
    const deps: CaptureDeps = {
      getProject: () => ({ id: 1, name: "P" }),
      createTask: (t) => { const r = { id: created.length + 1, ...t }; created.push(r); return r; },
      createProjectTask: () => { throw new Error("share must not file to projects"); },
      recordEvent: () => {},
    };
    const app = express();
    app.use((req, res, next) => (req.path === "/api/capture" ? express.json({ limit: "20kb" }) : express.json())(req, res, next));
    app.use(requireAuth);
    app.post("/api/capture", shareCaptureHandler(store, deps));
    app.get("/api/tasks", (_req, res) => res.json([]));
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ error: "x" }));
    server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server?.close());

  const post = (body: unknown, auth?: string) =>
    fetch(`${base}/api/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("401 without or with a bad token", async () => {
    expect((await post({ text: "x" })).status).toBe(401);
    expect((await post({ text: "x" }, "Bearer bcap_wrong")).status).toBe(401);
  });
  it("saves a check task with a valid token, ignoring projectId", async () => {
    const r = await post({ text: "https://example.com/article", projectId: 1 }, `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, id: 1 });
    expect(created[0]).toMatchObject({ tag: "check", title: "https://example.com/article" });
  });
  it("413 over 20 KB", async () => {
    expect((await post({ text: "a".repeat(25 * 1024) }, `Bearer ${token}`)).status).toBe(413);
  });
  it("the capture token does not open other routes", async () => {
    const r = await fetch(`${base}/api/tasks`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(401);
  });
  it("429 after 30 a minute", async () => {
    let last = 200;
    for (let i = 0; i < RATE_LIMIT_PER_MIN + 1; i++) last = (await post({ text: `n${i}` }, `Bearer ${token}`)).status;
    expect(last).toBe(429);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf8");
  it("routes, body limit, log redaction and Admin tab", () => {
    const r = read("server/routes.ts");
    expect(r).toContain('app.post("/api/capture", shareCaptureHandler(captureTokens, captureDeps))');
    expect(r).toMatch(/app\.post\("\/api\/capture-tokens"[\s\S]{0,80}requireUserOrOrchestrator/);
    expect(r).toMatch(/app\.delete\("\/api\/capture-tokens\/:id"[\s\S]{0,80}requireUserOrOrchestrator/);
    const i = read("server/index.ts");
    expect(i).toContain('express.json({ limit: "20kb" })');
    // Stage 33 moved the redaction list into server/log-paths.ts.
    expect(i).toContain("!isQuietLogPath(path)");
    expect(read("server/log-paths.ts")).toContain('path.startsWith("/api/capture")');
    expect(read("client/src/pages/Admin.tsx")).toContain("<ShareDevicesCard />");
  });
});
