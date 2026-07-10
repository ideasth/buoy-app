// filepath: test/pmt-dashboard-ui.test.ts
// PMT status unification — source-text guard tests.
// Follows the same pure file-read pattern as stage18-settings-nav-calm-music.test.ts
// and pmt-routes.test.ts. No jsdom or React rendering.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function readSrc(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

describe("PmtDashboard.tsx — Complete visual treatment", () => {
  const dashSrc = readSrc("client/src/pages/PmtDashboard.tsx");

  it("applies line-through on Complete item name", () => {
    expect(dashSrc).toContain("line-through");
  });

  it("applies opacity-60 on Complete item name", () => {
    expect(dashSrc).toContain("opacity-60");
  });

  it("contains sort-complete-last sentinel comment near sort logic", () => {
    expect(dashSrc).toContain("// sort-complete-last");
  });

  it("contains the PMT-status filter select testid", () => {
    expect(dashSrc).toContain("select-pmt-status-filter");
  });

  it("renders pmtStatusBadge function", () => {
    expect(dashSrc).toContain("pmtStatusBadge");
  });
});

describe("PmtDashboard.tsx — Open status is retired", () => {
  const dashSrc = readSrc("client/src/pages/PmtDashboard.tsx");

  it("does NOT contain an Open SelectItem in PmtDashboard.tsx", () => {
    // The filter select must not offer 'Open' as an option.
    expect(dashSrc).not.toContain('value="open"');
  });

  it("does NOT contain incomplete filter option", () => {
    expect(dashSrc).not.toContain('value="incomplete"');
  });

  it("contains Active, Parked, Complete filter options", () => {
    expect(dashSrc).toContain('value="active"');
    expect(dashSrc).toContain('value="parked"');
    expect(dashSrc).toContain('value="complete"');
  });

  it("default pmtFilter is active (not incomplete)", () => {
    expect(dashSrc).toContain('"active"');
    expect(dashSrc).not.toContain('"incomplete"');
  });
});

describe("ProjectDetail.tsx — PMT status dropdown", () => {
  const detailSrc = readSrc("client/src/pages/ProjectDetail.tsx");

  it("contains the select-pmt-status testid", () => {
    expect(detailSrc).toContain("select-pmt-status");
  });

  it("no longer contains the generic select-status control (Stage 22 removed it)", () => {
    // Stage 22: the generic active/parked status Select was removed; PMT Status
    // is the single status control surfaced for every project.
    expect(detailSrc).not.toContain('data-testid="select-status"');
  });

  it("does NOT contain Open as a SelectItem value", () => {
    // "Open" must have been removed from the PMT status select.
    expect(detailSrc).not.toContain('value="Open"');
  });

  it("contains Active, Parked, Complete as SelectItem values", () => {
    expect(detailSrc).toContain('"Active"');
    expect(detailSrc).toContain('"Parked"');
    expect(detailSrc).toContain('"Complete"');
  });

  it("surfaces PMT status for ALL projects (Stage 22 removed the pmtLabel gate)", () => {
    // Stage 22: the PMT status select is no longer gated behind pmtLabel != null.
    expect(detailSrc).not.toContain("pmtLabel != null");
    expect(detailSrc).toContain('data-testid="select-pmt-status"');
    expect(detailSrc).toContain('data-testid="select-priority"');
  });
});
