// filepath: test/pmt-status-writethrough.test.ts
// Pure unit tests for the PMT write-through helpers exported from server/storage.ts.
// No DB required — tests call the pure helper functions directly.

import { describe, expect, it } from "vitest";
import { legacyStatusForPmtStatus, pmtStatusForLegacyStatus } from "../server/storage";

describe("legacyStatusForPmtStatus", () => {
  it("Active -> active", () => {
    expect(legacyStatusForPmtStatus("Active")).toBe("active");
  });

  it("Parked -> parked", () => {
    expect(legacyStatusForPmtStatus("Parked")).toBe("parked");
  });

  it("Complete -> active (MS To Do list must not be archived for finished work)", () => {
    expect(legacyStatusForPmtStatus("Complete")).toBe("active");
  });

  it("unknown value -> active (safe default)", () => {
    expect(legacyStatusForPmtStatus("anything-else")).toBe("active");
  });
});

describe("pmtStatusForLegacyStatus", () => {
  it("returns null when currentPmtStatus is null (non-PMT item must not gain a pmtStatus)", () => {
    expect(pmtStatusForLegacyStatus("active", null)).toBeNull();
    expect(pmtStatusForLegacyStatus("parked", null)).toBeNull();
  });

  it("active + currently Active -> Active", () => {
    expect(pmtStatusForLegacyStatus("active", "Active")).toBe("Active");
  });

  it("parked + currently Active -> Parked", () => {
    expect(pmtStatusForLegacyStatus("parked", "Active")).toBe("Parked");
  });

  it("active + currently Parked -> Active", () => {
    expect(pmtStatusForLegacyStatus("active", "Parked")).toBe("Active");
  });

  it("parked + currently Parked -> Parked", () => {
    expect(pmtStatusForLegacyStatus("parked", "Parked")).toBe("Parked");
  });

  it("active + currently Complete -> Complete (don't un-complete a finished item)", () => {
    // This is the key invariant: MS To Do syncing back 'active' must NOT revert a Complete item.
    expect(pmtStatusForLegacyStatus("active", "Complete")).toBe("Complete");
  });

  it("parked + currently Complete -> Parked (explicit parking overrides Complete)", () => {
    expect(pmtStatusForLegacyStatus("parked", "Complete")).toBe("Parked");
  });
});
