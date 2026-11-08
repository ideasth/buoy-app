// filepath: /home/user/workspace/anchor/server/ontime/config.ts
// Stage 25 (On Time) — configuration shape + defaults.
// Stored as a single JSON row in ontime_config. Secrets (ntfy token, Graph
// client secret) are NEVER stored here; they live in /home/jod/buoy/.secrets/.

export interface RoutineCue {
  id: string;
  days: number[];     // ISO weekdays 1=Mon..7=Sun
  time: string;       // HH:MM Melbourne
  title: string;      // short, watch-friendly
  firstStep?: string; // tiny first step shown in the body
  enabled: boolean;
}

export interface OnTimeConfig {
  enabled: boolean;              // master switch: nothing is sent while false
  bufferMinutes: number;         // added on top of travel allow-minutes
  getReadyLeadMinutes: number;   // "Get ready" fires this long before leave-by
  wrapUpLeadMinutes: number;     // "Wrap up" fires this long before leave-by
  noTravelLeadMinutes: number;   // events without a travel match: "Starts soon"
  escalateAfterMinutes: number;  // firmer alert if "Leave now" not acknowledged
  snoozeMinutes: number;
  maxSnoozes: number;
  quietStart: string;            // HH:MM
  quietEnd: string;              // HH:MM
  digestTime: string;            // HH:MM daily "Today" summary
  digestEnabled: boolean;
  privacyLabels: boolean;        // never put event titles on the watch
  lateMessage: string;           // pre-filled "Running late" SMS text; {mins}
  ignoreKeywords: string[];      // calendar events containing these get no cues
  ntfyBaseUrl: string;           // e.g. https://ntfy.thinhalo.com
  ntfyTopic: string;             // private topic name
  publicBaseUrl: string;         // used for action-button callbacks
  emailEnabled: boolean;         // poll Microsoft Graph (needs secret file)
  emailPollMinutes: number;
  emailNudges: boolean;          // push act-today emails with a near deadline
  ollamaUrl: string;
  ollamaModel: string;
  routine: RoutineCue[];
}

// Oliver's agreed daily structure (24 Oct 2026): wake 06:00, bed 22:00,
// cello 1h x5, swim/sauna x3, daily upper back + flat feet exercises.
export const DEFAULT_ROUTINE: RoutineCue[] = [
  { id: "physio-am", days: [1, 2, 3, 4, 5, 6, 7], time: "06:00", title: "Upper back exercises", firstStep: "Open Daisy's physio app, first exercise", enabled: true },
  { id: "top3", days: [1, 2, 3, 4, 5], time: "07:30", title: "Brain dump + lock Top 3", firstStep: "Open Buoy Morning", enabled: true },
  { id: "deep-work", days: [1, 3, 4, 5], time: "08:00", title: "First work block", firstStep: "Open the one document for Top 1", enabled: true },
  { id: "cello", days: [1, 3, 4, 5, 6], time: "16:00", title: "Cello - 1 hour", firstStep: "Cello out of the case, tune", enabled: true },
  { id: "swim-tue", days: [2], time: "16:45", title: "Swim / sauna / spa", firstStep: "Grab the swim bag", enabled: true },
  { id: "swim-thu", days: [4], time: "12:00", title: "Swim / sauna / spa", firstStep: "Grab the swim bag", enabled: true },
  { id: "swim-sun", days: [7], time: "09:00", title: "Swim / sauna / spa", firstStep: "Grab the swim bag", enabled: true },
  { id: "wind-down", days: [1, 2, 3, 4, 5, 6, 7], time: "21:15", title: "Flat feet exercises, then wind down", firstStep: "10 minutes, then screens off at 21:30", enabled: true },
];

export const DEFAULT_CONFIG: OnTimeConfig = {
  enabled: false,
  bufferMinutes: 15,
  getReadyLeadMinutes: 30,
  wrapUpLeadMinutes: 10,
  noTravelLeadMinutes: 10,
  escalateAfterMinutes: 2,
  snoozeMinutes: 5,
  maxSnoozes: 2,
  quietStart: "22:00",
  quietEnd: "06:00",
  digestTime: "06:30",
  digestEnabled: true,
  privacyLabels: true,
  lateMessage: "Sorry, I'm running about {mins} minutes late. On my way.",
  ignoreKeywords: ["available", "tentative", "hold", "kids with us", "public holiday", "birthday", "focus time"],
  ntfyBaseUrl: "",
  ntfyTopic: "",
  publicBaseUrl: "https://buoy.thinhalo.com",
  emailEnabled: false,
  emailPollMinutes: 10,
  emailNudges: true,
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen2.5:7b",
  routine: DEFAULT_ROUTINE,
};

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(lo, Math.min(hi, Math.round(n)));
};
const isHHMM = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Merge a partial patch onto a config, validating every field. */
export function mergeConfig(cur: OnTimeConfig, patch: Record<string, unknown>): OnTimeConfig {
  const out: OnTimeConfig = { ...cur };
  const p = patch ?? {};
  if (typeof p.enabled === "boolean") out.enabled = p.enabled;
  if ("bufferMinutes" in p) out.bufferMinutes = clampInt(p.bufferMinutes, 0, 120, cur.bufferMinutes);
  if ("getReadyLeadMinutes" in p) out.getReadyLeadMinutes = clampInt(p.getReadyLeadMinutes, 5, 120, cur.getReadyLeadMinutes);
  if ("wrapUpLeadMinutes" in p) out.wrapUpLeadMinutes = clampInt(p.wrapUpLeadMinutes, 2, 60, cur.wrapUpLeadMinutes);
  if ("noTravelLeadMinutes" in p) out.noTravelLeadMinutes = clampInt(p.noTravelLeadMinutes, 0, 60, cur.noTravelLeadMinutes);
  if ("escalateAfterMinutes" in p) out.escalateAfterMinutes = clampInt(p.escalateAfterMinutes, 1, 15, cur.escalateAfterMinutes);
  if ("snoozeMinutes" in p) out.snoozeMinutes = clampInt(p.snoozeMinutes, 1, 30, cur.snoozeMinutes);
  if ("maxSnoozes" in p) out.maxSnoozes = clampInt(p.maxSnoozes, 0, 5, cur.maxSnoozes);
  if (isHHMM(p.quietStart)) out.quietStart = p.quietStart;
  if (isHHMM(p.quietEnd)) out.quietEnd = p.quietEnd;
  if (isHHMM(p.digestTime)) out.digestTime = p.digestTime;
  if (typeof p.digestEnabled === "boolean") out.digestEnabled = p.digestEnabled;
  if (typeof p.privacyLabels === "boolean") out.privacyLabels = p.privacyLabels;
  if (typeof p.lateMessage === "string") out.lateMessage = p.lateMessage.slice(0, 300);
  if (Array.isArray(p.ignoreKeywords)) {
    out.ignoreKeywords = p.ignoreKeywords.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 50);
  }
  if (typeof p.ntfyBaseUrl === "string") out.ntfyBaseUrl = p.ntfyBaseUrl.trim().replace(/\/+$/, "");
  if (typeof p.ntfyTopic === "string") out.ntfyTopic = p.ntfyTopic.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  if (typeof p.publicBaseUrl === "string") out.publicBaseUrl = p.publicBaseUrl.trim().replace(/\/+$/, "");
  if (typeof p.emailEnabled === "boolean") out.emailEnabled = p.emailEnabled;
  if ("emailPollMinutes" in p) out.emailPollMinutes = clampInt(p.emailPollMinutes, 5, 120, cur.emailPollMinutes);
  if (typeof p.emailNudges === "boolean") out.emailNudges = p.emailNudges;
  if (typeof p.ollamaUrl === "string") out.ollamaUrl = p.ollamaUrl.trim().replace(/\/+$/, "");
  if (typeof p.ollamaModel === "string") out.ollamaModel = p.ollamaModel.trim().slice(0, 80);
  if (Array.isArray(p.routine)) {
    out.routine = (p.routine as any[])
      .filter((r) => r && isHHMM(r.time) && typeof r.title === "string" && r.title.trim())
      .slice(0, 40)
      .map((r, i) => ({
        id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : `cue-${i}-${Date.now()}`,
        days: Array.isArray(r.days)
          ? Array.from(new Set(r.days.map(Number).filter((d: number) => d >= 1 && d <= 7))).sort() as number[]
          : [1, 2, 3, 4, 5, 6, 7],
        time: r.time,
        title: String(r.title).trim().slice(0, 60),
        firstStep: typeof r.firstStep === "string" ? r.firstStep.trim().slice(0, 120) : undefined,
        enabled: r.enabled !== false,
      }));
  }
  return out;
}
