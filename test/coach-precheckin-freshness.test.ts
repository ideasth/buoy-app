// Stage 9b (2026-05-10) — Coach pre-session check-in freshness gate.
//
// Pure-logic tests for isCheckinFresh / CHECKIN_FRESHNESS_MS. The
// host page (Coach.tsx) uses this exact predicate to decide whether
// to skip the pre-session modal. Vitest is node-only so we exercise
// the shared module directly via @shared alias.

import { describe, it, expect } from "vitest";
import {
  CHECKIN_FRESHNESS_MS,
  isCheckinFresh,
} from "@shared/checkin-mapping";

describe("CHECKIN_FRESHNESS_MS", () => {
  it("is 90 minutes in milliseconds", () => {
    expect(CHECKIN_FRESHNESS_MS).toBe(90 * 60 * 1000);
  });
});

describe("isCheckinFresh", () => {
  const now = 1_700_000_000_000; // arbitrary fixed reference point

  it("returns false for null", () => {
    expect(isCheckinFresh(null, now)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isCheckinFresh(undefined, now)).toBe(false);
  });

  it("returns false when capturedAt is missing", () => {
    expect(isCheckinFresh({}, now)).toBe(false);
  });

  it("returns false when capturedAt is not a number", () => {
    // @ts-expect-error — intentionally exercising defensive branch
    expect(isCheckinFresh({ capturedAt: "yesterday" }, now)).toBe(false);
  });

  it("returns true for a row captured 1 minute ago", () => {
    expect(
      isCheckinFresh({ capturedAt: now - 60 * 1000 }, now),
    ).toBe(true);
  });

  it("returns true for a row captured 89 minutes ago", () => {
    expect(
      isCheckinFresh({ capturedAt: now - 89 * 60 * 1000 }, now),
    ).toBe(true);
  });

  it("returns false at exactly 90 minutes (boundary)", () => {
    // Strict <, so the 90-min mark itself is stale.
    expect(
      isCheckinFresh({ capturedAt: now - CHECKIN_FRESHNESS_MS }, now),
    ).toBe(false);
  });

  it("returns false for a row captured 2 hours ago", () => {
    expect(
      isCheckinFresh({ capturedAt: now - 2 * 60 * 60 * 1000 }, now),
    ).toBe(false);
  });

  it("returns true for a future capturedAt (clock skew tolerance)", () => {
    // capturedAt slightly in the future → now - capturedAt is negative,
    // which is < CHECKIN_FRESHNESS_MS, so the row is treated as fresh.
    // This is intentional: a small server-vs-client skew shouldn't
    // bounce the user into the modal.
    expect(
      isCheckinFresh({ capturedAt: now + 5 * 1000 }, now),
    ).toBe(true);
  });
});
