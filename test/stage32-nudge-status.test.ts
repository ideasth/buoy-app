// filepath: test/stage32-nudge-status.test.ts
// Stage 32 — Friday stale-items nudge + public status feed for Power Automate.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { OnTimeStore } from "../server/ontime/store";
import { OnTimeEngine } from "../server/ontime/engine";
import { planCues, planStaleCue } from "../server/ontime/plan";
import { DEFAULT_CONFIG, mergeConfig } from "../server/ontime/config";
import { melbToUtcMs } from "../server/ontime/time";
import { renderStatusRss, statusProblems, type StatusInput } from "../server/ontime/statusfeed";

const FRI = "2026-11-13";
const fire = melbToUtcMs(FRI, "12:00");

function setup(captureDigest?: (o: any) => { needsLook: number; projectUpdates: number }) {
  const db = new Database(":memory:");
  const store = new OnTimeStore(db as any, () => fire);
  const sent: any[] = [];
  const engine = new OnTimeEngine({
    store, getPlanEvents: async () => [], getTop3Titles: () => [],
    createDeadlineTask: () => null, send: async (m: any) => { sent.push(m); return { ok: true }; },
    getCaptureDigest: captureDigest,
  } as any);
  const email = (id: string, receivedAt: number, status = "new", category = "act_today") => {
    store.insertTriage({ source: "upload", externalId: id, receivedAt, sender: "a@b.c", senderName: "", subject: "s", snippet: "", webLink: null, bodyForLlm: "" });
    db.prepare(`UPDATE email_triage SET status = ?, category = ? WHERE external_id = ?`).run(status, category, id);
  };
  return { store, engine, email, sent };
}

describe("config", () => {
  it("defaults to Friday 12:00, 5 days, on", () => {
    expect(DEFAULT_CONFIG.staleNudgeEnabled).toBe(true);
    expect(DEFAULT_CONFIG.staleNudgeDay).toBe(5);
    expect(DEFAULT_CONFIG.staleNudgeTime).toBe("12:00");
    expect(DEFAULT_CONFIG.staleNudgeDays).toBe(5);
  });
  it("clamps days 2–14 and rejects bad times", () => {
    const c = mergeConfig(DEFAULT_CONFIG, { staleNudgeDays: 99, staleNudgeTime: "25:00", staleNudgeDay: 0 });
    expect(c.staleNudgeDays).toBe(14);
    expect(c.staleNudgeTime).toBe("12:00");
    expect(c.staleNudgeDay).toBe(1);
  });
});

describe("planStaleCue", () => {
  it("fires only on the configured weekday", () => {
    const c = planStaleCue(FRI, DEFAULT_CONFIG)!;
    expect(c).toMatchObject({ key: `stale:${FRI}`, kind: "stale", fireAt: fire });
    expect(planStaleCue("2026-11-12", DEFAULT_CONFIG)).toBeNull();
    expect(planStaleCue(FRI, { ...DEFAULT_CONFIG, staleNudgeEnabled: false })).toBeNull();
  });
  it("is included by planCues over a Friday window", () => {
    const cues = planCues([], DEFAULT_CONFIG, fire - 3600_000, fire + 3600_000);
    expect(cues.some((c) => c.kind === "stale")).toBe(true);
  });
});

describe("composeStale", () => {
  it("counts only open Act today / Reply this week older than the cutoff", () => {
    const s = setup();
    s.email("a1", fire - 6 * 86400_000);
    s.email("a2", fire - 9 * 86400_000);
    s.email("fresh", fire - 2 * 86400_000);
    s.email("done", fire - 9 * 86400_000, "done");
    s.email("r1", fire - 7 * 86400_000, "new", "reply_week");
    s.email("fyi", fire - 9 * 86400_000, "new", "fyi");
    const body = s.engine.composeStale(s.store.getConfig(), fire)!;
    expect(body).toContain("2 Act today and 1 Reply this week items are over 5 days old.");
  });
  it("adds old captures and returns null when nothing is old", () => {
    let seen: any;
    const s = setup((o) => { seen = o; return { needsLook: 1, projectUpdates: 0 }; });
    expect(s.engine.composeStale(s.store.getConfig(), fire)).toContain("1 capture has waited over 5 days");
    expect(seen.checkOlderThanMs).toBe(fire - 5 * 86400_000);
    const empty = setup(() => ({ needsLook: 0, projectUpdates: 0 }));
    expect(empty.engine.composeStale(empty.store.getConfig(), fire)).toBeNull();
  });
});

describe("status feed", () => {
  const base: StatusInput = {
    now: 10_000_000_000, dbOk: true, engineRunning: true, lastPlanAt: 10_000_000_000 - 60_000,
    emailEnabled: true, emailPollMinutes: 10, lastMailPollAt: 10_000_000_000 - 60_000, lastMailError: null,
    bootAt: 0,
  };
  it("OK when healthy", () => {
    expect(statusProblems(base)).toEqual([]);
    expect(renderStatusRss(base, "https://buoy.thinhalo.com")).toContain("<title>OK</title>");
  });
  it("flags db, stopped scheduler, stale plan and mail problems", () => {
    expect(statusProblems({ ...base, dbOk: false })).toContain("database");
    expect(statusProblems({ ...base, engineRunning: false })).toContain("scheduler stopped");
    expect(statusProblems({ ...base, lastPlanAt: base.now - 20 * 60_000 })).toContain("calendar planning stale");
    expect(statusProblems({ ...base, lastMailPollAt: base.now - 40 * 60_000 })).toContain("mail check stale");
    expect(statusProblems({ ...base, lastMailError: "401 secret detail" })).toEqual(["mail check failing"]);
    expect(renderStatusRss({ ...base, lastMailError: "401 secret detail" }, "x")).not.toContain("secret detail");
  });
  it("gives a grace period after boot, and ignores mail when email is off", () => {
    expect(statusProblems({ ...base, engineRunning: false, bootAt: base.now - 30_000 })).toEqual([]);
    expect(statusProblems({ ...base, emailEnabled: false, lastMailPollAt: null })).toEqual([]);
  });
  it("is allowlisted by exact path and registered", () => {
    const a = readFileSync(path.join(__dirname, "..", "server/auth.ts"), "utf8");
    expect(a).toContain('"/api/status.rss"');
    const r = readFileSync(path.join(__dirname, "..", "server/ontime/routes.ts"), "utf8");
    expect(r).toContain('app.get("/api/status.rss"');
  });
});
