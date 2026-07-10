// filepath: test/focus-of-week.test.ts
// Stage 21 — Focus-of-week tier + daily focus action.
//
// Hermetic. Mirrors the CREATE TABLE + ALTER TABLE pattern from
// server/storage.ts (in-memory SQLite round-trips) plus source-text guards
// on server/routes.ts and the client pages, following test/pmt-routes.test.ts.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

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
`;

const DAILY_FOCUS_DDL = `
CREATE TABLE IF NOT EXISTS daily_focus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  focus_date TEXT NOT NULL UNIQUE,
  task_id INTEGER,
  project_id INTEGER,
  title TEXT NOT NULL,
  link_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_daily_focus_date ON daily_focus(focus_date);
`;

const ALTER_STMTS = ["ALTER TABLE projects ADD COLUMN focus_of_week_at INTEGER"];

function applyMigrations(db: Database.Database): void {
  db.exec(PROJECTS_DDL);
  for (const stmt of ALTER_STMTS) {
    try { db.exec(stmt); } catch { /* already exists */ }
  }
  db.exec(DAILY_FOCUS_DDL);
}

// Mirror of storage.setFocusOfWeek: sets focus_of_week_at to now (on) or null (off).
function setFocusOfWeek(db: Database.Database, id: number, on: boolean, now: number): void {
  db.prepare("UPDATE projects SET focus_of_week_at = ?, updated_at = ? WHERE id = ?")
    .run(on ? now : null, now, id);
}

// Mirror of storage.setDailyFocus: upsert on focus_date.
function setDailyFocus(
  db: Database.Database,
  input: { focusDate: string; title: string; taskId?: number | null; projectId?: number | null; linkUrl?: string | null },
  now: number,
): void {
  const existing = db.prepare("SELECT id FROM daily_focus WHERE focus_date = ?").get(input.focusDate) as { id: number } | undefined;
  if (existing) {
    db.prepare("UPDATE daily_focus SET task_id=?, project_id=?, title=?, link_url=?, updated_at=? WHERE id=?")
      .run(input.taskId ?? null, input.projectId ?? null, input.title, input.linkUrl ?? null, now, existing.id);
  } else {
    db.prepare("INSERT INTO daily_focus (focus_date, task_id, project_id, title, link_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(input.focusDate, input.taskId ?? null, input.projectId ?? null, input.title, input.linkUrl ?? null, now, now);
  }
}

describe("Focus-of-week migrations", () => {
  it("adds focus_of_week_at column and creates daily_focus table", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("focus_of_week_at");
    const dfCols = db.prepare("PRAGMA table_info(daily_focus)").all() as Array<{ name: string }>;
    const names = new Set(dfCols.map((c) => c.name));
    for (const col of ["focus_date", "task_id", "project_id", "title", "link_url"]) {
      expect(names, `expected daily_focus column ${col}`).toContain(col);
    }
  });

  it("is idempotent: applying migrations twice does not error", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    const cols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    // Column added exactly once.
    expect(cols.filter((c) => c.name === "focus_of_week_at")).toHaveLength(1);
  });
});

describe("setFocusOfWeek toggle", () => {
  it("sets focus_of_week_at on and clears it off", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = Date.now();
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO projects (name, status, priority, description, created_at, updated_at) VALUES (?,?,?,?,?,?)"
    ).run("P", "active", "high", "", now, now);
    const id = lastInsertRowid as number;

    // Initially null.
    let row = db.prepare("SELECT focus_of_week_at FROM projects WHERE id=?").get(id) as { focus_of_week_at: number | null };
    expect(row.focus_of_week_at).toBeNull();

    // On.
    setFocusOfWeek(db, id, true, now + 1);
    row = db.prepare("SELECT focus_of_week_at FROM projects WHERE id=?").get(id) as { focus_of_week_at: number | null };
    expect(row.focus_of_week_at).toBe(now + 1);

    // Off.
    setFocusOfWeek(db, id, false, now + 2);
    row = db.prepare("SELECT focus_of_week_at FROM projects WHERE id=?").get(id) as { focus_of_week_at: number | null };
    expect(row.focus_of_week_at).toBeNull();
  });
});

describe("daily_focus upsert uniqueness", () => {
  it("upsert on focus_date keeps a single row per date and updates it", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = Date.now();
    setDailyFocus(db, { focusDate: "2026-07-10", title: "First" }, now);
    setDailyFocus(db, { focusDate: "2026-07-10", title: "Second", projectId: 5 }, now + 1);

    const rows = db.prepare("SELECT title, project_id FROM daily_focus WHERE focus_date=?").all("2026-07-10") as Array<{ title: string; project_id: number | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Second");
    expect(rows[0].project_id).toBe(5);
  });

  it("enforces the UNIQUE constraint on a raw duplicate insert", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = Date.now();
    db.prepare("INSERT INTO daily_focus (focus_date, title, created_at, updated_at) VALUES (?,?,?,?)")
      .run("2026-07-10", "A", now, now);
    expect(() =>
      db.prepare("INSERT INTO daily_focus (focus_date, title, created_at, updated_at) VALUES (?,?,?,?)")
        .run("2026-07-10", "B", now, now),
    ).toThrow();
  });
});

describe("routes.ts source guards", () => {
  const routesSrc = readSrc("server/routes.ts");

  it("PATCH /api/projects/:id validates priority with invalid_priority", () => {
    expect(routesSrc).toContain("invalid_priority");
    expect(routesSrc).toContain('["high", "low"]');
  });

  it("PATCH routes focusOfWeek through storage.setFocusOfWeek", () => {
    expect(routesSrc).toContain("setFocusOfWeek");
    expect(routesSrc).toContain('"focusOfWeek" in req.body');
  });

  it("registers focus-of-week and daily-focus endpoints", () => {
    expect(routesSrc).toContain('"/api/projects/focus-of-week"');
    expect(routesSrc).toContain('"/api/daily-focus"');
  });

  it("registers focus-of-week BEFORE /api/projects/:id", () => {
    const focusIdx = routesSrc.indexOf('"/api/projects/focus-of-week"');
    const idIdx = routesSrc.indexOf('"/api/projects/:id"');
    expect(focusIdx).toBeGreaterThanOrEqual(0);
    expect(idIdx).toBeGreaterThanOrEqual(0);
    expect(focusIdx).toBeLessThan(idIdx);
  });
});

describe("client source guards", () => {
  it("Projects.tsx renders a Focus of the week group first", () => {
    const src = readSrc("client/src/pages/Projects.tsx");
    expect(src).toContain("Focus of the week");
    expect(src).toContain("focusOfWeekAt");
  });

  it("ProjectDetail.tsx offers the Focus of the week priority option", () => {
    const src = readSrc("client/src/pages/ProjectDetail.tsx");
    expect(src).toContain("Focus of the week");
    expect(src).toContain("focusOfWeek: true");
  });

  it("Today.tsx reads daily-focus and focus-of-week", () => {
    const src = readSrc("client/src/pages/Today.tsx");
    expect(src).toContain("/api/daily-focus");
    expect(src).toContain("/api/projects/focus-of-week");
    expect(src).toContain("Today's action");
  });
});
