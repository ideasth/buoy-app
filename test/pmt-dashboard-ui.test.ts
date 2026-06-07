// filepath: test/pmt-dashboard-ui.test.ts
// PMT Complete UI — source-text guard tests.
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

  it("contains the incomplete filter option", () => {
    expect(dashSrc).toContain("incomplete");
  });

  it("renders pmtStatusBadge function", () => {
    expect(dashSrc).toContain("pmtStatusBadge");
  });
});

describe("ProjectDetail.tsx — PMT status dropdown", () => {
  const detailSrc = readSrc("client/src/pages/ProjectDetail.tsx");

  it("contains the select-pmt-status testid", () => {
    expect(detailSrc).toContain("select-pmt-status");
  });

  it("contains all four PMT status values as literals", () => {
    expect(detailSrc).toContain('"Open"');
    expect(detailSrc).toContain('"Active"');
    expect(detailSrc).toContain('"Complete"');
    expect(detailSrc).toContain('"Parked"');
  });

  it("gates dropdown on pmtLabel being non-null", () => {
    expect(detailSrc).toContain("pmtLabel");
  });
});
