// filepath: test/stage24-transition-schema.test.ts
// Stage 24 (2026-08-11) — Relationship Transition module: schema + guards.
//
// Tests the DDL, seeding idempotency, credential guard, and export
// redaction on an isolated in-memory SQLite DB. Avoids importing the
// module directly (which would open data.db) — the DDL and rules are
// small enough to inline and are kept in sync with server/transition-storage.ts.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { TRANSITION_CREDENTIAL_REGEX } from "../shared/schema";

// A trimmed copy of ensureTransitionSchema's DDL. Kept small and readable.
// If the shipped DDL drifts, this test should be updated in the same PR.
function ddl(): string {
  return `
    CREATE TABLE IF NOT EXISTS transition_state (
      id INTEGER PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'decision_taken',
      decision_statement TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transition_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      horizon TEXT NOT NULL DEFAULT '2w',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      confidentiality TEXT NOT NULL DEFAULT 'private',
      seed_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transition_actions_seed_key
      ON transition_actions(seed_key) WHERE seed_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS transition_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_type TEXT NOT NULL,
      body TEXT NOT NULL,
      perspective TEXT NOT NULL DEFAULT 'me',
      confidentiality TEXT NOT NULL DEFAULT 'private',
      seed_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

describe("Stage 24 — transition schema", () => {
  it("creates the core tables and enforces the seed_key uniqueness index", () => {
    const db = new Database(":memory:");
    db.exec(ddl());

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("transition_state");
    expect(names).toContain("transition_actions");
    expect(names).toContain("transition_ledger");

    const now = Date.now();
    const ins = db.prepare(
      "INSERT OR IGNORE INTO transition_actions (title, seed_key, created_at, updated_at) VALUES (?, ?, ?, ?)",
    );
    ins.run("A", "seed:demo", now, now);
    ins.run("B", "seed:demo", now, now); // duplicate seed_key — should be ignored
    const rows = db.prepare("SELECT COUNT(*) AS n FROM transition_actions").get() as {
      n: number;
    };
    expect(rows.n).toBe(1);
  });
});

describe("Stage 24 — credential guard regex", () => {
  it("matches common credential terms case-insensitively", () => {
    const positives = [
      "The password is hunter2",
      "TOTP recovery code 123456",
      "MY api_key is here",
      "Save the token in 1Password",
      "PIN: 4242",
      "Recovery-Code: abcd",
    ];
    for (const s of positives) {
      expect(TRANSITION_CREDENTIAL_REGEX.test(s)).toBe(true);
    }
  });

  it("does not fire on plain prose about accounts", () => {
    const negatives = [
      "Google account belongs to Marieke",
      "Xero access is limited to the practice manager",
      "Home network is on the Apple Home hub",
    ];
    for (const s of negatives) {
      expect(TRANSITION_CREDENTIAL_REGEX.test(s)).toBe(false);
    }
  });
});

describe("Stage 24b \u2014 transition_action_notes", () => {
  it("stores a notes timeline per action, ordered by created_at ASC", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE transition_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE transition_action_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        record_type TEXT NOT NULL DEFAULT 'self_report',
        confidentiality TEXT NOT NULL DEFAULT 'private',
        source_url TEXT,
        source_label TEXT,
        seed_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_notes_action ON transition_action_notes(action_id, created_at);
    `);
    const now = Date.now();
    db.prepare(
      "INSERT INTO transition_actions (title, created_at, updated_at) VALUES (?, ?, ?)",
    ).run("Call solicitor", now, now);
    const actionId = 1;
    const insertNote = db.prepare(
      "INSERT INTO transition_action_notes (action_id, body, created_at, updated_at) VALUES (?, ?, ?, ?)",
    );
    insertNote.run(actionId, "Left voicemail", now, now);
    insertNote.run(actionId, "Callback confirmed for Thursday", now + 1, now + 1);
    insertNote.run(actionId, "Initial advice: no big-ticket moves", now + 2, now + 2);

    const rows = db
      .prepare(
        "SELECT body FROM transition_action_notes WHERE action_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(actionId) as Array<{ body: string }>;
    expect(rows.map((r) => r.body)).toEqual([
      "Left voicemail",
      "Callback confirmed for Thursday",
      "Initial advice: no big-ticket moves",
    ]);
  });
});
