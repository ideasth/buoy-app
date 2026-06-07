// filepath: test/pmt-routes.test.ts
// Stage 20 — route-shape / source-text guards for PMT endpoints.
// Follows the pattern of the Stage 18 test: reads source text and asserts
// structural invariants without spinning up the server.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

describe("PMT route registration (server/routes.ts)", () => {
  const routesSrc = readSrc("server/routes.ts");

  it("registers GET /api/pmt/dashboard", () => {
    expect(routesSrc).toContain('"/api/pmt/dashboard"');
  });

  it("registers GET /api/pmt/items", () => {
    expect(routesSrc).toContain('"/api/pmt/items"');
  });

  it("PATCH /api/projects/:id allowed list includes PMT fields", () => {
    for (const field of ["fileStatus", "pmtStatus", "pmtLabel", "nextAction", "kind", "parentId"]) {
      expect(routesSrc, `expected field "${field}" in allowed list`).toContain(`"${field}"`);
    }
  });

  it("validation strings are present", () => {
    expect(routesSrc).toContain("invalid_file_status");
    expect(routesSrc).toContain("invalid_pmt_status");
    expect(routesSrc).toContain("invalid_kind");
  });
});

describe("PMT dashboard page (client/src/pages/PmtDashboard.tsx)", () => {
  const dashSrc = readSrc("client/src/pages/PmtDashboard.tsx");

  it("queries /api/pmt/dashboard", () => {
    expect(dashSrc).toContain("/api/pmt/dashboard");
  });

  it("renders a filter chip row with file status options", () => {
    expect(dashSrc).toContain("needs files");
    expect(dashSrc).toContain("partial");
    expect(dashSrc).toContain("present");
  });
});

describe("PMT route in App.tsx", () => {
  const appSrc = readSrc("client/src/App.tsx");

  it("registers Route path='/pmt'", () => {
    expect(appSrc).toContain('path="/pmt"');
  });

  it("imports PmtDashboard", () => {
    expect(appSrc).toContain("PmtDashboard");
  });
});

describe("PMT NAV entry in Layout.tsx", () => {
  const layoutSrc = readSrc("client/src/components/Layout.tsx");

  it('contains href: "/pmt" in the NAV', () => {
    expect(layoutSrc).toContain('href: "/pmt"');
  });

  it("PMT comes before Projects in the NAV", () => {
    const pmtIdx = layoutSrc.indexOf('href: "/pmt"');
    const projectsIdx = layoutSrc.indexOf('href: "/projects"');
    expect(pmtIdx).toBeGreaterThanOrEqual(0);
    expect(projectsIdx).toBeGreaterThanOrEqual(0);
    expect(pmtIdx).toBeLessThan(projectsIdx);
  });
});

describe("ALLOWED_LANDING_ROUTES in server/app-settings.ts", () => {
  const settingsSrc = readSrc("server/app-settings.ts");

  it('includes "/pmt"', () => {
    expect(settingsSrc).toContain('"/pmt"');
  });
});
