// filepath: test/availability-sanitisation.test.ts
// Stage 17 availability ICS sanitisation (family cases removed 9 Nov 2026 with
// the family calendar). The public availability ICS must never contain event
// titles, locations, descriptions or "Busy" entries. The private ICS carries
// calendar events only.
import { describe, it, expect } from "vitest";
import { emitPublicIcs, computeAvailability, emitPrivateIcs } from "../server/public-calendar";
import type { AvailableBlock } from "../server/public-calendar";
import type { CalEvent } from "../server/ics";

const BOOKABLE = {
  mon: ["07:00", "19:00"] as [string, string],
  tue: ["07:00", "19:00"] as [string, string],
  wed: ["07:00", "19:00"] as [string, string],
  thu: ["07:00", "19:00"] as [string, string],
  fri: ["07:00", "19:00"] as [string, string],
  sat: ["08:00", "13:00"] as [string, string],
  sun: null,
};

describe("public availability ICS sanitisation", () => {
  it("does not contain Outlook event title in public ICS", () => {
    const calEvent: CalEvent = {
      uid: "outlook-1", summary: "VERY_SECRET_OUTLOOK_EVENT_TITLE",
      start: "2026-06-01T22:00:00Z", end: "2026-06-01T23:00:00Z", allDay: false,
    };
    const blocks = computeAvailability({
      calEvents: [calEvent], blocks: [], bookableWindow: BOOKABLE,
      now: new Date("2026-05-31T21:00:00Z").getTime(), horizonMs: 24 * 60 * 60 * 1000,
    });
    expect(emitPublicIcs(blocks)).not.toContain("VERY_SECRET_OUTLOOK_EVENT_TITLE");
  });

  it("never emits SUMMARY: Busy in public ICS", () => {
    const ics = emitPublicIcs([]);
    expect(ics).not.toContain("SUMMARY:Busy");
    expect(ics).not.toContain("SUMMARY: Busy");
  });

  it("only emits Available blocks (no private details)", () => {
    const blocks: AvailableBlock[] = [
      { startUtcMs: new Date("2026-06-01T22:00:00Z").getTime(), endUtcMs: new Date("2026-06-02T00:00:00Z").getTime(), durationMin: 120 },
    ];
    const ics = emitPublicIcs(blocks);
    expect(ics).toContain("Available (");
    for (const f of ["LOCATION:", "DESCRIPTION:", "ATTENDEE:", "ORGANIZER:"]) expect(ics).not.toContain(f);
  });
});

describe("private ICS (apex /cal/private.ics)", () => {
  it("contains calendar events and no family content", () => {
    const ics = emitPrivateIcs([
      { uid: "e1", summary: "Clinic", start: "2026-06-01T22:00:00Z", end: "2026-06-01T23:00:00Z", allDay: false },
    ]);
    expect(ics).toContain("SUMMARY:Clinic");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toMatch(/family/i);
  });
});
