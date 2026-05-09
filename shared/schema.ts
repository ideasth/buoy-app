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
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

export const projectPhases = sqliteTable("project_phases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  completed: integer("completed").notNull().default(0),
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

// Feature 5 — Life Coach: persistent + auto-summarised conversational sessions.
// Two modes (plan / reflect) toggleable mid-session. Full transcripts stored;
// only structured summaries replay back into model context on later sessions.
export const coachSessions = sqliteTable("coach_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  // Last-active mode. Switches mid-session are allowed; this stores the most
  // recent value at session-end time.
  mode: text("mode").notNull().default("plan"), // 'plan' | 'reflect'
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
});
export type CoachSession = typeof coachSessions.$inferSelect;
export type InsertCoachSession = typeof coachSessions.$inferInsert;

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
