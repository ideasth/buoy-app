// filepath: server/pmt-dashboard.ts
// Stage 20 — pure helper for PMT dashboard grouping logic.
// Exported as a standalone function so it can be called from storage helpers
// and also imported directly in tests without touching the DB.

export interface PmtRow {
  id: number;
  name: string;
  kind: string | null;
  parentId: number | null;
  pmtLabel: string | null;
  pmtStatus: string | null;
  nextAction: string | null;
  fileStatus: string | null;
  latestThreadUrl: string | null;
  pmtNotes: string | null;
  seedKey: string | null;
  // Remaining Project fields needed by callers (pass-through).
  [key: string]: unknown;
}

export interface LabeledProjectEntry {
  project: PmtRow;
  subProjects: PmtRow[];
  issues: PmtRow[];
}

export interface LabelGroup {
  label: string;
  items: LabeledProjectEntry[];
  orphanIssues: PmtRow[];
  statusCounts: Record<string, number>;
  fileStatusCounts: Record<string, number>;
}

export interface DashboardTotals {
  active: number;
  parked: number;
  complete: number;
  needsFiles: number;
  partial: number;
  present: number;
  total: number;
}

export interface DashboardShape {
  labels: LabelGroup[];
  totals: DashboardTotals;
}

// Canonical label order (seed order). Any label not in this list is sorted
// alphabetically after these.
const LABEL_ORDER = [
  "Bayside Health",
  "Victoria S&Q Infrastructure",
  "Private Hospital Surgical Governance and Auditing",
];

function labelSortKey(label: string): string {
  const idx = LABEL_ORDER.indexOf(label);
  // Pad with leading zeros so known labels sort before unknowns alphabetically.
  if (idx >= 0) return String(idx).padStart(4, "0");
  return "9999" + label.toLowerCase();
}

export function groupPmtItems(rows: PmtRow[]): DashboardShape {
  const totals: DashboardTotals = {
    active: 0, parked: 0, complete: 0,
    needsFiles: 0, partial: 0, present: 0, total: rows.length,
  };

  // Accumulate totals.
  for (const r of rows) {
    const ps = (r.pmtStatus ?? "").toLowerCase();
    // Treat any residual 'open' rows as 'active' (defence-in-depth; migration should prevent this).
    if (ps === "open" || ps === "active") totals.active++;
    else if (ps === "complete") totals.complete++;
    else if (ps === "parked") totals.parked++;

    const fs = (r.fileStatus ?? "").toLowerCase();
    if (fs === "needs files") totals.needsFiles++;
    else if (fs === "partial") totals.partial++;
    else if (fs === "present") totals.present++;
  }

  // Group by label.
  const labelMap = new Map<string, PmtRow[]>();
  for (const r of rows) {
    const lbl = r.pmtLabel ?? "(unlabelled)";
    if (!labelMap.has(lbl)) labelMap.set(lbl, []);
    labelMap.get(lbl)!.push(r);
  }

  // Build sorted label list.
  const labelKeys = [...labelMap.keys()].sort((a, b) =>
    labelSortKey(a).localeCompare(labelSortKey(b)),
  );

  const labels: LabelGroup[] = labelKeys.map((label) => {
    const labelRows = labelMap.get(label)!;

    // Index by id.
    const byId = new Map<number, PmtRow>();
    for (const r of labelRows) byId.set(r.id, r);

    // Separate by kind.
    const projectRows = labelRows.filter((r) => r.kind === "project");
    const subProjectRows = labelRows.filter((r) => r.kind === "sub-project");
    const issueRows = labelRows.filter((r) => r.kind === "issue");

    // Build project entries.
    const items: LabeledProjectEntry[] = projectRows.map((p) => ({
      project: p,
      subProjects: subProjectRows.filter((sp) => sp.parentId === p.id),
      issues: issueRows.filter((iss) => iss.parentId === p.id),
    }));

    // Orphan issues: kind === 'issue' with parent_id IS NULL.
    const orphanIssues = issueRows.filter((iss) => iss.parentId == null);

    // Per-label status counts.
    const statusCounts: Record<string, number> = {};
    const fileStatusCounts: Record<string, number> = {};
    for (const r of labelRows) {
      const ps = r.pmtStatus ?? "unknown";
      statusCounts[ps] = (statusCounts[ps] ?? 0) + 1;
      const fs = r.fileStatus ?? "unknown";
      fileStatusCounts[fs] = (fileStatusCounts[fs] ?? 0) + 1;
    }

    return { label, items, orphanIssues, statusCounts, fileStatusCounts };
  });

  // Note: Complete items are sorted last in the UI (PmtDashboard.tsx);
  // the helper preserves insertion order here.
  return { labels, totals };
}
