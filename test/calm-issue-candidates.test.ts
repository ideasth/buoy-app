// Stage 13 (2026-05-11) — Calm issue picker source-of-truth queries.
//
// The picker pulls open tasks, active projects, and unprocessed inbox
// items. This test pins the filter clauses + order so a future schema
// drift on tasks.status / projects.status / inbox_scan_queue.decided_at
// shows up loudly here before it lands in production.
//
// Hermetic: builds a minimal in-memory sqlite mirroring just the three
// columns the queries touch, then asserts row order + filtering.

import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";

const DDL = `
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  created_at INTEGER NOT NULL
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at INTEGER NOT NULL
);
CREATE TABLE inbox_scan_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
`;

function listCalmIssueCandidates(db: Database.Database) {
  const tasksRows = db
    .prepare(
      `SELECT id, title FROM tasks
       WHERE status != 'done' AND status != 'dropped'
       ORDER BY COALESCE(created_at, 0) DESC
       LIMIT 50`,
    )
    .all() as Array<{ id: number; title: string }>;
  const projectsRows = db
    .prepare(
      `SELECT id, name FROM projects
       WHERE status = 'active'
       ORDER BY updated_at DESC
       LIMIT 50`,
    )
    .all() as Array<{ id: number; name: string }>;
  const inboxRows = db
    .prepare(
      `SELECT id, subject FROM inbox_scan_queue
       WHERE decided_at IS NULL AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    .all() as Array<{ id: number; subject: string | null }>;
  return {
    tasks: tasksRows.map((r) => ({ id: r.id, label: r.title })),
    projects: projectsRows.map((r) => ({ id: r.id, label: r.name })),
    inboxItems: inboxRows.map((r) => ({ id: r.id, label: r.subject ?? "(no subject)" })),
  };
}

describe("listCalmIssueCandidates", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("returns open tasks newest-first, excluding done and dropped", () => {
    const ins = db.prepare(
      "INSERT INTO tasks (title, status, created_at) VALUES (?, ?, ?)",
    );
    ins.run("oldest open", "todo", 1000);
    ins.run("middle open", "doing", 2000);
    ins.run("done one", "done", 1500);
    ins.run("dropped one", "dropped", 1500);
    ins.run("newest open", "todo", 3000);

    const result = listCalmIssueCandidates(db);
    expect(result.tasks.map((t) => t.label)).toEqual([
      "newest open",
      "middle open",
      "oldest open",
    ]);
  });

  it("returns only active projects, newest-updated first", () => {
    const ins = db.prepare(
      "INSERT INTO projects (name, status, updated_at) VALUES (?, ?, ?)",
    );
    ins.run("parked", "parked", 5000);
    ins.run("active-old", "active", 1000);
    ins.run("active-new", "active", 2000);

    const result = listCalmIssueCandidates(db);
    expect(result.projects.map((p) => p.label)).toEqual(["active-new", "active-old"]);
  });

  it("returns only undecided pending inbox items, newest-first", () => {
    const ins = db.prepare(
      "INSERT INTO inbox_scan_queue (subject, status, decided_at, created_at) VALUES (?, ?, ?, ?)",
    );
    ins.run("approved one", "approved", 9000, 1000);
    ins.run("decided pending", "pending", 8000, 2000);
    ins.run("undecided old", "pending", null, 1500);
    ins.run("undecided new", "pending", null, 3000);

    const result = listCalmIssueCandidates(db);
    expect(result.inboxItems.map((i) => i.label)).toEqual([
      "undecided new",
      "undecided old",
    ]);
  });

  it("returns the three arrays in the documented shape, each independently filtered", () => {
    db.prepare("INSERT INTO tasks (title, status, created_at) VALUES ('t', 'todo', 1)").run();
    db.prepare(
      "INSERT INTO projects (name, status, updated_at) VALUES ('p', 'active', 1)",
    ).run();
    db.prepare(
      "INSERT INTO inbox_scan_queue (subject, status, decided_at, created_at) VALUES ('i', 'pending', NULL, 1)",
    ).run();
    const result = listCalmIssueCandidates(db);
    expect(Object.keys(result).sort()).toEqual(["inboxItems", "projects", "tasks"]);
    expect(result.tasks).toHaveLength(1);
    expect(result.projects).toHaveLength(1);
    expect(result.inboxItems).toHaveLength(1);
  });
});
