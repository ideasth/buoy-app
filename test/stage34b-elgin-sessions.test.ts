// filepath: test/stage34b-elgin-sessions.test.ts
import { describe, it, expect } from "vitest";
import { synthElginSessions } from "../server/elgin-feed";

const L = (hhmm: string, day: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h - 11, m)).toISOString();
};
const ev = (uid: string, summary: string, day: string, s: string, e: string, location?: string) =>
  ({ uid, summary, start: L(s, day), end: L(e, day), allDay: false, location } as any);

describe("Stage 34b synthElginSessions", () => {
  const D = "2026-11-11", svh = "St Vincents - Fitzroy OP";
  const appts = [
    ev("a1", "[Elgin House] EH: Pt A (SURG)", D, "13:00", "14:50", svh),
    ev("a2", "[Elgin House] EH: Pt B (SURG)", D, "15:00", "20:00", svh),
  ];
  it("operating list uses actual case times, one block, no names", () => {
    const out = synthElginSessions([], appts);
    expect(out).toHaveLength(1);
    expect([out[0].start, out[0].end]).toEqual([L("13:00", D), L("20:00", D)]);
    expect(out[0].location).toBe(svh);
    expect(out[0].summary).toBe(`Operating list · 2 cases · ${svh}`);
    expect((out[0] as any).infoOnly).toBeUndefined();
    expect(JSON.stringify(out[0])).not.toMatch(/Pt [AB]/);
  });
  it("operating list spanning AM and PM stays one block at actual times", () => {
    const out = synthElginSessions([], [
      ev("s1", "[Elgin House] EH: Pt G (SURG)", D, "08:30", "10:00", svh),
      ev("s2", "[Elgin House] EH: Pt H (SURG)", D, "13:30", "15:00", svh),
    ]);
    expect(out).toHaveLength(1);
    expect([out[0].start, out[0].end]).toEqual([L("08:30", D), L("15:00", D)]);
  });
  it("splits a clinic day into standard AM and PM sessions", () => {
    const eh = [
      ev("d1", "[Elgin House] EH: Pt D (NEW)", "2026-11-13", "09:00", "09:40", "Elgin House Carlton"),
      ev("d2", "[Elgin House] EH: Pt E (REV)", "2026-11-13", "14:00", "14:20", "Elgin House Carlton"),
    ];
    const [am, pm] = synthElginSessions([], eh);
    expect(am.summary).toBe("Elgin House session AM · 1 appointment · Elgin House Carlton");
    expect([am.start, am.end]).toEqual([L("08:00", "2026-11-13"), L("13:00", "2026-11-13")]);
    expect([pm.start, pm.end]).toEqual([L("13:00", "2026-11-13"), L("17:00", "2026-11-13")]);
  });
  it("skips Elgin rooms whose half already has a roster block", () => {
    const D2 = "2026-11-10";
    const block = ev("b", "Elgin House Braybrook (AM)", D2, "08:00", "12:00", "Elgin House Braybrook");
    const eh = [
      ev("c1", "[Elgin House] EH: Pt C (REV)", D2, "08:30", "09:00", "Elgin House Braybrook, 330 Ballarat Road"),
      ev("c2", "[Elgin House] EH: Pt F (REV)", D2, "14:00", "14:30", "Elgin House Braybrook, 330 Ballarat Road"),
    ];
    const out = synthElginSessions([block], eh);
    expect(out).toHaveLength(1);
    expect(out[0].summary).toContain("session PM");
  });
});
