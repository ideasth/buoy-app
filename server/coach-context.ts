// Feature 5 — Coach context bundle + system prompts + crisis detector.
//
// The bundle is a compact JSON summary of recent state passed into the
// system prompt. We keep it text-y (not code-y) so the model's reasoning
// stays grounded in the user's actual life rather than in schema details.

import { storage } from "./storage";
import type { CalEvent } from "./ics";
import type { AvailableHoursThisWeek } from "./available-hours";

type StorageT = typeof storage;
void storage; // imported only for type inference; suppress unused-value warnings

// -- Crisis detector ---------------------------------------------------------

const CRISIS_TERMS: RegExp[] = [
  /\bsuicid(e|al|ality)\b/i,
  /\bkill (myself|me)\b/i,
  /\bend (it|my life)\b/i,
  /\bI (don'?t|do not) want to (live|be alive|wake up)\b/i,
  /\bself[- ]harm\b/i,
  /\bharm myself\b/i,
  /\bcut(ting)? myself\b/i,
  /\bhurt myself\b/i,
  /\bno (point|reason) (in|to) (living|being alive)\b/i,
  /\b(want|wish) (I|i) (was|were) dead\b/i,
];

export function detectCrisisLanguage(text: string): boolean {
  if (!text) return false;
  return CRISIS_TERMS.some((re) => re.test(text));
}

export const CRISIS_RESPONSE = [
  "I'm hearing something serious in what you wrote, and I want to pause the coaching here.",
  "",
  "If you're in immediate danger or considering harm, please contact:",
  "",
  "- Lifeline AU \u2014 13 11 14 (24/7 phone & text)",
  "- Suicide Call Back Service \u2014 1300 659 467",
  "- Beyond Blue \u2014 1300 22 4636",
  "- Emergency \u2014 000",
  "",
  "Please also consider reaching out directly to your GP, or to Marieke. You don't have to handle this alone, and a coaching chat is the wrong tool for this moment. I'll stay here when you're ready, but please make a human contact first.",
].join("\n");

// -- Context bundle ----------------------------------------------------------

export interface CoachContextBundle {
  generatedAt: string;
  todayYmd: string;
  // Mood/energy/sleep snapshot (last 7 days).
  recentDailyFactors: Array<{
    date: string;
    mood?: string | null;
    energy?: string | null;
    cognitiveLoad?: string | null;
    sleepQuality?: string | null;
    focus?: string | null;
    valuesAlignment?: string | null;
  }>;
  // Today's top three (with task names + status) and yesterday unfinished.
  todayTop3: Array<{ slot: number; taskId: number; name: string; status: string }>;
  yesterdayUnfinished: Array<{ taskId: number; name: string; status: string }>;
  // Open life issues (limit 10).
  openIssues: Array<{
    id: number;
    date: string;
    category: string;
    note: string | null;
    needSupport: boolean;
    supportType?: string | null;
    status: string;
  }>;
  // Available hours this week.
  availableHoursThisWeek: { totalHours: number; bookedHours: number; freeHours: number } | null;
  availableHoursDetail?: AvailableHoursThisWeek | null;
  // Today + tomorrow timed events.
  upcomingEvents: Array<{ date: string; start: string; end: string; summary: string; location?: string }>;
  // Last 3 reflections (oldest -> newest).
  recentReflections: Array<{
    date: string;
    energy?: number | null;
    state?: string | null;
    avoidedTask?: string | null;
    notes: string;
  }>;
  // Last 3 coach session summaries (oldest -> newest), no full transcripts.
  recentCoachSessionSummaries: Array<{
    id: number;
    startedAt: number;
    endedAt: number | null;
    summary: string;
  }>;
  // Projects with currentIncomePerHour set (so the model can reason about $/hr).
  pricedProjects: Array<{ id: number; name: string; currentIncomePerHour: number | null }>;
  // Last 7 days of calendar time matched against priced projects (best-effort).
  // Helps the coach reason about where the user actually spent time vs intent.
  lastWeekTimeSpentPerProject: Array<{
    projectId: number;
    name: string;
    minutes: number;
    matchedEventCount: number;
    currentIncomePerHour: number | null;
  }>;
  // Last 7 days of locked top-three (oldest -> newest), so the coach can see
  // what the user has been deciding to prioritise day-by-day.
  recentTopThreeHistory: Array<{
    date: string;
    slot1?: { taskId: number; name: string; status: string } | null;
    slot2?: { taskId: number; name: string; status: string } | null;
    slot3?: { taskId: number; name: string; status: string } | null;
  }>;
}



function todayYmdMelb(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function ymdMelb(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export interface BuildBundleArgs {
  storage: StorageT;
  events: CalEvent[];
  availableHours?: AvailableHoursThisWeek | null;
}

export function buildCoachContextBundle({
  storage,
  events,
  availableHours,
}: BuildBundleArgs): CoachContextBundle {
  const today = todayYmdMelb();
  const yesterday = ymdMelb(new Date(Date.now() - 24 * 3600_000));

  const dfFrom = ymdMelb(new Date(Date.now() - 7 * 24 * 3600_000));
  const factors = storage.listDailyFactorsBetween(dfFrom, today).map((f) => ({
    date: f.date,
    mood: f.mood ?? null,
    energy: f.energy ?? null,
    cognitiveLoad: f.cognitiveLoad ?? null,
    sleepQuality: f.sleepQuality ?? null,
    focus: f.focus ?? null,
    valuesAlignment: f.valuesAlignment ?? null,
  }));

  const tasksById = new Map<number, { name: string; status: string }>();
  for (const t of storage.listTasks()) tasksById.set(t.id, { name: t.title, status: t.status });

  const top = storage.getTopThree(today);
  const todayTop3: CoachContextBundle["todayTop3"] = [];
  for (const slot of [1, 2, 3] as const) {
    const id = (top as any)?.[`taskId${slot}`] as number | null | undefined;
    if (id != null) {
      const t = tasksById.get(id);
      if (t) todayTop3.push({ slot, taskId: id, name: t.name, status: t.status });
    }
  }

  const yTop = storage.getTopThree(yesterday);
  const yesterdayUnfinished: CoachContextBundle["yesterdayUnfinished"] = [];
  for (const slot of [1, 2, 3] as const) {
    const id = (yTop as any)?.[`taskId${slot}`] as number | null | undefined;
    if (id != null) {
      const t = tasksById.get(id);
      if (t && t.status !== "done" && t.status !== "dropped") {
        yesterdayUnfinished.push({ taskId: id, name: t.name, status: t.status });
      }
    }
  }

  const openIssues = storage
    .listIssues({ status: "open" })
    .slice(0, 10)
    .map((i) => ({
      id: i.id,
      date: i.createdYmd,
      category: i.category,
      note: i.note ?? null,
      needSupport: (i.needSupport ?? 0) === 1,
      supportType: i.supportType ?? null,
      status: i.status,
    }));

  // Today + tomorrow timed events (drop all-day).
  const tomorrow = ymdMelb(new Date(Date.now() + 24 * 3600_000));
  const upcomingEvents: CoachContextBundle["upcomingEvents"] = [];
  for (const e of events) {
    if (e.allDay) continue;
    const ymd = ymdMelb(new Date(e.start));
    if (ymd !== today && ymd !== tomorrow) continue;
    upcomingEvents.push({
      date: ymd,
      start: e.start,
      end: e.end,
      summary: e.summary,
      location: e.location,
    });
  }
  upcomingEvents.sort((a, b) => +new Date(a.start) - +new Date(b.start));

  const reflections = storage.listReflections();
  const recentReflections = reflections
    .slice(-3)
    .map((r) => ({
      date: r.date,
      energy: r.energy ?? null,
      state: r.state ?? null,
      avoidedTask: r.avoidedTask ?? null,
      notes: (r.notes ?? "").trim(),
    }));

  const recentCoachSessionSummaries = storage
    .listRecentCoachSessionSummaries(3)
    .map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      summary: typeof s.summary === "string" ? s.summary : JSON.stringify(s.summary ?? {}),
    }));

  const allProjects = storage.listProjects();
  const pricedProjects = allProjects
    .filter((p) => (p as any).currentIncomePerHour != null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      currentIncomePerHour: (p as any).currentIncomePerHour ?? null,
    }));

  // -- Last 7 days time spent per project (best-effort calendar match) --
  // Mirrors /api/projects/top-paying-today matching: case-insensitive substring
  // on summary+location+description, project name needle >= 3 chars. We only
  // count active projects; a project may have multiple priced phases but the
  // event level is too coarse to attribute to phases reliably.
  const activeProjects = allProjects.filter((p) => p.status === "active");
  type ProjAccum = { project: typeof activeProjects[number]; minutes: number; count: number };
  const projAccum = new Map<number, ProjAccum>();
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 3600_000;
  for (const ev of events) {
    if (ev.allDay) continue;
    const startMs = +new Date(ev.start);
    const endMs = +new Date(ev.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs <= sevenDaysAgoMs) continue;
    if (startMs > Date.now()) continue;
    // Clip to last-7-days window so an ongoing/long event doesn't over-attribute.
    const clippedStart = Math.max(startMs, sevenDaysAgoMs);
    const clippedEnd = Math.min(endMs, Date.now());
    const minutes = Math.max(0, Math.round((clippedEnd - clippedStart) / 60000));
    if (minutes <= 0) continue;
    const hay = `${ev.summary ?? ""} ${ev.location ?? ""} ${ev.description ?? ""}`.toLowerCase();
    for (const p of activeProjects) {
      const needle = p.name.trim().toLowerCase();
      if (needle.length < 3) continue;
      if (!hay.includes(needle)) continue;
      const cur = projAccum.get(p.id) ?? { project: p, minutes: 0, count: 0 };
      cur.minutes += minutes;
      cur.count += 1;
      projAccum.set(p.id, cur);
    }
  }
  const lastWeekTimeSpentPerProject = Array.from(projAccum.values())
    .map((a) => ({
      projectId: a.project.id,
      name: a.project.name,
      minutes: a.minutes,
      matchedEventCount: a.count,
      currentIncomePerHour: (a.project as any).currentIncomePerHour ?? null,
    }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 10);

  // -- Last 7 days locked top-three history -----------------------------
  const topHistoryFrom = ymdMelb(new Date(Date.now() - 7 * 24 * 3600_000));
  const slotEntry = (id: number | null | undefined) => {
    if (id == null) return null;
    const t = tasksById.get(id);
    if (!t) return { taskId: id, name: `(task ${id})`, status: "unknown" };
    return { taskId: id, name: t.name, status: t.status };
  };
  const recentTopThreeHistory = storage
    .listTopThreeBetween(topHistoryFrom, today)
    .map((row) => ({
      date: row.date,
      slot1: slotEntry((row as any).taskId1),
      slot2: slotEntry((row as any).taskId2),
      slot3: slotEntry((row as any).taskId3),
    }));

  return {
    generatedAt: new Date().toISOString(),
    todayYmd: today,
    recentDailyFactors: factors,
    todayTop3,
    yesterdayUnfinished,
    openIssues,
    availableHoursThisWeek: availableHours
      ? {
          totalHours: Math.round((availableHours.totalWakingMinutes / 60) * 10) / 10,
          bookedHours:
            Math.round(
              ((availableHours.paidWorkMinutes +
                availableHours.familyMinutes +
                availableHours.otherCommittedMinutes) /
                60) *
                10,
            ) / 10,
          freeHours: Math.round((availableHours.freeMinutes / 60) * 10) / 10,
        }
      : null,
    availableHoursDetail: availableHours ?? null,
    upcomingEvents,
    recentReflections,
    recentCoachSessionSummaries,
    pricedProjects,
    lastWeekTimeSpentPerProject,
    recentTopThreeHistory,
  };
}

// -- System prompts ----------------------------------------------------------

const COMMON_PREAMBLE = `You are Anchor's private coach for Dr Oliver Daly (also called Justin Oliver Daly), a Melbourne-based clinician (obstetrics & urogynaecology) and healthcare administrator at AUPFHS who lives with ADHD. He uses Anchor as his single life-management surface across work (Elgin House, Sandringham, Peninsula Health, Monash, RANZCOG, IUGA/UGSA, medicolegal), home (partner Marieke; kids Hilde and Axel), and personal projects.

Voice and tone:
- Australian English. No emoji. Plain prose. Short paragraphs.
- Speak like a thoughtful, experienced peer \u2014 not a HR-bot, not a therapist, not a hype coach.
- Never say "I am an AI" or refuse to engage with relational, family, or values-laden material. Engage with humility but with substance.
- Default to a Socratic stance for relationship, kids, and house topics: ask one good question at a time, mirror what you hear, name a tension, only suggest a frame if invited.
- Be specific. Reference items from the supplied context bundle by name when relevant ("you've left 'submit Coleman report' carried over for 3 days").

Constraints:
- Do not invent calendar events, tasks, or people who aren't in the context bundle.
- Times are Australia/Melbourne unless stated otherwise.
- If the user expresses suicidal ideation, self-harm, or a clear crisis, stop coaching and direct them to Lifeline (13 11 14), 000, or their GP, and to Marieke. The system will detect most of this automatically; if you sense it and the system hasn't intervened, do it yourself.

The user's current state is provided as a JSON "context bundle" in the next system message. Treat it as ground truth. Do not echo it back.`;

const PLAN_MODE_INSTRUCTIONS = `You are in PLAN mode.

Goal: help the user shape what to do next \u2014 today, this week, or for a specific project. You may:
- Propose a top-3 candidate set for today (or tomorrow), drawing from open tasks + carry-overs.
- Suggest a sequencing for the day given energy/state and timed events.
- Identify a single highest-leverage move on a stuck issue.
- Stress-test a plan they've drafted.

Output style:
- Lead with one sentence of orientation.
- Then short bullets or a numbered list when proposing concrete moves.
- End with a single, specific question that moves the conversation forward (unless they've explicitly asked you to stop).
- If proposing a top-3 or an issue patch, mark the suggestion clearly so the UI can offer to apply it. Use a fenced block exactly like:

\`\`\`anchor-action
{ "type": "top3_candidate", "date": "YYYY-MM-DD", "taskIds": [12, 34, 56] }
\`\`\`

or

\`\`\`anchor-action
{ "type": "issue_patch", "issueId": 99, "fields": { "status": "in_progress", "domain": "work" } }
\`\`\`

Only emit one action block per turn, and only when the user has indicated they want a concrete commitment, not just exploration.`;

const REFLECT_MODE_INSTRUCTIONS = `You are in REFLECT mode.

Goal: help the user notice patterns, sit with what's actually going on, and articulate a value-led response \u2014 especially for relationship (Marieke), parenting (Hilde, Axel), house, or identity material. You may also reflect on work patterns when they're emotionally loaded, but never flatten them into productivity advice in this mode.

Stance:
- Socratic, not directive. Ask one question at a time.
- Mirror back the most charged or revealing phrase they used. Use their words.
- Name tensions, paradoxes, or things they're avoiding \u2014 gently, with permission.
- Do NOT propose a top-3, a task list, or a calendar move in this mode.
- Do NOT moralise. The user is an adult capable of his own values work.
- If they ask you to switch to plan mode, say so and stop reflecting.

Output style:
- Plain prose, paragraph-length, no bullets unless they explicitly ask.
- One question at a time.
- It is fine to be quiet \u2014 a single thoughtful question or mirror is often the best turn.`;

// Compact bundle sent to the model. We strip noisy fields (e.g. minute-level
// deep-work blocks) so the system prompt stays small enough that latency
// to first token is reasonable.
function bundleForModel(bundle: CoachContextBundle): Record<string, unknown> {
  const out: Record<string, unknown> = { ...bundle };
  delete (out as any).availableHoursDetail;
  // Drop yesterday's daily factors past today + yesterday to keep size down.
  if (Array.isArray(out.recentDailyFactors)) {
    out.recentDailyFactors = (out.recentDailyFactors as any[]).slice(-3);
  }
  return out;
}

export function buildSystemMessages(
  mode: "plan" | "reflect",
  bundle: CoachContextBundle,
): Array<{ role: "system"; content: string }> {
  const modeInstructions = mode === "plan" ? PLAN_MODE_INSTRUCTIONS : REFLECT_MODE_INSTRUCTIONS;
  // Combine preamble + mode instructions + bundle into a single system message.
  // sonar-reasoning-pro otherwise treats the second system block as just another
  // input to ignore in favour of (now-disabled) web search results.
  const bundleJson = JSON.stringify(bundleForModel(bundle));
  return [
    {
      role: "system",
      content: `${COMMON_PREAMBLE}\n\n${modeInstructions}\n\nContext bundle (JSON, ground truth — do not echo back, do not search the web for replacement context):\n${bundleJson}`,
    },
  ];
}

export const SUMMARY_SYSTEM_PROMPT = `You are summarising a coaching conversation for Dr Oliver Daly's private journal. Produce a tight, factual summary in 4\u20136 short bullets and a one-line "next step" line.

Format:
- Theme: ...
- Key tensions / what surfaced: ...
- What he decided or committed to (if anything): ...
- Open questions: ...
- Mood/state shift across the session: ...
- Next step: <single concrete action OR "none \u2014 reflective only">

Plain prose. No emoji. Australian English. Never invent commitments he didn't make.`;

export function buildSummaryRequestMessages(transcript: Array<{ role: "user" | "assistant"; content: string }>): Array<{ role: "system" | "user"; content: string }> {
  const joined = transcript
    .map((m) => `${m.role === "user" ? "Oliver" : "Coach"}: ${m.content}`)
    .join("\n\n");
  return [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    { role: "user", content: `Transcript:\n\n${joined}\n\nSummarise as instructed.` },
  ];
}

// -- Model selection ---------------------------------------------------------

/**
 * Default model per mode. Plan now defaults to `sonar-pro` for fast turns;
 * users can opt into deeper reasoning per session via the deepThink flag,
 * which routes plan turns to `sonar-reasoning-pro`. Reflect always uses
 * `sonar-pro` (Socratic mode does not benefit from chain-of-thought reasoning).
 */
export function modelForMode(mode: "plan" | "reflect", deepThink = false): string {
  if (mode === "plan" && deepThink) return "sonar-reasoning-pro";
  return "sonar-pro";
}

export const SUMMARY_MODEL = "sonar-pro";
