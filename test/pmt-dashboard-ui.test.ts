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

  it("contains the select-status testid (conditionally rendered for non-PMT items)", () => {
    expect(detailSrc).toContain("select-status");
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

  it("gates PMT dropdown on pmtLabel being non-null", () => {
    expect(detailSrc).toContain("pmtLabel");
  });

  it("shows the standard status select for ALL projects (Stage 21 removed the pmtLabel == null gate)", () => {
    // Stage 21: every project must expose both a status and a priority control.
    // The plain status selector is no longer gated behind pmtLabel == null.
    expect(detailSrc).not.toContain("pmtLabel == null");
    expect(detailSrc).toContain('data-testid="select-status"');
    expect(detailSrc).toContain('data-testid="select-priority"');
  });
});
