// Shared client utilities for Anchor.

export const DOMAIN_OPTIONS = [
  { value: "family", label: "Family" },
  { value: "work", label: "Work" },
  { value: "medicolegal", label: "Medicolegal" },
  { value: "personal", label: "Personal" },
  { value: "health", label: "Health" },
] as const;

export const PRIORITY_OPTIONS = [
  { value: "anchor", label: "Anchor" },
  { value: "deadline", label: "Deadline" },
  { value: "deep", label: "Deep" },
  { value: "maintenance", label: "Maintenance" },
  { value: "iftime", label: "If-time" },
] as const;

export const ESTIMATE_PRESETS = [15, 30, 45, 60, 90];

const KEYWORD_RULES: Array<{ pattern: RegExp; domain: string; priority?: string }> = [
  { pattern: /\b(hilde|axel|marieke|kids?|school|family|wife|son|daughter)\b/i, domain: "family", priority: "anchor" },
  { pattern: /\b(patient|clinic|peninsula|sandy|consult|review|admit|ward|registrar|psychiatry|telehealth)\b/i, domain: "work" },
  { pattern: /\b(medicolegal|report|expert|tribunal|court|affidavit|opinion|coroner)\b/i, domain: "medicolegal", priority: "deadline" },
  { pattern: /\b(gym|run|swim|sleep|gp|dentist|appointment|exercise|meditate)\b/i, domain: "health" },
];

export function classifyTask(title: string): { domain: string; priority?: string } {
  for (const r of KEYWORD_RULES) {
    if (r.pattern.test(title)) return { domain: r.domain, priority: r.priority };
  }
  return { domain: "personal" };
}

export function todayDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtClock(d: Date): { hh: string; mm: string; ss: string } {
  return {
    hh: String(d.getHours()).padStart(2, "0"),
    mm: String(d.getMinutes()).padStart(2, "0"),
    ss: String(d.getSeconds()).padStart(2, "0"),
  };
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function minutesUntil(iso: string): number {
  return Math.round((+new Date(iso) - Date.now()) / 60000);
}

export function isAllDayCovering(ev: { start: string; end: string; allDay: boolean }, now = new Date()): boolean {
  if (!ev.allDay) return false;
  return new Date(ev.start) <= now && new Date(ev.end) >= now;
}

export function statusFor(minutesUntilNext: number | null): "green" | "amber" | "red" {
  if (minutesUntilNext === null) return "green";
  if (minutesUntilNext < 0) return "red";
  if (minutesUntilNext < 15) return "amber";
  return "green";
}

export function priorityLabel(p: string) {
  return PRIORITY_OPTIONS.find((x) => x.value === p)?.label ?? p;
}

export function domainLabel(d: string) {
  return DOMAIN_OPTIONS.find((x) => x.value === d)?.label ?? d;
}

export function domainTone(d: string): string {
  // returns tailwind classes
  switch (d) {
    case "family":
      return "border-amber-500/30 text-amber-300 dark:text-amber-300";
    case "work":
      return "border-sky-500/30 text-sky-700 dark:text-sky-300";
    case "medicolegal":
      return "border-rose-500/30 text-rose-700 dark:text-rose-300";
    case "personal":
      return "border-emerald-500/30 text-emerald-700 dark:text-emerald-300";
    case "health":
      return "border-violet-500/30 text-violet-700 dark:text-violet-300";
    default:
      return "border-border text-muted-foreground";
  }
}
