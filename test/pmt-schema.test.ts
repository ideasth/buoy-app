// filepath: test/pmt-schema.test.ts
// Stage 20 — PMT schema migrations + seed.
//
// Hermetic. Mirrors the CREATE TABLE + ALTER TABLE + seed pattern from
// server/storage.ts so a regression in either lands here loudly.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";

const PROJECTS_DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ms_todo_list_id TEXT UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'low',
  description TEXT NOT NULL DEFAULT '',
  current_phase_id INTEGER,
  next_action_task_id INTEGER,
  current_income_per_hour INTEGER,
  future_income_estimate INTEGER,
  is_primary_future_income INTEGER NOT NULL DEFAULT 0,
  community_benefit INTEGER,
  professional_kudos INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
`;

const PMT_ALTER_STMTS = [
  "ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'project'",
  "ALTER TABLE projects ADD COLUMN parent_id INTEGER",
  "ALTER TABLE projects ADD COLUMN pmt_label TEXT",
  "ALTER TABLE projects ADD COLUMN pmt_status TEXT",
  "ALTER TABLE projects ADD COLUMN next_action TEXT",
  "ALTER TABLE projects ADD COLUMN file_status TEXT",
  "ALTER TABLE projects ADD COLUMN latest_thread_url TEXT",
  "ALTER TABLE projects ADD COLUMN pmt_notes TEXT",
  "ALTER TABLE projects ADD COLUMN seed_key TEXT",
];

const PMT_INDEX_STMTS = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_seed_key ON projects(seed_key) WHERE seed_key IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_projects_pmt_label ON projects(pmt_label)",
  "CREATE INDEX IF NOT EXISTS idx_projects_parent_id ON projects(parent_id)",
];

function applyProjectsMigrations(db: Database.Database): void {
  db.exec(PROJECTS_DDL);
  for (const stmt of PMT_ALTER_STMTS) {
    try { db.exec(stmt); } catch { /* already exists */ }
  }
  for (const stmt of PMT_INDEX_STMTS) {
    try { db.exec(stmt); } catch { /* already exists */ }
  }
}

function applySeed(db: Database.Database): void {
  const now = Date.now();
  const pmtInsert = db.prepare(`
    INSERT OR IGNORE INTO projects
      (name, status, priority, description, kind, parent_id, pmt_label, pmt_status,
       next_action, file_status, latest_thread_url, pmt_notes, seed_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    // Bayside Health
    pmtInsert.run('Peninsula Health Formal complaint', 'active', 'low', '', 'issue', null, 'Bayside Health', 'Active', 'Confirm current complaint pack, supporting correspondence, and deadline/status in thread notes.', 'partial', 'bayside-health/peninsula-health-formal-complaint', now, now);
    pmtInsert.run('Monash Health Formal complaint and CEO escalation', 'active', 'low', '', 'issue', null, 'Bayside Health', 'Active', 'Confirm complaint documents and CEO-escalation bundle are linked and current.', 'partial', 'bayside-health/monash-health-formal-complaint-and-ceo-escalation', now, now);
    pmtInsert.run('FTE and duties at Sandringham Hospital', 'active', 'low', '', 'issue', null, 'Bayside Health', 'Active', 'Confirm current FTE/duties document and identify required follow-up action.', 'partial', 'bayside-health/fte-and-duties-at-sandringham-hospital', now, now);
    pmtInsert.run("Bayside Health CEO Escalation (initial and further) re: Women's Health leadership and governance", 'active', 'low', '', 'issue', null, 'Bayside Health', 'Active', 'Confirm all escalation correspondence and governance notes are linked.', 'partial', 'bayside-health/bayside-health-ceo-escalation', now, now);
    pmtInsert.run('Bayside Health LHSN pelvic floor service proposal', 'active', 'low', '', 'project', null, 'Bayside Health', 'Open', 'Create or import proposal base document into the Space and link the canonical thread.', 'needs files', 'bayside-health/lhsn-pelvic-floor-service-proposal', now, now);
    // Victoria S&Q Infrastructure
    pmtInsert.run('Letter to Health Minister re: concerns regarding the Department of Health restructure and risks to patient safety, safety governance and statewide quality improvement', 'active', 'low', '', 'issue', null, 'Victoria S&Q Infrastructure', 'Active', 'Confirm current letter draft/final and any response-tracking material.', 'partial', 'victoria-sq-infrastructure/letter-to-health-minister-department-restructure', now, now);
    pmtInsert.run('SAMM projects', 'active', 'low', '', 'project', null, 'Victoria S&Q Infrastructure', 'Active', null, 'partial', 'victoria-sq-infrastructure/samm-projects', now, now);
    const sammRow = db.prepare("SELECT id FROM projects WHERE seed_key = 'victoria-sq-infrastructure/samm-projects'").get() as { id: number } | undefined;
    const sammId = sammRow?.id ?? null;
    pmtInsert.run('AIHW SAMM scoping', 'active', 'low', '', 'sub-project', sammId, 'Victoria S&Q Infrastructure', 'Open', 'Create or import a scoping note and link the canonical discussion thread.', 'needs files', 'victoria-sq-infrastructure/samm-projects/aihw-samm-scoping', now, now);
    pmtInsert.run('Routine use of administrative data for SAMM', 'active', 'low', '', 'sub-project', sammId, 'Victoria S&Q Infrastructure', 'Open', 'Create or import a concept note and define the first concrete analysis step.', 'needs files', 'victoria-sq-infrastructure/samm-projects/routine-use-of-administrative-data-for-samm', now, now);
    pmtInsert.run('PSPI project', 'active', 'low', '', 'project', null, 'Victoria S&Q Infrastructure', 'Open', 'Create or import a project outline and link the current thread.', 'needs files', 'victoria-sq-infrastructure/pspi-project', now, now);
    // Private Hospital Surgical Governance and Auditing
    pmtInsert.run('Epworth', 'active', 'low', '', 'project', null, 'Private Hospital Surgical Governance and Auditing', 'Active', 'Confirm current governance/audit files and define the next concrete step.', 'partial', 'private-hospital-surgical-governance/epworth', now, now);
    pmtInsert.run('Australian Government', 'active', 'low', '', 'project', null, 'Private Hospital Surgical Governance and Auditing', 'Open', 'Create or import a project stub and identify the first deliverable.', 'needs files', 'private-hospital-surgical-governance/australian-government', now, now);
  });
  tx();
}

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  applyProjectsMigrations(db);
  applySeed(db);
  return db;
}

describe("PMT schema migrations", () => {
  it("creates the PMT columns via ALTER TABLE", () => {
    const db = setupDb();
    const cols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    for (const col of [
      "kind", "parent_id", "pmt_label", "pmt_status", "next_action",
      "file_status", "latest_thread_url", "pmt_notes", "seed_key",
    ]) {
      expect(names, `expected column ${col}`).toContain(col);
    }
  });

  it("creates the UNIQUE seed_key index", () => {
    const db = setupDb();
    const indexes = db.prepare("PRAGMA index_list(projects)").all() as Array<{ name: string; unique: number }>;
    const seedKeyIndex = indexes.find((i) => i.name === "idx_projects_seed_key");
    expect(seedKeyIndex, "idx_projects_seed_key index should exist").toBeTruthy();
    expect(seedKeyIndex!.unique).toBe(1);
  });

  it("seeds all 12 PMT rows", () => {
    const db = setupDb();
    const { c } = db.prepare("SELECT COUNT(*) AS c FROM projects WHERE pmt_label IS NOT NULL").get() as { c: number };
    expect(c).toBe(12);
  });

  it("seeds rows with correct pmt_label, kind, pmt_status, file_status", () => {
    const db = setupDb();
    const rows = db.prepare(
      "SELECT name, pmt_label, kind, pmt_status, file_status FROM projects WHERE pmt_label IS NOT NULL ORDER BY seed_key"
    ).all() as Array<{ name: string; pmt_label: string; kind: string; pmt_status: string; file_status: string }>;

    const peninsula = rows.find((r) => r.name === "Peninsula Health Formal complaint");
    expect(peninsula).toBeTruthy();
    expect(peninsula!.pmt_label).toBe("Bayside Health");
    expect(peninsula!.kind).toBe("issue");
    expect(peninsula!.pmt_status).toBe("Active");
    expect(peninsula!.file_status).toBe("partial");

    const lhsn = rows.find((r) => r.name === "Bayside Health LHSN pelvic floor service proposal");
    expect(lhsn).toBeTruthy();
    expect(lhsn!.pmt_status).toBe("Open");
    expect(lhsn!.file_status).toBe("needs files");
    expect(lhsn!.kind).toBe("project");

    const samm = rows.find((r) => r.name === "SAMM projects");
    expect(samm).toBeTruthy();
    expect(samm!.kind).toBe("project");
    expect(samm!.pmt_label).toBe("Victoria S&Q Infrastructure");

    const epworth = rows.find((r) => r.name === "Epworth");
    expect(epworth).toBeTruthy();
    expect(epworth!.pmt_label).toBe("Private Hospital Surgical Governance and Auditing");
    expect(epworth!.kind).toBe("project");
    expect(epworth!.pmt_status).toBe("Active");
    expect(epworth!.file_status).toBe("partial");
  });

  it("SAMM sub-projects have parent_id pointing to the SAMM project row", () => {
    const db = setupDb();
    const samm = db.prepare("SELECT id FROM projects WHERE seed_key = 'victoria-sq-infrastructure/samm-projects'").get() as { id: number };
    expect(samm).toBeTruthy();
    const subProjects = db.prepare(
      "SELECT name, parent_id FROM projects WHERE kind = 'sub-project' AND pmt_label = 'Victoria S&Q Infrastructure'"
    ).all() as Array<{ name: string; parent_id: number }>;
    expect(subProjects).toHaveLength(2);
    for (const sp of subProjects) {
      expect(sp.parent_id).toBe(samm.id);
    }
  });

  it("running the seed twice produces no duplicates (still exactly 12 PMT rows)", () => {
    const db = new Database(":memory:");
    applyProjectsMigrations(db);
    applySeed(db);
    applySeed(db); // second run
    const { c } = db.prepare("SELECT COUNT(*) AS c FROM projects WHERE pmt_label IS NOT NULL").get() as { c: number };
    expect(c).toBe(12);
  });
});
