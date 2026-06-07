// filepath: test/pmt-dashboard.test.ts
// Stage 20 — PMT dashboard grouping helper tests.
//
// Uses the pure groupPmtItems function from server/pmt-dashboard.ts
// directly (no DB required).

import { describe, expect, it } from "vitest";
import { groupPmtItems, type PmtRow } from "../server/pmt-dashboard";

// Build a fixture that mirrors the 12 seed rows from storage.ts.
function buildFixtureRows(): PmtRow[] {
  // Assign fake IDs sequentially.
  let id = 1;
  const make = (
    partial: Partial<PmtRow> & { name: string; pmtLabel: string; kind: string }
  ): PmtRow => ({
    id: id++,
    parentId: null,
    pmtStatus: null,
    nextAction: null,
    fileStatus: null,
    latestThreadUrl: null,
    pmtNotes: null,
    seedKey: null,
    ...partial,
  });

  // Bayside Health (5 rows)
  const bh1 = make({ name: "Peninsula Health Formal complaint", pmtLabel: "Bayside Health", kind: "issue", pmtStatus: "Active", fileStatus: "partial", seedKey: "bayside-health/peninsula-health-formal-complaint" });
  const bh2 = make({ name: "Monash Health Formal complaint and CEO escalation", pmtLabel: "Bayside Health", kind: "issue", pmtStatus: "Active", fileStatus: "partial", seedKey: "bayside-health/monash-health-formal-complaint-and-ceo-escalation" });
  const bh3 = make({ name: "FTE and duties at Sandringham Hospital", pmtLabel: "Bayside Health", kind: "issue", pmtStatus: "Active", fileStatus: "partial", seedKey: "bayside-health/fte-and-duties-at-sandringham-hospital" });
  const bh4 = make({ name: "Bayside Health CEO Escalation", pmtLabel: "Bayside Health", kind: "issue", pmtStatus: "Active", fileStatus: "partial", seedKey: "bayside-health/bayside-health-ceo-escalation" });
  const bh5 = make({ name: "Bayside Health LHSN pelvic floor service proposal", pmtLabel: "Bayside Health", kind: "project", pmtStatus: "Open", fileStatus: "needs files", seedKey: "bayside-health/lhsn-pelvic-floor-service-proposal" });

  // Victoria S&Q Infrastructure (5 rows)
  const vsq1 = make({ name: "Letter to Health Minister", pmtLabel: "Victoria S&Q Infrastructure", kind: "issue", pmtStatus: "Active", fileStatus: "partial", seedKey: "victoria-sq-infrastructure/letter-to-health-minister-department-restructure" });
  const sammProjectId = id;
  const vsq2 = make({ name: "SAMM projects", pmtLabel: "Victoria S&Q Infrastructure", kind: "project", pmtStatus: "Active", fileStatus: "partial", seedKey: "victoria-sq-infrastructure/samm-projects" });
  const vsq3 = make({ name: "AIHW SAMM scoping", pmtLabel: "Victoria S&Q Infrastructure", kind: "sub-project", pmtStatus: "Open", fileStatus: "needs files", parentId: sammProjectId, seedKey: "victoria-sq-infrastructure/samm-projects/aihw-samm-scoping" });
  const vsq4 = make({ name: "Routine use of administrative data for SAMM", pmtLabel: "Victoria S&Q Infrastructure", kind: "sub-project", pmtStatus: "Open", fileStatus: "needs files", parentId: sammProjectId, seedKey: "victoria-sq-infrastructure/samm-projects/routine-use-of-administrative-data-for-samm" });
  const vsq5 = make({ name: "PSPI project", pmtLabel: "Victoria S&Q Infrastructure", kind: "project", pmtStatus: "Open", fileStatus: "needs files", seedKey: "victoria-sq-infrastructure/pspi-project" });

  // Private Hospital Surgical Governance and Auditing (2 rows)
  const ph1 = make({ name: "Epworth", pmtLabel: "Private Hospital Surgical Governance and Auditing", kind: "project", pmtStatus: "Active", fileStatus: "partial", seedKey: "private-hospital-surgical-governance/epworth" });
  const ph2 = make({ name: "Australian Government", pmtLabel: "Private Hospital Surgical Governance and Auditing", kind: "project", pmtStatus: "Open", fileStatus: "needs files", seedKey: "private-hospital-surgical-governance/australian-government" });

  return [bh1, bh2, bh3, bh4, bh5, vsq1, vsq2, vsq3, vsq4, vsq5, ph1, ph2];
}

describe("groupPmtItems", () => {
  it("returns exactly 3 labels in canonical seed order", () => {
    const rows = buildFixtureRows();
    const result = groupPmtItems(rows);
    expect(result.labels).toHaveLength(3);
    expect(result.labels[0].label).toBe("Bayside Health");
    expect(result.labels[1].label).toBe("Victoria S&Q Infrastructure");
    expect(result.labels[2].label).toBe("Private Hospital Surgical Governance and Auditing");
  });

  it("SAMM project has exactly 2 sub-projects nested under it", () => {
    const rows = buildFixtureRows();
    const result = groupPmtItems(rows);
    const vsqLabel = result.labels.find((l) => l.label === "Victoria S&Q Infrastructure")!;
    const sammEntry = vsqLabel.items.find((e) => e.project.name === "SAMM projects");
    expect(sammEntry).toBeTruthy();
    expect(sammEntry!.subProjects).toHaveLength(2);
    const subNames = sammEntry!.subProjects.map((sp) => sp.name).sort();
    expect(subNames).toContain("AIHW SAMM scoping");
    expect(subNames).toContain("Routine use of administrative data for SAMM");
  });

  it("needs-files count is 5", () => {
    const rows = buildFixtureRows();
    const result = groupPmtItems(rows);
    expect(result.totals.needsFiles).toBe(5);
  });

  it("total count is 12", () => {
    const rows = buildFixtureRows();
    const result = groupPmtItems(rows);
    expect(result.totals.total).toBe(12);
  });

  it("status counts match seed data", () => {
    const rows = buildFixtureRows();
    const result = groupPmtItems(rows);
    // Active: bh1,bh2,bh3,bh4 + vsq1 + vsq2 + ph1 = 7
    expect(result.totals.active).toBe(7);
    // Open: bh5 + vsq3 + vsq4 + vsq5 + ph2 = 5
    expect(result.totals.open).toBe(5);
    expect(result.totals.complete).toBe(0);
    expect(result.totals.parked).toBe(0);
  });

  it("Bayside Health orphan issues includes all 4 Bayside issues (no parent)", () => {
    const rows = buildFixtureRows();
    const result = groupPmtItems(rows);
    const bh = result.labels.find((l) => l.label === "Bayside Health")!;
    // Bayside Health issues have parentId=null so they are orphan issues.
    expect(bh.orphanIssues).toHaveLength(4);
  });

  it("Victoria S&Q Infrastructure orphan issue (Letter to Health Minister) is in orphanIssues", () => {
    const rows = buildFixtureRows();
    const result = groupPmtItems(rows);
    const vsq = result.labels.find((l) => l.label === "Victoria S&Q Infrastructure")!;
    expect(vsq.orphanIssues).toHaveLength(1);
    expect(vsq.orphanIssues[0].name).toBe("Letter to Health Minister");
  });

  it("file status counts in totals are correct", () => {
    const rows = buildFixtureRows();
    const result = groupPmtItems(rows);
    // partial: bh1,bh2,bh3,bh4 + vsq1 + vsq2 + ph1 = 7
    expect(result.totals.partial).toBe(7);
    // present: 0
    expect(result.totals.present).toBe(0);
  });

  it("handles an empty row list gracefully", () => {
    const result = groupPmtItems([]);
    expect(result.labels).toHaveLength(0);
    expect(result.totals.total).toBe(0);
  });

  it("groupPmtItems counts Complete in totals and per-label statusCounts", () => {
    const rows: PmtRow[] = [
      {
        id: 100,
        name: "Completed item",
        kind: "project",
        parentId: null,
        pmtLabel: "Bayside Health",
        pmtStatus: "Complete",
        nextAction: null,
        fileStatus: null,
        latestThreadUrl: null,
        pmtNotes: null,
        seedKey: null,
      },
    ];
    const result = groupPmtItems(rows);
    expect(result.totals.complete).toBe(1);
    expect(result.labels).toHaveLength(1);
    expect(result.labels[0].statusCounts["Complete"]).toBe(1);
  });

  it("groupPmtItems leaves items in seed order regardless of status", () => {
    const rows: PmtRow[] = [
      {
        id: 1,
        name: "Alpha",
        kind: "project",
        parentId: null,
        pmtLabel: "Bayside Health",
        pmtStatus: "Complete",
        nextAction: null,
        fileStatus: null,
        latestThreadUrl: null,
        pmtNotes: null,
        seedKey: null,
      },
      {
        id: 2,
        name: "Beta",
        kind: "issue",
        parentId: null,
        pmtLabel: "Bayside Health",
        pmtStatus: "Active",
        nextAction: null,
        fileStatus: null,
        latestThreadUrl: null,
        pmtNotes: null,
        seedKey: null,
      },
      {
        id: 3,
        name: "Gamma",
        kind: "project",
        parentId: null,
        pmtLabel: "Bayside Health",
        pmtStatus: "Open",
        nextAction: null,
        fileStatus: null,
        latestThreadUrl: null,
        pmtNotes: null,
        seedKey: null,
      },
    ];
    const result = groupPmtItems(rows);
    const bh = result.labels.find((l) => l.label === "Bayside Health")!;
    // projects: Alpha (Complete) at index 0, Gamma (Open) at index 1 — seed order preserved
    expect(bh.items[0].project.name).toBe("Alpha");
    expect(bh.items[1].project.name).toBe("Gamma");
    // orphan issues: Beta
    expect(bh.orphanIssues[0].name).toBe("Beta");
  });
});
