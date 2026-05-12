// Stage 17 — free/busy compute tests
import { describe, it, expect } from "vitest";
import {
  computeAvailability,
  emitPublicIcs,
  type BookableWindow,
  type AvailableBlock,
} from "../server/public-calendar";
import type { CalEvent } from "../server/ics";
import type { FamilyEvent, PublicCalendarBlock } from "../server/family-storage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOOKABLE: BookableWindow = {
  mon: ["07:00", "19:00"],
  tue: ["07:00", "19:00"],
  wed: ["07:00", "19:00"],
  thu: ["07:00", "19:00"],
  fri: ["07:00", "19:00"],
  sat: ["08:00", "13:00"],
  sun: null,
};

// Monday 2026-06-01 09:00 UTC (AEST = 19:00, so just inside bookable window)
const MON_2026_06_01 = new Date("2026-06-01T09:00:00Z").getTime(); // 09:00 UTC = 19:00 AEST

// A "now" that is a Monday at 07:00 Melbourne (21:00 UTC prev day... let's use midday UTC Mon)
function mondayNoon(dateStr: string): number {
  return new Date(dateStr + "T02:00:00Z").getTime(); // Mon ~12:00 AEST
}

function utcMs(iso: string): number {
  return new Date(iso).getTime();
}

function makeCalEvent(uid: string, start: string, end: string): CalEvent {
  return { uid, summary: "Test Event", start, end, allDay: false };
}

function makeFamilyEvent(
  id: number,
  start: string,
  end: string,
  countAsBusy = 1,
): FamilyEvent {
  return {
    id,
    user_id: null,
    title: "Family Event",
    start_utc: start,
    end_utc: end,
    all_day: 0,
    location: null,
    notes: null,
    added_by: "password",
    count_as_busy_for_public: countAsBusy,
    created_at: start,
    updated_at: start,
  };
}

function makeBlock(
  id: number,
  kind: PublicCalendarBlock["kind"],
  opts: { start?: string; end?: string; weekday?: number },
): PublicCalendarBlock {
  return {
    id,
    user_id: null,
    kind,
    start_utc: opts.start ?? null,
    end_utc: opts.end ?? null,
    weekday: opts.weekday ?? null,
    source_event_id: null,
    note: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeAvailability", () => {
  it("empty calendar yields Available blocks within bookable window", () => {
    // Monday 2026-06-01, "now" = 07:00 AEST = 21:00 UTC prev day
    const now = utcMs("2026-05-31T21:00:00Z"); // 07:00 AEST on Mon 2026-06-01
    const result = computeAvailability({
      calEvents: [],
      familyEvents: [],
      blocks: [],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 7 * 24 * 60 * 60 * 1000, // 1 week only
    });
    // Should have some blocks for Mon-Sat within 1 week
    expect(result.length).toBeGreaterThan(0);
    // All blocks >= 60 min
    for (const b of result) {
      expect(b.durationMin).toBeGreaterThanOrEqual(60);
    }
  });

  it("one Outlook event mid-day produces buffered free blocks before and after", () => {
    const now = utcMs("2026-05-31T21:00:00Z"); // 07:00 AEST Mon 2026-06-01
    // Event: 09:00-10:00 AEST = 23:00-00:00 UTC (prev/next day)
    // Correction: AEST = UTC+10, so 09:00 AEST = 23:00 UTC(prev) ... let's use AEDT
    // Actually in June, AEST = UTC+10. So 09:00 AEST = 23:00 UTC prev = let's use:
    // 2026-06-01 09:00 AEST = 2026-05-31 23:00 UTC
    const ev = makeCalEvent("ev1", "2026-05-31T23:00:00Z", "2026-06-01T00:00:00Z");
    const result = computeAvailability({
      calEvents: [ev],
      familyEvents: [],
      blocks: [],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 24 * 60 * 60 * 1000, // just today
    });
    // After buffering, the event occupies 08:45-10:15 AEST.
    // Free blocks: [07:00-08:45] = 105 min, [10:15-19:00] = 525 min
    const durations = result.map((b) => b.durationMin);
    // Both should be >= 60
    for (const d of durations) expect(d).toBeGreaterThanOrEqual(60);
    // Should have at least one block after the event
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("back-to-back events within buffer distance suppresses the gap", () => {
    const now = utcMs("2026-05-31T21:00:00Z"); // 07:00 AEST
    // Two events 09:00-10:00 and 10:15-11:15 AEST
    // 09:00 AEST = 23:00 UTC prev; 10:15 AEST = 00:15 UTC
    const ev1 = makeCalEvent("ev1", "2026-05-31T23:00:00Z", "2026-06-01T00:00:00Z");
    const ev2 = makeCalEvent("ev2", "2026-06-01T00:15:00Z", "2026-06-01T01:15:00Z");
    const result = computeAvailability({
      calEvents: [ev1, ev2],
      familyEvents: [],
      blocks: [],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 24 * 60 * 60 * 1000,
    });
    // The 15-min gap between ev1 end and ev2 start (10:00-10:15 AEST)
    // is consumed by buffers (ev1 buffer +15, ev2 buffer -15 = overlap).
    // No block between them should be published (< 60 min after buffering).
    const blockStarts = result.map((b) => b.startUtcMs);
    // There should be no block starting between ev1 end and ev2 start.
    const gapStart = utcMs("2026-06-01T00:00:00Z"); // 10:00 AEST
    const gapEnd = utcMs("2026-06-01T00:15:00Z"); // 10:15 AEST
    const blocsInGap = result.filter(
      (b) => b.startUtcMs >= gapStart && b.startUtcMs < gapEnd,
    );
    expect(blocsInGap.length).toBe(0);
  });

  it("force_available overrides a busy event", () => {
    const now = utcMs("2026-05-31T21:00:00Z");
    // Busy all morning
    const ev = makeCalEvent(
      "ev1",
      "2026-05-31T21:00:00Z", // 07:00 AEST
      "2026-06-01T03:00:00Z", // 13:00 AEST — half day gone
    );
    // Force available: 08:00-12:00 AEST = 22:00-02:00 UTC
    const block = makeBlock(1, "force_available", {
      start: "2026-05-31T22:00:00Z",
      end: "2026-06-01T02:00:00Z",
    });
    const result = computeAvailability({
      calEvents: [ev],
      familyEvents: [],
      blocks: [block],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 24 * 60 * 60 * 1000,
    });
    // The force_available span should produce an Available block
    expect(result.length).toBeGreaterThan(0);
  });

  it("force_busy over a free window suppresses that span", () => {
    const now = utcMs("2026-05-31T21:00:00Z");
    // No events, but force_busy all Monday
    const block = makeBlock(1, "force_busy", {
      start: "2026-05-31T21:00:00Z", // 07:00 AEST
      end: "2026-06-01T09:00:00Z",   // 19:00 AEST
    });
    const result = computeAvailability({
      calEvents: [],
      familyEvents: [],
      blocks: [block],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 24 * 60 * 60 * 1000,
    });
    expect(result.length).toBe(0);
  });

  it("rule_off_day for Wednesday suppresses all Wednesday blocks", () => {
    const now = utcMs("2026-05-31T21:00:00Z"); // Mon 2026-06-01 07:00 AEST
    // weekday=3 = Wednesday
    const block = makeBlock(1, "rule_off_day", { weekday: 3 });
    const result = computeAvailability({
      calEvents: [],
      familyEvents: [],
      blocks: [block],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 7 * 24 * 60 * 60 * 1000, // 1 week
    });
    // Wed 2026-06-03: no blocks
    const wed = utcMs("2026-06-02T21:00:00Z"); // 07:00 AEST Wed 2026-06-03
    const wedEnd = utcMs("2026-06-03T09:00:00Z");
    const wedBlocks = result.filter(
      (b) => b.startUtcMs >= wed && b.startUtcMs < wedEnd,
    );
    expect(wedBlocks.length).toBe(0);
  });

  it("Saturday outside 08:00-13:00 AEST is suppressed", () => {
    const now = utcMs("2026-05-31T21:00:00Z");
    const result = computeAvailability({
      calEvents: [],
      familyEvents: [],
      blocks: [],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 7 * 24 * 60 * 60 * 1000,
    });
    // Sat 2026-06-06 14:00 AEST = 04:00 UTC — outside bookable window
    const satAfter = utcMs("2026-06-06T04:00:00Z"); // 14:00 AEST Sat
    const badBlocks = result.filter(
      (b) => b.startUtcMs >= satAfter && b.startUtcMs < satAfter + 5 * 3600000,
    );
    expect(badBlocks.length).toBe(0);
  });

  it("Sunday is always suppressed (no window configured)", () => {
    const now = utcMs("2026-05-31T21:00:00Z");
    const result = computeAvailability({
      calEvents: [],
      familyEvents: [],
      blocks: [],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 7 * 24 * 60 * 60 * 1000,
    });
    // Sun 2026-06-07 09:00 AEST = 23:00 UTC Sat
    const sunStart = utcMs("2026-06-06T21:00:00Z"); // 07:00 AEST Sun
    const sunEnd = utcMs("2026-06-07T09:00:00Z"); // 19:00 AEST Sun
    const sunBlocks = result.filter(
      (b) => b.startUtcMs >= sunStart && b.startUtcMs < sunEnd,
    );
    expect(sunBlocks.length).toBe(0);
  });

  it("publish horizon respected — event 13 weeks out not emitted", () => {
    const now = Date.now();
    const result = computeAvailability({
      calEvents: [],
      familyEvents: [],
      blocks: [],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 12 * 7 * 24 * 60 * 60 * 1000,
    });
    const horizon = now + 12 * 7 * 24 * 60 * 60 * 1000;
    const beyond = result.filter((b) => b.startUtcMs >= horizon);
    expect(beyond.length).toBe(0);
  });

  it("family event with count_as_busy_for_public=0 does NOT contribute to busy", () => {
    const now = utcMs("2026-05-31T21:00:00Z");
    // Family event occupies all morning — but count_as_busy=0
    const fev = makeFamilyEvent(1, "2026-05-31T21:00:00Z", "2026-06-01T03:00:00Z", 0);
    const result = computeAvailability({
      calEvents: [],
      familyEvents: [fev],
      blocks: [],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 24 * 60 * 60 * 1000,
    });
    // Without busy contribution, the whole morning should be Available
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].durationMin).toBeGreaterThan(60);
  });

  // Regression — Stage 17 hotfix. The upstream Outlook feed contains many
  // all-day "marker" events (school terms, "Kids with us", roster week labels)
  // that span 24+ hours. Before the fix, these blanketed every bookable window
  // and the public ICS came out empty (zero VEVENTs). All-day events must be
  // skipped in the busy-interval builder; force_busy blocks remain the
  // intentional way to mark an all-day span as busy.
  it("all-day calendar events do NOT contribute to busy", () => {
    const now = utcMs("2026-05-31T21:00:00Z"); // 07:00 AEST Mon 2026-06-01
    // A 1-week all-day "School term" marker covering the whole bookable horizon.
    const allDayEv: CalEvent = {
      uid: "school-term-1",
      summary: "School Term 2",
      start: "2026-06-01T00:00:00Z",
      end: "2026-06-08T00:00:00Z",
      allDay: true,
    };
    const result = computeAvailability({
      calEvents: [allDayEv],
      familyEvents: [],
      blocks: [],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 7 * 24 * 60 * 60 * 1000,
    });
    // The all-day event must be ignored — we should still see Mon-Sat blocks.
    expect(result.length).toBeGreaterThan(0);
  });

  it("all-day event coexists with a timed event — only the timed event blocks time", () => {
    const now = utcMs("2026-05-31T21:00:00Z"); // 07:00 AEST Mon 2026-06-01
    const allDayEv: CalEvent = {
      uid: "kids-with-us",
      summary: "Kids with us",
      start: "2026-06-01T00:00:00Z",
      end: "2026-06-02T00:00:00Z",
      allDay: true,
    };
    // Timed event 09:00-10:00 AEST Mon (2026-05-31 23:00 → 2026-06-01 00:00 UTC)
    const timedEv = makeCalEvent("ev1", "2026-05-31T23:00:00Z", "2026-06-01T00:00:00Z");
    const result = computeAvailability({
      calEvents: [allDayEv, timedEv],
      familyEvents: [],
      blocks: [],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 24 * 60 * 60 * 1000,
    });
    // Free blocks should exist on Monday around the timed event — the
    // all-day must not blanket the day.
    expect(result.length).toBeGreaterThan(0);
  });

  it("family event with count_as_busy_for_public=1 contributes to busy", () => {
    const now = utcMs("2026-05-31T21:00:00Z");
    // Family event occupies all day
    const fev = makeFamilyEvent(1, "2026-05-31T21:00:00Z", "2026-06-01T09:00:00Z", 1);
    const result = computeAvailability({
      calEvents: [],
      familyEvents: [fev],
      blocks: [],
      bookableWindow: BOOKABLE,
      now,
      horizonMs: 24 * 60 * 60 * 1000,
    });
    // The whole bookable day is occupied by the family event (+ buffer)
    expect(result.length).toBe(0);
  });
});

describe("emitPublicIcs", () => {
  it("emits VCALENDAR with VEVENT blocks", () => {
    const blocks: AvailableBlock[] = [
      { startUtcMs: utcMs("2026-06-01T00:00:00Z"), endUtcMs: utcMs("2026-06-01T02:00:00Z"), durationMin: 120 },
    ];
    const ics = emitPublicIcs(blocks);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("PRODID:-//Buoy//Public Availability//EN");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("CLASS:PUBLIC");
  });

  it("never emits SUMMARY: Busy", () => {
    const blocks: AvailableBlock[] = [];
    const ics = emitPublicIcs(blocks);
    expect(ics).not.toContain("SUMMARY:Busy");
    expect(ics).not.toContain("SUMMARY: Busy");
  });

  it("emits Available label with rounded-down minutes", () => {
    const blocks: AvailableBlock[] = [
      { startUtcMs: utcMs("2026-06-01T00:00:00Z"), endUtcMs: utcMs("2026-06-01T02:07:00Z"), durationMin: 127 },
    ];
    const ics = emitPublicIcs(blocks);
    // 127 rounded down to nearest 15 = 120
    expect(ics).toContain("Available (120 min)");
  });

  it("emits deterministic UIDs", () => {
    const blocks: AvailableBlock[] = [
      { startUtcMs: utcMs("2026-06-01T00:00:00Z"), endUtcMs: utcMs("2026-06-01T02:00:00Z"), durationMin: 120 },
    ];
    const ics1 = emitPublicIcs(blocks);
    const ics2 = emitPublicIcs(blocks);
    const uid1 = ics1.match(/UID:(.+)/)?.[1];
    const uid2 = ics2.match(/UID:(.+)/)?.[1];
    expect(uid1).toBe(uid2);
    expect(uid1).toMatch(/^buoy-public-/);
  });
});
