import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Tasks
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  status: text("status").notNull().default("todo"), // todo / doing / done / dropped
  priority: text("priority").notNull().default("iftime"), // anchor / deadline / deep / maintenance / iftime
  domain: text("domain").notNull().default("work"), // family / work / medicolegal / personal / health
  estimateMinutes: integer("estimate_minutes").notNull().default(30),
  actualMinutes: integer("actual_minutes"),
  dueAt: integer("due_at"), // unix ms
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
  notes: text("notes"),
  // ----- Microsoft To Do sync fields -----
  msTodoId: text("ms_todo_id").unique(), // Graph task id; null for Anchor-only tasks
  msTodoListId: text("ms_todo_list_id"), // Graph list id
  msTodoEtag: text("ms_todo_etag"), // @odata.etag for change detection
  lastSyncedAt: integer("last_synced_at"), // unix ms
  syncDirty: integer("sync_dirty").notNull().default(0), // 0/1
  tag: text("tag"), // free-form tag, mirrors MS list name when synced
  fromBraindump: integer("from_braindump").notNull().default(0), // 1 if created from a Morning braindump
  pendingAction: text("pending_action"), // e.g. "complete-remote" — for sync engine
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  completedAt: true,
  actualMinutes: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// MS To Do lists
export const msTodoLists = sqliteTable("ms_todo_lists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  msListId: text("ms_list_id").notNull().unique(),
  name: text("name").notNull(),
  defaultDomain: text("default_domain").notNull().default("work"),
  isDefaultTarget: integer("is_default_target").notNull().default(0),
  enabled: integer("enabled").notNull().default(1),
});

export const insertMsTodoListSchema = createInsertSchema(msTodoLists).omit({ id: true });
export type InsertMsTodoList = z.infer<typeof insertMsTodoListSchema>;
export type MsTodoList = typeof msTodoLists.$inferSelect;

// Sync log
export const syncLog = sqliteTable("sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at").notNull(),
  kind: text("kind").notNull(), // import / pull / push / error
  msTaskId: text("ms_task_id"),
  summary: text("summary").notNull(),
  detail: text("detail"),
});

export const insertSyncLogSchema = createInsertSchema(syncLog).omit({ id: true });
export type InsertSyncLog = z.infer<typeof insertSyncLogSchema>;
export type SyncLog = typeof syncLog.$inferSelect;

// Top three for a date
export const topThree = sqliteTable("top_three", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(), // YYYY-MM-DD
  taskId1: integer("task_id1"),
  taskId2: integer("task_id2"),
  taskId3: integer("task_id3"),
  lockedAt: integer("locked_at"),
});

export const insertTopThreeSchema = createInsertSchema(topThree).omit({ id: true });
export type InsertTopThree = z.infer<typeof insertTopThreeSchema>;
export type TopThree = typeof topThree.$inferSelect;

// Habits
export const habits = sqliteTable("habits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  target: text("target").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  archivedAt: integer("archived_at"),
});

export const insertHabitSchema = createInsertSchema(habits).omit({
  id: true,
  createdAt: true,
  archivedAt: true,
});
export type InsertHabit = z.infer<typeof insertHabitSchema>;
export type Habit = typeof habits.$inferSelect;

// Habit logs
export const habitLogs = sqliteTable("habit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  habitId: integer("habit_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  done: integer("done").notNull().default(0),
  note: text("note"),
});

export const insertHabitLogSchema = createInsertSchema(habitLogs).omit({ id: true });
export type InsertHabitLog = z.infer<typeof insertHabitLogSchema>;
export type HabitLog = typeof habitLogs.$inferSelect;

// Time blocks
export const timeBlocks = sqliteTable("time_blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id"),
  plannedStart: integer("planned_start").notNull(),
  plannedEnd: integer("planned_end").notNull(),
  actualStart: integer("actual_start"),
  actualEnd: integer("actual_end"),
  kind: text("kind").notNull().default("focus"), // focus / admin / transition / break
});

export const insertTimeBlockSchema = createInsertSchema(timeBlocks).omit({ id: true });
export type InsertTimeBlock = z.infer<typeof insertTimeBlockSchema>;
export type TimeBlock = typeof timeBlocks.$inferSelect;

// Reflections
export const reflections = sqliteTable("reflections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  kind: text("kind").notNull().default("daily"), // daily / weekly / quarterly
  // Legacy daily-reflection fields (kept for historical analytics; new
  // submissions from the Stage 6 Reflect UI leave these NULL).
  energy: integer("energy"), // legacy 1-5
  state: text("state"), // legacy calm / anxious / scattered / flat
  avoidedTask: text("avoided_task"),
  notes: text("notes"),
  // Reflect page restructure (Stage 6 — 2026-05-09):
  // Evening habit tickboxes mirroring Morning's habit pattern.
  medicationDone: integer("medication_done"),
  bedBy11pmDone: integer("bed_by_11pm_done"),
  // Reflect-aligned chip labels matching the Morning reflection chips so
  // both pages share the same ChipOption arrays from morningOptions.tsx and
  // tracking is comparable across morning + evening.
  arousalState: text("arousal_state"), // hypo | calm | hyper
  mood: text("mood"), // positive | neutral | strained
  cognitiveLoad: text("cognitive_load"), // high | moderate | low
  energyLabel: text("energy_label"), // low | moderate | high
  sleepLabel: text("sleep_label"), // restorative | adequate | poor
  focus: text("focus"), // focused | scattered
  alignmentPeople: text("alignment_people"), // aligned | neutral | disconnected
  alignmentActivities: text("alignment_activities"), // aligned | neutral | misaligned
  // Numeric shadow columns matching the Stage 5 mapping. Text columns above
  // remain canonical; these mirror categorical labels onto a small ordinal
  // scale for charts/correlations. Mapping in server/storage.ts (same
  // MORNING_LABEL_TO_NUM table reused; no shadow for arousalState).
  moodN: integer("mood_n"),
  cognitiveLoadN: integer("cognitive_load_n"),
  energyN: integer("energy_n"),
  sleepN: integer("sleep_n"),
  focusN: integer("focus_n"),
  alignmentPeopleN: integer("alignment_people_n"),
  alignmentActivitiesN: integer("alignment_activities_n"),
  // Top-3 status snapshot at reflect-time (JSON array of {id, done} pairs).
  // Optional: lets a row record the per-task tick state at end-of-day even if
  // the underlying task is later re-opened. Read from /api/top-three when
  // rendering live state.
  topThreeStatus: text("top_three_status"),
  // Optional braindump captured during the evening reflection.
  braindumpRaw: text("braindump_raw"),
});

export const insertReflectionSchema = createInsertSchema(reflections).omit({ id: true });
export type InsertReflection = z.infer<typeof insertReflectionSchema>;
export type Reflection = typeof reflections.$inferSelect;

// Goals
export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  horizon: text("horizon").notNull().default("quarter"), // quarter / year
  title: text("title").notNull(),
  why: text("why"),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at").notNull(),
});

export const insertGoalSchema = createInsertSchema(goals).omit({ id: true, createdAt: true });
export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type Goal = typeof goals.$inferSelect;

// Morning routines (one row per local YYYY-MM-DD)
export const morningRoutines = sqliteTable("morning_routines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  // Legacy 1–5 numeric columns (kept for historical analytics, no longer
  // written by the Morning UI as of 2026-05-09). New label columns below.
  energy: integer("energy"),
  state: text("state"),
  sleepQuality: integer("sleep_quality"),
  gratitude: text("gratitude"),
  avoidedTask: text("avoided_task"),
  notes: text("notes"),
  braindumpRaw: text("braindump_raw"),
  braindumpTaskIds: text("braindump_task_ids"),
  topThreeIds: text("top_three_ids"),
  expressMode: integer("express_mode").notNull().default(0),
  // Morning habits (added 2026-05-09): tickbox completions for the Morning page.
  breathingDone: integer("breathing_done").notNull().default(0),
  medicationDone: integer("medication_done").notNull().default(0),
  // Reflection check-in fields surfaced on the Morning page (added 2026-05-09).
  // Mirror of the lighter dailyFactors row, but stored on the morning routine
  // so the Morning page is self-contained and can lock without a second API.
  mood: text("mood"), // positive | neutral | strained
  cognitiveLoad: text("cognitive_load"), // high | moderate | low
  alignment: text("alignment"), // legacy yes | no — kept nullable for backward compatibility; superseded by alignmentPeople + alignmentActivities (added 2026-05-09)
  // Two-axis alignment split (added 2026-05-09):
  alignmentPeople: text("alignment_people"), // aligned | neutral | disconnected
  alignmentActivities: text("alignment_activities"), // aligned | neutral | misaligned
  // Reflect-aligned text labels (added 2026-05-09): same option set as the
  // Reflect Mood & Factors check-in, so Morning + Reflect tracking is comparable.
  energyLabel: text("energy_label"), // low | moderate | high
  sleepLabel: text("sleep_label"), // restorative | adequate | poor
  focus: text("focus"), // focused | scattered
  // Numeric shadows for analytics (added 2026-05-09 — Stage 5).
  // Text columns above remain the canonical UI source; these mirror the
  // categorical labels onto a small ordinal scale for charts/correlations.
  // Mapping is defined in server/storage.ts (MORNING_LABEL_TO_NUM).
  moodN: integer("mood_n"),
  energyN: integer("energy_n"),
  cognitiveLoadN: integer("cognitive_load_n"),
  sleepN: integer("sleep_n"),
  focusN: integer("focus_n"),
  alignmentPeopleN: integer("alignment_people_n"),
  alignmentActivitiesN: integer("alignment_activities_n"),
});

export const insertMorningRoutineSchema = createInsertSchema(morningRoutines).omit({ id: true });
export type InsertMorningRoutine = z.infer<typeof insertMorningRoutineSchema>;
export type MorningRoutine = typeof morningRoutines.$inferSelect;

// Stage 7 (2026-05-10) — Unified daily check-ins table.
//
// Single source of truth for chip-style reflection state across
// morning / midday / evening / adhoc captures. Coexists with
// morning_routines + reflections (which keep their operational fields
// — top-3, braindump, weekly review, evening habits — in Stage 7).
// Reads remain on the legacy tables in Stage 7; Stage 10 switches.
//
// Logical uniqueness is on (date, phase, source) — same source posting
// again the same day in the same phase updates the existing row;
// different source same phase creates a new row (so coach_pre_session
// can coexist with morning_page on the same morning). The unique
// compound index is created in server/storage.ts so we can also have
// the supporting indexes for read patterns.
//
// Note on PK: every other table in this schema uses an autoincrement
// integer PK, so daily_check_ins follows that convention rather than
// the uuid suggested in the master prompt — it keeps the codebase
// uniform and lets ON CONFLICT(date, phase, source) drive the upsert.
export const dailyCheckIns = sqliteTable("daily_check_ins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD (Melbourne local)
  phase: text("phase").notNull(), // morning | midday | evening | adhoc
  source: text("source").notNull(), // morning_page | evening_page | checkin_page | coach_pre_session
  capturedAt: integer("captured_at").notNull(), // unix ms
  // Chip text columns — same option set as Morning + Reflect.
  arousalState: text("arousal_state"),
  mood: text("mood"), // positive | neutral | strained
  cognitiveLoad: text("cognitive_load"), // high | moderate | low
  energyLabel: text("energy_label"), // low | moderate | high
  sleepLabel: text("sleep_label"), // restorative | adequate | poor
  focus: text("focus"), // focused | scattered
  alignmentPeople: text("alignment_people"), // aligned | neutral | disconnected
  alignmentActivities: text("alignment_activities"), // aligned | neutral | misaligned
  // Numeric shadows — same Stage 5 mapping in shared/checkin-mapping.ts.
  moodN: integer("mood_n"),
  cognitiveLoadN: integer("cognitive_load_n"),
  energyN: integer("energy_n"),
  sleepN: integer("sleep_n"),
  focusN: integer("focus_n"),
  alignmentPeopleN: integer("alignment_people_n"),
  alignmentActivitiesN: integer("alignment_activities_n"),
  // Optional free-text note (e.g. one-liner from the /checkin page).
  note: text("note"),
});

export const insertDailyCheckInSchema = createInsertSchema(dailyCheckIns).omit({
  id: true,
  capturedAt: true,
});
export type InsertDailyCheckIn = z.infer<typeof insertDailyCheckInSchema>;
export type DailyCheckIn = typeof dailyCheckIns.$inferSelect;

// Daily factors (mood + lightweight measures, one row per local YYYY-MM-DD)
// All measure columns nullable so the user can fill in progressively.
export const dailyFactors = sqliteTable("daily_factors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(), // YYYY-MM-DD (local, AEST/AEDT)
  mood: text("mood"), // positive | neutral | strained
  energy: text("energy"), // low | moderate | high
  cognitiveLoad: text("cognitive_load"), // high | moderate | low
  sleepQuality: text("sleep_quality"), // restorative | adequate | poor
  focus: text("focus"), // focused | scattered
  valuesAlignment: text("values_alignment"), // aligned | neutral | misaligned
  capturedAt: integer("captured_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const insertDailyFactorsSchema = createInsertSchema(dailyFactors).omit({
  id: true,
  capturedAt: true,
  updatedAt: true,
});
export type InsertDailyFactors = z.infer<typeof insertDailyFactorsSchema>;
export type DailyFactors = typeof dailyFactors.$inferSelect;

// Contextual life issues log
// Categorical, non-judgemental signals that may correlate with mood/energy.
export const issues = sqliteTable("issues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdYmd: text("created_ymd").notNull(), // YYYY-MM-DD the issue was logged against
  category: text("category").notNull(), // relationship | house | kids | work | other
  note: text("note"), // optional single-line context
  needSupport: integer("need_support").notNull().default(0), // 0/1
  supportType: text("support_type"), // listen | problem_solve | practical (only when needSupport=1)
  status: text("status").notNull().default("open"), // open | ongoing | resolved
  resolvedYmd: text("resolved_ymd"), // set when status -> resolved
  sourcePage: text("source_page").notNull().default("reflect"), // morning | reflect | issues
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const insertIssueSchema = createInsertSchema(issues).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertIssue = z.infer<typeof insertIssueSchema>;
export type Issue = typeof issues.$inferSelect;

// Sync queue (orchestrator drives this)
export const syncQueue = sqliteTable("sync_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(), // pull-list / push-task / complete-task
  payload: text("payload").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
  processedAt: integer("processed_at"),
  error: text("error"),
});

export const insertSyncQueueSchema = createInsertSchema(syncQueue).omit({ id: true });
export type InsertSyncQueue = z.infer<typeof insertSyncQueueSchema>;
export type SyncQueueItem = typeof syncQueue.$inferSelect;

// Inbox-scan queue (orchestrator pushes scan results here for human approval)
export const inboxScanQueue = sqliteTable("inbox_scan_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceMessageId: text("source_message_id"),
  subject: text("subject"),
  fromAddress: text("from_address"),
  receivedAt: integer("received_at"),
  suggestedAction: text("suggested_action").notNull().default("{}"), // JSON
  status: text("status").notNull().default("pending"), // pending / approved / dismissed
  createdAt: integer("created_at").notNull(),
  decidedAt: integer("decided_at"),
});

export const insertInboxScanSchema = createInsertSchema(inboxScanQueue).omit({ id: true });
export type InsertInboxScan = z.infer<typeof insertInboxScanSchema>;
export type InboxScanItem = typeof inboxScanQueue.$inferSelect;

// Settings (single row JSON blob)
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  data: text("data").notNull().default("{}"),
});

export type Settings = typeof settings.$inferSelect;

export interface SettingsBlob {
  adhd_tax_coefficient: number;
  briefing_time: string; // HH:MM
  calendar_ics_url: string;
  // Optional secondary public ICS feed (e.g. AUPFHS Outlook publish URL).
  // Events are merged into the planner with a configurable summary prefix.
  aupfhs_ics_url?: string;
  timezone: string;
  theme: "light" | "dark" | "system";
  habits_seeded: boolean;
  passphrase_hash: string | null;
  // Feature 1 — travel time defaults
  home_address?: string; // free text, fed into Google Maps origin
  maps_provider?: "google"; // reserved for future Apple Maps support
  // Coach context-bundle telemetry kill switch. Default true.
  // When false, /api/coach/sessions/:id/turn skips the telemetry write to
  // coach_context_usage and the daily retention sweep is a no-op.
  coach_telemetry_enabled?: boolean;
}

// Feature 1 — Travel locations (static lookup table)
// Matched against event title/location/description by keyword substring.
export const travelLocations = sqliteTable("travel_locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Comma-separated, lowercase. Matched as case-insensitive substrings.
  keywords: text("keywords").notNull().default(""),
  nominalMinutes: integer("nominal_minutes").notNull(), // typical drive time
  allowMinutes: integer("allow_minutes").notNull(), // recommended buffer
  destinationAddress: text("destination_address"), // optional, fed to Maps
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export type TravelLocation = typeof travelLocations.$inferSelect;
export type InsertTravelLocation = typeof travelLocations.$inferInsert;

// Per-event override on top of the matched location. Keyed on event UID
// because events come from ICS feeds (not stored in our DB).
export const travelOverrides = sqliteTable("travel_overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventUid: text("event_uid").notNull().unique(),
  nominalMinutesOverride: integer("nominal_minutes_override"),
  allowMinutesOverride: integer("allow_minutes_override"),
  // Optional manual location pin (e.g. when the keyword match is wrong).
  locationIdOverride: integer("location_id_override"),
  updatedAt: integer("updated_at").notNull(),
});
export type TravelOverride = typeof travelOverrides.$inferSelect;
export type InsertTravelOverride = typeof travelOverrides.$inferInsert;

// Planner notes (free-form per-day notes for the /planner page)
export const plannerNotes = sqliteTable("planner_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(), // YYYY-MM-DD
  note: text("note").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
});

export const insertPlannerNoteSchema = createInsertSchema(plannerNotes).omit({
  id: true,
  updatedAt: true,
});
export type InsertPlannerNote = z.infer<typeof insertPlannerNoteSchema>;
export type PlannerNote = typeof plannerNotes.$inferSelect;

// Auth sessions (single-user passphrase gate)
export const authSessions = sqliteTable("auth_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull().unique(), // sha256 hex of the cookie token
  deviceLabel: text("device_label"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  revokedAt: integer("revoked_at"),
});

export type AuthSession = typeof authSessions.$inferSelect;
export type InsertAuthSession = typeof authSessions.$inferInsert;

// Email Status: high-priority unanswered emails
export const emailStatus = sqliteTable("email_status", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: text("message_id").notNull().unique(),
  threadId: text("thread_id"),
  receivedAt: integer("received_at").notNull(),
  sender: text("sender").notNull(),
  subject: text("subject").notNull().default(""),
  bodyPreview: text("body_preview").notNull().default(""),
  importance: text("importance"),
  isFlagged: integer("is_flagged").notNull().default(0),
  draftResponse: text("draft_response"),
  draftGeneratedAt: integer("draft_generated_at"),
  status: text("status").notNull().default("pending"), // pending | replied | dismissed
  dismissedAt: integer("dismissed_at"),
  webLink: text("web_link"),
  updatedAt: integer("updated_at").notNull(),
});
export type EmailStatusRow = typeof emailStatus.$inferSelect;
export type InsertEmailStatus = typeof emailStatus.$inferInsert;

// Projects (mapped from MS To Do `: Active` / `: Parked` lists)
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  msTodoListId: text("ms_todo_list_id").unique(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"), // active | parked
  priority: text("priority").notNull().default("low"), // high | low
  description: text("description").notNull().default(""),
  currentPhaseId: integer("current_phase_id"),
  nextActionTaskId: integer("next_action_task_id"),
  // Feature 2 — Project values (income + benefit + kudos). All nullable; null = not yet scored.
  currentIncomePerHour: integer("current_income_per_hour"), // AUD/hr; null = unscored, 0 = not income-generating
  futureIncomeEstimate: integer("future_income_estimate"), // AUD annualised over next 12 months; null = unscored
  isPrimaryFutureIncome: integer("is_primary_future_income").notNull().default(0), // 0/1 flag — at most one project should be flagged
  communityBenefit: integer("community_benefit"), // 1-5; null = unscored
  professionalKudos: integer("professional_kudos"), // 1-5; null = unscored
  // PMT extension columns (Stage 20). Additive; legacy MS To Do sync columns untouched.
  // kind: project | sub-project | issue
  // pmt_status: Open | Active | Complete | Parked
  // file_status: present | partial | needs files
  kind: text("kind").notNull().default("project"),
  parentId: integer("parent_id"),
  pmtLabel: text("pmt_label"),
  pmtStatus: text("pmt_status"),
  nextAction: text("next_action"),
  fileStatus: text("file_status"),
  latestThreadUrl: text("latest_thread_url"),
  pmtNotes: text("pmt_notes"),
  seedKey: text("seed_key"),
  // PMT component narrative status. Additive; free-text status box surfaced
  // near the top of the component detail view. updatedAt is epoch-ms.
  latestNarrativeStatus: text("latest_narrative_status"),
  latestNarrativeStatusUpdatedAt: integer("latest_narrative_status_updated_at"),
  latestNarrativeStatusSourceUrl: text("latest_narrative_status_source_url"),
  latestNarrativeStatusSourceLabel: text("latest_narrative_status_source_label"),
  // Stage 21 — Focus-of-week tier. Nullable epoch-ms; non-null means the
  // project is currently flagged as focus-of-week (ranks above priority=high).
  focusOfWeekAt: integer("focus_of_week_at"),
  // Stage 22 — First-class space fields. Both nullable; spaceUrl (when set) is a
  // validated absolute http(s) URL, spaceName is a free-text label.
  spaceName: text("space_name"),
  spaceUrl: text("space_url"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// Stage 21 — Daily focus: one nominated action per date (Melbourne local).
export const dailyFocus = sqliteTable("daily_focus", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  focusDate: text("focus_date").notNull().unique(), // 'YYYY-MM-DD' Melbourne
  taskId: integer("task_id"),
  projectId: integer("project_id"),
  title: text("title").notNull(),
  linkUrl: text("link_url"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export type DailyFocus = typeof dailyFocus.$inferSelect;
export type InsertDailyFocus = typeof dailyFocus.$inferInsert;

export const projectPhases = sqliteTable("project_phases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  completed: integer("completed").notNull().default(0),
  // PMT phase description & objectives. Additive; free-text separate from the
  // narrative status box. descriptionUpdatedAt is epoch-ms.
  description: text("description"),
  descriptionUpdatedAt: integer("description_updated_at"),
  descriptionSourceUrl: text("description_source_url"),
  descriptionSourceLabel: text("description_source_label"),
  createdAt: integer("created_at").notNull(),
});
export type ProjectPhase = typeof projectPhases.$inferSelect;
export type InsertProjectPhase = typeof projectPhases.$inferInsert;

export const projectComponents = sqliteTable("project_components", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  phaseId: integer("phase_id"),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});
export type ProjectComponent = typeof projectComponents.$inferSelect;
export type InsertProjectComponent = typeof projectComponents.$inferInsert;

export const projectTasks = sqliteTable("project_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  componentId: integer("component_id"),
  msTodoTaskId: text("ms_todo_task_id").unique(),
  title: text("title").notNull(),
  notes: text("notes").notNull().default(""),
  deadline: text("deadline"),
  completed: integer("completed").notNull().default(0),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export type ProjectTask = typeof projectTasks.$inferSelect;
export type InsertProjectTask = typeof projectTasks.$inferInsert;

// PMT component notes — dated timeline attached to a projects row (a PMT
// component). componentType is kept generic text so it can extend beyond
// 'project' later. noteDate is a YYYY-MM-DD or ISO string; *_at are epoch-ms.
export const projectComponentNotes = sqliteTable("project_component_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  componentType: text("component_type").notNull().default("project"),
  componentId: integer("component_id").notNull(),
  noteDate: text("note_date").notNull(),
  title: text("title"),
  body: text("body").notNull(),
  sourceUrl: text("source_url"),
  sourceLabel: text("source_label"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export type ProjectComponentNote = typeof projectComponentNotes.$inferSelect;
export type InsertProjectComponentNote = typeof projectComponentNotes.$inferInsert;

// PMT actions — tracked actions attached to a PMT component. status is one of
// Open | Active | Complete | Parked.
export const projectActions = sqliteTable("project_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  componentType: text("component_type").notNull().default("project"),
  componentId: integer("component_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("Open"),
  dueDate: text("due_date"),
  linkUrl: text("link_url"),
  linkLabel: text("link_label"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export type ProjectAction = typeof projectActions.$inferSelect;
export type InsertProjectAction = typeof projectActions.$inferInsert;

// PMT action notes — dated timeline attached to a project_actions row.
export const projectActionNotes = sqliteTable("project_action_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actionId: integer("action_id").notNull(),
  noteDate: text("note_date").notNull(),
  body: text("body").notNull(),
  sourceUrl: text("source_url"),
  sourceLabel: text("source_label"),
  // Stage 22 — Thread pointer for an action note. Both nullable; threadUrl
  // (when set) is a validated absolute http(s) URL, threadName a free-text label.
  threadName: text("thread_name"),
  threadUrl: text("thread_url"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export type ProjectActionNote = typeof projectActionNotes.$inferSelect;
export type InsertProjectActionNote = typeof projectActionNotes.$inferInsert;

// Feature 5 — Life Coach: persistent + auto-summarised conversational sessions.
// Two modes (plan / reflect) toggleable mid-session. Full transcripts stored;
// only structured summaries replay back into model context on later sessions.
export const coachSessions = sqliteTable("coach_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  // Last-active mode. Switches mid-session are allowed; this stores the most
  // recent value at session-end time.
  mode: text("mode").notNull().default("plan"), // 'plan' | 'reflect' | 'calm'
  // JSON snapshot of the context bundle loaded at session start. Stored for
  // auditability — lets the user see exactly what the coach saw.
  contextSnapshot: text("context_snapshot").notNull().default("{}"),
  // JSON of the structured summary: { discussed, decisions, commitments, open_threads }
  summary: text("summary"),
  summaryEditedByUser: integer("summary_edited_by_user").notNull().default(0),
  // Set when reflect mode picks an issue to focus on.
  linkedIssueId: integer("linked_issue_id"),
  // Date this session belongs to (Australia/Melbourne local), YYYY-MM-DD.
  linkedYmd: text("linked_ymd"),
  modelProvider: text("model_provider").notNull().default("perplexity"),
  modelName: text("model_name").notNull().default("sonar-pro"),
  totalInputTokens: integer("total_input_tokens").notNull().default(0),
  totalOutputTokens: integer("total_output_tokens").notNull().default(0),
  // Plan-mode opt-in: if 1, plan turns use sonar-reasoning-pro instead of
  // sonar-pro. Per-session, not global. Default 0 (off).
  deepThink: integer("deep_think").notNull().default(0),
  // Retention: when set, the transcript has been purged but summary kept.
  // Display in history as read-only with the summary only.
  archivedAt: integer("archived_at"),
  // Stage 13 (2026-05-11) — Calm mode columns. All nullable; only populated
  // when mode='calm'. Additive on the existing coach_sessions table.
  calmVariant: text("calm_variant"), // 'grounding_only' | 'grounding_plus_reflection'
  issueEntityType: text("issue_entity_type"), // 'task' | 'project' | 'inbox_item' | 'freetext'
  issueEntityId: integer("issue_entity_id"),
  issueFreetext: text("issue_freetext"),
  preTags: text("pre_tags"), // JSON array of strings
  preIntensity: integer("pre_intensity"), // 0-10
  groundingObservations: text("grounding_observations"), // JSON {see, hear, feel}
  reframeText: text("reframe_text"),
  reflectionWorstStory: text("reflection_worst_story"),
  reflectionAccurateStory: text("reflection_accurate_story"),
  reflectionNextAction: text("reflection_next_action"),
  postTags: text("post_tags"), // JSON array
  postIntensity: integer("post_intensity"), // 0-10
  postNote: text("post_note"),
  completedAt: integer("completed_at"),
  // Stage 13a (2026-05-12) — Calm pre-capture chips + post-capture delta.
  // 22 nullable TEXT columns mirroring the Reflect chip set, captured at
  // session start (pre) and again at session end (post). All optional.
  // Mind categories store a JSON-array string; mind_other_label is the
  // free-text label shown when the user toggles the "Other" chip.
  calmPreArousal: text("calm_pre_arousal"),
  calmPreEnergy: text("calm_pre_energy"),
  calmPreSleep: text("calm_pre_sleep"),
  calmPreMood: text("calm_pre_mood"),
  calmPreCognitiveLoad: text("calm_pre_cognitive_load"),
  calmPreFocus: text("calm_pre_focus"),
  calmPreAlignmentPeople: text("calm_pre_alignment_people"),
  calmPreAlignmentValues: text("calm_pre_alignment_values"),
  calmPreMindCategories: text("calm_pre_mind_categories"),
  calmPreMindOtherLabel: text("calm_pre_mind_other_label"),
  calmPreBrainDump: text("calm_pre_brain_dump"),
  calmPostArousal: text("calm_post_arousal"),
  calmPostEnergy: text("calm_post_energy"),
  calmPostSleep: text("calm_post_sleep"),
  calmPostMood: text("calm_post_mood"),
  calmPostCognitiveLoad: text("calm_post_cognitive_load"),
  calmPostFocus: text("calm_post_focus"),
  calmPostAlignmentPeople: text("calm_post_alignment_people"),
  calmPostAlignmentValues: text("calm_post_alignment_values"),
  calmPostMindCategories: text("calm_post_mind_categories"),
  calmPostMindOtherLabel: text("calm_post_mind_other_label"),
  calmPostBrainDump: text("calm_post_brain_dump"),
});
export type CoachSession = typeof coachSessions.$inferSelect;
export type InsertCoachSession = typeof coachSessions.$inferInsert;

// Stage 14 (2026-05-12) — Relationships table.
//
// Replaces the hard-coded Marieke / Hilde / Axel references that used to
// live in REFLECT_MODE_INSTRUCTIONS. The Coach context bundle reads
// active rows at runtime so Reflect prompts work for any user and a
// fresh self-host install (empty table) produces sensible reflections
// without naming anyone.
//
// Per Path B (PROJECT_DIRECTION_QUIETLY_DISTRIBUTABLE.md), new tables
// added from Stage 14 onward carry a nullable user_id so the future
// multi-user migration is "make it non-null and backfill to user 1".
//
// Author-managed: no settings UI this Stage. Rows seeded on empty table
// during boot migrations; further edits via the admin import endpoint.
export const relationships = sqliteTable("relationships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  relationshipLabel: text("relationship_label").notNull(),
  notes: text("notes"),
  active: integer("active").notNull().default(1),
  displayOrder: integer("display_order").notNull().default(0),
  userId: integer("user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type Relationship = typeof relationships.$inferSelect;
export type InsertRelationship = typeof relationships.$inferInsert;

export const coachMessages = sqliteTable("coach_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
  tokenCount: integer("token_count"),
  modeAtTurn: text("mode_at_turn").notNull().default("plan"),
});
export type CoachMessage = typeof coachMessages.$inferSelect;
export type InsertCoachMessage = typeof coachMessages.$inferInsert;
