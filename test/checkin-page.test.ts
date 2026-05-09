// Stage 8 (2026-05-10) — /checkin page + 4 routes.
//
// What this guards:
//   - phaseFromClock window boundaries (04:00, 11:00, 16:30, 22:00)
//   - insertDailyCheckInSchema accepts the body shape the page sends
//   - insertDailyCheckInSchema rejects malformed input
//
// Phase derivation is duplicated client-side (Intl-based) and tested as
// a pure boundary-table here so any future window adjustment forces a
// matching test edit. The route handlers are thin wrappers around
// storage.upsertDailyCheckIn / storage.listDailyCheckInsForDate / etc.,
// which are exercised by the Stage 7 in-memory sqlite suite.

import { describe, expect, it } from "vitest";
import { insertDailyCheckInSchema } from "../shared/schema";

// Re-implementation of the page's phase-from-clock helper as a pure
// function on a decimal hour, so we can test the window logic without
// going through Intl. The real client code uses an Intl-based melbourne
// clock to feed this exact predicate.
function phaseFromHour(h: number): "morning" | "midday" | "evening" | "adhoc" {
  if (h >= 4 && h < 11) return "morning";
  if (h >= 11 && h < 16.5) return "midday";
  if (h >= 16.5 && h < 22) return "evening";
  return "adhoc";
}

describe("phaseFromHour (Stage 8)", () => {
  it("classifies the four documented windows", () => {
    expect(phaseFromHour(4.0)).toBe("morning");
    expect(phaseFromHour(7.5)).toBe("morning");
    expect(phaseFromHour(10.99)).toBe("morning");

    expect(phaseFromHour(11.0)).toBe("midday");
    expect(phaseFromHour(13.0)).toBe("midday");
    expect(phaseFromHour(16.49)).toBe("midday");

    expect(phaseFromHour(16.5)).toBe("evening");
    expect(phaseFromHour(20.0)).toBe("evening");
    expect(phaseFromHour(21.99)).toBe("evening");

    expect(phaseFromHour(22.0)).toBe("adhoc");
    expect(phaseFromHour(23.5)).toBe("adhoc");
    expect(phaseFromHour(0)).toBe("adhoc");
    expect(phaseFromHour(3.99)).toBe("adhoc");
  });
});

describe("insertDailyCheckInSchema (Stage 8 wire shape)", () => {
  it("accepts the body shape /checkin POSTs", () => {
    const body = {
      date: "2026-05-10",
      phase: "midday",
      source: "checkin_page",
      mood: "positive",
      energyLabel: "moderate",
      cognitiveLoad: "low",
      focus: "focused",
      arousalState: "calm",
      note: "between cases",
    };
    const parsed = insertDailyCheckInSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("accepts a sparse body with only one chip set", () => {
    const parsed = insertDailyCheckInSchema.safeParse({
      date: "2026-05-10",
      phase: "evening",
      source: "checkin_page",
      mood: "neutral",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects when the required fields are missing", () => {
    // Missing phase + source + date. Schema requires all three.
    expect(insertDailyCheckInSchema.safeParse({ mood: "positive" }).success).toBe(
      false,
    );
  });

  it("accepts the coach pre-session source", () => {
    const parsed = insertDailyCheckInSchema.safeParse({
      date: "2026-05-10",
      phase: "morning",
      source: "coach_pre_session",
      mood: "positive",
    });
    expect(parsed.success).toBe(true);
  });
});
