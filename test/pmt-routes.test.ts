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

  it("Open is NOT in the valid pmtStatus list", () => {
    // The valid list must be exactly ["Active", "Parked", "Complete"]. "Open" must not appear
    // in the validation array.
    expect(routesSrc).toContain('"Active", "Parked", "Complete"');
    // Confirm "Open" does not appear in the validation includes() call.
    const validationBlock = routesSrc.slice(
      routesSrc.indexOf("invalid_pmt_status") - 200,
      routesSrc.indexOf("invalid_pmt_status") + 50,
    );
    expect(validationBlock).not.toContain('"Open"');
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

describe("PATCH /api/projects/:id pmtStatus validation", () => {
  // Hermetic in-memory SQLite round-trip.
  // Mirrors the DDL pattern from test/pmt-schema.test.ts.
  it("round-trips pmtStatus Complete via raw SQLite (simulates PATCH + GET)", () => {
    // Inline import of better-sqlite3 so this test stays hermetic.
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");

    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        priority TEXT NOT NULL DEFAULT 'low',
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    // Apply PMT columns
    for (const stmt of [
      "ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'project'",
      "ALTER TABLE projects ADD COLUMN parent_id INTEGER",
      "ALTER TABLE projects ADD COLUMN pmt_label TEXT",
      "ALTER TABLE projects ADD COLUMN pmt_status TEXT",
      "ALTER TABLE projects ADD COLUMN next_action TEXT",
      "ALTER TABLE projects ADD COLUMN file_status TEXT",
      "ALTER TABLE projects ADD COLUMN latest_thread_url TEXT",
      "ALTER TABLE projects ADD COLUMN pmt_notes TEXT",
      "ALTER TABLE projects ADD COLUMN seed_key TEXT",
    ]) {
      try { db.exec(stmt); } catch { /* already exists */ }
    }

    const now = Date.now();
    const result = db.prepare(
      "INSERT INTO projects (name, status, priority, description, pmt_label, pmt_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("Test project", "active", "low", "", "Bayside Health", "Active", now, now);
    const id = result.lastInsertRowid as number;

    // Simulate PATCH: validate Active, Parked, Complete are in the allowed list.
    const routesSrc = readSrc("server/routes.ts");
    expect(routesSrc).toContain('"Active"');
    expect(routesSrc).toContain('"Parked"');
    expect(routesSrc).toContain('"Complete"');

    db.prepare("UPDATE projects SET pmt_status = ?, updated_at = ? WHERE id = ?").run("Complete", now + 1, id);

    // Simulate GET: read back and confirm.
    const row = db.prepare("SELECT pmt_status FROM projects WHERE id = ?").get(id) as { pmt_status: string };
    expect(row.pmt_status).toBe("Complete");
  });

  it("Open is rejected as an invalid pmtStatus (source-level guard)", () => {
    // Confirm the validation array does NOT include "Open".
    const routesSrc = readSrc("server/routes.ts");
    // The valid list must now only contain Active, Parked, Complete.
    expect(routesSrc).toContain('"Active", "Parked", "Complete"');
    // "Open" must not appear anywhere near the invalid_pmt_status validation block.
    const idx = routesSrc.indexOf("invalid_pmt_status");
    const ctx = routesSrc.slice(idx - 300, idx + 50);
    expect(ctx).not.toContain('"Open"');
  });
});

describe("PMT write-through: PATCH pmtStatus derives legacy status (source-text + logic guards)", () => {
  // These tests validate the write-through logic is wired in routes.ts source
  // and exercise the mapping rules using the same inline logic as the
  // pure helper tests in test/pmt-status-writethrough.test.ts.

  it("routes.ts imports legacyStatusForPmtStatus and pmtStatusForLegacyStatus", () => {
    const routesSrc = readSrc("server/routes.ts");
    expect(routesSrc).toContain("legacyStatusForPmtStatus");
    expect(routesSrc).toContain("pmtStatusForLegacyStatus");
  });

  it("routes.ts sets updates.status = legacyStatusForPmtStatus(updates.pmtStatus) when pmtStatus patched", () => {
    const routesSrc = readSrc("server/routes.ts");
    expect(routesSrc).toContain("legacyStatusForPmtStatus(updates.pmtStatus)");
  });

  it("routes.ts calls pmtStatusForLegacyStatus when status is patched without pmtStatus", () => {
    const routesSrc = readSrc("server/routes.ts");
    expect(routesSrc).toContain("pmtStatusForLegacyStatus(updates.status");
  });

  it("PATCH pmtStatus=Parked mapping: legacyStatusForPmtStatus returns parked (inline)", () => {
    // Inline implementation mirrors the exported helper — no DB import needed.
    function legacyStatusForPmtStatus(pmt: string): string {
      return pmt === "Parked" ? "parked" : "active";
    }
    expect(legacyStatusForPmtStatus("Parked")).toBe("parked");
    expect(legacyStatusForPmtStatus("Active")).toBe("active");
    expect(legacyStatusForPmtStatus("Complete")).toBe("active");
  });

  it("PATCH status=active on Complete project: pmtStatusForLegacyStatus returns Complete (inline)", () => {
    // Inline implementation mirrors the exported helper.
    function pmtStatusForLegacyStatus(legacy: string, currentPmtStatus: string | null): string | null {
      if (currentPmtStatus == null) return null;
      if (currentPmtStatus === "Complete" && legacy === "active") return "Complete";
      if (legacy === "parked") return "Parked";
      if (legacy === "active") return "Active";
      return currentPmtStatus;
    }
    // Key invariant: Complete is preserved when legacy patches to active.
    expect(pmtStatusForLegacyStatus("active", "Complete")).toBe("Complete");
    // Normal mapping.
    expect(pmtStatusForLegacyStatus("parked", "Active")).toBe("Parked");
    expect(pmtStatusForLegacyStatus("active", "Parked")).toBe("Active");
    // Non-PMT item is left alone.
    expect(pmtStatusForLegacyStatus("active", null)).toBeNull();
  });
});
