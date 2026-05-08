import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  insertTaskSchema,
  insertHabitSchema,
  insertHabitLogSchema,
  insertTimeBlockSchema,
  insertReflectionSchema,
  insertGoalSchema,
} from "@shared/schema";
import { getCachedEvents, getCachedEventsForFeeds, eventsForDate } from "./ics";
import { computeAvailableHoursThisWeek } from "./available-hours";
import { resolveTravel } from "./travel";
import { registerCoachRoutes } from "./coach-routes";
import { buildPlannerXlsx } from "./planner";
import {
  inferDomain,
  melbourneDateStr,
  shiftDate,
  parseIdArray,
} from "./morning-helpers";
import { approveAsTask } from "./inbox-scanner";
import { getCurrentSession } from "./auth";
import { BAKED_SYNC_SECRET } from "./baked-secret";
import type { Task } from "@shared/schema";
import {
  calibrate,
  estimateLast24h,
  actualLast24h,
  lastBalance,
  runs24hByType,
} from "./usage-calibration";
import { registerAdminDbRoutes } from "./admin-db";

// Orchestrator-only auth: protects endpoints that the cron calls from outside
// the browser. Reads the shared secret from env first, falling back to a
// build-time baked value (used for publish_website where env injection is
// not supported). In production, if neither is set, the gate FAILS CLOSED.
const SYNC_SECRET = process.env.ANCHOR_SYNC_SECRET || BAKED_SYNC_SECRET || "";
const IS_PROD_ROUTES = process.env.NODE_ENV === "production";
if (!SYNC_SECRET) {
  if (IS_PROD_ROUTES) {
    console.error(
      "[anchor] FATAL: ANCHOR_SYNC_SECRET is not set in production \u2014 sync/inbox endpoints will reject all requests.",
    );
  } else {
    console.warn(
      "[anchor] ANCHOR_SYNC_SECRET is not set \u2014 sync/inbox endpoints are unauthenticated (dev mode).",
    );
  }
}
function requireOrchestrator(req: Request, res: Response): boolean {
  if (!SYNC_SECRET) {
    if (IS_PROD_ROUTES) {
      res.status(503).json({ error: "orchestrator secret not configured" });
      return false;
    }
    return true; // dev mode: no secret configured
  }
  const provided = (req.header("x-anchor-sync-secret") || "").trim();
  if (provided && provided === SYNC_SECRET) return true;
  res.status(401).json({ error: "orchestrator auth required" });
  return false;
}

// For read endpoints used by both the UI (user session) and the cron
// (orchestrator secret). Accepts either; rejects if neither.
function requireUserOrOrchestrator(req: Request, res: Response): boolean {
  if (SYNC_SECRET) {
    const provided = (req.header("x-anchor-sync-secret") || "").trim();
    if (provided && provided === SYNC_SECRET) return true;
  }
  const session = getCurrentSession(req);
  if (session) {
    (req as any).authSession = session;
    return true;
  }
  res.status(401).json({ error: "auth required" });
  return false;
}

function todayStr(): string {
  // YYYY-MM-DD in Australia/Melbourne (server runs in UTC).
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, n: number): string {
  // Operate on UTC midnight so getUTC* fields hold the wall-clock date.
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const REFLECTION_PROMPTS = [
  "What did you avoid today?",
  "What drained your energy?",
  "What are you proud of today?",
  "What needs to slow down?",
  "Where did time evaporate?",
  "What was today's anchor?",
  "Who did you show up for?",
  "What would yesterday-you thank you for?",
];

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Admin DB export/import. Both behind requireOrchestrator; import is
  // additionally gated by ANCHOR_DB_IMPORT_ENABLED=1.
  registerAdminDbRoutes(app, requireOrchestrator);

  // ---- Tasks ----
  app.get("/api/tasks", (_req, res) => res.json(storage.listTasks()));

  app.post("/api/tasks", (req, res) => {
    const parsed = insertTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createTask(parsed.data));
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const id = Number(req.params.id);
    const updated = storage.updateTask(id, req.body);
    if (!updated) return res.status(404).json({ message: "not found" });
    res.json(updated);
  });

  app.delete("/api/tasks/:id", (req, res) => {
    storage.deleteTask(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Top three ----
  app.get("/api/top-three", (req, res) => {
    const date = (req.query.date as string) || todayStr();
    res.json(storage.getTopThree(date) ?? { date, taskId1: null, taskId2: null, taskId3: null, lockedAt: null });
  });

  app.put("/api/top-three", (req, res) => {
    const date = (req.body.date as string) || todayStr();
    const ids = {
      taskId1: req.body.taskId1 ?? null,
      taskId2: req.body.taskId2 ?? null,
      taskId3: req.body.taskId3 ?? null,
    };
    res.json(storage.setTopThree(date, ids));
  });

  app.post("/api/top-three/lock", (req, res) => {
    const date = (req.body.date as string) || todayStr();
    res.json(storage.lockTopThree(date));
  });

  // ---- Habits ----
  app.get("/api/habits", (_req, res) => res.json(storage.listHabits()));
  app.post("/api/habits", (req, res) => {
    const parsed = insertHabitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createHabit(parsed.data));
  });
  app.patch("/api/habits/:id", (req, res) => {
    const updated = storage.updateHabit(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "not found" });
    res.json(updated);
  });
  app.delete("/api/habits/:id", (req, res) => {
    storage.deleteHabit(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Habit logs ----
  app.get("/api/habit-logs", (req, res) => {
    const from = req.query.from as string | undefined;
    res.json(storage.listHabitLogs(from));
  });
  app.post("/api/habit-logs", (req, res) => {
    const parsed = insertHabitLogSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.upsertHabitLog(parsed.data));
  });

  // ---- Time blocks ----
  app.get("/api/time-blocks", (_req, res) => res.json(storage.listTimeBlocks()));
  app.post("/api/time-blocks", (req, res) => {
    const parsed = insertTimeBlockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createTimeBlock(parsed.data));
  });
  app.patch("/api/time-blocks/:id", (req, res) => {
    const updated = storage.updateTimeBlock(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "not found" });
    res.json(updated);
  });
  app.delete("/api/time-blocks/:id", (req, res) => {
    storage.deleteTimeBlock(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Reflections ----
  app.get("/api/reflections", (_req, res) => res.json(storage.listReflections()));
  app.post("/api/reflections", (req, res) => {
    const parsed = insertReflectionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createReflection(parsed.data));
  });
  app.patch("/api/reflections/:id", (req, res) => {
    const updated = storage.updateReflection(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "not found" });
    res.json(updated);
  });
  app.delete("/api/reflections/:id", (req, res) => {
    storage.deleteReflection(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Goals ----
  app.get("/api/goals", (_req, res) => res.json(storage.listGoals()));
  app.post("/api/goals", (req, res) => {
    const parsed = insertGoalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createGoal(parsed.data));
  });
  app.patch("/api/goals/:id", (req, res) => {
    const updated = storage.updateGoal(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "not found" });
    res.json(updated);
  });
  app.delete("/api/goals/:id", (req, res) => {
    storage.deleteGoal(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Settings ----
  app.get("/api/settings", (_req, res) => {
    const s = storage.getSettings();
    // Never leak the calendar URL (contains a PAT) or the passphrase hash
    const { calendar_ics_url, passphrase_hash, ...safe } = s;
    const masked = calendar_ics_url
      ? calendar_ics_url.replace(/\/\/.*@/, "//[secret]@")
      : "";
    res.json({ ...safe, calendar_ics_url_masked: masked });
  });
  app.patch("/api/settings", (req, res) => {
    const allowed: any = {};
    const fields = [
      "adhd_tax_coefficient",
      "briefing_time",
      "calendar_ics_url",
      "aupfhs_ics_url",
      "timezone",
      "theme",
      "home_address",
      "maps_provider",
    ];
    for (const f of fields) if (f in req.body) allowed[f] = req.body[f];
    const merged = storage.updateSettings(allowed);
    const { calendar_ics_url, passphrase_hash, ...safe } = merged;
    const masked = calendar_ics_url
      ? calendar_ics_url.replace(/\/\/.*@/, "//[secret]@")
      : "";
    res.json({ ...safe, calendar_ics_url_masked: masked });
  });

  // ---- Calendar events ----
  async function getMergedPlannerEvents(force = false) {
    const s = storage.getSettings();
    return getCachedEventsForFeeds([
      { url: s.calendar_ics_url },
      { url: s.aupfhs_ics_url || "", summaryPrefix: "[Personal]" },
    ], force);
  }

  app.get("/api/today-events", async (_req, res) => {
    const events = await getMergedPlannerEvents();
    const today = new Date();
    res.json({
      date: today.toISOString(),
      events: eventsForDate(events, today),
    });
  });

  app.get("/api/calendar-events", async (req, res) => {
    const events = await getMergedPlannerEvents();
    const days = Math.min(parseInt((req.query.days as string) || "7", 10), 31);
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + days);
    const filtered = events
      .filter((e) => {
        const en = new Date(e.end);
        return en >= now && new Date(e.start) <= horizon;
      })
      .sort((a, b) => +new Date(a.start) - +new Date(b.start));
    res.json({ events: filtered });
  });

  // ---- Feature 1 — Travel locations + per-event travel resolution ----

  app.get("/api/travel-locations", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    res.json({ locations: storage.listTravelLocations() });
  });

  app.post("/api/travel-locations", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const { name, keywords, nominalMinutes, allowMinutes, destinationAddress, notes } = req.body ?? {};
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name required" });
    }
    if (!Number.isFinite(nominalMinutes) || !Number.isFinite(allowMinutes)) {
      return res.status(400).json({ error: "nominalMinutes and allowMinutes required (integers)" });
    }
    if (nominalMinutes < 0 || nominalMinutes > 600 || allowMinutes < 0 || allowMinutes > 600) {
      return res.status(400).json({ error: "minutes out of range (0–600)" });
    }
    const created = storage.createTravelLocation({
      name: name.trim(),
      keywords: typeof keywords === "string" ? keywords : "",
      nominalMinutes,
      allowMinutes,
      destinationAddress: typeof destinationAddress === "string" ? destinationAddress : null,
      notes: typeof notes === "string" ? notes : null,
    });
    res.json(created);
  });

  app.patch("/api/travel-locations/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
    const allowed = ["name", "keywords", "nominalMinutes", "allowMinutes", "destinationAddress", "notes"];
    const updates: any = {};
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    if ("nominalMinutes" in updates) {
      if (!Number.isFinite(updates.nominalMinutes) || updates.nominalMinutes < 0 || updates.nominalMinutes > 600) {
        return res.status(400).json({ error: "nominalMinutes out of range" });
      }
    }
    if ("allowMinutes" in updates) {
      if (!Number.isFinite(updates.allowMinutes) || updates.allowMinutes < 0 || updates.allowMinutes > 600) {
        return res.status(400).json({ error: "allowMinutes out of range" });
      }
    }
    const updated = storage.updateTravelLocation(id, updates);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  });

  app.delete("/api/travel-locations/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
    storage.deleteTravelLocation(id);
    res.json({ ok: true });
  });

  // GET /api/travel/lookup?uid=<encoded>
  // Returns a TravelMatch for the given event uid, by re-fetching the merged
  // ICS calendar and running the matcher. UID is a query-param so it survives
  // arbitrary characters (slashes, equals signs in Outlook UIDs).
  app.get("/api/travel/lookup", async (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const uid = (req.query.uid as string) ?? "";
    if (!uid) return res.status(400).json({ error: "uid required" });
    const events = await getMergedPlannerEvents();
    const event = events.find((e) => e.uid === uid);
    if (!event) return res.status(404).json({ error: "event not found" });
    const locations = storage.listTravelLocations();
    const override = storage.getTravelOverride(uid) ?? null;
    const homeAddress = storage.getSettings().home_address ?? null;
    const match = resolveTravel({ event, locations, override, homeAddress });
    res.json({ event: { uid: event.uid, summary: event.summary, start: event.start, end: event.end, location: event.location }, ...match });
  });

  // GET /api/travel/today — returns travel info for every event today (Melbourne).
  // Convenience aggregator for the Today page and Morning briefing so the
  // client makes ONE call instead of N.
  app.get("/api/travel/today", async (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const events = await getMergedPlannerEvents();
    const todayEvents = eventsForDate(events, new Date());
    const locations = storage.listTravelLocations();
    const homeAddress = storage.getSettings().home_address ?? null;
    const items = todayEvents.map((event) => {
      const override = storage.getTravelOverride(event.uid) ?? null;
      const match = resolveTravel({ event, locations, override, homeAddress });
      return {
        event: { uid: event.uid, summary: event.summary, start: event.start, end: event.end, location: event.location, allDay: event.allDay },
        ...match,
      };
    });
    res.json({ items });
  });

  // PUT /api/travel/override?uid=<encoded>  body: { nominalMinutesOverride?, allowMinutesOverride?, locationIdOverride? }
  // Upserts an override row. Pass null on a field to clear it.
  app.put("/api/travel/override", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const uid = (req.query.uid as string) ?? "";
    if (!uid) return res.status(400).json({ error: "uid required" });
    const patch: any = {};
    if ("nominalMinutesOverride" in req.body) patch.nominalMinutesOverride = req.body.nominalMinutesOverride;
    if ("allowMinutesOverride" in req.body) patch.allowMinutesOverride = req.body.allowMinutesOverride;
    if ("locationIdOverride" in req.body) patch.locationIdOverride = req.body.locationIdOverride;
    const row = storage.upsertTravelOverride(uid, patch);
    res.json(row);
  });

  app.delete("/api/travel/override", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const uid = (req.query.uid as string) ?? "";
    if (!uid) return res.status(400).json({ error: "uid required" });
    storage.deleteTravelOverride(uid);
    res.json({ ok: true });
  });

  // Available hours this week (Mon-Sun, Australia/Melbourne). Surfaces on
  // Morning + Review pages. See server/available-hours.ts for details.
  app.get("/api/available-hours/this-week", async (_req, res) => {
    try {
      const events = await getMergedPlannerEvents();
      const result = computeAvailableHoursThisWeek(events);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  // ---- Planner ----
  app.get("/api/planner/events", async (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const from = (req.query.from as string) || todayStr();
    const to = (req.query.to as string) || addDays(todayStr(), 365);
    const all = await getMergedPlannerEvents();
    const fromDt = new Date(from + "T00:00:00");
    const toDt = new Date(to + "T23:59:59");
    const filtered = all
      .filter((e) => {
        const s = new Date(e.start);
        const en = new Date(e.end);
        return en >= fromDt && s <= toDt;
      })
      .sort((a, b) => +new Date(a.start) - +new Date(b.start));
    res.json({ events: filtered });
  });

  app.get("/api/planner/notes", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const from = (req.query.from as string) || todayStr();
    const to = (req.query.to as string) || addDays(todayStr(), 365);
    res.json({ notes: storage.listPlannerNotes(from, to) });
  });

  app.put("/api/planner/notes/:date", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "invalid date" });
    }
    const note = (req.body?.note ?? "") as string;
    if (!note.trim()) {
      storage.deletePlannerNote(date);
      return res.json({ note: null });
    }
    res.json({ note: storage.upsertPlannerNote(date, note) });
  });

  // Public ICS feed of Family Notes — subscribable from iCloud/Outlook/Google.
  // No auth: subscription clients can't send custom headers. Each note line
  // becomes a separate all-day VEVENT prefixed with "[Family Notes] ".
  app.get("/api/planner/notes.ics", (_req, res) => {
    const from = todayStr();
    const to = addDays(from, 365);
    const notes = storage.listPlannerNotes(from, to);
    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Anchor//Family Notes//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Family Notes",
      "X-WR-TIMEZONE:Australia/Melbourne",
    ];
    const dtstamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    function escIcs(s: string): string {
      return s
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");
    }
    function nextDay(ymd: string): string {
      const d = new Date(ymd + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10).replace(/-/g, "");
    }
    for (const n of notes) {
      if (!n.note || !n.note.trim()) continue;
      const dateCompact = n.date.replace(/-/g, "");
      const dtend = nextDay(n.date);
      const items = n.note
        .split(/\r?\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      items.forEach((line, idx) => {
        const uid = `family-notes-${n.date}-${idx}@anchor-jod.pplx.app`;
        lines.push(
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${dtstamp}`,
          `DTSTART;VALUE=DATE:${dateCompact}`,
          `DTEND;VALUE=DATE:${dtend}`,
          `SUMMARY:${escIcs("[Family Notes] " + line)}`,
          "TRANSP:TRANSPARENT",
          "END:VEVENT",
        );
      });
    }
    lines.push("END:VCALENDAR");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="family-notes.ics"',
    );
    res.send(lines.join("\r\n"));
  });

  app.get("/api/planner/export", async (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const from = (req.query.from as string) || todayStr();
    const to = (req.query.to as string) || addDays(todayStr(), 365);
    const all = await getMergedPlannerEvents();
    const fromDt = new Date(from + "T00:00:00");
    const toDt = new Date(to + "T23:59:59");
    const filtered = all.filter((e) => {
      const s = new Date(e.start);
      const en = new Date(e.end);
      return en >= fromDt && s <= toDt;
    });
    const notes = storage.listPlannerNotes(from, to);
    try {
      const buf = await buildPlannerXlsx(from, to, filtered, notes);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="anchor-planner-${from}-to-${to}.xlsx"`,
      );
      res.send(buf);
    } catch (err) {
      console.error("[planner export] failed:", err);
      res.status(500).json({ error: "export failed" });
    }
  });

  // ---- Briefing ----
  app.get("/api/briefing", async (_req, res) => {
    const date = todayStr();
    const top3Row = storage.getTopThree(date);
    const allTasks = storage.listTasks();
    const taskById = new Map(allTasks.map((t) => [t.id, t]));
    const top3 = [top3Row?.taskId1, top3Row?.taskId2, top3Row?.taskId3]
      .map((id) => (id ? taskById.get(id) : null))
      .filter(Boolean);

    const cal = await getMergedPlannerEvents();
    const todayEvents = eventsForDate(cal, new Date());

    const habits = storage.listHabits();
    const recentLogs = storage.listHabitLogs(addDays(date, -7));
    const habitNudges = habits.map((h) => {
      const todayLog = recentLogs.find((l) => l.habitId === h.id && l.date === date);
      return { id: h.id, name: h.name, target: h.target, doneToday: !!todayLog?.done };
    });

    const reflections = storage.getReflectionsBetween(addDays(date, -6), date);
    const energyLast7Days = reflections
      .filter((r) => r.kind === "daily" && r.energy)
      .map((r) => ({ date: r.date, energy: r.energy }));

    // pick rotating prompt based on day of year
    const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const reflectionPrompt = REFLECTION_PROMPTS[doy % REFLECTION_PROMPTS.length];

    res.json({
      date,
      top3,
      todayEvents,
      habitNudges,
      reflectionPrompt,
      energyLast7Days,
      adhdTaxCoefficient: storage.rollingAdhdTaxCoefficient(),
    });
  });

  // ---- Weekly review summary ----
  app.get("/api/weekly-review", (_req, res) => {
    const today = todayStr();
    const start = addDays(today, -6);
    const allTasks = storage.listTasks();
    const completed = allTasks.filter(
      (t) =>
        t.status === "done" &&
        t.completedAt &&
        new Date(t.completedAt).toISOString().slice(0, 10) >= start,
    );
    const dropped = allTasks.filter((t) => t.status === "dropped");
    const reflections = storage.getReflectionsBetween(start, today);
    const dailyReflections = reflections.filter((r) => r.kind === "daily");
    const avgEnergy =
      dailyReflections.length > 0
        ? dailyReflections.reduce((a, r) => a + (r.energy ?? 0), 0) / dailyReflections.length
        : 0;
    const totalEstimated = completed.reduce((a, t) => a + (t.estimateMinutes || 0), 0);
    const totalActual = completed.reduce((a, t) => a + (t.actualMinutes || 0), 0);
    res.json({
      from: start,
      to: today,
      completedCount: completed.length,
      droppedCount: dropped.length,
      totalEstimatedMinutes: totalEstimated,
      totalActualMinutes: totalActual,
      adhdTaxCoefficient: storage.rollingAdhdTaxCoefficient(),
      avgEnergy: Math.round(avgEnergy * 10) / 10,
      reflections,
      completedTasks: completed,
    });
  });

  // ---- Reflection prompt for the day ----
  app.get("/api/reflection-prompt", (_req, res) => {
    const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    res.json({ prompt: REFLECTION_PROMPTS[doy % REFLECTION_PROMPTS.length] });
  });

  // ====== MORNING ROUTINE ======
  app.get("/api/morning/today", (_req, res) => {
    const date = melbourneDateStr();
    const row = storage.ensureMorningForDate(date);
    res.json(row);
  });

  app.patch("/api/morning/today", (req, res) => {
    const date = melbourneDateStr();
    const allowed: any = {};
    for (const k of [
      "energy",
      "state",
      "sleepQuality",
      "gratitude",
      "avoidedTask",
      "notes",
      "expressMode",
    ]) {
      if (k in req.body) allowed[k] = req.body[k];
    }
    const updated = storage.updateMorning(date, allowed);
    res.json(updated);
  });

  app.post("/api/morning/braindump", (req, res) => {
    const raw = String(req.body?.raw ?? "");
    const date = melbourneDateStr();
    const lines = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const created: Task[] = [];
    for (const line of lines) {
      const t = storage.insertRawTask({
        title: line,
        status: "todo",
        priority: "iftime",
        domain: inferDomain(line),
        estimateMinutes: 30,
        tag: "Braindump",
        fromBraindump: 1,
        createdAt: Date.now(),
      });
      created.push(t);
    }
    storage.updateMorning(date, {
      braindumpRaw: raw,
      braindumpTaskIds: JSON.stringify(created.map((t) => t.id)),
    });
    res.json({ tasks: created });
  });

  app.post("/api/morning/lock", (req, res) => {
    const date = melbourneDateStr();
    const ids: number[] = Array.isArray(req.body?.topThreeIds)
      ? req.body.topThreeIds.filter((n: any) => typeof n === "number").slice(0, 3)
      : [];
    storage.updateMorning(date, { topThreeIds: JSON.stringify(ids) });
    storage.setTopThree(date, {
      taskId1: ids[0] ?? undefined,
      taskId2: ids[1] ?? undefined,
      taskId3: ids[2] ?? undefined,
    });

    const cur = storage.getMorningByDate(date)!;
    const missing: string[] = [];
    if (!cur.energy) missing.push("energy");
    if (!cur.braindumpRaw) missing.push("braindumpRaw");
    if (ids.length === 0) missing.push("topThreeIds");

    let completed = false;
    if (missing.length === 0) {
      storage.updateMorning(date, { completedAt: Date.now() });
      completed = true;
    }
    res.json({ completed, missing });
  });

  app.get("/api/morning/eligible-tasks", (_req, res) => {
    const date = melbourneDateStr();
    const tomorrow = shiftDate(date, 1);
    const yesterday = shiftDate(date, -1);
    const dayStartTs = Date.parse(date + "T00:00:00");
    const tomorrowEndTs = Date.parse(tomorrow + "T23:59:59");
    const dayMinus1Ts = Date.now() - 24 * 3600 * 1000;

    const all = storage
      .listTasks()
      .filter((t) => t.status !== "done" && t.status !== "dropped");

    const yt = storage.getTopThree(yesterday);
    const yIds = new Set<number>(
      [yt?.taskId1, yt?.taskId2, yt?.taskId3].filter(
        (n): n is number => typeof n === "number",
      ),
    );

    type R = { task: Task; bucket: number };
    const out: R[] = [];
    const seen = new Set<number>();
    const push = (t: Task, bucket: number) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      out.push({ task: t, bucket });
    };
    for (const t of all) {
      // overdue
      if (t.dueAt && t.dueAt < dayStartTs) push(t, 0);
      // due today/tomorrow
      else if (t.dueAt && t.dueAt >= dayStartTs && t.dueAt <= tomorrowEndTs) push(t, 1);
      // anchor / deadline
      else if (t.priority === "anchor" || t.priority === "deadline") push(t, 2);
      // braindump from today
      else if (t.tag === "Braindump" && t.createdAt >= dayMinus1Ts) push(t, 3);
      // created in last 24h
      else if (t.createdAt >= dayMinus1Ts) push(t, 3);
      // yesterday top3 carryover
      else if (yIds.has(t.id)) push(t, 4);
    }
    out.sort((a, b) => a.bucket - b.bucket || a.task.id - b.task.id);
    res.json(out.slice(0, 30).map((x) => x.task));
  });

  // ====== INBOX SUGGESTIONS ======
  app.post("/api/inbox/suggestions", (req, res) => {
    if (!requireOrchestrator(req, res)) return;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const created = [];
    for (const it of items) {
      const row = storage.insertInboxSuggestion({
        sourceMessageId: it.sourceMessageId ?? null,
        subject: it.subject ?? null,
        fromAddress: it.fromAddress ?? null,
        receivedAt: it.receivedAt ?? null,
        suggestedAction: JSON.stringify(it.suggestedAction ?? {}),
        status: "pending",
        createdAt: Date.now(),
      });
      created.push(row);
    }
    res.json({ created });
  });

  app.get("/api/inbox/suggestions", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const status = (req.query.status as string) || "pending";
    res.json(storage.listInboxSuggestions(status));
  });

  app.get("/api/inbox/count", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    res.json({ pending: storage.countPendingInbox() });
  });

  app.post("/api/inbox/suggestions/:id/approve", (req, res) => {
    // Same-origin OR orchestrator: in-app UI uses same-origin; orchestrator
    // (cron / agent) presents X-Anchor-Sync-Secret. Either is accepted.
    if (SYNC_SECRET) {
      const provided = (req.header("x-anchor-sync-secret") || "").trim();
      const isOrchestrator = provided === SYNC_SECRET;
      const isSameOrigin = (req.header("sec-fetch-site") || "") === "same-origin";
      if (!isOrchestrator && !isSameOrigin) {
        return res.status(401).json({ error: "auth required" });
      }
    }
    const id = Number(req.params.id);
    const item = storage.getInboxSuggestion(id);
    if (!item) return res.status(404).json({ message: "not found" });
    if (item.status !== "pending") {
      return res.status(400).json({ message: `already ${item.status}` });
    }
    const task = approveAsTask(item);
    storage.decideInboxSuggestion(id, "approved");
    res.json({ ok: true, task });
  });

  app.post("/api/inbox/suggestions/:id/dismiss", (req, res) => {
    if (SYNC_SECRET) {
      const provided = (req.header("x-anchor-sync-secret") || "").trim();
      const isOrchestrator = provided === SYNC_SECRET;
      const isSameOrigin = (req.header("sec-fetch-site") || "") === "same-origin";
      if (!isOrchestrator && !isSameOrigin) {
        return res.status(401).json({ error: "auth required" });
      }
    }
    const id = Number(req.params.id);
    const item = storage.getInboxSuggestion(id);
    if (!item) return res.status(404).json({ message: "not found" });
    storage.decideInboxSuggestion(id, "dismissed");
    res.json({ ok: true });
  });

  // Warm the ICS cache on startup (non-blocking)
  void getMergedPlannerEvents(true);

  // ====== CREDIT USAGE ======

  // POST /api/usage/balance — log a manual credit balance reading
  app.post("/api/usage/balance", (req, res) => {
    const balance = Number(req.body?.balance);
    if (!Number.isFinite(balance) || balance < 0) {
      return res.status(400).json({ message: "balance must be a non-negative number" });
    }
    const note = req.body?.note ? String(req.body.note) : null;
    const row = storage.insertCreditBalance(balance, note);
    const calibrated = calibrate();
    res.json({ id: row.id, recordedAt: row.recordedAt, balance: row.balance, calibrated });
  });

  // GET /api/usage/balances — last 14 balance entries for balance history UI
  app.get("/api/usage/balances", (_req, res) => {
    res.json(storage.getRecentCreditBalances(14));
  });

  // DELETE /api/usage/balance/:id
  app.delete("/api/usage/balance/:id", (req, res) => {
    storage.deleteCreditBalance(Number(req.params.id));
    res.json({ ok: true });
  });

  // GET /api/usage/today
  app.get("/api/usage/today", (_req, res) => {
    const estimated = estimateLast24h();
    const actual = actualLast24h();
    const lb = lastBalance();
    const runs24h = runs24hByType();
    const needsEntry = !lb || lb.ageHours > 24;
    res.json({
      estimatedCreditsLast24h: estimated,
      actualCreditsLast24h: actual,
      lastBalance: lb,
      runs24h,
      needsEntry,
    });
  });

  // GET /api/usage/history?days=7
  app.get("/api/usage/history", (req, res) => {
    const days = Math.min(Math.max(1, parseInt((req.query.days as string) || "7", 10)), 30);
    const estimates = storage.getAllCreditEstimates();
    const estimateMap: Record<string, number> = {};
    for (const e of estimates) estimateMap[e.cronType] = e.perRunCredits;

    const result: Array<{
      date: string;
      estimated: number;
      actual: number | null;
      runs: Record<string, number>;
    }> = [];

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - i);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const dateStr = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, "0")}-${String(dayStart.getDate()).padStart(2, "0")}`;

      // Cron runs for this day
      const runs = storage.getCronRunsBetween(dayStart.getTime(), dayEnd.getTime());
      const runCounts: Record<string, number> = {};
      for (const r of runs) runCounts[r.cronType] = (runCounts[r.cronType] ?? 0) + 1;

      let estimated = 0;
      for (const [ct, cnt] of Object.entries(runCounts)) {
        estimated += cnt * (estimateMap[ct] ?? 0);
      }

      // Actual: need ≥2 balance entries spanning the day
      const balances = storage.getCreditBalancesBetween(dayStart.getTime(), dayEnd.getTime());
      let actual: number | null = null;
      if (balances.length >= 2) {
        actual = balances[0].balance - balances[balances.length - 1].balance;
      }

      result.push({ date: dateStr, estimated: Math.round(estimated), actual, runs: runCounts });
    }

    res.json({ days: result });
  });

  // GET /api/usage/estimates — current per-type estimates
  app.get("/api/usage/estimates", (_req, res) => {
    res.json(storage.getAllCreditEstimates());
  });

  // POST /api/usage/cron-run — orchestrator-only endpoint for cron logging
  app.post("/api/usage/cron-run", (req, res) => {
    if (!requireOrchestrator(req, res)) return;
    const { cronId, cronType, startedAt, endedAt, ok, notes } = req.body ?? {};
    if (!cronId || !cronType || !Number.isFinite(Number(startedAt))) {
      return res.status(400).json({ message: "cronId, cronType, and startedAt are required" });
    }
    const row = storage.insertCronRun(
      String(cronId),
      String(cronType),
      Number(startedAt),
      endedAt != null ? Number(endedAt) : null,
      ok === false || ok === 0 ? 0 : 1,
      notes ? String(notes) : null,
    );
    res.json({ ok: true, id: row.id });
  });

  // ====== EMAIL STATUS ======
  app.get("/api/email-status", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const includeDismissed = String(req.query.includeDismissed || "") === "1";
    res.json(storage.listEmailStatus(includeDismissed));
  });

  app.post("/api/email-status/upsert", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
    const saved = items.map((it: any) => storage.upsertEmailStatus({
      messageId: String(it.messageId),
      threadId: it.threadId ?? null,
      receivedAt: Number(it.receivedAt) || Date.now(),
      sender: String(it.sender || ""),
      subject: String(it.subject || ""),
      bodyPreview: String(it.bodyPreview || ""),
      importance: it.importance ?? null,
      isFlagged: it.isFlagged ? 1 : 0,
      draftResponse: it.draftResponse ?? null,
      draftGeneratedAt: it.draftGeneratedAt ?? null,
      status: it.status || "pending",
      webLink: it.webLink ?? null,
      updatedAt: Date.now(),
    }));
    res.json({ saved });
  });

  app.patch("/api/email-status/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const { status, draftResponse } = req.body || {};
    if (status && ["pending", "replied", "dismissed"].includes(status)) {
      storage.setEmailStatusStatus(id, status);
    }
    if (typeof draftResponse === "string") {
      storage.updateEmailDraft(id, draftResponse);
    }
    res.json({ ok: true });
  });

  // ====== PROJECTS ======
  app.get("/api/projects", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const list = storage.listProjects().map((p) => {
      const nextTask = p.nextActionTaskId ? storage.listProjectTasks(p.id).find((t) => t.id === p.nextActionTaskId) : null;
      const phases = storage.listProjectPhases(p.id);
      const components = storage.listProjectComponents(p.id);
      const phase = nextTask?.componentId
        ? components.find((c) => c.id === nextTask.componentId)
        : null;
      const phaseObj = phase?.phaseId ? phases.find((ph) => ph.id === phase.phaseId) : null;
      return {
        ...p,
        nextAction: nextTask
          ? {
              id: nextTask.id,
              title: nextTask.title,
              deadline: nextTask.deadline,
              phaseName: phaseObj?.name || null,
              componentName: phase?.name || null,
            }
          : null,
      };
    });
    res.json(list);
  });

  app.post("/api/projects", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const { name, status, priority, description } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    res.json(storage.createProject({ name, status, priority, description }));
  });

  // Aggregate summary of project values — must be registered before /api/projects/:id
  // so Express doesn't match "values-summary" as an :id.
  app.get("/api/projects/values-summary", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const all = storage.listProjects();
    const active = all.filter((p) => p.status === "active");
    const scoredCurrent = active.filter(
      (p) => p.currentIncomePerHour != null && p.currentIncomePerHour > 0,
    );
    // Weighted average: assume equal weight per project (no time-spent data yet).
    // When time-spent telemetry lands, weight by hours-this-week.
    const weightedAvgCurrentRate = scoredCurrent.length
      ? Math.round(
          scoredCurrent.reduce((sum, p) => sum + (p.currentIncomePerHour ?? 0), 0) /
            scoredCurrent.length,
        )
      : null;
    const primaryFutureIncome = active.find((p) => p.isPrimaryFutureIncome === 1) ?? null;
    res.json({
      totalActive: active.length,
      totalParked: all.length - active.length,
      scoredCurrentIncome: scoredCurrent.length,
      weightedAvgCurrentRate,
      primaryFutureIncome: primaryFutureIncome
        ? {
            id: primaryFutureIncome.id,
            name: primaryFutureIncome.name,
            futureIncomeEstimate: primaryFutureIncome.futureIncomeEstimate,
          }
        : null,
    });
  });

  // Top-paying project today — matches today's calendar events against active
  // projects by case-insensitive substring match on project name. Returns the
  // project with the highest currentIncomePerHour (>= 300) tied to any event.
  // Must be registered before /api/projects/:id.
  app.get("/api/projects/top-paying-today", async (_req, res) => {
    if (!requireUserOrOrchestrator(_req, res)) return;
    const events = await getMergedPlannerEvents();
    const today = eventsForDate(events, new Date());
    const active = storage
      .listProjects()
      .filter(
        (p) =>
          p.status === "active" &&
          p.currentIncomePerHour != null &&
          p.currentIncomePerHour >= 300,
      );
    if (active.length === 0 || today.length === 0) {
      return res.json({ project: null, matchedEvent: null });
    }
    // Match each event against project names. Lowercase the haystack once.
    type Match = { project: typeof active[number]; event: typeof today[number] };
    const matches: Match[] = [];
    for (const ev of today) {
      const hay = `${ev.summary ?? ""} ${ev.location ?? ""} ${ev.description ?? ""}`.toLowerCase();
      for (const p of active) {
        const needle = p.name.trim().toLowerCase();
        if (needle.length >= 3 && hay.includes(needle)) {
          matches.push({ project: p, event: ev });
        }
      }
    }
    if (matches.length === 0) {
      return res.json({ project: null, matchedEvent: null });
    }
    matches.sort(
      (a, b) => (b.project.currentIncomePerHour ?? 0) - (a.project.currentIncomePerHour ?? 0),
    );
    const top = matches[0];
    res.json({
      project: {
        id: top.project.id,
        name: top.project.name,
        currentIncomePerHour: top.project.currentIncomePerHour,
      },
      matchedEvent: {
        uid: top.event.uid,
        summary: top.event.summary,
        start: top.event.start,
        end: top.event.end,
      },
    });
  });

  app.get("/api/projects/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const project = storage.getProject(id);
    if (!project) return res.status(404).json({ error: "not found" });
    const phases = storage.listProjectPhases(id);
    const components = storage.listProjectComponents(id);
    const tasks = storage.listProjectTasks(id);
    const unassigned = tasks.filter((t) => t.componentId == null);
    res.json({ project, phases, components, tasks, unassigned });
  });

  app.patch("/api/projects/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const allowed = [
      "name",
      "status",
      "priority",
      "description",
      "currentPhaseId",
      "nextActionTaskId",
      // Feature 2 — Project values
      "currentIncomePerHour",
      "futureIncomeEstimate",
      "isPrimaryFutureIncome",
      "communityBenefit",
      "professionalKudos",
    ];
    const updates: any = {};
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];

    // Validate ranges where applicable.
    if ("currentIncomePerHour" in updates && updates.currentIncomePerHour != null) {
      const v = Number(updates.currentIncomePerHour);
      if (!Number.isFinite(v) || v < 0 || v > 100000) {
        return res.status(400).json({ error: "currentIncomePerHour must be between 0 and 100000" });
      }
      updates.currentIncomePerHour = Math.round(v);
    }
    if ("futureIncomeEstimate" in updates && updates.futureIncomeEstimate != null) {
      const v = Number(updates.futureIncomeEstimate);
      if (!Number.isFinite(v) || v < 0 || v > 100000000) {
        return res.status(400).json({ error: "futureIncomeEstimate must be between 0 and 100000000" });
      }
      updates.futureIncomeEstimate = Math.round(v);
    }
    for (const field of ["communityBenefit", "professionalKudos"] as const) {
      if (field in updates && updates[field] != null) {
        const v = Number(updates[field]);
        if (!Number.isInteger(v) || v < 1 || v > 5) {
          return res.status(400).json({ error: `${field} must be an integer 1-5` });
        }
        updates[field] = v;
      }
    }

    // Single-flag invariant: if this project is being marked primary, clear the flag on all others.
    if ("isPrimaryFutureIncome" in updates) {
      updates.isPrimaryFutureIncome = updates.isPrimaryFutureIncome ? 1 : 0;
      if (updates.isPrimaryFutureIncome === 1) {
        for (const p of storage.listProjects()) {
          if (p.id !== id && p.isPrimaryFutureIncome === 1) {
            storage.updateProject(p.id, { isPrimaryFutureIncome: 0 });
          }
        }
      }
    }

    const updated = storage.updateProject(id, updates);
    res.json(updated);
  });

  app.delete("/api/projects/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = parseInt(req.params.id, 10);
    storage.deleteProject(id);
    res.json({ ok: true });
  });

  // Phases
  app.post("/api/projects/:id/phases", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const projectId = parseInt(req.params.id, 10);
    const { name, orderIndex } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    res.json(storage.createProjectPhase({
      projectId, name, orderIndex: Number(orderIndex) || 0, completed: 0,
      createdAt: Date.now(),
    }));
  });
  app.patch("/api/phases/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const allowed = ["name", "orderIndex", "completed"];
    const updates: any = {};
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    storage.updateProjectPhase(id, updates);
    res.json({ ok: true });
  });
  app.delete("/api/phases/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    storage.deleteProjectPhase(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // Components
  app.post("/api/projects/:id/components", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const projectId = parseInt(req.params.id, 10);
    const { name, phaseId, orderIndex } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    res.json(storage.createProjectComponent({
      projectId, name, phaseId: phaseId ?? null, orderIndex: Number(orderIndex) || 0,
      createdAt: Date.now(),
    }));
  });
  app.patch("/api/components/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const allowed = ["name", "phaseId", "orderIndex"];
    const updates: any = {};
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    storage.updateProjectComponent(id, updates);
    res.json({ ok: true });
  });
  app.delete("/api/components/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    storage.deleteProjectComponent(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // Tasks
  app.post("/api/projects/:id/tasks", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const projectId = parseInt(req.params.id, 10);
    const { title, componentId, deadline, notes, msTodoTaskId } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    res.json(storage.createProjectTask({
      projectId,
      componentId: componentId ?? null,
      title,
      notes: notes ?? "",
      deadline: deadline ?? null,
      msTodoTaskId: msTodoTaskId ?? null,
      completed: 0,
      orderIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any));
  });
  app.patch("/api/tasks/project/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const allowed = ["title", "componentId", "deadline", "notes", "completed", "orderIndex"];
    const updates: any = {};
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    storage.updateProjectTask(id, updates);
    res.json({ ok: true });
  });
  app.delete("/api/tasks/project/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    storage.deleteProjectTask(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // Bulk ingest from MS To Do (called by cron)
  app.post("/api/projects/ingest", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const { lists } = req.body || {};
    if (!Array.isArray(lists)) return res.status(400).json({ error: "lists array required" });
    const summary: any = { projects: 0, tasks: 0 };
    for (const list of lists) {
      // list: { msTodoListId, name, status, tasks: [{ msTodoTaskId, title, notes?, deadline?, completed? }] }
      const proj = storage.upsertProjectByListId({
        msTodoListId: list.msTodoListId,
        name: list.name,
        status: list.status || "active",
        priority: "low",
        description: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any);
      summary.projects++;
      for (const t of (list.tasks || [])) {
        storage.upsertProjectTaskByMsId({
          projectId: proj.id,
          componentId: null,
          msTodoTaskId: t.msTodoTaskId,
          title: t.title || "",
          notes: t.notes || "",
          deadline: t.deadline ?? null,
          completed: t.completed ? 1 : 0,
          orderIndex: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as any);
        summary.tasks++;
      }
    }
    res.json(summary);
  });

  // ====== DAILY FACTORS (Mood + lightweight measures) ======
  // Allowed values per measure — kept loose at the API layer; UI enforces choice.
  const FACTOR_KEYS = [
    "mood",
    "energy",
    "cognitiveLoad",
    "sleepQuality",
    "focus",
    "valuesAlignment",
  ] as const;

  app.get("/api/daily-factors/today", (_req, res) => {
    const date = melbourneDateStr();
    const row = storage.getDailyFactors(date) ?? null;
    res.json({ date, factors: row });
  });

  app.get("/api/daily-factors/:ymd", (req, res) => {
    const ymd = String(req.params.ymd);
    const row = storage.getDailyFactors(ymd) ?? null;
    res.json({ date: ymd, factors: row });
  });

  app.patch("/api/daily-factors/:ymd", (req, res) => {
    const ymd = String(req.params.ymd);
    const patch: any = {};
    for (const k of FACTOR_KEYS) {
      if (k in (req.body ?? {})) {
        const v = req.body[k];
        patch[k] = v === "" || v === undefined ? null : v;
      }
    }
    const row = storage.upsertDailyFactors(ymd, patch);
    res.json(row);
  });

  app.get("/api/daily-factors", (req, res) => {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!from || !to) {
      return res.status(400).json({ error: "from and to query params required (YYYY-MM-DD)" });
    }
    res.json(storage.listDailyFactorsBetween(from, to));
  });

  // ====== ISSUES (contextual life issues log) ======
  const ISSUE_CATEGORIES = new Set(["relationship", "house", "kids", "work", "other"]);
  const ISSUE_STATUSES = new Set(["open", "ongoing", "resolved"]);
  const SUPPORT_TYPES = new Set(["listen", "problem_solve", "practical"]);

  app.get("/api/issues", (req, res) => {
    const opts: { status?: string; from?: string; to?: string } = {};
    if (req.query.status) opts.status = String(req.query.status);
    if (req.query.from) opts.from = String(req.query.from);
    if (req.query.to) opts.to = String(req.query.to);
    res.json(storage.listIssues(opts));
  });

  app.get("/api/issues/this-week", (_req, res) => {
    const today = melbourneDateStr();
    // Compute Monday of current week (Melbourne) using Date math.
    const d = new Date(today + "T00:00:00");
    const dow = d.getDay(); // Sun=0..Sat=6
    const offsetToMonday = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(d);
    monday.setDate(d.getDate() + offsetToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (x: Date) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    const mondayYmd = fmt(monday);
    const sundayYmd = fmt(sunday);
    // Issues created this week, plus any still-open/ongoing issues from earlier.
    const thisWeek = storage.listIssues({ from: mondayYmd, to: sundayYmd });
    const carriedOver = storage
      .listIssues({})
      .filter(
        (i) =>
          (i.status === "open" || i.status === "ongoing") &&
          i.createdYmd < mondayYmd,
      );
    res.json({
      mondayYmd,
      sundayYmd,
      thisWeek,
      carriedOver,
    });
  });

  app.get("/api/issues/:id", (req, res) => {
    const id = Number(req.params.id);
    const row = storage.getIssue(id);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });

  app.post("/api/issues", (req, res) => {
    const b = req.body ?? {};
    if (!ISSUE_CATEGORIES.has(b.category)) {
      return res.status(400).json({ error: "invalid category" });
    }
    const status = b.status && ISSUE_STATUSES.has(b.status) ? b.status : "open";
    const supportType = b.supportType && SUPPORT_TYPES.has(b.supportType) ? b.supportType : null;
    const row = storage.createIssue({
      createdYmd: String(b.createdYmd ?? melbourneDateStr()),
      category: b.category,
      note: b.note ? String(b.note).slice(0, 200) : null,
      needSupport: b.needSupport ? 1 : 0,
      supportType: b.needSupport ? supportType : null,
      status,
      resolvedYmd: status === "resolved" ? String(b.resolvedYmd ?? melbourneDateStr()) : null,
      sourcePage: String(b.sourcePage ?? "reflect"),
    });
    res.json(row);
  });

  app.patch("/api/issues/:id", (req, res) => {
    const id = Number(req.params.id);
    const existing = storage.getIssue(id);
    if (!existing) return res.status(404).json({ error: "not found" });
    const b = req.body ?? {};
    const patch: any = {};
    if ("category" in b) {
      if (!ISSUE_CATEGORIES.has(b.category)) return res.status(400).json({ error: "invalid category" });
      patch.category = b.category;
    }
    if ("note" in b) patch.note = b.note ? String(b.note).slice(0, 200) : null;
    if ("needSupport" in b) {
      patch.needSupport = b.needSupport ? 1 : 0;
      if (!b.needSupport) patch.supportType = null;
    }
    if ("supportType" in b) {
      patch.supportType = b.supportType && SUPPORT_TYPES.has(b.supportType) ? b.supportType : null;
    }
    if ("status" in b) {
      if (!ISSUE_STATUSES.has(b.status)) return res.status(400).json({ error: "invalid status" });
      patch.status = b.status;
      if (b.status === "resolved") {
        patch.resolvedYmd = String(b.resolvedYmd ?? melbourneDateStr());
      } else {
        patch.resolvedYmd = null;
      }
    }
    const row = storage.updateIssue(id, patch);
    res.json(row);
  });

  app.delete("/api/issues/:id", (req, res) => {
    const id = Number(req.params.id);
    storage.deleteIssue(id);
    res.json({ ok: true });
  });

  // Feature 5 — Coach API.
  registerCoachRoutes({
    app,
    requireUserOrOrchestrator,
    getMergedPlannerEvents,
    computeAvailableHoursThisWeek,
  });

  return httpServer;
}
