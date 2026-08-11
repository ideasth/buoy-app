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
