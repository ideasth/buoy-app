// filepath: test/stage23-notes-thread.test.ts
// Stage 23 — Remove the Actions feature; Notes-timeline thread URL with a
// server-fetched page title.
//
// Fully hermetic and OFFLINE: the title fetch is stubbed via the injectable
// `fetcher` argument to resolveNoteSource, so no network is ever touched. The
// boot migration is mirrored on an in-memory SQLite db, and source-text guards
// confirm routes.ts / storage.ts wire everything up.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join } from "path";
import {
  resolveNoteSource,
  isAbsoluteHttpUrl,
  extractTitleFromHtml,
  normaliseTitle,
} from "../server/thread-title";

const ROOT = join(__dirname, "..");
function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

// A deterministic offline title source. Records the URL it was asked for.
function stubFetcher(title: string | null): (url: string) => Promise<string | null> {
  return async () => title;
}

describe("resolveNoteSource — thread pointer create logic (offline)", () => {
  it("stores the URL and the fetched title for a valid absolute http(s) URL", async () => {
    const res = await resolveNoteSource(
      "https://example.com/thread/42",
      stubFetcher("Example Thread Title"),
    );
    expect(res.ok).toBe(true);
    expect(res.sourceUrl).toBe("https://example.com/thread/42");
    expect(res.sourceLabel).toBe("Example Thread Title");
  });

  it("still stores the URL when the title fetch fails (label null)", async () => {
    const res = await resolveNoteSource(
      "https://example.com/thread/99",
      stubFetcher(null),
    );
    expect(res.ok).toBe(true);
    expect(res.sourceUrl).toBe("https://example.com/thread/99");
    expect(res.sourceLabel).toBeNull();
  });

  it("rejects a non-http(s) / malformed URL with invalid_source_url", async () => {
    for (const bad of ["ftp://example.com", "javascript:alert(1)", "not a url", "example.com"]) {
      const res = await resolveNoteSource(bad, stubFetcher("should not be used"));
      expect(res.ok, `expected ${bad} to be rejected`).toBe(false);
      expect(res.error).toBe("invalid_source_url");
      expect(res.sourceUrl).toBeNull();
      expect(res.sourceLabel).toBeNull();
    }
  });

  it("clears both fields when the URL is empty or null", async () => {
    for (const empty of ["", "   ", null, undefined]) {
      const res = await resolveNoteSource(empty, stubFetcher("unused"));
      expect(res.ok).toBe(true);
      expect(res.sourceUrl).toBeNull();
      expect(res.sourceLabel).toBeNull();
    }
  });

  it("does not invoke the fetcher for empty or invalid URLs", async () => {
    let called = 0;
    const counting = async () => { called += 1; return "x"; };
    await resolveNoteSource("", counting);
    await resolveNoteSource("not a url", counting);
    expect(called).toBe(0);
  });
});

describe("thread-title helpers (offline)", () => {
  it("isAbsoluteHttpUrl accepts http(s) and rejects everything else", () => {
    expect(isAbsoluteHttpUrl("http://x.com")).toBe(true);
    expect(isAbsoluteHttpUrl("https://x.com/y")).toBe(true);
    expect(isAbsoluteHttpUrl("")).toBe(false);
    expect(isAbsoluteHttpUrl(null)).toBe(false);
    expect(isAbsoluteHttpUrl("ftp://x.com")).toBe(false);
    expect(isAbsoluteHttpUrl("mailto:a@b.com")).toBe(false);
  });

  it("extractTitleFromHtml prefers <title>, falls back to og:title", () => {
    expect(extractTitleFromHtml("<html><head><title>Hello World</title></head></html>"))
      .toBe("Hello World");
    expect(extractTitleFromHtml('<meta property="og:title" content="OG Only">'))
      .toBe("OG Only");
    expect(extractTitleFromHtml("<html><body>no title here</body></html>"))
      .toBeNull();
  });

  it("normaliseTitle collapses whitespace, decodes entities, and caps length", () => {
    expect(normaliseTitle("  a\n  b\t c ")).toBe("a b c");
    expect(normaliseTitle("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(normaliseTitle("x".repeat(500)).length).toBe(200);
  });
});

// ----- Boot migration: drop the Actions tables idempotently -----

const ACTIONS_DDL = `
CREATE TABLE IF NOT EXISTS project_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_type TEXT NOT NULL DEFAULT 'project',
  component_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_action_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER NOT NULL,
  note_date TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

// Mirror of the Stage 23 boot migration in server/storage.ts.
function dropActionTables(db: Database.Database): void {
  db.exec(`DROP TABLE IF EXISTS project_action_notes;`);
  db.exec(`DROP TABLE IF EXISTS project_actions;`);
}

function tableNames(db: Database.Database): Set<string> {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map((r) => r.name),
  );
}

describe("Stage 23 boot migration — drops the Actions tables", () => {
  it("drops project_actions and project_action_notes when present", () => {
    const db = new Database(":memory:");
    db.exec(ACTIONS_DDL);
    expect(tableNames(db).has("project_actions")).toBe(true);
    expect(tableNames(db).has("project_action_notes")).toBe(true);
    dropActionTables(db);
    const names = tableNames(db);
    expect(names.has("project_actions")).toBe(false);
    expect(names.has("project_action_notes")).toBe(false);
  });

  it("is idempotent: re-running on a db without the tables does not throw", () => {
    const db = new Database(":memory:");
    // No action tables at all.
    expect(() => dropActionTables(db)).not.toThrow();
    // And re-running after a create+drop is also safe.
    db.exec(ACTIONS_DDL);
    dropActionTables(db);
    expect(() => dropActionTables(db)).not.toThrow();
    const names = tableNames(db);
    expect(names.has("project_actions")).toBe(false);
    expect(names.has("project_action_notes")).toBe(false);
  });
});

// ----- Source-text guards -----

describe("server/storage.ts source guards", () => {
  const src = readSrc("server/storage.ts");

  it("declares the idempotent DROP TABLE boot migration (child first)", () => {
    expect(src).toContain("DROP TABLE IF EXISTS project_action_notes;");
    expect(src).toContain("DROP TABLE IF EXISTS project_actions;");
    const childIdx = src.indexOf("DROP TABLE IF EXISTS project_action_notes;");
    const parentIdx = src.indexOf("DROP TABLE IF EXISTS project_actions;");
    expect(childIdx).toBeLessThan(parentIdx);
  });

  it("no longer defines the Actions storage helpers", () => {
    expect(src).not.toContain("createAction(");
    expect(src).not.toContain("createActionNote(");
    expect(src).not.toContain("CREATE TABLE IF NOT EXISTS project_actions");
  });
});

describe("server/routes.ts source guards", () => {
  const src = readSrc("server/routes.ts");

  it("wires resolveNoteSource into the notes create route", () => {
    expect(src).toContain('import { resolveNoteSource } from "./thread-title"');
    expect(src).toContain("await resolveNoteSource(sourceUrl)");
  });

  it("the notes POST no longer accepts a client sourceLabel (server-derived)", () => {
    const post = src.slice(
      src.indexOf('app.post("/api/projects/:id/notes"'),
      src.indexOf('app.patch("/api/component-notes/:noteId"'),
    );
    // sourceLabel is not an accepted client field...
    expect(post).toContain('const allowed = ["noteDate", "title", "body", "sourceUrl"]');
    // ...and it is set from the server-resolved source, not the request body.
    expect(post).toContain("sourceLabel: source.sourceLabel");
  });

  it("still returns invalid_source_url on a bad URL", () => {
    expect(src).toContain("invalid_source_url");
  });
});

describe("shared/schema.ts source guards", () => {
  const src = readSrc("shared/schema.ts");

  it("no longer defines projectActions / projectActionNotes", () => {
    expect(src).not.toContain("projectActions");
    expect(src).not.toContain("projectActionNotes");
    expect(src).not.toContain('sqliteTable("project_actions"');
    expect(src).not.toContain('sqliteTable("project_action_notes"');
  });

  it("keeps projects.nextActionTaskId (a task pointer, not an action)", () => {
    expect(src).toContain("nextActionTaskId");
  });
});
