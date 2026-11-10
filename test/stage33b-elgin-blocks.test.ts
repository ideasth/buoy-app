// filepath: test/stage33b-elgin-blocks.test.ts
// Stage 34b supersedes 33b fitting: standard AM 08:00–13:00 / PM 13:00–17:00,
// widened only when that half's appointments fall outside the window.
import { describe, it, expect } from "vitest";
import { fitElginBlocks, isElginBlock } from "../server/elgin-feed";
import type { CalEvent } from "../server/ics";

// 2026-11-10 is AEDT (UTC+11).
const L = (hhmm: string, day = "2026-11-10") => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h - 11, m)).toISOString();
};
const block = (half: "AM" | "PM", s: string, e: string, day = "2026-11-10"): CalEvent => ({
  uid: `elginhouse-${day}-${half}@oliver-daly-roster`, summary: `Elgin House Braybrook (${half})`,
  start: L(s, day), end: L(e, day), allDay: false, source: "rules",
});
const appt = (s: string, e: string, day = "2026-11-10", n = 0): CalEvent => ({
  uid: `xestro-${day}-${s}-${n}`, summary: "[Elgin House] Patient Name", start: L(s, day), end: L(e, day),
  allDay: false, source: "external", infoOnly: true, location: "Elgin House Braybrook",
});

describe("Elgin blocks use standard session times", () => {
  const blocks = [block("AM", "08:00", "12:00"), block("PM", "13:00", "17:00")];

  it("sets AM 08:00–13:00 and PM 13:00–17:00 when appointments sit inside", () => {
    const [am, pm] = fitElginBlocks(blocks, [appt("08:30", "08:50"), appt("12:20", "12:50"), appt("14:00", "14:30")]);
    expect([am.start, am.end]).toEqual([L("08:00"), L("13:00")]);
    expect([pm.start, pm.end]).toEqual([L("13:00"), L("17:00")]);
    expect(am.description).toContain("roster 08:00–12:00");
    expect(am.description).not.toContain("Patient");
    expect(am.uid).toBe(blocks[0].uid);
  });

  it("widens a half to cover appointments outside its window", () => {
    const [am, pm] = fitElginBlocks(blocks, [appt("07:30", "08:00"), appt("17:00", "17:30")]);
    expect([am.start, am.end]).toEqual([L("07:30"), L("13:00")]);
    expect([pm.start, pm.end]).toEqual([L("13:00"), L("17:30")]);
    expect(pm.description).toContain("widened");
  });

  it("uses standard times on days with no appointments, leaves non-block events alone", () => {
    const other: CalEvent = { uid: "x", summary: "Theatre", start: L("08:00"), end: L("09:00"), allDay: false };
    const out = fitElginBlocks([...blocks, other], [appt("09:00", "09:30", "2026-11-11")]);
    expect([out[0].start, out[0].end]).toEqual([L("08:00"), L("13:00")]);
    expect(out[2]).toBe(other);
  });

  it("does not mutate inputs and recognises block titles only", () => {
    const copy = JSON.parse(JSON.stringify(blocks));
    fitElginBlocks(blocks, [appt("08:30", "09:00")]);
    expect(blocks).toEqual(copy);
    expect(isElginBlock(blocks[0])).toBe(true);
    expect(isElginBlock({ ...blocks[0], summary: "Elgin House (AM)" })).toBe(true);
    expect(isElginBlock({ ...blocks[0], summary: "Elgin House Carlton (PM)" })).toBe(true);
    expect(isElginBlock(appt("08:30", "09:00"))).toBe(false);
  });

  it("routes merge fitted blocks before appending appointments", async () => {
    const { readFileSync } = await import("node:fs");
    const r = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
    expect(r).toMatch(/fitElginBlocks\(feedEvents, appts\)/);
  });
});
