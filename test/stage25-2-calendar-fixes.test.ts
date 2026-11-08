// filepath: test/stage25-2-calendar-fixes.test.ts
// Stage 25.2 — TZID handling, same-location back-to-back suppression, Focus time ignored.

import { describe, expect, it } from "vitest";
import { parseIcs, resolveTzid } from "../server/ics";
import { DEFAULT_CONFIG, type OnTimeConfig } from "../server/ontime/config";
import { planCues, type PlanEvent } from "../server/ontime/plan";
import { melbToUtcMs } from "../server/ontime/time";

const ics = (dt: string) =>
  ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x1", "SUMMARY:Test", dt, dt.replace("DTSTART", "DTEND"), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const startOf = (dt: string) => new Date(parseIcs(ics(dt))[0].start);

describe("ICS TZID", () => {
  it("UTC TZID is read as UTC", () => {
    expect(startOf("DTSTART;TZID=UTC:20261109T220000").toISOString()).toBe("2026-11-09T22:00:00.000Z");
  });
  it("AUS Eastern Standard Time = Sydney/Melbourne wall clock", () => {
    expect(startOf("DTSTART;TZID=AUS Eastern Standard Time:20261110T090000").toISOString()).toBe("2026-11-09T22:00:00.000Z");
  });
  it("Sri Lanka Standard Time (UTC+5:30)", () => {
    expect(startOf("DTSTART;TZID=Sri Lanka Standard Time:20261113T014500").toISOString()).toBe("2026-11-12T20:15:00.000Z");
  });
  it("E. Australia (Brisbane, no DST in November)", () => {
    expect(startOf("DTSTART;TZID=E. Australia Standard Time:20261110T090000").toISOString()).toBe("2026-11-09T23:00:00.000Z");
  });
  it("IANA names and Z suffix; unknown falls back to Melbourne", () => {
    expect(startOf("DTSTART;TZID=Asia/Bangkok:20261110T090000").toISOString()).toBe("2026-11-10T02:00:00.000Z");
    expect(startOf("DTSTART:20261110T090000Z").toISOString()).toBe("2026-11-10T09:00:00.000Z");
    expect(startOf("DTSTART;TZID=Mars Standard Time:20261110T090000").toISOString()).toBe("2026-11-09T22:00:00.000Z");
    expect(resolveTzid(undefined)).toBe("Australia/Melbourne");
  });
});

const cfg = (p: Partial<OnTimeConfig> = {}): OnTimeConfig => ({ ...DEFAULT_CONFIG, ...p });
const ev = (p: Partial<PlanEvent>): PlanEvent => ({
  uid: "am", summary: "Elgin House (AM)", startMs: melbToUtcMs("2026-11-10", "08:00"),
  endMs: melbToUtcMs("2026-11-10", "12:00"), allDay: false, travelAllowMinutes: 30, travelLocationName: "Elgin Carlton",
  ...p,
});
const pm = ev({ uid: "pm", summary: "Elgin House (PM)", startMs: melbToUtcMs("2026-11-10", "13:00"), endMs: melbToUtcMs("2026-11-10", "17:00") });
const leaveFor = (cues: any[], uid: string) => cues.filter((c) => c.kind === "leave_now" && String(c.key).includes(`:${uid}:`));

describe("back-to-back same location", () => {
  it("PM session after AM at same place gets no leave cue", () => {
    const cues = planCues([ev({}), pm], cfg(), melbToUtcMs("2026-11-10", "00:00"), melbToUtcMs("2026-11-11", "00:00"));
    expect(leaveFor(cues, "am").length).toBe(1);
    expect(leaveFor(cues, "pm").length).toBe(0);
  });
  it("different place still gets a leave cue", () => {
    const other = { ...pm, travelLocationName: "Elgin Braybrook" };
    const cues = planCues([ev({}), other], cfg(), melbToUtcMs("2026-11-10", "00:00"), melbToUtcMs("2026-11-11", "00:00"));
    expect(leaveFor(cues, "pm").length).toBe(1);
  });
  it("long gap at same place still gets a leave cue", () => {
    const late = { ...pm, startMs: melbToUtcMs("2026-11-10", "16:00"), endMs: melbToUtcMs("2026-11-10", "18:00") };
    const cues = planCues([ev({}), late], cfg(), melbToUtcMs("2026-11-10", "00:00"), melbToUtcMs("2026-11-11", "00:00"));
    expect(leaveFor(cues, "pm").length).toBe(1);
  });
});

describe("Focus time", () => {
  it("is ignored by default", () => {
    const f = ev({ uid: "f", summary: "Focus time", travelAllowMinutes: null, travelLocationName: null,
      startMs: melbToUtcMs("2026-11-10", "06:00"), endMs: melbToUtcMs("2026-11-10", "07:30") });
    const cues = planCues([f], cfg(), melbToUtcMs("2026-11-10", "00:00"), melbToUtcMs("2026-11-11", "00:00"));
    expect(cues.filter((c: any) => String(c.key).includes(":f:")).length).toBe(0);
  });
});
