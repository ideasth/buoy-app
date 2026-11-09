// filepath: test/stage33b-elgin-blocks.test.ts
import { describe, it, expect } from "vitest";
import { fitElginBlocks, isElginBlock } from "../server/elgin-feed";
import type { CalEvent } from "../server/ics";

// 2026-11-10 is AEDT (UTC+11): 08:00 local = 21:00Z on the 9th.
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
  allDay: false, source: "external", infoOnly: true,
});

describe("Stage 33b — fit Elgin blocks to appointments", () => {
  const blocks = [block("AM", "08:00", "12:00"), block("PM", "13:00", "17:00")];

  it("reshapes AM and PM to first start / last end, split at AM end", () => {
    const appts = [appt("08:30", "08:50"), appt("11:30", "12:30"), appt("12:50", "13:50"), appt("17:00", "17:30")];
    const [am, pm] = fitElginBlocks(blocks, appts);
    expect([am.start, am.end]).toEqual([L("08:30"), L("12:30")]);
    expect([pm.start, pm.end]).toEqual([L("12:50"), L("17:30")]);
    expect(am.description).toContain("template 08:00–12:00");
    expect(am.description).not.toContain("Patient");
    expect(am.uid).toBe(blocks[0].uid);
  });

  it("leaves a half with no appointments at its template times", () => {
    const [am, pm] = fitElginBlocks(blocks, [appt("10:10", "10:40")]);
    expect([am.start, am.end]).toEqual([L("10:10"), L("10:40")]);
    expect(pm).toBe(blocks[1]);
  });

  it("ignores appointments on other days and leaves non-block events alone", () => {
    const other: CalEvent = { uid: "x", summary: "Theatre", start: L("08:00"), end: L("09:00"), allDay: false };
    const out = fitElginBlocks([...blocks, other], [appt("09:00", "09:30", "2026-11-11")]);
    expect(out[0]).toBe(blocks[0]);
    expect(out[1]).toBe(blocks[1]);
    expect(out[2]).toBe(other);
  });

  it("PM-only day takes all appointments", () => {
    const [pm] = fitElginBlocks([block("PM", "13:00", "17:00")], [appt("15:40", "16:10"), appt("17:00", "17:30")]);
    expect([pm.start, pm.end]).toEqual([L("15:40"), L("17:30")]);
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
