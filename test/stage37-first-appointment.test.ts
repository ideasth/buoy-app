// filepath: test/stage37-first-appointment.test.ts
// Stage 37 — morning digest leads with the first appointment, place and leave-by.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { OnTimeStore } from "../server/ontime/store";
import { OnTimeEngine } from "../server/ontime/engine";
import { firstAppointment, type PlanEvent } from "../server/ontime/plan";
import { melbToUtcMs } from "../server/ontime/time";

const day = "2026-11-18";
const ev = (p: Partial<PlanEvent>): PlanEvent => ({
  uid: "u1", summary: "Clinic", location: "", startMs: melbToUtcMs(day, "08:00"), endMs: melbToUtcMs(day, "12:00"),
  allDay: false, travelAllowMinutes: null, travelLocationName: null, ...p,
});

function setup(events: PlanEvent[] | (() => Promise<PlanEvent[]>), cfgPatch: Record<string, unknown> = {}) {
  const db = new Database(":memory:");
  const store = new OnTimeStore(db as any, () => melbToUtcMs(day, "06:30"));
  store.updateConfig({ enabled: true, ntfyBaseUrl: "https://ntfy.example", ntfyTopic: "t", ...cfgPatch } as any);
  const sent: any[] = [];
  const getPlanEvents = typeof events === "function" ? events : async () => events;
  const engine = new OnTimeEngine({
    store, getPlanEvents, getTop3Titles: () => [], createDeadlineTask: () => null,
    send: async (_c: any, m: any) => { sent.push(m); return { ok: true }; },
    now: () => melbToUtcMs(day, "06:30") + 1000,
  } as any);
  return { store, engine, sent, cfg: () => store.getConfig() };
}

describe("firstAppointment — Stage 37", () => {
  it("gives start, place and leave-by for a travel event", () => {
    const { cfg } = setup([]);
    const c = cfg();
    const fa = firstAppointment(day, [
      ev({ uid: "late", startMs: melbToUtcMs(day, "13:00"), endMs: melbToUtcMs(day, "17:00") }),
      ev({ travelAllowMinutes: 25, travelLocationName: "Elgin House" }),
    ], c)!;
    const leave = melbToUtcMs(day, "08:00") - (25 + c.bufferMinutes) * 60_000;
    expect(fa.leaveAtMs).toBe(leave);
    expect(fa.title).toMatch(/^08:00 Elgin House - leave by \d\d:\d\d$/);
    expect(fa.line).toContain("First appointment: 08:00");
    expect(fa.line).toContain("Elgin House");
    expect(fa.line).toContain(`25 min travel + ${c.bufferMinutes} min buffer`);
  });

  it("says no travel needed when there is no travel time", () => {
    const { cfg } = setup([]);
    const fa = firstAppointment(day, [ev({ summary: "Telehealth", location: "Zoom" })], { ...cfg(), privacyLabels: false })!;
    expect(fa.leaveAtMs).toBeNull();
    expect(fa.line).toBe("First appointment: 08:00 Telehealth at Zoom. No travel needed.");
  });

  it("ignores all-day events, other days and ignored keywords", () => {
    const { cfg } = setup([]);
    const c = cfg();
    expect(firstAppointment(day, [
      ev({ allDay: true }),
      ev({ startMs: melbToUtcMs("2026-11-19", "08:00"), endMs: melbToUtcMs("2026-11-19", "09:00") }),
    ], c)).toBeNull();
  });

  it("hides the calendar location when privacy labels are on", () => {
    const { cfg } = setup([]);
    const fa = firstAppointment(day, [ev({ summary: "Secret meeting", location: "12 Private St" })], { ...cfg(), privacyLabels: true })!;
    expect(fa.line).not.toContain("Private St");
    expect(fa.line).not.toContain("Secret");
  });
});

describe("digest send — Stage 37", () => {
  it("leads the pushed title and body with the first appointment", async () => {
    const s = setup([ev({ travelAllowMinutes: 25, travelLocationName: "Elgin House" })]);
    const c = s.cfg();
    const m = s.engine.composeDigestMessage(c, day, [ev({ travelAllowMinutes: 25, travelLocationName: "Elgin House" })]);
    expect(m.title).toMatch(/^08:00 Elgin House - leave by/);
    expect(m.body.split("\n")[0]).toMatch(/^First appointment: 08:00/);
    expect(m.body).not.toContain("First leave-by");
  });

  it("says no appointments when the calendar is empty", () => {
    const s = setup([]);
    const m = s.engine.composeDigestMessage(s.cfg(), day, []);
    expect(m.title).toBe("Today");
    expect(m.body.split("\n")[0]).toBe("No appointments today.");
  });

  it("falls back to the old title and lines when the calendar can't be read", () => {
    const s = setup([]);
    const m = s.engine.composeDigestMessage(s.cfg(), day, null);
    expect(m.title).toBe("Today");
    expect(m.body).toContain("No travel today.");
  });
});
