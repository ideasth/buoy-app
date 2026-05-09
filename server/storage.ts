import {
  tasks,
  topThree,
  habits,
  habitLogs,
  timeBlocks,
  reflections,
  goals,
  settings,
  msTodoLists,
  syncLog,
  morningRoutines,
  inboxScanQueue,
  plannerNotes,
  emailStatus,
  projects,
  projectPhases,
  projectComponents,
  projectTasks,
  dailyFactors,
  issues,
  travelLocations,
  travelOverrides,
  coachSessions,
  coachMessages,
} from "@shared/schema";
import type {
  Task,
  InsertTask,
  TopThree,
  InsertTopThree,
  Habit,
  InsertHabit,
  HabitLog,
  InsertHabitLog,
  TimeBlock,
  InsertTimeBlock,
  Reflection,
  InsertReflection,
  Goal,
  InsertGoal,
  SettingsBlob,
  MsTodoList,
  InsertMsTodoList,
  SyncLog,
  InsertSyncLog,
  MorningRoutine,
  InsertMorningRoutine,
  InboxScanItem,
  InsertInboxScan,
  PlannerNote,
  EmailStatusRow,
  InsertEmailStatus,
  Project,
  InsertProject,
  ProjectPhase,
  InsertProjectPhase,
  ProjectComponent,
  InsertProjectComponent,
  ProjectTask,
  InsertProjectTask,
  DailyFactors,
  InsertDailyFactors,
  Issue,
  InsertIssue,
  TravelLocation,
  InsertTravelLocation,
  TravelOverride,
  InsertTravelOverride,
  CoachSession,
  InsertCoachSession,
  CoachMessage,
  InsertCoachMessage,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, gte, lte, isNull, sql } from "drizzle-orm";
import { evaluateEmailPriority } from "@shared/email-priority";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);
// Exported for admin endpoints that need the raw handle (e.g. .backup()).
export const rawSqlite = sqlite;

// Run schema migrations inline (no drizzle-kit at runtime)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'iftime',
  domain TEXT NOT NULL DEFAULT 'work',
  estimate_minutes INTEGER NOT NULL DEFAULT 30,
  actual_minutes INTEGER,
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  notes TEXT,
  ms_todo_id TEXT,
  ms_todo_list_id TEXT,
  ms_todo_etag TEXT,
  last_synced_at INTEGER,
  sync_dirty INTEGER NOT NULL DEFAULT 0,
  tag TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_ms_todo_id_unique ON tasks (ms_todo_id);
CREATE TABLE IF NOT EXISTS ms_todo_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ms_list_id TEXT NOT NULL,
  name TEXT NOT NULL,
  default_domain TEXT NOT NULL DEFAULT 'work',
  is_default_target INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ms_todo_lists_ms_list_id_unique ON ms_todo_lists (ms_list_id);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ms_task_id TEXT,
  summary TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS top_three (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  task_id1 INTEGER,
  task_id2 INTEGER,
  task_id3 INTEGER,
  locked_at INTEGER
);
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE TABLE IF NOT EXISTS habit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE TABLE IF NOT EXISTS time_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  planned_start INTEGER NOT NULL,
  planned_end INTEGER NOT NULL,
  actual_start INTEGER,
  actual_end INTEGER,
  kind TEXT NOT NULL DEFAULT 'focus'
);
CREATE TABLE IF NOT EXISTS reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'daily',
  energy INTEGER,
  state TEXT,
  avoided_task TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horizon TEXT NOT NULL DEFAULT 'quarter',
  title TEXT NOT NULL,
  why TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS morning_routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  started_at INTEGER,
  completed_at INTEGER,
  energy INTEGER,
  state TEXT,
  sleep_quality INTEGER,
  gratitude TEXT,
  avoided_task TEXT,
  notes TEXT,
  braindump_raw TEXT,
  braindump_task_ids TEXT,
  top_three_ids TEXT,
  express_mode INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS inbox_scan_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_message_id TEXT,
  subject TEXT,
  from_address TEXT,
  received_at INTEGER,
  suggested_action TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL,
  device_label TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_hash_unique ON auth_sessions (token_hash);
CREATE TABLE IF NOT EXISTS credit_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recordedAt INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_credit_balances_recordedAt ON credit_balances(recordedAt);
CREATE TABLE IF NOT EXISTS cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cronId TEXT NOT NULL,
  cronType TEXT NOT NULL,
  startedAt INTEGER NOT NULL,
  endedAt INTEGER,
  ok INTEGER DEFAULT 1,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(startedAt);
CREATE INDEX IF NOT EXISTS idx_cron_runs_type ON cron_runs(cronType);
CREATE TABLE IF NOT EXISTS planner_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS planner_notes_date_unique ON planner_notes (date);
CREATE TABLE IF NOT EXISTS credit_estimates (
  cronType TEXT PRIMARY KEY,
  perRunCredits REAL NOT NULL,
  sampleCount INTEGER DEFAULT 0,
  lastUpdatedAt INTEGER
);
INSERT OR IGNORE INTO credit_estimates (cronType, perRunCredits, sampleCount, lastUpdatedAt) VALUES
  ('daily_morning', 5, 0, NULL),
  ('weekly_review', 8, 0, NULL),
  ('two_hour_sync', 15, 0, NULL),
  ('calendar_sync', 10, 0, NULL),
  ('agent_session', 50, 0, NULL);

-- Email Status: high-priority unanswered emails
CREATE TABLE IF NOT EXISTS email_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  thread_id TEXT,
  received_at INTEGER NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_preview TEXT NOT NULL DEFAULT '',
  importance TEXT,
  is_flagged INTEGER NOT NULL DEFAULT 0,
  draft_response TEXT,
  draft_generated_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  dismissed_at INTEGER,
  web_link TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_status_status ON email_status(status);
CREATE INDEX IF NOT EXISTS idx_email_status_received ON email_status(received_at);

-- Projects (mapped from MS To Do lists ending in : Active or : Parked)
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ms_todo_list_id TEXT UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'low',
  description TEXT NOT NULL DEFAULT '',
  current_phase_id INTEGER,
  next_action_task_id INTEGER,
  -- Feature 2 — Project values
  current_income_per_hour INTEGER,
  future_income_estimate INTEGER,
  is_primary_future_income INTEGER NOT NULL DEFAULT 0,
  community_benefit INTEGER,
  professional_kudos INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS project_phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phases_project ON project_phases(project_id);

CREATE TABLE IF NOT EXISTS project_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  phase_id INTEGER,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_components_project ON project_components(project_id);
CREATE INDEX IF NOT EXISTS idx_components_phase ON project_components(phase_id);

CREATE TABLE IF NOT EXISTS project_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  component_id INTEGER,
  ms_todo_task_id TEXT UNIQUE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  deadline TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ptasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_ptasks_component ON project_tasks(component_id);

-- Daily factors: mood + lightweight measures (one row per YYYY-MM-DD)
CREATE TABLE IF NOT EXISTS daily_factors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  mood TEXT,
  energy TEXT,
  cognitive_load TEXT,
  sleep_quality TEXT,
  focus TEXT,
  values_alignment TEXT,
  captured_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_daily_factors_date ON daily_factors(date);

-- Contextual life issues log
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ymd TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  need_support INTEGER NOT NULL DEFAULT 0,
  support_type TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_ymd TEXT,
  source_page TEXT NOT NULL DEFAULT 'reflect',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_created_ymd ON issues(created_ymd);
CREATE INDEX IF NOT EXISTS idx_issues_category ON issues(category);

-- Feature 1 — Travel locations + per-event overrides
CREATE TABLE IF NOT EXISTS travel_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  nominal_minutes INTEGER NOT NULL,
  allow_minutes INTEGER NOT NULL,
  destination_address TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS travel_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uid TEXT NOT NULL UNIQUE,
  nominal_minutes_override INTEGER,
  allow_minutes_override INTEGER,
  location_id_override INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_travel_overrides_uid ON travel_overrides(event_uid);

-- Feature 5 — Coach sessions + messages
CREATE TABLE IF NOT EXISTS coach_sessions (
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
  total_output_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_coach_sessions_started ON coach_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_sessions_ymd ON coach_sessions(linked_ymd);

CREATE TABLE IF NOT EXISTS coach_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  token_count INTEGER,
  mode_at_turn TEXT NOT NULL DEFAULT 'plan'
);
CREATE INDEX IF NOT EXISTS idx_coach_messages_session ON coach_messages(session_id, created_at);
`);

// Coach session full-text search (Feature 5 polish, 2026-05-08).
// Additive virtual table + triggers — does not alter coach_sessions schema.
// We store summary text directly (not external-content) so triggers stay simple.
try {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS coach_sessions_fts USING fts5(
      session_id UNINDEXED,
      summary,
      tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS coach_sessions_fts_ai AFTER INSERT ON coach_sessions
      WHEN NEW.summary IS NOT NULL
      BEGIN
        INSERT INTO coach_sessions_fts(session_id, summary) VALUES (NEW.id, NEW.summary);
      END;
    CREATE TRIGGER IF NOT EXISTS coach_sessions_fts_au AFTER UPDATE OF summary ON coach_sessions
      BEGIN
        DELETE FROM coach_sessions_fts WHERE session_id = OLD.id;
        INSERT INTO coach_sessions_fts(session_id, summary)
          SELECT NEW.id, NEW.summary WHERE NEW.summary IS NOT NULL;
      END;
    CREATE TRIGGER IF NOT EXISTS coach_sessions_fts_ad AFTER DELETE ON coach_sessions
      BEGIN
        DELETE FROM coach_sessions_fts WHERE session_id = OLD.id;
      END;
  `);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[storage] FTS5 setup failed (search will be unavailable):", err);
}

// Coach context-bundle telemetry + backup receipts (2026-05-08).
// Both append-only; queried by admin Health card and (later) coach analytics.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS coach_context_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  message_id INTEGER,
  mode TEXT NOT NULL,
  bundle_keys_present TEXT NOT NULL,
  bundle_keys_referenced TEXT NOT NULL,
  reference_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_context_usage_session ON coach_context_usage(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_coach_context_usage_created ON coach_context_usage(created_at DESC);

CREATE TABLE IF NOT EXISTS backup_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  onedrive_url TEXT NOT NULL,
  mtime INTEGER,
  size_bytes INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_receipts_created ON backup_receipts(created_at DESC);

CREATE TABLE IF NOT EXISTS cron_heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cron_id TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  anomaly_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cron_heartbeats_created ON cron_heartbeats(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_heartbeats_cron_created ON cron_heartbeats(cron_id, created_at DESC);
`);

// Add new columns to existing tasks table if missing (idempotent)
for (const stmt of [
  "ALTER TABLE tasks ADD COLUMN from_braindump INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tasks ADD COLUMN pending_action TEXT",
  // Feature 2 — Project values. Nullable so existing rows get NULL; UI treats null as "not scored yet".
  // is_primary_future_income gets NOT NULL DEFAULT 0 so existing rows are explicitly "not primary".
  "ALTER TABLE projects ADD COLUMN current_income_per_hour INTEGER",
  "ALTER TABLE projects ADD COLUMN future_income_estimate INTEGER",
  "ALTER TABLE projects ADD COLUMN is_primary_future_income INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE projects ADD COLUMN community_benefit INTEGER",
  "ALTER TABLE projects ADD COLUMN professional_kudos INTEGER",
  // Coach session retention + deep-think (Feature 5 polish, 2026-05-08).
  "ALTER TABLE coach_sessions ADD COLUMN deep_think INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE coach_sessions ADD COLUMN archived_at INTEGER",
  // Morning page restructure (2026-05-09):
  // - Habits tickboxes (calm focused breathing, medication)
  // - Reflection mirror columns (mood, cognitive_load, alignment) so the
  //   Morning page surface is self-contained.
  "ALTER TABLE morning_routines ADD COLUMN breathing_done INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE morning_routines ADD COLUMN medication_done INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE morning_routines ADD COLUMN mood TEXT",
  "ALTER TABLE morning_routines ADD COLUMN cognitive_load TEXT",
  "ALTER TABLE morning_routines ADD COLUMN alignment TEXT",
  // Morning alignment split (2026-05-09): two-axis alignment supersedes
  // the legacy yes/no alignment column. Legacy column kept for historical rows.
  "ALTER TABLE morning_routines ADD COLUMN alignment_people TEXT",
  "ALTER TABLE morning_routines ADD COLUMN alignment_activities TEXT",
  // Reflect-aligned label columns (2026-05-09): mirror Reflect option sets so
  // Morning + Reflect tracking is comparable. Legacy 1–5 numeric energy and
  // sleep_quality columns retained untouched for historical analytics.
  "ALTER TABLE morning_routines ADD COLUMN energy_label TEXT",
  "ALTER TABLE morning_routines ADD COLUMN sleep_label TEXT",
  "ALTER TABLE morning_routines ADD COLUMN focus TEXT",
  // Numeric shadow columns for analytics (2026-05-09 — Stage 5).
  // Text columns above remain canonical; these mirror labels onto small
  // ordinal scales. Mapping in MORNING_LABEL_TO_NUM below. Backfill runs once
  // on boot to populate existing rows.
  "ALTER TABLE morning_routines ADD COLUMN mood_n INTEGER",
  "ALTER TABLE morning_routines ADD COLUMN energy_n INTEGER",
  "ALTER TABLE morning_routines ADD COLUMN cognitive_load_n INTEGER",
  "ALTER TABLE morning_routines ADD COLUMN sleep_n INTEGER",
  "ALTER TABLE morning_routines ADD COLUMN focus_n INTEGER",
  "ALTER TABLE morning_routines ADD COLUMN alignment_people_n INTEGER",
  "ALTER TABLE morning_routines ADD COLUMN alignment_activities_n INTEGER",
  // Reflect page restructure (Stage 6 — 2026-05-09).
  // Evening habit tickboxes (medication, bed by 11pm) on the reflections table.
  // Reflect-aligned chip labels mirroring the Morning reflection chips so the
  // two pages share the same shared option arrays. Numeric shadows mirror the
  // Stage 5 mapping for cross-page comparability. All nullable so existing
  // legacy reflection rows remain valid.
  "ALTER TABLE reflections ADD COLUMN medication_done INTEGER",
  "ALTER TABLE reflections ADD COLUMN bed_by_11pm_done INTEGER",
  "ALTER TABLE reflections ADD COLUMN arousal_state TEXT",
  "ALTER TABLE reflections ADD COLUMN mood TEXT",
  "ALTER TABLE reflections ADD COLUMN cognitive_load TEXT",
  "ALTER TABLE reflections ADD COLUMN energy_label TEXT",
  "ALTER TABLE reflections ADD COLUMN sleep_label TEXT",
  "ALTER TABLE reflections ADD COLUMN focus TEXT",
  "ALTER TABLE reflections ADD COLUMN alignment_people TEXT",
  "ALTER TABLE reflections ADD COLUMN alignment_activities TEXT",
  "ALTER TABLE reflections ADD COLUMN mood_n INTEGER",
  "ALTER TABLE reflections ADD COLUMN cognitive_load_n INTEGER",
  "ALTER TABLE reflections ADD COLUMN energy_n INTEGER",
  "ALTER TABLE reflections ADD COLUMN sleep_n INTEGER",
  "ALTER TABLE reflections ADD COLUMN focus_n INTEGER",
  "ALTER TABLE reflections ADD COLUMN alignment_people_n INTEGER",
  "ALTER TABLE reflections ADD COLUMN alignment_activities_n INTEGER",
  "ALTER TABLE reflections ADD COLUMN top_three_status TEXT",
  "ALTER TABLE reflections ADD COLUMN braindump_raw TEXT",
]) {
  try {
    sqlite.exec(stmt);
  } catch {
    // Column already exists — ignore.
  }
}

// Stage 5 (2026-05-09) — Morning numerical tracking values.
//
// Maps each Reflection text label to a small ordinal integer where higher =
// "more positive / better day". Cognitive load is inverted (low load = 3).
// Direction matches what a chart-of-the-day would intuitively rank as good.
//
// The text columns remain the canonical UI source. These integers are a
// shadow for analytics. If a label has no mapping (e.g. an unknown legacy
// value), the numeric column stays NULL.
export const MORNING_LABEL_TO_NUM: Record<string, Record<string, number>> = {
  mood: { positive: 3, neutral: 2, strained: 1 },
  energyLabel: { high: 3, moderate: 2, low: 1 },
  cognitiveLoad: { low: 3, moderate: 2, high: 1 },
  sleepLabel: { restorative: 3, adequate: 2, poor: 1 },
  focus: { focused: 2, scattered: 1 },
  alignmentPeople: { aligned: 3, neutral: 2, disconnected: 1 },
  alignmentActivities: { aligned: 3, neutral: 2, misaligned: 1 },
};

// Camel-case label field -> camelCase Drizzle column key on morningRoutines
// (used in updateMorning's set() merge object).
const MORNING_NUM_DRIZZLE_KEY: Record<string, string> = {
  mood: "moodN",
  energyLabel: "energyN",
  cognitiveLoad: "cognitiveLoadN",
  sleepLabel: "sleepN",
  focus: "focusN",
  alignmentPeople: "alignmentPeopleN",
  alignmentActivities: "alignmentActivitiesN",
};

// Camel-case label field -> snake_case raw SQL column name (used in the
// boot-time backfill UPDATE statements).
const MORNING_NUM_SQL_COL: Record<string, string> = {
  mood: "mood_n",
  energyLabel: "energy_n",
  cognitiveLoad: "cognitive_load_n",
  sleepLabel: "sleep_n",
  focus: "focus_n",
  alignmentPeople: "alignment_people_n",
  alignmentActivities: "alignment_activities_n",
};

function labelToNum(field: string, value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = MORNING_LABEL_TO_NUM[field];
  if (!m) return null;
  return field in MORNING_LABEL_TO_NUM && value in m ? m[value] : null;
}

// One-shot idempotent backfill: populate *_n columns from existing text rows
// where the *_n cell is currently NULL. Cheap (one UPDATE per (field, value)
// pair, conditioned on IS NULL) and safe to re-run on every boot.
function backfillMorningNumericShadows(): void {
  const fieldToTextCol: Record<string, string> = {
    mood: "mood",
    energyLabel: "energy_label",
    cognitiveLoad: "cognitive_load",
    sleepLabel: "sleep_label",
    focus: "focus",
    alignmentPeople: "alignment_people",
    alignmentActivities: "alignment_activities",
  };
  for (const [field, mapping] of Object.entries(MORNING_LABEL_TO_NUM)) {
    const numCol = MORNING_NUM_SQL_COL[field];
    const textCol = fieldToTextCol[field];
    if (!numCol || !textCol) continue;
    for (const [labelValue, numValue] of Object.entries(mapping)) {
      try {
        sqlite
          .prepare(
            `UPDATE morning_routines SET ${numCol} = ? WHERE ${textCol} = ? AND ${numCol} IS NULL`,
          )
          .run(numValue, labelValue);
      } catch {
        // Column may not yet exist on a partially-migrated DB — ignore.
      }
    }
  }
}
try {
  backfillMorningNumericShadows();
} catch {
  // Never fail boot on a backfill error.
}

// ICS URL (including GitHub PAT) must be set via ANCHOR_ICS_URL env var.
// Never hardcode a PAT here — the server bundle ships to pplx.app.
const DEFAULT_ICS_URL = process.env.ANCHOR_ICS_URL ?? "";
// AUPFHS Outlook publish URL must be set via AUPFHS_ICS_URL env var.
// Even though it carries no token, the URL itself grants read access to the
// owner's work calendar — never hardcode it in the source bundle.
// User-set value via Settings overrides this.
const DEFAULT_AUPFHS_ICS_URL = process.env.AUPFHS_ICS_URL ?? "";

const DEFAULT_SETTINGS: SettingsBlob = {
  adhd_tax_coefficient: 1.5,
  briefing_time: "07:00",
  calendar_ics_url: DEFAULT_ICS_URL,
  aupfhs_ics_url: DEFAULT_AUPFHS_ICS_URL,
  timezone: "Australia/Melbourne",
  theme: "dark",
  habits_seeded: false,
  passphrase_hash: null,
};

// On every boot, if ANCHOR_ICS_URL env var is set, treat it as canonical
// and overwrite any stored value. This lets us rotate the GitHub PAT without
// having to wipe data.db. Persisted user-set URLs from /api/settings PATCH are
// preserved when the env var is unset.
if (DEFAULT_ICS_URL) {
  const cur = db.select().from(settings).get();
  if (cur) {
    try {
      const parsed = JSON.parse(cur.data) as SettingsBlob;
      let dirty = false;
      if (parsed.calendar_ics_url !== DEFAULT_ICS_URL) {
        parsed.calendar_ics_url = DEFAULT_ICS_URL;
        dirty = true;
        console.log("[storage] calendar_ics_url updated from ANCHOR_ICS_URL env var");
      }
      // Backfill aupfhs_ics_url if missing on existing rows.
      if (!parsed.aupfhs_ics_url && DEFAULT_AUPFHS_ICS_URL) {
        parsed.aupfhs_ics_url = DEFAULT_AUPFHS_ICS_URL;
        dirty = true;
        console.log("[storage] aupfhs_ics_url backfilled from default");
      }
      if (dirty) {
        db.update(settings).set({ data: JSON.stringify(parsed) }).where(eq(settings.id, cur.id)).run();
      }
    } catch {
      // settings row corrupt; will be re-seeded below
    }
  }
}

// Seed settings row if missing
{
  const existing = db.select().from(settings).get();
  if (!existing) {
    db.insert(settings).values({ data: JSON.stringify(DEFAULT_SETTINGS) }).run();
  }
}

// Backfill home_address / maps_provider on existing settings row (Feature 1).
{
  const cur = db.select().from(settings).get();
  if (cur) {
    try {
      const parsed = JSON.parse(cur.data) as SettingsBlob;
      let dirty = false;
      if (!parsed.home_address) {
        parsed.home_address = "Erskine St, North Melbourne VIC 3051";
        dirty = true;
      }
      if (!parsed.maps_provider) {
        parsed.maps_provider = "google";
        dirty = true;
      }
      if (dirty) {
        db.update(settings).set({ data: JSON.stringify(parsed) }).where(eq(settings.id, cur.id)).run();
      }
    } catch {
      // settings row corrupt; ignore
    }
  }
}

// Feature 1 — seed travel_locations with the user's 4 default locations
// if the table is empty. User can edit/delete via the Settings page CRUD UI.
{
  const count = (sqlite.prepare("SELECT COUNT(*) as c FROM travel_locations").get() as { c: number }).c;
  if (count === 0) {
    const now = Date.now();
    const seedRows = [
      { name: "Sandringham", keywords: "sandy,sandringham,sandringham hospital,sand hospital", nominalMinutes: 45, allowMinutes: 60, destinationAddress: "Sandringham Hospital, 193 Bluff Rd, Sandringham VIC 3191" },
      { name: "Peninsula", keywords: "peninsula,frankston,peninsula health", nominalMinutes: 60, allowMinutes: 90, destinationAddress: "Frankston Hospital, 2 Hastings Rd, Frankston VIC 3199" },
      { name: "Elgin Braybrook", keywords: "elgin braybrook,braybrook", nominalMinutes: 20, allowMinutes: 30, destinationAddress: "Elgin House Braybrook, Braybrook VIC" },
      { name: "Elgin Carlton", keywords: "elgin carlton,carlton,elgin house", nominalMinutes: 15, allowMinutes: 30, destinationAddress: "Elgin House Carlton, Carlton VIC" },
    ];
    for (const r of seedRows) {
      db.insert(travelLocations).values({
        name: r.name,
        keywords: r.keywords,
        nominalMinutes: r.nominalMinutes,
        allowMinutes: r.allowMinutes,
        destinationAddress: r.destinationAddress,
        notes: null,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
    console.log(`[storage] seeded ${seedRows.length} default travel_locations`);
  }
}

export class Storage {
  // ----- Tasks -----
  listTasks(): Task[] {
    return db.select().from(tasks).orderBy(desc(tasks.createdAt)).all();
  }
  getTask(id: number): Task | undefined {
    return db.select().from(tasks).where(eq(tasks.id, id)).get();
  }
  createTask(input: InsertTask): Task {
    return db
      .insert(tasks)
      .values({ ...input, createdAt: Date.now() })
      .returning()
      .get();
  }
  updateTask(id: number, patch: Partial<Task>): Task | undefined {
    const cur = this.getTask(id);
    const updates: any = { ...patch };
    if (patch.status === "done" && !patch.completedAt) {
      updates.completedAt = Date.now();
    }
    // If the task is linked to MS To Do and a sync-relevant field changed,
    // mark it dirty so the orchestrator picks it up next sync.
    const SYNC_RELEVANT = [
      "title",
      "status",
      "priority",
      "dueAt",
      "notes",
      "completedAt",
      "estimateMinutes",
    ];
    if (
      cur?.msTodoId &&
      Object.keys(patch).some((k) => SYNC_RELEVANT.includes(k)) &&
      patch.syncDirty === undefined
    ) {
      updates.syncDirty = 1;
    }
    db.update(tasks).set(updates).where(eq(tasks.id, id)).run();
    return this.getTask(id);
  }
  deleteTask(id: number) {
    const cur = this.getTask(id);
    // If the task is linked to MS To Do, soft-delete (drop) instead and
    // queue a remote completion so the orchestrator finalises it.
    if (cur?.msTodoId) {
      db.update(tasks)
        .set({ status: "dropped", syncDirty: 1, pendingAction: "complete-remote" })
        .where(eq(tasks.id, id))
        .run();
      return;
    }
    db.delete(tasks).where(eq(tasks.id, id)).run();
  }
  getTaskByMsId(msTodoId: string): Task | undefined {
    return db.select().from(tasks).where(eq(tasks.msTodoId, msTodoId)).get();
  }
  // Used by importer + sync engine: insert with explicit createdAt/sync fields.
  insertRawTask(row: Partial<Task> & { title: string; createdAt: number }): Task {
    return db.insert(tasks).values(row as any).returning().get();
  }

  // ----- Top three -----
  getTopThree(date: string): TopThree | undefined {
    return db.select().from(topThree).where(eq(topThree.date, date)).get();
  }
  setTopThree(date: string, ids: { taskId1?: number; taskId2?: number; taskId3?: number }): TopThree {
    const existing = this.getTopThree(date);
    if (existing) {
      db.update(topThree).set(ids).where(eq(topThree.date, date)).run();
      return this.getTopThree(date)!;
    }
    return db.insert(topThree).values({ date, ...ids }).returning().get();
  }
  lockTopThree(date: string): TopThree | undefined {
    db.update(topThree).set({ lockedAt: Date.now() }).where(eq(topThree.date, date)).run();
    return this.getTopThree(date);
  }
  /** Top-3 rows between two YYYY-MM-DD dates (inclusive), oldest first. */
  listTopThreeBetween(fromYmd: string, toYmd: string): TopThree[] {
    return db
      .select()
      .from(topThree)
      .where(
        and(
          gte(topThree.date, fromYmd),
          lte(topThree.date, toYmd),
        ),
      )
      .orderBy(topThree.date)
      .all();
  }

  // ----- Habits -----
  listHabits(): Habit[] {
    return db.select().from(habits).where(isNull(habits.archivedAt)).orderBy(habits.id).all();
  }
  createHabit(input: InsertHabit): Habit {
    return db
      .insert(habits)
      .values({ ...input, createdAt: Date.now() })
      .returning()
      .get();
  }
  updateHabit(id: number, patch: Partial<Habit>): Habit | undefined {
    db.update(habits).set(patch).where(eq(habits.id, id)).run();
    return db.select().from(habits).where(eq(habits.id, id)).get();
  }
  archiveHabit(id: number) {
    db.update(habits).set({ archivedAt: Date.now() }).where(eq(habits.id, id)).run();
  }
  deleteHabit(id: number) {
    db.delete(habits).where(eq(habits.id, id)).run();
    db.delete(habitLogs).where(eq(habitLogs.habitId, id)).run();
  }

  // ----- Habit logs -----
  listHabitLogs(fromDate?: string): HabitLog[] {
    if (fromDate) {
      return db.select().from(habitLogs).where(gte(habitLogs.date, fromDate)).all();
    }
    return db.select().from(habitLogs).all();
  }
  upsertHabitLog(input: InsertHabitLog): HabitLog {
    const existing = db
      .select()
      .from(habitLogs)
      .where(and(eq(habitLogs.habitId, input.habitId), eq(habitLogs.date, input.date)))
      .get();
    if (existing) {
      db.update(habitLogs)
        .set({ done: input.done ?? 0, note: input.note ?? null })
        .where(eq(habitLogs.id, existing.id))
        .run();
      return db.select().from(habitLogs).where(eq(habitLogs.id, existing.id)).get()!;
    }
    return db.insert(habitLogs).values(input).returning().get();
  }

  // ----- Time blocks -----
  listTimeBlocks(): TimeBlock[] {
    return db.select().from(timeBlocks).orderBy(timeBlocks.plannedStart).all();
  }
  createTimeBlock(input: InsertTimeBlock): TimeBlock {
    return db.insert(timeBlocks).values(input).returning().get();
  }
  updateTimeBlock(id: number, patch: Partial<TimeBlock>): TimeBlock | undefined {
    db.update(timeBlocks).set(patch).where(eq(timeBlocks.id, id)).run();
    return db.select().from(timeBlocks).where(eq(timeBlocks.id, id)).get();
  }
  deleteTimeBlock(id: number) {
    db.delete(timeBlocks).where(eq(timeBlocks.id, id)).run();
  }

  // ----- Reflections -----
  listReflections(): Reflection[] {
    return db.select().from(reflections).orderBy(desc(reflections.date)).all();
  }
  createReflection(input: InsertReflection): Reflection {
    // Stage 6 (2026-05-09): mirror Morning's Stage 5 dual-write so any
    // categorical chip label submitted from the Reflect page also populates
    // its numeric shadow column. Reuses MORNING_LABEL_TO_NUM verbatim so the
    // two pages share one mapping and one source of truth.
    const enriched: Record<string, unknown> = { ...input };
    for (const field of Object.keys(MORNING_LABEL_TO_NUM)) {
      if (field in enriched) {
        const numKey = MORNING_NUM_DRIZZLE_KEY[field];
        if (numKey) enriched[numKey] = labelToNum(field, enriched[field]);
      }
    }
    return db
      .insert(reflections)
      .values(enriched as InsertReflection)
      .returning()
      .get();
  }
  updateReflection(id: number, patch: Partial<Reflection>): Reflection | undefined {
    // Mirror createReflection's dual-write so PATCHes also update shadows.
    const enriched: Record<string, unknown> = { ...patch };
    for (const field of Object.keys(MORNING_LABEL_TO_NUM)) {
      if (field in enriched) {
        const numKey = MORNING_NUM_DRIZZLE_KEY[field];
        if (numKey) enriched[numKey] = labelToNum(field, enriched[field]);
      }
    }
    db.update(reflections).set(enriched).where(eq(reflections.id, id)).run();
    return db.select().from(reflections).where(eq(reflections.id, id)).get();
  }
  deleteReflection(id: number) {
    db.delete(reflections).where(eq(reflections.id, id)).run();
  }
  getReflectionsBetween(from: string, to: string): Reflection[] {
    return db
      .select()
      .from(reflections)
      .where(and(gte(reflections.date, from), lte(reflections.date, to)))
      .orderBy(desc(reflections.date))
      .all();
  }

  // ----- Goals -----
  listGoals(): Goal[] {
    return db.select().from(goals).orderBy(desc(goals.createdAt)).all();
  }
  createGoal(input: InsertGoal): Goal {
    return db
      .insert(goals)
      .values({ ...input, createdAt: Date.now() })
      .returning()
      .get();
  }
  updateGoal(id: number, patch: Partial<Goal>): Goal | undefined {
    db.update(goals).set(patch).where(eq(goals.id, id)).run();
    return db.select().from(goals).where(eq(goals.id, id)).get();
  }
  deleteGoal(id: number) {
    db.delete(goals).where(eq(goals.id, id)).run();
  }

  // ----- Settings -----
  getSettings(): SettingsBlob {
    const row = db.select().from(settings).get();
    if (!row) {
      return { ...DEFAULT_SETTINGS };
    }
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(row.data) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  updateSettings(patch: Partial<SettingsBlob>): SettingsBlob {
    const cur = this.getSettings();
    const merged = { ...cur, ...patch };
    const row = db.select().from(settings).get();
    if (row) {
      db.update(settings).set({ data: JSON.stringify(merged) }).where(eq(settings.id, row.id)).run();
    } else {
      db.insert(settings).values({ data: JSON.stringify(merged) }).run();
    }
    return merged;
  }

  // ----- Derived -----
  rollingAdhdTaxCoefficient(): number {
    // last 20 completed tasks where both estimate and actual are positive
    const rows = db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "done"),
          sql`${tasks.actualMinutes} IS NOT NULL`,
          sql`${tasks.estimateMinutes} > 0`,
        ),
      )
      .orderBy(desc(tasks.completedAt))
      .limit(20)
      .all();
    if (rows.length === 0) return this.getSettings().adhd_tax_coefficient;
    const ratios = rows.map((r) => (r.actualMinutes ?? 0) / Math.max(1, r.estimateMinutes));
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    return Math.round(avg * 100) / 100;
  }

  // ----- MS To Do lists (kept for import-mstodo script + Capture/Settings UI) -----
  getMsTodoListByMsId(msListId: string): MsTodoList | undefined {
    return db.select().from(msTodoLists).where(eq(msTodoLists.msListId, msListId)).get();
  }
  upsertMsTodoList(input: InsertMsTodoList): MsTodoList {
    const existing = this.getMsTodoListByMsId(input.msListId);
    if (existing) {
      db.update(msTodoLists).set(input).where(eq(msTodoLists.id, existing.id)).run();
      return db.select().from(msTodoLists).where(eq(msTodoLists.id, existing.id)).get()!;
    }
    return db.insert(msTodoLists).values(input).returning().get();
  }

  // ----- Sync log (still appended by import-mstodo) -----
  appendSyncLog(input: InsertSyncLog): SyncLog {
    return db.insert(syncLog).values(input).returning().get();
  }
  countImportedTasks(): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(tasks)
      .where(sql`${tasks.msTodoId} IS NOT NULL`)
      .get();
    return Number(r?.c ?? 0);
  }

  // ----- Morning routines -----
  getMorningByDate(date: string): MorningRoutine | undefined {
    return db.select().from(morningRoutines).where(eq(morningRoutines.date, date)).get();
  }
  ensureMorningForDate(date: string): MorningRoutine {
    const existing = this.getMorningByDate(date);
    if (existing) return existing;
    return db
      .insert(morningRoutines)
      .values({ date, startedAt: Date.now() })
      .returning()
      .get();
  }
  updateMorning(date: string, patch: Partial<MorningRoutine>): MorningRoutine | undefined {
    const existing = this.ensureMorningForDate(date);
    // Stage 5 dual-write: when a label field is being updated, also derive
    // and write its numeric shadow column. Setting the label to null clears
    // the shadow too. Unknown values (no mapping) leave the shadow at null.
    const merged: Record<string, unknown> = { ...patch };
    for (const labelField of Object.keys(MORNING_LABEL_TO_NUM)) {
      if (labelField in patch) {
        const drizzleKey = MORNING_NUM_DRIZZLE_KEY[labelField];
        if (!drizzleKey) continue;
        const v = (patch as any)[labelField];
        if (v === null || v === undefined) {
          (merged as any)[drizzleKey] = null;
        } else {
          (merged as any)[drizzleKey] = labelToNum(labelField, v);
        }
      }
    }
    db.update(morningRoutines).set(merged as any).where(eq(morningRoutines.id, existing.id)).run();
    return this.getMorningByDate(date);
  }
  recentMorningRoutines(limit = 7): MorningRoutine[] {
    return db
      .select()
      .from(morningRoutines)
      .orderBy(desc(morningRoutines.date))
      .limit(limit)
      .all();
  }

  // ----- Inbox scan queue -----
  insertInboxSuggestion(input: InsertInboxScan): InboxScanItem {
    return db.insert(inboxScanQueue).values(input).returning().get();
  }
  listInboxSuggestions(status?: string): InboxScanItem[] {
    if (status) {
      return db
        .select()
        .from(inboxScanQueue)
        .where(eq(inboxScanQueue.status, status))
        .orderBy(desc(inboxScanQueue.createdAt))
        .all();
    }
    return db
      .select()
      .from(inboxScanQueue)
      .orderBy(desc(inboxScanQueue.createdAt))
      .all();
  }
  getInboxSuggestion(id: number): InboxScanItem | undefined {
    return db.select().from(inboxScanQueue).where(eq(inboxScanQueue.id, id)).get();
  }
  decideInboxSuggestion(id: number, status: "approved" | "dismissed"): InboxScanItem | undefined {
    db.update(inboxScanQueue)
      .set({ status, decidedAt: Date.now() })
      .where(eq(inboxScanQueue.id, id))
      .run();
    return this.getInboxSuggestion(id);
  }
  countPendingInbox(): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(inboxScanQueue)
      .where(eq(inboxScanQueue.status, "pending"))
      .get();
    return Number(r?.c ?? 0);
  }

  // ----- Credit balances -----
  insertCreditBalance(balance: number, note?: string | null): { id: number; recordedAt: number; balance: number; note: string | null } {
    const recordedAt = Date.now();
    const result = sqlite.prepare(
      "INSERT INTO credit_balances (recordedAt, balance, note) VALUES (?, ?, ?) RETURNING id, recordedAt, balance, note"
    ).get(recordedAt, balance, note ?? null) as any;
    return result;
  }
  getLastTwoCreditBalances(): Array<{ id: number; recordedAt: number; balance: number; note: string | null }> {
    return sqlite.prepare(
      "SELECT id, recordedAt, balance, note FROM credit_balances ORDER BY recordedAt DESC LIMIT 2"
    ).all() as any[];
  }
  getCreditBalancesSince(since: number): Array<{ id: number; recordedAt: number; balance: number; note: string | null }> {
    return sqlite.prepare(
      "SELECT id, recordedAt, balance, note FROM credit_balances WHERE recordedAt > ? ORDER BY recordedAt ASC"
    ).all(since) as any[];
  }
  getRecentCreditBalances(limit = 14): Array<{ id: number; recordedAt: number; balance: number; note: string | null }> {
    return sqlite.prepare(
      "SELECT id, recordedAt, balance, note FROM credit_balances ORDER BY recordedAt DESC LIMIT ?"
    ).all(limit) as any[];
  }
  deleteCreditBalance(id: number): void {
    sqlite.prepare("DELETE FROM credit_balances WHERE id = ?").run(id);
  }
  getCreditBalancesBetween(from: number, to: number): Array<{ id: number; recordedAt: number; balance: number; note: string | null }> {
    return sqlite.prepare(
      "SELECT id, recordedAt, balance, note FROM credit_balances WHERE recordedAt >= ? AND recordedAt <= ? ORDER BY recordedAt ASC"
    ).all(from, to) as any[];
  }

  // ----- Cron runs -----
  insertCronRun(cronId: string, cronType: string, startedAt: number, endedAt?: number | null, ok = 1, notes?: string | null): { id: number } {
    const result = sqlite.prepare(
      "INSERT INTO cron_runs (cronId, cronType, startedAt, endedAt, ok, notes) VALUES (?, ?, ?, ?, ?, ?) RETURNING id"
    ).get(cronId, cronType, startedAt, endedAt ?? null, ok, notes ?? null) as any;
    return result;
  }
  getCronRunsSince(since: number): Array<{ id: number; cronId: string; cronType: string; startedAt: number; endedAt: number | null; ok: number; notes: string | null }> {
    return sqlite.prepare(
      "SELECT id, cronId, cronType, startedAt, endedAt, ok, notes FROM cron_runs WHERE startedAt > ? ORDER BY startedAt ASC"
    ).all(since) as any[];
  }
  getCronRunsBetween(from: number, to: number): Array<{ cronType: string }> {
    return sqlite.prepare(
      "SELECT cronType FROM cron_runs WHERE startedAt >= ? AND startedAt <= ?"
    ).all(from, to) as any[];
  }
  getCronRunCountsByType(since: number): Array<{ cronType: string; count: number }> {
    return sqlite.prepare(
      "SELECT cronType, COUNT(*) as count FROM cron_runs WHERE startedAt > ? GROUP BY cronType"
    ).all(since) as any[];
  }

  // ----- Credit estimates -----
  getAllCreditEstimates(): Array<{ cronType: string; perRunCredits: number; sampleCount: number; lastUpdatedAt: number | null }> {
    return sqlite.prepare("SELECT cronType, perRunCredits, sampleCount, lastUpdatedAt FROM credit_estimates").all() as any[];
  }
  updateCreditEstimate(cronType: string, perRunCredits: number, sampleCount: number): void {
    sqlite.prepare(
      "UPDATE credit_estimates SET perRunCredits = ?, sampleCount = ?, lastUpdatedAt = ? WHERE cronType = ?"
    ).run(perRunCredits, sampleCount, Date.now(), cronType);
  }

  // ----- Planner notes -----
  getPlannerNote(date: string): PlannerNote | undefined {
    return db.select().from(plannerNotes).where(eq(plannerNotes.date, date)).get();
  }
  upsertPlannerNote(date: string, note: string): PlannerNote {
    const existing = this.getPlannerNote(date);
    const updatedAt = Date.now();
    if (existing) {
      db.update(plannerNotes)
        .set({ note, updatedAt })
        .where(eq(plannerNotes.id, existing.id))
        .run();
      return this.getPlannerNote(date)!;
    }
    return db
      .insert(plannerNotes)
      .values({ date, note, updatedAt })
      .returning()
      .get();
  }
  listPlannerNotes(from: string, to: string): PlannerNote[] {
    return db
      .select()
      .from(plannerNotes)
      .where(and(gte(plannerNotes.date, from), lte(plannerNotes.date, to)))
      .all();
  }
  deletePlannerNote(date: string): void {
    db.delete(plannerNotes).where(eq(plannerNotes.date, date)).run();
  }

  // ===== Email Status =====
  listEmailStatus(includeDismissed = false): EmailStatusRow[] {
    if (includeDismissed) {
      return db.select().from(emailStatus).orderBy(desc(emailStatus.receivedAt)).all();
    }
    return db.select().from(emailStatus)
      .where(eq(emailStatus.status, "pending"))
      .orderBy(desc(emailStatus.receivedAt))
      .all();
  }
  upsertEmailStatus(input: InsertEmailStatus): EmailStatusRow {
    const now = Date.now();
    const existing = db.select().from(emailStatus).where(eq(emailStatus.messageId, input.messageId)).get();
    if (existing) {
      const updates: Partial<InsertEmailStatus> = { updatedAt: now };
      if (input.draftResponse !== undefined) updates.draftResponse = input.draftResponse;
      if (input.draftGeneratedAt !== undefined) updates.draftGeneratedAt = input.draftGeneratedAt;
      if (input.bodyPreview !== undefined) updates.bodyPreview = input.bodyPreview;
      if (input.isFlagged !== undefined) updates.isFlagged = input.isFlagged;
      if (input.importance !== undefined) updates.importance = input.importance;
      if (input.threadId !== undefined) updates.threadId = input.threadId;
      if (input.webLink !== undefined) updates.webLink = input.webLink;
      db.update(emailStatus).set(updates).where(eq(emailStatus.id, existing.id)).run();
      return db.select().from(emailStatus).where(eq(emailStatus.id, existing.id)).get()!;
    }
    return db.insert(emailStatus).values({ ...input, updatedAt: now }).returning().get();
  }
  setEmailStatusStatus(id: number, status: "pending" | "replied" | "dismissed"): void {
    const now = Date.now();
    const updates: any = { status, updatedAt: now };
    if (status === "dismissed") updates.dismissedAt = now;
    db.update(emailStatus).set(updates).where(eq(emailStatus.id, id)).run();
  }
  updateEmailDraft(id: number, draft: string): void {
    const now = Date.now();
    db.update(emailStatus)
      .set({ draftResponse: draft, draftGeneratedAt: now, updatedAt: now })
      .where(eq(emailStatus.id, id))
      .run();
  }
  /**
   * Re-evaluate priority on every stored email_status row using the canonical
   * shared/email-priority.ts evaluator. Only writes rows whose isFlagged value
   * actually changes. Returns counts for diagnostics. Idempotent.
   */
  recomputeAllEmailPriority(): { scanned: number; updated: number; flagged: number } {
    const rows = db.select().from(emailStatus).all();
    let updated = 0;
    let flagged = 0;
    const now = Date.now();
    for (const row of rows) {
      const { isPriority } = evaluateEmailPriority({
        sender: row.sender,
        subject: row.subject,
        bodyPreview: row.bodyPreview,
      });
      const next = isPriority ? 1 : 0;
      if (next !== row.isFlagged) {
        db.update(emailStatus)
          .set({ isFlagged: next, updatedAt: now })
          .where(eq(emailStatus.id, row.id))
          .run();
        updated++;
      }
      if (next === 1) flagged++;
    }
    return { scanned: rows.length, updated, flagged };
  }

  // ===== Projects =====
  listProjects(): Project[] {
    return db.select().from(projects).orderBy(projects.priority, projects.name).all();
  }
  getProject(id: number): Project | undefined {
    return db.select().from(projects).where(eq(projects.id, id)).get();
  }
  upsertProjectByListId(input: InsertProject): Project {
    const now = Date.now();
    if (input.msTodoListId) {
      const existing = db.select().from(projects).where(eq(projects.msTodoListId, input.msTodoListId)).get();
      if (existing) {
        const updates: any = { updatedAt: now };
        if (input.name) updates.name = input.name;
        if (input.status) updates.status = input.status;
        db.update(projects).set(updates).where(eq(projects.id, existing.id)).run();
        return db.select().from(projects).where(eq(projects.id, existing.id)).get()!;
      }
    }
    return db.insert(projects).values({ ...input, createdAt: now, updatedAt: now }).returning().get();
  }
  createProject(input: { name: string; status?: string; priority?: string; description?: string }): Project {
    const now = Date.now();
    return db.insert(projects).values({
      name: input.name,
      status: input.status || "active",
      priority: input.priority || "low",
      description: input.description || "",
      createdAt: now,
      updatedAt: now,
    }).returning().get();
  }
  updateProject(id: number, updates: Partial<InsertProject>): Project | undefined {
    db.update(projects).set({ ...updates, updatedAt: Date.now() }).where(eq(projects.id, id)).run();
    return this.getProject(id);
  }
  deleteProject(id: number): void {
    db.delete(projectTasks).where(eq(projectTasks.projectId, id)).run();
    db.delete(projectComponents).where(eq(projectComponents.projectId, id)).run();
    db.delete(projectPhases).where(eq(projectPhases.projectId, id)).run();
    db.delete(projects).where(eq(projects.id, id)).run();
  }

  listProjectPhases(projectId: number): ProjectPhase[] {
    return db.select().from(projectPhases)
      .where(eq(projectPhases.projectId, projectId))
      .orderBy(projectPhases.orderIndex)
      .all();
  }
  createProjectPhase(input: InsertProjectPhase): ProjectPhase {
    return db.insert(projectPhases).values({ ...input, createdAt: Date.now() }).returning().get();
  }
  updateProjectPhase(id: number, updates: Partial<InsertProjectPhase>): void {
    db.update(projectPhases).set(updates).where(eq(projectPhases.id, id)).run();
  }
  deleteProjectPhase(id: number): void {
    db.update(projectComponents).set({ phaseId: null }).where(eq(projectComponents.phaseId, id)).run();
    db.delete(projectPhases).where(eq(projectPhases.id, id)).run();
  }

  listProjectComponents(projectId: number): ProjectComponent[] {
    return db.select().from(projectComponents)
      .where(eq(projectComponents.projectId, projectId))
      .orderBy(projectComponents.orderIndex)
      .all();
  }
  createProjectComponent(input: InsertProjectComponent): ProjectComponent {
    return db.insert(projectComponents).values({ ...input, createdAt: Date.now() }).returning().get();
  }
  updateProjectComponent(id: number, updates: Partial<InsertProjectComponent>): void {
    db.update(projectComponents).set(updates).where(eq(projectComponents.id, id)).run();
  }
  deleteProjectComponent(id: number): void {
    db.update(projectTasks).set({ componentId: null }).where(eq(projectTasks.componentId, id)).run();
    db.delete(projectComponents).where(eq(projectComponents.id, id)).run();
  }

  listProjectTasks(projectId: number, options?: { unassignedOnly?: boolean }): ProjectTask[] {
    let q = db.select().from(projectTasks).where(eq(projectTasks.projectId, projectId));
    if (options?.unassignedOnly) {
      q = db.select().from(projectTasks).where(
        and(eq(projectTasks.projectId, projectId), isNull(projectTasks.componentId)),
      );
    }
    return q.orderBy(projectTasks.orderIndex, desc(projectTasks.createdAt)).all();
  }
  upsertProjectTaskByMsId(input: InsertProjectTask): ProjectTask {
    const now = Date.now();
    if (input.msTodoTaskId) {
      const existing = db.select().from(projectTasks).where(eq(projectTasks.msTodoTaskId, input.msTodoTaskId)).get();
      if (existing) {
        const updates: any = { updatedAt: now };
        if (input.title) updates.title = input.title;
        if (input.notes !== undefined) updates.notes = input.notes;
        if (input.deadline !== undefined) updates.deadline = input.deadline;
        if (input.completed !== undefined) updates.completed = input.completed;
        db.update(projectTasks).set(updates).where(eq(projectTasks.id, existing.id)).run();
        return db.select().from(projectTasks).where(eq(projectTasks.id, existing.id)).get()!;
      }
    }
    return db.insert(projectTasks).values({ ...input, createdAt: now, updatedAt: now }).returning().get();
  }
  createProjectTask(input: InsertProjectTask): ProjectTask {
    const now = Date.now();
    return db.insert(projectTasks).values({ ...input, createdAt: now, updatedAt: now }).returning().get();
  }
  updateProjectTask(id: number, updates: Partial<InsertProjectTask>): void {
    db.update(projectTasks).set({ ...updates, updatedAt: Date.now() }).where(eq(projectTasks.id, id)).run();
  }
  deleteProjectTask(id: number): void {
    db.delete(projectTasks).where(eq(projectTasks.id, id)).run();
  }

  seedDefaultHabitsIfNeeded() {
    const s = this.getSettings();
    if (s.habits_seeded) return;
    const defaults = [
      { name: "Sleep", target: "7+ hours" },
      { name: "Exercise", target: "30 min movement" },
      { name: "Family dinner", target: "Eat with family" },
      { name: "Deep work", target: "1× 90-min block" },
      { name: "Phone down by 10pm", target: "Off by 22:00" },
    ];
    for (const h of defaults) {
      db.insert(habits).values({ ...h, createdAt: Date.now() }).run();
    }
    this.updateSettings({ habits_seeded: true });
  }

  // ----- Daily factors -----
  getDailyFactors(date: string): DailyFactors | undefined {
    return db.select().from(dailyFactors).where(eq(dailyFactors.date, date)).get();
  }
  upsertDailyFactors(
    date: string,
    patch: Partial<InsertDailyFactors>,
  ): DailyFactors {
    const now = Date.now();
    const existing = this.getDailyFactors(date);
    if (existing) {
      db.update(dailyFactors)
        .set({ ...patch, updatedAt: now })
        .where(eq(dailyFactors.date, date))
        .run();
      return this.getDailyFactors(date)!;
    }
    return db
      .insert(dailyFactors)
      .values({
        date,
        mood: patch.mood ?? null,
        energy: patch.energy ?? null,
        cognitiveLoad: patch.cognitiveLoad ?? null,
        sleepQuality: patch.sleepQuality ?? null,
        focus: patch.focus ?? null,
        valuesAlignment: patch.valuesAlignment ?? null,
        capturedAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }
  listDailyFactorsBetween(from: string, to: string): DailyFactors[] {
    return db
      .select()
      .from(dailyFactors)
      .where(and(gte(dailyFactors.date, from), lte(dailyFactors.date, to)))
      .orderBy(dailyFactors.date)
      .all();
  }

  // ----- Issues -----
  listIssues(opts: { status?: string; from?: string; to?: string } = {}): Issue[] {
    const conds: any[] = [];
    if (opts.status) conds.push(eq(issues.status, opts.status));
    if (opts.from) conds.push(gte(issues.createdYmd, opts.from));
    if (opts.to) conds.push(lte(issues.createdYmd, opts.to));
    const q = conds.length
      ? db.select().from(issues).where(and(...conds))
      : db.select().from(issues);
    return q.orderBy(desc(issues.createdYmd), desc(issues.id)).all();
  }
  getIssue(id: number): Issue | undefined {
    return db.select().from(issues).where(eq(issues.id, id)).get();
  }
  createIssue(input: InsertIssue): Issue {
    const now = Date.now();
    return db
      .insert(issues)
      .values({ ...input, createdAt: now, updatedAt: now })
      .returning()
      .get();
  }
  updateIssue(id: number, patch: Partial<Issue>): Issue | undefined {
    db.update(issues)
      .set({ ...patch, updatedAt: Date.now() })
      .where(eq(issues.id, id))
      .run();
    return this.getIssue(id);
  }
  deleteIssue(id: number) {
    db.delete(issues).where(eq(issues.id, id)).run();
  }

  // ----- Travel locations (Feature 1) -----
  listTravelLocations(): TravelLocation[] {
    return db.select().from(travelLocations).orderBy(travelLocations.name).all();
  }
  getTravelLocation(id: number): TravelLocation | undefined {
    return db.select().from(travelLocations).where(eq(travelLocations.id, id)).get();
  }
  createTravelLocation(input: Omit<InsertTravelLocation, "createdAt" | "updatedAt">): TravelLocation {
    const now = Date.now();
    return db
      .insert(travelLocations)
      .values({ ...input, createdAt: now, updatedAt: now })
      .returning()
      .get();
  }
  updateTravelLocation(id: number, patch: Partial<InsertTravelLocation>): TravelLocation | undefined {
    db.update(travelLocations)
      .set({ ...patch, updatedAt: Date.now() })
      .where(eq(travelLocations.id, id))
      .run();
    return this.getTravelLocation(id);
  }
  deleteTravelLocation(id: number) {
    db.delete(travelLocations).where(eq(travelLocations.id, id)).run();
  }

  // ----- Travel overrides (per-event, keyed on UID) -----
  getTravelOverride(uid: string): TravelOverride | undefined {
    return db.select().from(travelOverrides).where(eq(travelOverrides.eventUid, uid)).get();
  }
  upsertTravelOverride(
    uid: string,
    patch: Partial<Pick<TravelOverride, "nominalMinutesOverride" | "allowMinutesOverride" | "locationIdOverride">>,
  ): TravelOverride {
    const existing = this.getTravelOverride(uid);
    if (existing) {
      db.update(travelOverrides)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(travelOverrides.eventUid, uid))
        .run();
      return this.getTravelOverride(uid)!;
    }
    return db
      .insert(travelOverrides)
      .values({
        eventUid: uid,
        nominalMinutesOverride: patch.nominalMinutesOverride ?? null,
        allowMinutesOverride: patch.allowMinutesOverride ?? null,
        locationIdOverride: patch.locationIdOverride ?? null,
        updatedAt: Date.now(),
      })
      .returning()
      .get();
  }
  deleteTravelOverride(uid: string) {
    db.delete(travelOverrides).where(eq(travelOverrides.eventUid, uid)).run();
  }

  // ----- Coach sessions (Feature 5) -----
  createCoachSession(input: Omit<InsertCoachSession, "startedAt">): CoachSession {
    return db
      .insert(coachSessions)
      .values({ ...input, startedAt: Date.now() })
      .returning()
      .get();
  }
  getCoachSession(id: number): CoachSession | undefined {
    return db.select().from(coachSessions).where(eq(coachSessions.id, id)).get();
  }
  listCoachSessions(limit = 25): CoachSession[] {
    return db.select().from(coachSessions).orderBy(desc(coachSessions.startedAt)).limit(limit).all();
  }
  /** Latest N sessions that have a non-null summary, newest first. Used to feed prior context. */
  listRecentCoachSessionSummaries(limit = 3): CoachSession[] {
    return db
      .select()
      .from(coachSessions)
      .where(sql`${coachSessions.summary} IS NOT NULL`)
      .orderBy(desc(coachSessions.startedAt))
      .limit(limit)
      .all();
  }
  updateCoachSession(id: number, patch: Partial<CoachSession>): CoachSession | undefined {
    db.update(coachSessions).set(patch).where(eq(coachSessions.id, id)).run();
    return this.getCoachSession(id);
  }
  deleteCoachSession(id: number) {
    // Hard delete + cascade messages.
    db.delete(coachMessages).where(eq(coachMessages.sessionId, id)).run();
    db.delete(coachSessions).where(eq(coachSessions.id, id)).run();
  }
  /**
   * Soft-archive a session: drop the transcript but keep the session row +
   * summary so history remains useful as long-running context. Sets
   * archivedAt to now.
   */
  archiveCoachSession(id: number): CoachSession | undefined {
    db.delete(coachMessages).where(eq(coachMessages.sessionId, id)).run();
    db.update(coachSessions)
      .set({ archivedAt: Date.now() })
      .where(eq(coachSessions.id, id))
      .run();
    return this.getCoachSession(id);
  }
  /**
   * Auto-archive sessions whose startedAt is older than `olderThanMs`. Only
   * archives ended sessions that still have transcripts. Returns the number
   * of sessions archived.
   */
  autoArchiveOldCoachSessions(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const targets = db
      .select()
      .from(coachSessions)
      .where(
        and(
          lte(coachSessions.startedAt, cutoff),
          sql`${coachSessions.archivedAt} IS NULL`,
          sql`${coachSessions.endedAt} IS NOT NULL`,
        ),
      )
      .all();
    let n = 0;
    for (const s of targets) {
      this.archiveCoachSession(s.id);
      n += 1;
    }
    return n;
  }

  /**
   * List ended coach sessions that have no summary yet and are not archived.
   * Used by the boot-time backfill worker. Ordered oldest-first so we keep
   * the historical record consistent.
   */
  listCoachSessionsNeedingSummary(limit = 50): CoachSession[] {
    return db
      .select()
      .from(coachSessions)
      .where(
        and(
          sql`${coachSessions.endedAt} IS NOT NULL`,
          sql`${coachSessions.summary} IS NULL`,
          sql`${coachSessions.archivedAt} IS NULL`,
        ),
      )
      .orderBy(coachSessions.startedAt)
      .limit(limit)
      .all();
  }

  // ----- Coach messages -----
  appendCoachMessage(input: Omit<InsertCoachMessage, "createdAt">): CoachMessage {
    return db
      .insert(coachMessages)
      .values({ ...input, createdAt: Date.now() })
      .returning()
      .get();
  }
  listCoachMessages(sessionId: number): CoachMessage[] {
    return db
      .select()
      .from(coachMessages)
      .where(eq(coachMessages.sessionId, sessionId))
      .orderBy(coachMessages.createdAt)
      .all();
  }
  countCoachMessages(sessionId: number): number {
    const row = sqlite
      .prepare("SELECT COUNT(*) as c FROM coach_messages WHERE session_id = ?")
      .get(sessionId) as { c: number };
    return row.c;
  }

  // ----- Coach session search (FTS5) -----
  /**
   * Full-text search across session summaries. Returns matched sessions
   * (newest first) with a snippet around the match. Empty/whitespace query
   * returns []. Tolerates malformed FTS5 syntax by falling back to no results.
   */
  searchCoachSessions(
    q: string,
    limit = 20,
  ): Array<{
    id: number;
    mode: string;
    startedAt: number;
    archivedAt: number | null;
    deepThink: number;
    summarySnippet: string;
  }> {
    const trimmed = q.trim();
    if (!trimmed) return [];
    // Quote each token to make it a phrase match; FTS5 tolerates duplicate
    // quotes and this avoids needing to validate operators.
    const tokens = trimmed
      .split(/\s+/)
      .map((t) => t.replace(/["']/g, ""))
      .filter(Boolean);
    if (tokens.length === 0) return [];
    const fts = tokens.map((t) => `"${t}"`).join(" ");
    try {
      const rows = sqlite
        .prepare(
          `SELECT cs.id as id,
                  cs.mode as mode,
                  cs.started_at as startedAt,
                  cs.archived_at as archivedAt,
                  cs.deep_think as deepThink,
                  snippet(coach_sessions_fts, 1, '<mark>', '</mark>', '...', 16) as summarySnippet
           FROM coach_sessions_fts
           JOIN coach_sessions cs ON cs.id = coach_sessions_fts.session_id
           WHERE coach_sessions_fts MATCH ?
           ORDER BY cs.started_at DESC
           LIMIT ?`,
        )
        .all(fts, limit) as Array<{
        id: number;
        mode: string;
        startedAt: number;
        archivedAt: number | null;
        deepThink: number;
        summarySnippet: string;
      }>;
      return rows;
    } catch {
      // Malformed FTS5 syntax or table missing — return empty quietly.
      return [];
    }
  }

  /**
   * Backfill coach_sessions_fts from existing coach_sessions rows that have
   * a summary. Idempotent (skips sessions already indexed). Returns the
   * number of rows inserted.
   */
  backfillCoachSessionsFts(): number {
    try {
      const rows = sqlite
        .prepare(
          `SELECT cs.id as id, cs.summary as summary
           FROM coach_sessions cs
           LEFT JOIN coach_sessions_fts f ON f.session_id = cs.id
           WHERE cs.summary IS NOT NULL AND f.session_id IS NULL`,
        )
        .all() as Array<{ id: number; summary: string }>;
      const insert = sqlite.prepare(
        "INSERT INTO coach_sessions_fts(session_id, summary) VALUES (?, ?)",
      );
      const tx = sqlite.transaction((batch: Array<{ id: number; summary: string }>) => {
        for (const r of batch) insert.run(r.id, r.summary);
      });
      tx(rows);
      return rows.length;
    } catch {
      return 0;
    }
  }

  // ----- Coach context-bundle telemetry -----
  recordCoachContextUsage(input: {
    sessionId: number;
    messageId?: number | null;
    mode: string;
    bundleKeysPresent: string[];
    bundleKeysReferenced: string[];
  }): void {
    try {
      sqlite
        .prepare(
          `INSERT INTO coach_context_usage
             (session_id, message_id, mode, bundle_keys_present, bundle_keys_referenced, reference_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.sessionId,
          input.messageId ?? null,
          input.mode,
          JSON.stringify(input.bundleKeysPresent),
          JSON.stringify(input.bundleKeysReferenced),
          input.bundleKeysReferenced.length,
          Date.now(),
        );
    } catch (err) {
      // Telemetry failures must never break the coach turn.
      // eslint-disable-next-line no-console
      console.warn("[storage] recordCoachContextUsage failed:", err);
    }
  }

  /**
   * Delete coach_context_usage rows older than `days` days. Returns the
   * number of rows removed. Called by the daily retention sweep.
   */
  pruneCoachContextUsage(days = 90): number {
    try {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const r = sqlite
        .prepare(`DELETE FROM coach_context_usage WHERE created_at < ?`)
        .run(cutoff);
      return Number((r as { changes?: number }).changes ?? 0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[storage] pruneCoachContextUsage failed:", err);
      return 0;
    }
  }

  /**
   * Aggregate bundle-key reference counts over the last `days` days. Used by
   * admin Health card to show which context fields the model actually leans
   * on. Returns array of {key, hits, sessions}.
   */
  summariseCoachContextUsage(days = 30): Array<{ key: string; hits: number; sessions: number }> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = sqlite
      .prepare(
        `SELECT bundle_keys_referenced, session_id
         FROM coach_context_usage
         WHERE created_at >= ?`,
      )
      .all(cutoff) as Array<{ bundle_keys_referenced: string; session_id: number }>;
    const hits = new Map<string, number>();
    const sessions = new Map<string, Set<number>>();
    for (const r of rows) {
      let keys: string[] = [];
      try {
        keys = JSON.parse(r.bundle_keys_referenced);
      } catch {
        keys = [];
      }
      for (const k of keys) {
        hits.set(k, (hits.get(k) ?? 0) + 1);
        if (!sessions.has(k)) sessions.set(k, new Set());
        sessions.get(k)!.add(r.session_id);
      }
    }
    const out = Array.from(hits.entries()).map(([key, n]) => ({
      key,
      hits: n,
      sessions: sessions.get(key)?.size ?? 0,
    }));
    out.sort((a, b) => b.hits - a.hits);
    return out;
  }

  // ----- Backup receipts -----
  recordBackupReceipt(input: {
    onedriveUrl: string;
    mtime?: number | null;
    sizeBytes?: number | null;
    note?: string | null;
  }): { id: number; createdAt: number } {
    const createdAt = Date.now();
    const result = sqlite
      .prepare(
        `INSERT INTO backup_receipts (onedrive_url, mtime, size_bytes, note, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.onedriveUrl,
        input.mtime ?? null,
        input.sizeBytes ?? null,
        input.note ?? null,
        createdAt,
      );
    return { id: Number(result.lastInsertRowid), createdAt };
  }

  latestBackupReceipt(): {
    id: number;
    onedriveUrl: string;
    mtime: number | null;
    sizeBytes: number | null;
    note: string | null;
    createdAt: number;
  } | null {
    const row = sqlite
      .prepare(
        `SELECT id, onedrive_url as onedriveUrl, mtime, size_bytes as sizeBytes, note, created_at as createdAt
         FROM backup_receipts
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get() as
      | {
          id: number;
          onedriveUrl: string;
          mtime: number | null;
          sizeBytes: number | null;
          note: string | null;
          createdAt: number;
        }
      | undefined;
    return row ?? null;
  }

  // ----- Cron heartbeats (Option 3 canary) -----
  // Each known cron POSTs a heartbeat as step 0 of its task body. Anomalies
  // (unknown cronId, off-window fire, double-fire) are recorded in
  // anomaly_reason and surfaced by the Admin UI plus the in-memory error ring.
  recordCronHeartbeat(input: {
    cronId: string;
    ranAt: number;
    anomalyReason?: string | null;
  }): { id: number; createdAt: number } {
    const createdAt = Date.now();
    const result = sqlite
      .prepare(
        `INSERT INTO cron_heartbeats (cron_id, ran_at, anomaly_reason, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.cronId,
        input.ranAt,
        input.anomalyReason ?? null,
        createdAt,
      );
    // Prune to last 365 rows globally — heartbeats are <10/week so this gives
    // ~7 years of headroom, but the cap protects against runaway double-fires.
    try {
      sqlite.exec(
        `DELETE FROM cron_heartbeats WHERE id NOT IN (
           SELECT id FROM cron_heartbeats ORDER BY created_at DESC LIMIT 365
         )`,
      );
    } catch {
      /* swallow — pruning is best-effort */
    }
    return { id: Number(result.lastInsertRowid), createdAt };
  }

  /**
   * Latest heartbeat for a single cron id, or null if never recorded.
   */
  latestCronHeartbeat(cronId: string): {
    id: number;
    cronId: string;
    ranAt: number;
    anomalyReason: string | null;
    createdAt: number;
  } | null {
    const row = sqlite
      .prepare(
        `SELECT id, cron_id as cronId, ran_at as ranAt, anomaly_reason as anomalyReason, created_at as createdAt
         FROM cron_heartbeats
         WHERE cron_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(cronId) as
      | {
          id: number;
          cronId: string;
          ranAt: number;
          anomalyReason: string | null;
          createdAt: number;
        }
      | undefined;
    return row ?? null;
  }

  /**
   * Most-recent N heartbeats across all crons (default 50).
   */
  recentCronHeartbeats(limit = 50): Array<{
    id: number;
    cronId: string;
    ranAt: number;
    anomalyReason: string | null;
    createdAt: number;
  }> {
    const n = Math.max(1, Math.min(Math.floor(limit), 365));
    const rows = sqlite
      .prepare(
        `SELECT id, cron_id as cronId, ran_at as ranAt, anomaly_reason as anomalyReason, created_at as createdAt
         FROM cron_heartbeats
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(n) as Array<{
      id: number;
      cronId: string;
      ranAt: number;
      anomalyReason: string | null;
      createdAt: number;
    }>;
    return rows;
  }

  /**
   * Heartbeats within the last `withinSeconds` for a given cron, oldest first.
   * Used by anomaly detection to spot double-fires.
   */
  cronHeartbeatsSince(cronId: string, sinceUnixMs: number): Array<{
    id: number;
    ranAt: number;
    createdAt: number;
  }> {
    const rows = sqlite
      .prepare(
        `SELECT id, ran_at as ranAt, created_at as createdAt
         FROM cron_heartbeats
         WHERE cron_id = ? AND created_at >= ?
         ORDER BY created_at ASC`,
      )
      .all(cronId, sinceUnixMs) as Array<{
      id: number;
      ranAt: number;
      createdAt: number;
    }>;
    return rows;
  }
}

export const storage = new Storage();

// Coach session retention: on boot, auto-archive any ended sessions older
// than 90 days (drops transcript, keeps row + summary).
try {
  const NINETY_DAYS_MS = 90 * 24 * 3600 * 1000;
  const archived = storage.autoArchiveOldCoachSessions(NINETY_DAYS_MS);
  if (archived > 0) {
    // eslint-disable-next-line no-console
    console.log(`[storage] auto-archived ${archived} coach session(s) older than 90 days`);
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[storage] coach auto-archive failed:", err);
}

// Backfill FTS5 index for any sessions that already have summaries (first
// boot after the FTS5 table was added).
try {
  const n = storage.backfillCoachSessionsFts();
  if (n > 0) {
    // eslint-disable-next-line no-console
    console.log(`[storage] backfilled ${n} coach session summary(ies) into FTS5 index`);
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[storage] coach FTS backfill failed:", err);
}
// Email priority backfill: re-evaluate isFlagged on every existing
// email_status row using the canonical shared evaluator. This repairs the
// 2026-05-08 cron-side regression in which priority hits were stored with
// isFlagged=0. Idempotent: only writes rows whose flag value changes.
try {
  const r = storage.recomputeAllEmailPriority();
  if (r.updated > 0) {
    // eslint-disable-next-line no-console
    console.log(`[storage] email-priority backfill: scanned=${r.scanned} updated=${r.updated} flagged=${r.flagged}`);
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[storage] email-priority backfill failed:", err);
}

storage.seedDefaultHabitsIfNeeded();
