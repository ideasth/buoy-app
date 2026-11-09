// filepath: test/stage26d-digest.test.ts
// Stage 26d — morning digest: stale captures, project updates, 7-day email count.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { OnTimeStore } from "../server/ontime/store";
import { OnTimeEngine, CHECK_STALE_MS } from "../server/ontime/engine";
import { melbToUtcMs } from "../server/ontime/time";

function setup(captureDigest?: (o: { checkOlderThanMs: number; updatesSinceMs: number }) => { needsLook: number; projectUpdates: number }) {
  const db = new Database(":memory:");
  const store = new OnTimeStore(db as any, () => melbToUtcMs("2026-11-10", "06:30"));
  store.updateConfig({ emailEnabled: true });
  const engine = new OnTimeEngine({
    store, getPlanEvents: async () => [], getTop3Titles: () => [],
    createDeadlineTask: () => null, send: async () => ({ ok: true }),
    getCaptureDigest: captureDigest,
  } as any);
  const email = (id: string, receivedAt: number, status = "new", category = "act_today") => {
    store.insertTriage({ source: "upload", externalId: id, receivedAt, sender: "a@b.c", senderName: "", subject: "s", snippet: "", webLink: null, bodyForLlm: "" });
    db.prepare(`UPDATE email_triage SET status = ?, category = ? WHERE external_id = ?`).run(status, category, id);
  };
  return { store, engine, email };
}
const fire = melbToUtcMs("2026-11-10", "06:30");

describe("composeDigest — Stage 26d", () => {
  it("adds capture and project-update lines with windows anchored to the digest time", () => {
    let seen: any = null;
    const s = setup((o) => { seen = o; return { needsLook: 3, projectUpdates: 1 }; });
    const d = s.engine.composeDigest(s.store.getConfig(), "2026-11-10");
    expect(d).toContain("3 captures need a look.");
    expect(d).toContain("1 project update since yesterday.");
    expect(seen).toEqual({ checkOlderThanMs: fire - CHECK_STALE_MS, updatesSinceMs: fire - 86400_000 });
  });
  it("singular capture wording, and zero counts are left out", () => {
    const s1 = setup(() => ({ needsLook: 1, projectUpdates: 0 }));
    const d1 = s1.engine.composeDigest(s1.store.getConfig(), "2026-11-10");
    expect(d1).toContain("1 capture needs a look.");
    expect(d1).not.toContain("project update");
    const s0 = setup(() => ({ needsLook: 0, projectUpdates: 0 }));
    expect(s0.engine.composeDigest(s0.store.getConfig(), "2026-11-10")).not.toMatch(/capture|project update/);
  });
  it("a failing capture lookup does not break the digest", () => {
    const s = setup(() => { throw new Error("db locked"); });
    expect(s.engine.composeDigest(s.store.getConfig(), "2026-11-10")).toContain("No travel today.");
  });
  it("act-today email count covers the last 7 days and skips dismissed/done", () => {
    const s = setup();
    s.email("recent1", fire - 2 * 86400_000);
    s.email("recent2", fire - 6 * 86400_000);
    s.email("old", fire - 8 * 86400_000);
    s.email("dismissed", fire - 3600_000, "dismissed");
    s.email("done", fire - 3600_000, "done");
    s.email("reply", fire - 3600_000, "new", "reply_week");
    expect(s.engine.composeDigest(s.store.getConfig(), "2026-11-10")).toContain("2 emails to act on (last 7 days).");
  });
  it("triageCounts without a window still counts everything open (On Time page unchanged)", () => {
    const s = setup();
    s.email("old", fire - 30 * 86400_000);
    expect(s.store.triageCounts().act_today).toBe(1);
  });
});

describe("wiring", () => {
  it("routes.ts supplies getCaptureDigest from tasks + project_events", () => {
    const r = readFileSync(path.join(__dirname, "..", "server/routes.ts"), "utf8");
    expect(r).toMatch(/getCaptureDigest:[\s\S]{0,300}tag = 'check'[\s\S]{0,300}projectEvents\.countSince/);
    const o = readFileSync(path.join(__dirname, "..", "server/ontime/routes.ts"), "utf8");
    expect(o).toContain("getCaptureDigest: deps.getCaptureDigest");
  });
});
