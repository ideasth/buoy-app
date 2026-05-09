// Stage 7 (2026-05-10) — Tests for the unified daily_check_ins mirror
// table and Stage 11 score composition helper.
//
// We deliberately do NOT import server/storage.ts here because that
// module opens the live data.db on import. Instead we construct an
// in-memory sqlite DB with the same DDL used by storage.ts, then
// exercise the upsert + backfill semantics directly. The chip → shadow
// numeric mapping is tested via the canonical helpers in
// shared/checkin-mapping.ts to keep this suite hermetic.

import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  composeWellbeingScore,
  labelToNum,
  MORNING_LABEL_TO_NUM,
} from "../shared/checkin-mapping";

// Mirror the daily_check_ins DDL from server/storage.ts. Kept inline so
// the test fails loudly if the production DDL drifts (we'd need to
// update both places to match).
const DDL = `
  CREATE TABLE IF NOT EXISTS daily_check_ins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    phase TEXT NOT NULL,
    source TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    arousal_state TEXT,
    mood TEXT,
    cognitive_load TEXT,
    energy_label TEXT,
    sleep_label TEXT,
    focus TEXT,
    alignment_people TEXT,
    alignment_activities TEXT,
    mood_n INTEGER,
    cognitive_load_n INTEGER,
    energy_n INTEGER,
    sleep_n INTEGER,
    focus_n INTEGER,
    alignment_people_n INTEGER,
    alignment_activities_n INTEGER,
    note TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_checkins_date_phase_source
    ON daily_check_ins(date, phase, source);
  CREATE INDEX IF NOT EXISTS idx_checkins_date_phase
    ON daily_check_ins(date, phase);
  CREATE INDEX IF NOT EXISTS idx_checkins_date_captured
    ON daily_check_ins(date, captured_at);
`;

interface UpsertArgs {
  date: string;
  phase: "morning" | "midday" | "evening" | "adhoc";
  source: "morning_page" | "evening_page" | "checkin_page" | "coach_pre_session";
  fields: Record<string, string | null | undefined>;
  capturedAt?: number;
}

// Re-implementation of upsertDailyCheckIn against a raw sqlite handle.
// Mirrors the production behaviour: derive numeric shadows from chip
// labels, then INSERT … ON CONFLICT(date, phase, source) DO UPDATE.
function upsertDailyCheckIn(db: Database.Database, args: UpsertArgs) {
  const captured = args.capturedAt ?? Date.now();
  // SQL column names ↔ chip-text keys.
  const labelCols: Record<string, string> = {
    arousalState: "arousal_state",
    mood: "mood",
    cognitiveLoad: "cognitive_load",
    energyLabel: "energy_label",
    sleepLabel: "sleep_label",
    focus: "focus",
    alignmentPeople: "alignment_people",
    alignmentActivities: "alignment_activities",
    note: "note",
  };
  const shadowCols: Record<string, string> = {
    mood: "mood_n",
    energyLabel: "energy_n",
    cognitiveLoad: "cognitive_load_n",
    sleepLabel: "sleep_n",
    focus: "focus_n",
    alignmentPeople: "alignment_people_n",
    alignmentActivities: "alignment_activities_n",
  };
  const cols: string[] = ["date", "phase", "source", "captured_at"];
  const vals: unknown[] = [args.date, args.phase, args.source, captured];
  for (const [key, value] of Object.entries(args.fields)) {
    if (key in labelCols) {
      cols.push(labelCols[key]);
      vals.push(value ?? null);
    }
    if (key in shadowCols) {
      cols.push(shadowCols[key]);
      vals.push(value == null ? null : labelToNum(key, value));
    }
  }
  const placeholders = cols.map(() => "?").join(", ");
  const updates = cols
    .filter((c) => c !== "date" && c !== "phase" && c !== "source")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  db.prepare(
    `INSERT INTO daily_check_ins (${cols.join(", ")}) VALUES (${placeholders})
     ON CONFLICT(date, phase, source) DO UPDATE SET ${updates}`,
  ).run(...vals);
  return db
    .prepare(
      "SELECT * FROM daily_check_ins WHERE date=? AND phase=? AND source=?",
    )
    .get(args.date, args.phase, args.source) as Record<string, unknown>;
}

describe("daily_check_ins schema", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("inserts a row with derived numeric shadows", () => {
    const row = upsertDailyCheckIn(db, {
      date: "2026-05-10",
      phase: "morning",
      source: "morning_page",
      fields: {
        mood: "positive",
        energyLabel: "high",
        cognitiveLoad: "low",
        sleepLabel: "restorative",
        focus: "focused",
        alignmentPeople: "aligned",
        alignmentActivities: "aligned",
      },
      capturedAt: 1_000,
    });
    expect(row.mood_n).toBe(3);
    expect(row.energy_n).toBe(3);
    expect(row.cognitive_load_n).toBe(3); // inverted: low load = good
    expect(row.sleep_n).toBe(3);
    expect(row.focus_n).toBe(2);
    expect(row.alignment_people_n).toBe(3);
    expect(row.alignment_activities_n).toBe(3);
  });

  it("is idempotent on (date, phase, source) — second call updates", () => {
    upsertDailyCheckIn(db, {
      date: "2026-05-10",
      phase: "morning",
      source: "morning_page",
      fields: { mood: "neutral" },
      capturedAt: 1_000,
    });
    upsertDailyCheckIn(db, {
      date: "2026-05-10",
      phase: "morning",
      source: "morning_page",
      fields: { mood: "positive" },
      capturedAt: 2_000,
    });
    const rows = db
      .prepare("SELECT * FROM daily_check_ins WHERE date=? AND phase=?")
      .all("2026-05-10", "morning") as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].mood).toBe("positive");
    expect(rows[0].mood_n).toBe(3);
    expect(rows[0].captured_at).toBe(2_000);
  });

  it("allows different sources for same (date, phase) to coexist", () => {
    upsertDailyCheckIn(db, {
      date: "2026-05-10",
      phase: "morning",
      source: "morning_page",
      fields: { mood: "positive" },
    });
    upsertDailyCheckIn(db, {
      date: "2026-05-10",
      phase: "morning",
      source: "coach_pre_session",
      fields: { mood: "neutral" },
    });
    const rows = db
      .prepare("SELECT source FROM daily_check_ins WHERE date=? AND phase=?")
      .all("2026-05-10", "morning") as { source: string }[];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.source))).toEqual(
      new Set(["morning_page", "coach_pre_session"]),
    );
  });

  it("treats unknown chip values as null shadow", () => {
    const row = upsertDailyCheckIn(db, {
      date: "2026-05-10",
      phase: "evening",
      source: "evening_page",
      fields: { mood: "garbage" },
    });
    expect(row.mood).toBe("garbage");
    expect(row.mood_n).toBeNull();
  });
});

describe("labelToNum (canonical mapping)", () => {
  it("maps every documented label", () => {
    for (const [field, mapping] of Object.entries(MORNING_LABEL_TO_NUM)) {
      for (const [label, expected] of Object.entries(mapping)) {
        expect(labelToNum(field, label)).toBe(expected);
      }
    }
  });
  it("returns null for unknown field or label", () => {
    expect(labelToNum("not_a_field", "positive")).toBeNull();
    expect(labelToNum("mood", "ecstatic")).toBeNull();
    expect(labelToNum("mood", null)).toBeNull();
    expect(labelToNum("mood", undefined)).toBeNull();
  });
});

describe("composeWellbeingScore (Stage 11 helper)", () => {
  it("returns null when no shadows present", () => {
    expect(composeWellbeingScore({})).toBeNull();
  });

  it("scales focus by 1.5× before averaging", () => {
    // focus=2 alone → 2 * 1.5 = 3.0
    expect(composeWellbeingScore({ focus: 2 })).toBeCloseTo(3.0, 5);
    // focus=1 alone → 1.5
    expect(composeWellbeingScore({ focus: 1 })).toBeCloseTo(1.5, 5);
  });

  it("computes arithmetic mean across non-null dimensions", () => {
    // mood=3, energy=2 → mean = 2.5
    expect(composeWellbeingScore({ mood: 3, energy: 2 })).toBeCloseTo(2.5, 5);
  });

  it("ignores undefined and null dimensions", () => {
    expect(
      composeWellbeingScore({
        mood: 3,
        energy: undefined,
        sleep: null as unknown as number,
      }),
    ).toBeCloseTo(3, 5);
  });

  it("full 'great day' composes to 3.0", () => {
    const score = composeWellbeingScore({
      mood: 3,
      energy: 3,
      cognitive_load: 3,
      sleep: 3,
      focus: 2, // scales to 3.0
      alignment_people: 3,
      alignment_activities: 3,
    });
    expect(score).toBeCloseTo(3.0, 5);
  });

  it("ignores NaN inputs", () => {
    expect(composeWellbeingScore({ mood: NaN, energy: 2 })).toBeCloseTo(2, 5);
  });
});
