// Stage 7 (2026-05-10) — Shared chip-label → numeric-shadow mapping.
//
// Moved from server/storage.ts so both the server (write paths +
// aggregation queries) and any future client (e.g. Stage 11
// composeWellbeingScore recompute) can import the same canonical
// mapping. Keeping this in /shared makes it the single source of
// truth for "categorical chip → small ordinal integer".
//
// Direction convention: higher = "more positive day". Cognitive load
// is inverted so that low load (= 3) ranks as good. Focus is 1–2
// (binary chip), all others are 1–3.
//
// Stage 5 (Morning) and Stage 6 (Reflect) already use this exact
// mapping verbatim. Stage 7 introduces daily_check_ins which uses
// the same mapping. Stage 11's composeWellbeingScore() lives below
// and applies a 1.5× scale to focus_n so it averages into a 0–3
// composite alongside the 1–3 dimensions.

export const MORNING_LABEL_TO_NUM: Record<string, Record<string, number>> = {
  mood: { positive: 3, neutral: 2, strained: 1 },
  energyLabel: { high: 3, moderate: 2, low: 1 },
  cognitiveLoad: { low: 3, moderate: 2, high: 1 },
  sleepLabel: { restorative: 3, adequate: 2, poor: 1 },
  focus: { focused: 2, scattered: 1 },
  alignmentPeople: { aligned: 3, neutral: 2, disconnected: 1 },
  alignmentActivities: { aligned: 3, neutral: 2, misaligned: 1 },
};

// Camel-case label field -> camelCase Drizzle column key (used in
// updateMorning's set() merge object and updateReflection's enriched
// merge). Same keys are reused for daily_check_ins (Stage 7).
export const MORNING_NUM_DRIZZLE_KEY: Record<string, string> = {
  mood: "moodN",
  energyLabel: "energyN",
  cognitiveLoad: "cognitiveLoadN",
  sleepLabel: "sleepN",
  focus: "focusN",
  alignmentPeople: "alignmentPeopleN",
  alignmentActivities: "alignmentActivitiesN",
};

// Camel-case label field -> snake_case raw SQL column name (used in
// the boot-time backfill UPDATE statements and in raw SQL elsewhere).
export const MORNING_NUM_SQL_COL: Record<string, string> = {
  mood: "mood_n",
  energyLabel: "energy_n",
  cognitiveLoad: "cognitive_load_n",
  sleepLabel: "sleep_n",
  focus: "focus_n",
  alignmentPeople: "alignment_people_n",
  alignmentActivities: "alignment_activities_n",
};

// Camel-case label field -> snake_case raw SQL column for the chip
// TEXT column itself (mirror of MORNING_NUM_SQL_COL but for the
// label, not the shadow). Used by backfills that walk text→numeric.
export const MORNING_TEXT_SQL_COL: Record<string, string> = {
  mood: "mood",
  energyLabel: "energy_label",
  cognitiveLoad: "cognitive_load",
  sleepLabel: "sleep_label",
  focus: "focus",
  alignmentPeople: "alignment_people",
  alignmentActivities: "alignment_activities",
};

export function labelToNum(field: string, value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = MORNING_LABEL_TO_NUM[field];
  if (!m) return null;
  return field in MORNING_LABEL_TO_NUM && value in m ? m[value] : null;
}

// Stage 11 (2026-05-10) — Composite well-being score.
//
// Pure helper. Arithmetic mean of all non-null numeric shadows for
// a single day, normalised to a 0–3 scale. Focus is 1–2 (binary
// chip) so we scale focus_n by 1.5× before averaging — that maps
// {1, 2} onto {1.5, 3.0}, keeping the dimension's "max = 3 = good"
// alignment with the other 1–3 dimensions. Returns null if no
// shadows are present (the caller decides how to render gaps).
//
// Used by both the server aggregation route (GET /api/checkins/scores)
// and any client-side recompute (e.g. when the tracker switches
// aggregate mode without re-fetching).

export type DimensionKey =
  | "mood"
  | "energy"
  | "cognitive_load"
  | "sleep"
  | "focus"
  | "alignment_people"
  | "alignment_activities";

export const DIMENSION_KEYS: DimensionKey[] = [
  "mood",
  "energy",
  "cognitive_load",
  "sleep",
  "focus",
  "alignment_people",
  "alignment_activities",
];

export function composeWellbeingScore(
  dayScores: Partial<Record<DimensionKey, number>>,
): number | null {
  const values: number[] = [];
  for (const key of DIMENSION_KEYS) {
    const v = dayScores[key];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || Number.isNaN(v)) continue;
    if (key === "focus") {
      // Scale focus from {1, 2} to {1.5, 3.0} so it averages onto
      // the same 0–3 scale as the other dimensions.
      values.push(v * 1.5);
    } else {
      values.push(v);
    }
  }
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}


// Stage 9b (2026-05-10) — Coach pre-session freshness window.
//
// If the most recent daily_check_ins row was captured within this
// window, Coach skips the pre-session modal and starts the session
// directly. Lives in /shared so the client component, the host page,
// and tests share one definition.
export const CHECKIN_FRESHNESS_MS = 90 * 60 * 1000;

export function isCheckinFresh(
  latest: { capturedAt?: number } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!latest) return false;
  if (typeof latest.capturedAt !== "number") return false;
  return now - latest.capturedAt < CHECKIN_FRESHNESS_MS;
}
