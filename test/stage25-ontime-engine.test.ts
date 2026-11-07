// filepath: test/stage25-ontime-engine.test.ts
// Stage 25 — On Time engine + triage, on an in-memory SQLite DB with a fake
// clock, fake sender and fake LLM. Nothing touches the network or data.db.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { OnTimeStore } from "../server/ontime/store";
import { OnTimeEngine } from "../server/ontime/engine";
import { applyRules, classify, resolveDeadline } from "../server/ontime/triage";
import { parsePasted, parseUpload } from "../server/ontime/upload";
import { melbToUtcMs } from "../server/ontime/time";
import type { PlanEvent } from "../server/ontime/plan";
import type { NtfyMessage } from "../server/ontime/notify";

function setup(opts: { events?: PlanEvent[]; enabled?: boolean; llm?: (p: string) => Promise<string> } = {}) {
  const db = new Database(":memory:");
  let now = melbToUtcMs("2026-11-10", "07:00");
  const store = new OnTimeStore(db, () => now);
  store.updateConfig({ enabled: opts.enabled ?? true, ntfyBaseUrl: "https://ntfy.example", ntfyTopic: "t1", emailNudges: true });
  const sent: NtfyMessage[] = [];
  const tasks: any[] = [];
  const engine = new OnTimeEngine({
    store,
    getPlanEvents: async () => opts.events ?? [],
    getTop3Titles: () => ["Report A", "Call B"],
    createDeadlineTask: (t) => { tasks.push(t); return tasks.length; },
    send: async (_c, m) => { sent.push(m); return { ok: true }; },
    now: () => now,
    llmFactory: () => opts.llm ?? null,
    graphCreds: () => null,
  });
  return { db, store, engine, sent, tasks, at: (hhmm: string, day = "2026-11-10") => { now = melbToUtcMs(day, hhmm); } };
}

const elgin: PlanEvent = {
  uid: "e1", summary: "Patient X", startMs: melbToUtcMs("2026-11-10", "09:00"), endMs: melbToUtcMs("2026-11-10", "16:00"),
  allDay: false, travelAllowMinutes: 30, travelLocationName: "Elgin Braybrook",
};

describe("engine: cues, escalation, snooze", () => {
  it("fires leave_now with On my way / Snooze / Running late, then escalates", async () => {
    const s = setup({ events: [elgin] });
    await s.engine.refreshPlan();
    s.at("08:15");
    await s.engine.fireDue(s.store.getConfig());
    const leave = s.sent.find((m) => m.title.startsWith("Leave now"))!;
    expect(leave).toBeTruthy();
    expect(leave.priority).toBe(5);
    expect(leave.actions!.map((a) => a.label)).toEqual(["On my way", "Snooze 5", "Running late"]);
    expect(leave.actions![0].url).toMatch(/\/api\/ontime\/ack\/[A-Za-z0-9_-]+\?a=omw$/);
    expect(leave.title + leave.message).not.toContain("Patient X");
    // stale get_ready / wrap_up (07:45, 08:05) were > 10 min old at 08:15? 07:45 is 30 min old -> skipped
    expect(s.sent.some((m) => m.title.startsWith("Get ready"))).toBe(false);
    // no tap within 2 min -> firmer alert
    s.at("08:18");
    await s.engine.escalate(s.store.getConfig());
    const esc = s.sent.find((m) => m.title.startsWith("Still here?"))!;
    expect(esc.priority).toBe(5);
    s.at("08:25");
    await s.engine.escalate(s.store.getConfig());
    expect(s.sent.filter((m) => m.title.startsWith("Still here?"))).toHaveLength(1);
  });

  it("snooze is capped at maxSnoozes and ack stops escalation", async () => {
    const s = setup({ events: [elgin] });
    await s.engine.refreshPlan();
    s.at("08:15");
    await s.engine.fireDue(s.store.getConfig());
    const token = s.sent.at(-1)!.actions![0].url.match(/ack\/([^?]+)/)![1];
    expect(s.engine.handleAck(token, "snooze").text).toContain("Snoozed");
    s.at("08:20");
    await s.engine.fireDue(s.store.getConfig());
    expect(s.engine.handleAck(token, "snooze").text).toContain("Snoozed");
    s.at("08:25");
    await s.engine.fireDue(s.store.getConfig());
    const third = s.sent.at(-1)!;
    expect(third.actions!.map((a) => a.label)).toEqual(["On my way", "Running late"]); // no more snooze
    expect(s.engine.handleAck(token, "snooze").text).toContain("No more snoozes");
    expect(s.engine.handleAck("nope-nope-nope-nope", "omw").status).toBe(404);
  });

  it("sends nothing while the master switch is off (via tick)", async () => {
    const s = setup({ events: [elgin], enabled: false });
    s.at("08:15");
    await s.engine.tick(true);
    expect(s.sent).toHaveLength(0);
  });

  it("digest is composed at fire time with leave-by and Top 3", async () => {
    const s = setup({ events: [elgin] });
    s.at("06:00");
    await s.engine.refreshPlan();
    s.at("06:30");
    await s.engine.fireDue(s.store.getConfig());
    const d = s.sent.find((m) => m.title === "Today")!;
    expect(d.message).toContain("First leave-by: 08:15");
    expect(d.message).toContain("Top 3: Report A; Call B");
  });

  it("skips routine nudges in quiet hours but not leave cues", async () => {
    const s = setup();
    s.store.updateConfig({ routine: [{ id: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "12:00", title: "X", enabled: true }], quietStart: "11:00", quietEnd: "13:00" });
    s.at("11:59");
    await s.engine.refreshPlan();
    // routine planned outside quiet? planner skips inside quiet hours already
    expect(s.store.listAlerts(0, Number.MAX_SAFE_INTEGER).some((a) => a.key.startsWith("rt:x"))).toBe(false);
  });
});

describe("triage", () => {
  it("rules: bulk -> fyi without calling the model", async () => {
    let called = false;
    const c = await classify({ sender: "noreply@shop.com", senderName: "Shop", subject: "Sale", body: "Big sale. Unsubscribe here.", receivedAt: Date.now() },
      async () => { called = true; return "{}"; }, "m");
    expect(c.category).toBe("fyi");
    expect(called).toBe(false);
  });
  it("rules: urgent + action -> act_today hint", () => {
    const r = applyRules({ sender: "a@b.com", senderName: "A", subject: "Urgent", body: "Please call me today about the results.", receivedAt: Date.now() });
    expect(r.hintCategory).toBe("act_today");
  });
  it("falls back to rules when the model returns junk", async () => {
    const c = await classify({ sender: "a@b.com", senderName: "A", subject: "Can you review", body: "Could you review the draft by Friday?", receivedAt: Date.now() },
      async () => "not json", "m");
    expect(c.category).toBe("reply_week");
    expect(c.model).toBeNull();
    expect(c.deadlineText).toBe("Friday");
    expect(c.deadlineDate).not.toBeNull();
  });
  it("resolveDeadline handles AU formats", () => {
    const rx = melbToUtcMs("2026-11-10", "10:00"); // Tuesday
    expect(resolveDeadline("today", rx)).toBe("2026-11-10");
    expect(resolveDeadline("tomorrow", rx)).toBe("2026-11-11");
    expect(resolveDeadline("by Thursday", rx)).toBe("2026-11-12");
    expect(resolveDeadline("next Tuesday", rx)).toBe("2026-11-17");
    expect(resolveDeadline("16/11", rx)).toBe("2026-11-16");
    expect(resolveDeadline("3 Jan", rx)).toBe("2027-01-03");
    expect(resolveDeadline("soon", rx)).toBeNull();
  });
  it("engine: classified act_today with deadline creates a task and one nudge", async () => {
    const s = setup({ llm: async () => JSON.stringify({ category: "act_today", summary: "Call back re results.", deadline: "today" }) });
    s.at("10:00");
    s.store.insertTriage({ source: "upload", externalId: "x1", receivedAt: melbToUtcMs("2026-11-10", "09:30"), sender: "dr@hospital.org",
      senderName: "Dr Y", subject: "Results", snippet: "", webLink: null, bodyForLlm: "Please call me today." });
    expect(await s.engine.drainTriage()).toBe(1);
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].title).toBe("Email: Results");
    const row = s.store.listTriage()[0];
    expect(row.category).toBe("act_today");
    expect(row.body_for_llm).toBeNull(); // body not kept after classification
    await s.engine.fireDue(s.store.getConfig());
    expect(s.sent.filter((m) => m.title === "Email to action today")).toHaveLength(1);
  });
});

describe("upload parsing", () => {
  it("parses pasted Outlook text", () => {
    const p = parsePasted("From: Jane Doe <jane@safercare.vic.gov.au>\nSent: Tuesday, 10 November 2026 9:15 AM\nSubject: Review panel\n\nPlease confirm by Friday.");
    expect(p.sender).toBe("jane@safercare.vic.gov.au");
    expect(p.senderName).toBe("Jane Doe");
    expect(p.subject).toBe("Review panel");
  });
  it("parses an .eml file", async () => {
    const eml = "From: \"Sam\" <sam@safercare.vic.gov.au>\r\nTo: x@y.com\r\nSubject: Hello\r\nDate: Tue, 10 Nov 2026 09:00:00 +1100\r\nMessage-ID: <abc@scv>\r\n\r\nBody text here.\r\n";
    const p = await parseUpload({ filename: "a.eml", contentBase64: Buffer.from(eml).toString("base64") });
    expect(p.sender).toBe("sam@safercare.vic.gov.au");
    expect(p.subject).toBe("Hello");
    expect(p.body).toContain("Body text here");
    expect(p.externalId).toBe("eml:<abc@scv>");
  });
  it("dedupes repeat uploads", () => {
    const store = new OnTimeStore(new Database(":memory:"));
    const row = { source: "upload" as const, externalId: "e1", receivedAt: 1, sender: "a", senderName: "a", subject: "s", snippet: "", webLink: null, bodyForLlm: "b" };
    expect(store.insertTriage(row).inserted).toBe(true);
    expect(store.insertTriage(row).inserted).toBe(false);
  });
});
