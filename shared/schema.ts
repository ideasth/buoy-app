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
  energy: integer("energy"), // 1-5
  state: text("state"), // calm / anxious / scattered / flat
  avoidedTask: text("avoided_task"),
  notes: text("notes"),
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
}

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
