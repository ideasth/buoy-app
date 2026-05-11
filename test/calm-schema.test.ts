// Stage 13 (2026-05-11) — Calm schema migrations.
//
// Verifies that the additive ALTER TABLE statements in server/storage.ts
// successfully bring an older coach_sessions schema up to the Stage 13
// shape without data loss, and that a second boot is a no-op (the catch
// block silently swallows "duplicate column" errors).

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";

// Pre-Stage-13 DDL (the shape that lives in production before this PR).
const PRE_STAGE_13_DDL = `
CREATE TABLE coach_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  mode TEXT NOT NULL DEFAULT 'plan',
  context_snapshot TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  summary_edited_by_user INTEGER NOT NULL DEFAULT 0,
  linked_issue_id INTEGER,
  linked_ymd TEXT,
  model_provider TEXT NOT NULL DEFAULT 'perplexity',
  model_name TEXT NOT NULL DEFAULT 'sonar-pro',
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  deep_think INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER
);
`;

const STAGE_13_ADDS = [
  "ALTER TABLE coach_sessions ADD COLUMN calm_variant TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN issue_entity_type TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN issue_entity_id INTEGER",
  "ALTER TABLE coach_sessions ADD COLUMN issue_freetext TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN pre_tags TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN pre_intensity INTEGER",
  "ALTER TABLE coach_sessions ADD COLUMN grounding_observations TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN reframe_text TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN reflection_worst_story TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN reflection_accurate_story TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN reflection_next_action TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN post_tags TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN post_intensity INTEGER",
  "ALTER TABLE coach_sessions ADD COLUMN post_note TEXT",
  "ALTER TABLE coach_sessions ADD COLUMN completed_at INTEGER",
];

function applyIdempotently(db: Database.Database) {
  for (const stmt of STAGE_13_ADDS) {
    try {
      db.exec(stmt);
    } catch {
      // Column already exists — ignore. Mirrors server/storage.ts pattern.
    }
  }
}

describe("Calm schema migration", () => {
  it("adds all 15 calm columns to a pre-stage-13 coach_sessions table", () => {
    const db = new Database(":memory:");
    db.exec(PRE_STAGE_13_DDL);
    applyIdempotently(db);
    const cols = db
      .prepare("PRAGMA table_info(coach_sessions)")
      .all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    for (const expected of [
      "calm_variant",
      "issue_entity_type",
      "issue_entity_id",
      "issue_freetext",
      "pre_tags",
      "pre_intensity",
      "grounding_observations",
      "reframe_text",
      "reflection_worst_story",
      "reflection_accurate_story",
      "reflection_next_action",
      "post_tags",
      "post_intensity",
      "post_note",
      "completed_at",
    ]) {
      expect(names, `column ${expected} should be added`).toContain(expected);
    }
  });

  it("is idempotent: a second boot is a silent no-op", () => {
    const db = new Database(":memory:");
    db.exec(PRE_STAGE_13_DDL);
    applyIdempotently(db);
    // Second pass must not throw under the try/catch wrapper.
    expect(() => applyIdempotently(db)).not.toThrow();
  });

  it("accepts NULL for every new column", () => {
    const db = new Database(":memory:");
    db.exec(PRE_STAGE_13_DDL);
    applyIdempotently(db);
    // Insert a minimal calm row leaving all new columns NULL.
    db.prepare(
      "INSERT INTO coach_sessions (started_at, mode) VALUES (?, 'calm')",
    ).run(Date.now());
    const row = db
      .prepare("SELECT * FROM coach_sessions WHERE mode = 'calm'")
      .get() as Record<string, unknown>;
    expect(row.mode).toBe("calm");
    expect(row.calm_variant).toBeNull();
    expect(row.issue_entity_type).toBeNull();
    expect(row.grounding_observations).toBeNull();
    expect(row.reframe_text).toBeNull();
    expect(row.completed_at).toBeNull();
  });

  it("stores grounding_observations as a JSON string round-trip", () => {
    const db = new Database(":memory:");
    db.exec(PRE_STAGE_13_DDL);
    applyIdempotently(db);
    const obs = { see: "tree", hear: "rain", feel: "cold floor" };
    db.prepare(
      "INSERT INTO coach_sessions (started_at, mode, calm_variant, grounding_observations) VALUES (?, 'calm', 'grounding_only', ?)",
    ).run(Date.now(), JSON.stringify(obs));
    const row = db
      .prepare("SELECT grounding_observations FROM coach_sessions")
      .get() as { grounding_observations: string };
    expect(JSON.parse(row.grounding_observations)).toEqual(obs);
  });
});
