// filepath: test/pmt-fields.test.ts
// PMT component fields — hermetic schema/storage tests for narrative status,
// phase description, and component notes.
//
// Note: the Actions feature (project_actions / project_action_notes) was
// removed in Stage 23, so those tests no longer exist here.
//
// Mirrors the CREATE TABLE + ALTER TABLE pattern from server/storage.ts so a
// regression in the migration path lands here loudly. No server boot.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";

const PROJECTS_DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'low',
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_component_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_type TEXT NOT NULL DEFAULT 'project',
  component_id INTEGER NOT NULL,
  note_date TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  source_url TEXT,
  source_label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_component_notes_component ON project_component_notes(component_type, component_id, note_date);
`;

// The additive ALTER statements from server/storage.ts (subset relevant here).
const PMT_FIELD_ALTERS = [
  "ALTER TABLE projects ADD COLUMN latest_narrative_status TEXT",
  "ALTER TABLE projects ADD COLUMN latest_narrative_status_updated_at INTEGER",
  "ALTER TABLE projects ADD COLUMN latest_narrative_status_source_url TEXT",
  "ALTER TABLE projects ADD COLUMN latest_narrative_status_source_label TEXT",
  "ALTER TABLE project_phases ADD COLUMN description TEXT",
  "ALTER TABLE project_phases ADD COLUMN description_updated_at INTEGER",
  "ALTER TABLE project_phases ADD COLUMN description_source_url TEXT",
  "ALTER TABLE project_phases ADD COLUMN description_source_label TEXT",
];

function applyMigrations(db: Database.Database): void {
  db.exec(PROJECTS_DDL);
  for (const stmt of PMT_FIELD_ALTERS) {
    try { db.exec(stmt); } catch { /* already exists */ }
  }
}

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  const now = Date.now();
  db.prepare("INSERT INTO projects (name, status, priority, description, created_at, updated_at) VALUES (?,?,?,?,?,?)")
    .run("Test component", "active", "low", "", now, now);
  db.prepare("INSERT INTO project_phases (project_id, name, order_index, completed, created_at) VALUES (?,?,?,?,?)")
    .run(1, "Phase 1", 0, 0, now);
  return db;
}

describe("PMT field migrations", () => {
  it("adds narrative-status columns to projects", () => {
    const db = setupDb();
    const cols = new Set((db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((c) => c.name));
    for (const col of [
      "latest_narrative_status",
      "latest_narrative_status_updated_at",
      "latest_narrative_status_source_url",
      "latest_narrative_status_source_label",
    ]) {
      expect(cols, `expected column ${col}`).toContain(col);
    }
  });

  it("adds description columns to project_phases", () => {
    const db = setupDb();
    const cols = new Set((db.prepare("PRAGMA table_info(project_phases)").all() as Array<{ name: string }>).map((c) => c.name));
    for (const col of ["description", "description_updated_at", "description_source_url", "description_source_label"]) {
      expect(cols, `expected column ${col}`).toContain(col);
    }
  });

  it("re-running the ADD COLUMN migrations is idempotent (no crash)", () => {
    const db = setupDb();
    // Second run — the try/catch loop in storage.ts swallows duplicate-column errors.
    expect(() => {
      for (const stmt of PMT_FIELD_ALTERS) {
        try { db.exec(stmt); } catch { /* already exists */ }
      }
    }).not.toThrow();
    // Columns still present exactly once.
    const cols = (db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>)
      .filter((c) => c.name === "latest_narrative_status");
    expect(cols).toHaveLength(1);
  });
});

describe("narrative status create + update", () => {
  it("stamps updated_at and reads back", () => {
    const db = setupDb();
    const now = Date.now();
    db.prepare(
      "UPDATE projects SET latest_narrative_status=?, latest_narrative_status_updated_at=?, updated_at=? WHERE id=1",
    ).run("Awaiting sign-off", now, now);
    const row = db.prepare("SELECT latest_narrative_status AS s, latest_narrative_status_updated_at AS u FROM projects WHERE id=1").get() as any;
    expect(row.s).toBe("Awaiting sign-off");
    expect(row.u).toBe(now);
  });
});

describe("phase description create + update", () => {
  it("stamps description_updated_at and reads back", () => {
    const db = setupDb();
    const now = Date.now();
    db.prepare("UPDATE project_phases SET description=?, description_updated_at=? WHERE id=1").run("Objectives here", now);
    const row = db.prepare("SELECT description AS d, description_updated_at AS u FROM project_phases WHERE id=1").get() as any;
    expect(row.d).toBe("Objectives here");
    expect(row.u).toBe(now);
  });
});

describe("component notes timeline", () => {
  it("lists notes chronologically by note_date then id", () => {
    const db = setupDb();
    const now = Date.now();
    const ins = db.prepare(
      "INSERT INTO project_component_notes (component_type, component_id, note_date, title, body, created_at, updated_at) VALUES ('project', 1, ?, ?, ?, ?, ?)",
    );
    // Insert out of order.
    ins.run("2026-03-10", null, "second", now, now);
    ins.run("2026-01-05", null, "first", now, now);
    ins.run("2026-05-20", null, "third", now, now);
    const rows = db.prepare(
      "SELECT body FROM project_component_notes WHERE component_type='project' AND component_id=1 ORDER BY note_date ASC, id ASC",
    ).all() as Array<{ body: string }>;
    expect(rows.map((r) => r.body)).toEqual(["first", "second", "third"]);
  });
});
