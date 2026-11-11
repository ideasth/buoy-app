// filepath: test/stage34c-ontime-schedule.test.ts
import { describe, it, expect } from "vitest";
import { elginSchedule } from "../server/ontime/routes";

const iso = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 11, h - 11, m)).toISOString();
describe("Stage 34c elginSchedule", () => {
  const evs = [
    { uid: "elgin-session-2026-11-11-list-svh@buoy", summary: "Operating list · 2 cases · SVH", start: iso(13), end: iso(20), location: "SVH" },
    { uid: "x1", summary: "[Elgin House] EH: Pt A (SURG)", start: iso(13), end: iso(14, 50), location: "SVH", infoOnly: true },
    { uid: "r1", summary: "Elgin House Braybrook (AM)", start: iso(8), end: iso(13) },
    { uid: "o1", summary: "[Personal] Focus time", start: iso(6), end: iso(8) },
    { uid: "a1", summary: "D: No kids", start: iso(0), end: iso(23), allDay: true },
  ];
  const from = Date.parse(iso(0)), to = from + 86_400_000;
  it("keeps only Elgin sessions and appointments, session first, prefix stripped", () => {
    const out = elginSchedule(evs, from, to);
    expect(out.map((o) => o.uid)).toEqual(["r1", "elgin-session-2026-11-11-list-svh@buoy", "x1"]);
    expect(out[2]).toMatchObject({ kind: "appointment", title: "Pt A (SURG)" });
    expect(out[1].kind).toBe("session");
  });
  it("respects the range", () => {
    expect(elginSchedule(evs, to, to + 1000)).toEqual([]);
  });
});
