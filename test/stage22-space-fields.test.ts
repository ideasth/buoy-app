// filepath: test/stage22-space-fields.test.ts
// Stage 22 — PMT status ordering fix + first-class space fields + action-note
// thread pointers.
//
// Hermetic, mirroring test/focus-of-week.test.ts: in-memory SQLite round-trips
// for the additive migrations plus source-text guards on server/routes.ts and
// client/src/pages/ProjectDetail.tsx. No server boot required.

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
  pmt_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

const ACTION_NOTES_DDL = `
CREATE TABLE IF NOT EXISTS project_action_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER NOT NULL,
  note_date TEXT NOT NULL,
  body TEXT NOT NULL,
  source_url TEXT,
  source_label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

// Mirror of the Stage 22 additive ALTERs in server/storage.ts.
const ALTER_STMTS = [
  "ALTER TABLE projects ADD COLUMN space_name TEXT",
  "ALTER TABLE projects ADD COLUMN space_url TEXT",
  "ALTER TABLE project_action_notes ADD COLUMN thread_name TEXT",
  "ALTER TABLE project_action_notes ADD COLUMN thread_url TEXT",
];

function applyMigrations(db: Database.Database): void {
  db.exec(PROJECTS_DDL);
  db.exec(ACTION_NOTES_DDL);
  for (const stmt of ALTER_STMTS) {
    try { db.exec(stmt); } catch { /* already exists */ }
  }
  // Mirror of the idempotent Open -> Active data migration.
  try {
    db.prepare(`UPDATE projects SET pmt_status='Active' WHERE pmt_status='Open'`).run();
  } catch { /* column absent */ }
}

// Mirror of the spaceUrl / threadUrl validation used in server/routes.ts.
function isBlankOrValidUrl(v: unknown): boolean {
  if (v == null || v === "") return true;
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

describe("Stage 22 migrations", () => {
  it("adds space_name/space_url to projects and thread_name/thread_url to action notes", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const projCols = (db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(projCols).toContain("space_name");
    expect(projCols).toContain("space_url");
    const noteCols = (db.prepare("PRAGMA table_info(project_action_notes)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(noteCols).toContain("thread_name");
    expect(noteCols).toContain("thread_url");
  });

  it("is idempotent: re-applying (re-open) does not error and adds each column once", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    const projCols = (db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(projCols.filter((n) => n === "space_name")).toHaveLength(1);
    expect(projCols.filter((n) => n === "space_url")).toHaveLength(1);
  });
});

describe("Space fields round-trip", () => {
  it("PATCH-equivalent stores spaceName + spaceUrl and a GET-equivalent returns them", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = Date.now();
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO projects (name, created_at, updated_at) VALUES (?,?,?)"
    ).run("P", now, now);
    const id = lastInsertRowid as number;

    db.prepare("UPDATE projects SET space_name=?, space_url=? WHERE id=?")
      .run("Design space", "https://example.com/space", id);
    const row = db.prepare("SELECT space_name, space_url FROM projects WHERE id=?").get(id) as { space_name: string | null; space_url: string | null };
    expect(row.space_name).toBe("Design space");
    expect(row.space_url).toBe("https://example.com/space");
  });

  it("empty spaceUrl/spaceName clear to null", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = Date.now();
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO projects (name, space_name, space_url, created_at, updated_at) VALUES (?,?,?,?,?)"
    ).run("P", "Old", "https://example.com", now, now);
    const id = lastInsertRowid as number;
    db.prepare("UPDATE projects SET space_name=?, space_url=? WHERE id=?").run(null, null, id);
    const row = db.prepare("SELECT space_name, space_url FROM projects WHERE id=?").get(id) as { space_name: string | null; space_url: string | null };
    expect(row.space_name).toBeNull();
    expect(row.space_url).toBeNull();
  });
});

describe("spaceUrl / threadUrl validation (mirror of routes.ts)", () => {
  it("accepts blank/null and absolute http(s) URLs", () => {
    expect(isBlankOrValidUrl(null)).toBe(true);
    expect(isBlankOrValidUrl("")).toBe(true);
    expect(isBlankOrValidUrl("https://example.com/x")).toBe(true);
    expect(isBlankOrValidUrl("http://example.com")).toBe(true);
  });

  it("rejects non-http(s) and malformed URLs", () => {
    expect(isBlankOrValidUrl("ftp://example.com")).toBe(false);
    expect(isBlankOrValidUrl("javascript:alert(1)")).toBe(false);
    expect(isBlankOrValidUrl("not a url")).toBe(false);
    expect(isBlankOrValidUrl("example.com")).toBe(false);
  });
});

describe("Action-note thread fields round-trip", () => {
  it("stores threadName + threadUrl and returns them on a list-equivalent read", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = Date.now();
    db.prepare(
      "INSERT INTO project_action_notes (action_id, note_date, body, thread_name, thread_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
    ).run(1, "2026-07-10", "did a thing", "Slack thread", "https://slack.example/thread/1", now, now);
    const row = db.prepare("SELECT thread_name, thread_url FROM project_action_notes WHERE action_id=?").get(1) as { thread_name: string | null; thread_url: string | null };
    expect(row.thread_name).toBe("Slack thread");
    expect(row.thread_url).toBe("https://slack.example/thread/1");
  });
});

describe("Legacy pmtStatus Open -> Active migration", () => {
  it("migrates a seeded Open row to Active on (re-)open", () => {
    const db = new Database(":memory:");
    // First open: seed a legacy row with Open before the migration runs.
    db.exec(PROJECTS_DDL);
    const now = Date.now();
    db.prepare("INSERT INTO projects (name, pmt_status, created_at, updated_at) VALUES (?,?,?,?)")
      .run("Legacy", "Open", now, now);
    // Re-open: run the full idempotent migration set.
    applyMigrations(db);
    const row = db.prepare("SELECT pmt_status FROM projects WHERE name=?").get("Legacy") as { pmt_status: string | null };
    expect(row.pmt_status).toBe("Active");
  });

  it("leaves Active/Parked/Complete untouched", () => {
    const db = new Database(":memory:");
    db.exec(PROJECTS_DDL);
    const now = Date.now();
    for (const s of ["Active", "Parked", "Complete"]) {
      db.prepare("INSERT INTO projects (name, pmt_status, created_at, updated_at) VALUES (?,?,?,?)").run(s, s, now, now);
    }
    applyMigrations(db);
    for (const s of ["Active", "Parked", "Complete"]) {
      const row = db.prepare("SELECT pmt_status FROM projects WHERE name=?").get(s) as { pmt_status: string | null };
      expect(row.pmt_status).toBe(s);
    }
  });
});

describe("server/routes.ts source guards", () => {
  const src = readSrc("server/routes.ts");

  it("PATCH /api/projects/:id accepts spaceName/spaceUrl and validates the URL", () => {
    expect(src).toContain('"spaceName"');
    expect(src).toContain('"spaceUrl"');
    expect(src).toContain("invalid_space_url");
  });

  it("action-note routes accept threadName/threadUrl and validate the URL", () => {
    expect(src).toContain('"threadName"');
    expect(src).toContain('"threadUrl"');
    expect(src).toContain("invalid_thread_url");
  });

  it("still restricts pmtStatus to Active|Parked|Complete (no Open)", () => {
    expect(src).toContain('["Active", "Parked", "Complete"].includes(updates.pmtStatus)');
  });
});

describe("server/storage.ts source guards", () => {
  const src = readSrc("server/storage.ts");

  it("declares the Stage 22 additive ALTERs", () => {
    expect(src).toContain("ALTER TABLE projects ADD COLUMN space_name TEXT");
    expect(src).toContain("ALTER TABLE projects ADD COLUMN space_url TEXT");
    expect(src).toContain("ALTER TABLE project_action_notes ADD COLUMN thread_name TEXT");
    expect(src).toContain("ALTER TABLE project_action_notes ADD COLUMN thread_url TEXT");
  });

  it("runs the idempotent Open -> Active data migration", () => {
    expect(src).toContain("UPDATE projects SET pmt_status='Active' WHERE pmt_status='Open'");
  });

  it("createActionNote persists threadName/threadUrl", () => {
    expect(src).toContain("threadName: input.threadName ?? null");
    expect(src).toContain("threadUrl: input.threadUrl ?? null");
  });
});

describe("client/src/pages/ProjectDetail.tsx source guards", () => {
  const src = readSrc("client/src/pages/ProjectDetail.tsx");

  it("removes the generic select-status control", () => {
    expect(src).not.toContain('data-testid="select-status"');
  });

  it("surfaces select-pmt-status ungated, ordered above select-priority", () => {
    expect(src).not.toContain("pmtLabel != null");
    const pmtIdx = src.indexOf('data-testid="select-pmt-status"');
    const prioIdx = src.indexOf('data-testid="select-priority"');
    expect(pmtIdx).toBeGreaterThanOrEqual(0);
    expect(prioIdx).toBeGreaterThanOrEqual(0);
    expect(pmtIdx).toBeLessThan(prioIdx);
  });

  it("renders an editable Space area with name + url inputs and a link", () => {
    expect(src).toContain('data-testid="space-box"');
    expect(src).toContain('data-testid="input-space-name"');
    expect(src).toContain('data-testid="input-space-url"');
    expect(src).toContain('data-testid="link-space"');
    expect(src).toContain("No space linked yet.");
  });

  it("adds thread name + url inputs to the add-action-note form", () => {
    expect(src).toContain("input-action-note-thread-name-");
    expect(src).toContain("input-action-note-thread-url-");
  });

  it("renders an existing action note thread as a clickable link", () => {
    expect(src).toContain("action-note-thread-");
    expect(src).toContain("n.threadUrl");
  });
});
