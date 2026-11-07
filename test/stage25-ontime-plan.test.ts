// filepath: test/stage25-ontime-plan.test.ts
// Stage 25 — On Time planner: leave-by maths, privacy labels, ignore list,
// routine suppression, quiet hours, DST.

import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, mergeConfig, type OnTimeConfig } from "../server/ontime/config";
import { planCues, planEventCues, planRoutineCues, runningLateSmsUrl, type PlanEvent } from "../server/ontime/plan";
import { inQuietHours, melbDateKey, melbHHMM, melbToUtcMs, melbWeekday } from "../server/ontime/time";

const cfg = (p: Partial<OnTimeConfig> = {}): OnTimeConfig => ({ ...DEFAULT_CONFIG, ...p });
const ev = (p: Partial<PlanEvent>): PlanEvent => ({
  uid: "u1", summary: "Mrs Smith review", startMs: melbToUtcMs("2026-11-10", "09:00"),
  endMs: melbToUtcMs("2026-11-10", "16:00"), allDay: false, travelAllowMinutes: 30, travelLocationName: "Elgin Braybrook",
  ...p,
});

describe("time helpers", () => {
  it("handles AEDT and AEST", () => {
    expect(melbToUtcMs("2026-11-10", "09:00")).toBe(Date.parse("2026-11-09T22:00:00Z"));
    expect(melbToUtcMs("2027-06-10", "09:00")).toBe(Date.parse("2027-06-09T23:00:00Z"));
    expect(melbHHMM(melbToUtcMs("2027-04-04", "12:00"))).toBe("12:00"); // DST end day
    expect(melbHHMM(melbToUtcMs("2026-10-04", "12:00"))).toBe("12:00"); // DST start day
    expect(melbDateKey(Date.parse("2026-11-09T14:00:00Z"))).toBe("2026-11-10");
    expect(melbWeekday(melbToUtcMs("2026-11-10", "12:00"))).toBe(2); // Tuesday
  });
  it("quiet hours wrap midnight", () => {
    expect(inQuietHours(melbToUtcMs("2026-11-10", "23:00"), "22:00", "06:00")).toBe(true);
    expect(inQuietHours(melbToUtcMs("2026-11-10", "05:59"), "22:00", "06:00")).toBe(true);
    expect(inQuietHours(melbToUtcMs("2026-11-10", "06:00"), "22:00", "06:00")).toBe(false);
    expect(inQuietHours(melbToUtcMs("2026-11-10", "12:00"), "22:00", "06:00")).toBe(false);
  });
});

describe("event cues", () => {
  it("Elgin Tuesday 09:00, 30 min allow + 15 buffer => leave 08:15", () => {
    const cues = planEventCues(ev({}), cfg());
    const by = Object.fromEntries(cues.map((c) => [c.kind, c]));
    expect(melbHHMM(by.leave_now.fireAt)).toBe("08:15");
    expect(melbHHMM(by.wrap_up.fireAt)).toBe("08:05");
    expect(melbHHMM(by.get_ready.fireAt)).toBe("07:45");
    expect(by.leave_now.priority).toBe(5);
    expect(by.leave_now.leaveAtMs).toBe(by.leave_now.fireAt);
  });
  it("privacy labels never show the event title", () => {
    for (const c of planEventCues(ev({}), cfg())) {
      expect(c.title + c.body).not.toContain("Smith");
      expect(c.title + c.body).toContain("Elgin Braybrook");
    }
    const noLoc = planEventCues(ev({ travelAllowMinutes: null, travelLocationName: null }), cfg());
    expect(noLoc).toHaveLength(1);
    expect(noLoc[0].kind).toBe("starts_soon");
    expect(noLoc[0].title).toBe("Appointment at 09:00");
    const open = planEventCues(ev({ summary: "[Personal] Dentist" }), cfg({ privacyLabels: false }));
    expect(open[0].title).toContain("Dentist");
    expect(open[0].title).not.toContain("[Personal]");
  });
  it("skips ignored, all-day and zero-length events", () => {
    expect(planEventCues(ev({ summary: "Available - hold" }), cfg())).toEqual([]);
    expect(planEventCues(ev({ allDay: true }), cfg())).toEqual([]);
    expect(planEventCues(ev({ endMs: ev({}).startMs }), cfg())).toEqual([]);
  });
  it("keys are stable for the same event", () => {
    const a = planEventCues(ev({}), cfg()).map((c) => c.key);
    const b = planEventCues(ev({}), cfg()).map((c) => c.key);
    expect(a).toEqual(b);
  });
});

describe("routine cues", () => {
  it("suppresses a routine nudge while an event is on", () => {
    // Tue 10 Nov: Elgin 09:00-16:00; swim-tue 16:45 still fires, physio 06:00 fires
    const tue = planRoutineCues("2026-11-10", [ev({})], cfg()).map((c) => c.key);
    expect(tue).toContain("rt:physio-am:2026-11-10");
    expect(tue).toContain("rt:swim-tue:2026-11-10");
    // Wed 11 Nov with an all-day-ish 07:00-17:00 event: deep-work 08:00 + cello 16:00 suppressed
    const wedEv = ev({ startMs: melbToUtcMs("2026-11-11", "07:00"), endMs: melbToUtcMs("2026-11-11", "17:00") });
    const wed = planRoutineCues("2026-11-11", [wedEv], cfg()).map((c) => c.key);
    expect(wed).not.toContain("rt:deep-work:2026-11-11");
    expect(wed).not.toContain("rt:cello:2026-11-11");
  });
  it("never plans routine inside quiet hours", () => {
    const c = cfg({ routine: [{ id: "late", days: [1, 2, 3, 4, 5, 6, 7], time: "22:30", title: "x", enabled: true }] });
    expect(planRoutineCues("2026-11-10", [], c)).toEqual([]);
  });
  it("disabled routine items are skipped", () => {
    const c = cfg({ routine: DEFAULT_CONFIG.routine.map((r) => ({ ...r, enabled: false })) });
    expect(planRoutineCues("2026-11-10", [], c)).toEqual([]);
  });
});

describe("planCues window", () => {
  it("includes the 06:30 digest and filters to the window", () => {
    const from = melbToUtcMs("2026-11-10", "00:00");
    const to = melbToUtcMs("2026-11-11", "00:00");
    const cues = planCues([ev({})], cfg(), from, to);
    expect(cues.some((c) => c.key === "digest:2026-11-10" && melbHHMM(c.fireAt) === "06:30")).toBe(true);
    expect(cues.every((c) => c.fireAt >= from && c.fireAt < to)).toBe(true);
    const sorted = [...cues].sort((a, b) => a.fireAt - b.fireAt);
    expect(cues).toEqual(sorted);
  });
});

describe("config + running late", () => {
  it("mergeConfig clamps and validates", () => {
    const c = mergeConfig(DEFAULT_CONFIG, { bufferMinutes: 999, quietStart: "25:00", ntfyTopic: "a b/c!", maxSnoozes: -1 });
    expect(c.bufferMinutes).toBe(120);
    expect(c.quietStart).toBe(DEFAULT_CONFIG.quietStart);
    expect(c.ntfyTopic).toBe("abc");
    expect(c.maxSnoozes).toBe(0);
    expect(DEFAULT_CONFIG.enabled).toBe(false);
  });
  it("builds an SMS link the user sends themselves", () => {
    const u = runningLateSmsUrl(cfg(), 15);
    expect(u.startsWith("sms:&body=")).toBe(true);
    expect(decodeURIComponent(u.slice(10))).toContain("15 minutes");
  });
});
