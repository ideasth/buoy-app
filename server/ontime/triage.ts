// filepath: /home/user/workspace/anchor/server/ontime/triage.ts
// Stage 25 (On Time) — email triage: rules first, then a local Ollama model
// for the summary / category / deadline. Runs entirely on the VPS; no email
// text leaves the server. Rules alone still work if Ollama is unavailable.

import { evaluateEmailPriority } from "@shared/email-priority";
import type { TriageCategory } from "./store";
import { addDaysKey, melbDateKey, melbWeekday } from "./time";

export interface TriageInput {
  sender: string;
  senderName: string;
  subject: string;
  body: string;
  receivedAt: number;
}

export interface RuleResult {
  isPriority: boolean;
  isBulk: boolean;
  hits: string[];
  hintCategory: TriageCategory | null;
}

const BULK_SENDER = /^(no-?reply|do-?not-?reply|newsletter|notifications?|mailer-daemon|news|marketing|info@.*(mailchimp|campaign))/i;
const BULK_BODY = /\bunsubscribe\b|view (this email )?in (your )?browser|manage (your )?(email )?preferences/i;
const URGENT = /\b(urgent|asap|as soon as possible|today|by (close of business|cob|eod|end of day)|immediately|time[- ]critical)\b/i;
const ACTION = /\b(please (call|reply|confirm|respond|review|sign|complete|advise)|rsvp|action required|deadline|due (by|on)|by \d{1,2}(:\d{2})?\s?(am|pm)|by (mon|tue|wed|thu|fri|sat|sun)[a-z]*|can you|could you|would you)\b/i;
const WAITING = /\b(i will (get back|come back|send)|we will (get back|be in touch|send)|awaiting|pending (your|our)|following up on|will confirm)\b/i;

export function applyRules(inp: TriageInput): RuleResult {
  const hits: string[] = [];
  const sender = (inp.sender || "").toLowerCase();
  const text = `${inp.subject}\n${inp.body.slice(0, 4000)}`;
  const isBulk = BULK_SENDER.test(sender.split("@")[0] ?? "") || BULK_SENDER.test(sender) || BULK_BODY.test(text);
  if (isBulk) hits.push("bulk");
  let isPriority = false;
  try {
    isPriority = evaluateEmailPriority({ sender: inp.sender, subject: inp.subject, bodyPreview: inp.body.slice(0, 500) } as any).isPriority;
  } catch { isPriority = false; }
  if (isPriority) hits.push("priority");
  const urgent = URGENT.test(text);
  if (urgent) hits.push("urgent");
  const action = ACTION.test(text);
  if (action) hits.push("action");
  const waiting = WAITING.test(text);
  if (waiting) hits.push("waiting");
  let hint: TriageCategory | null = null;
  if (isBulk && !isPriority) hint = "fyi";
  else if (urgent && (action || isPriority)) hint = "act_today";
  else if (action) hint = "reply_week";
  else if (waiting) hint = "waiting";
  return { isPriority, isBulk, hits, hintCategory: hint };
}

const WD: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Resolve a free-text deadline ("Thursday", "16/10", "23 Oct", "tomorrow",
 * "2026-11-12") to a YYYY-MM-DD relative to the email's received date.
 * Returns null if it can't be resolved confidently.
 */
export function resolveDeadline(text: string | null | undefined, receivedAt: number): string | null {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  const base = melbDateKey(receivedAt);
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (/\btoday\b|\beod\b|\bcob\b|end of day|close of business/.test(t)) return base;
  if (/\btomorrow\b/.test(t)) return addDaysKey(base, 1);
  const baseYear = Number(base.slice(0, 4));
  const fix = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (key < base) key = `${y + 1}-${key.slice(5)}`; // e.g. a January date seen in December
    return key;
  };
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/); // AU d/m
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : baseYear;
    return fix(y, Number(dm[2]), Number(dm[1]));
  }
  const dMon = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (dMon) return fix(baseYear, MONTHS[dMon[2]], Number(dMon[1]));
  const monD = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (monD) return fix(baseYear, MONTHS[monD[1]], Number(monD[2]));
  const wd = t.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/);
  if (wd) {
    const target = WD[wd[1]];
    const cur = melbWeekday(receivedAt);
    let delta = (target - cur + 7) % 7;
    // "next Thursday" is ambiguous in AU usage; resolve to the nearest one
    // (an early reminder is safer than a late one).
    if (delta === 0 && /next/.test(t)) delta = 7;
    return addDaysKey(base, delta);
  }
  return null;
}

export interface Classification {
  category: TriageCategory;
  summary: string;
  deadlineText: string | null;
  deadlineDate: string | null;
  model: string | null;
}

export function buildPrompt(inp: TriageInput, rules: RuleResult): string {
  const today = melbDateKey(inp.receivedAt);
  return [
    "You sort email for a busy Australian medical specialist with ADHD.",
    "Return ONLY JSON: {\"category\": one of act_today|reply_week|waiting|fyi, \"summary\": one plain sentence (max 20 words) saying what he needs to do, \"deadline\": the deadline as written in the email or null}.",
    "act_today = needs his action within 24 hours (urgent clinical, results calls, same-day deadlines).",
    "reply_week = needs a reply or action, but not today.",
    "waiting = he is waiting on someone else; nothing for him to do now.",
    "fyi = newsletters, notifications, receipts, information only.",
    `Email received: ${today}. Rule hints: ${rules.hits.join(", ") || "none"}.`,
    `From: ${inp.senderName} <${inp.sender}>`,
    `Subject: ${inp.subject}`,
    "Body:",
    inp.body.slice(0, 3000),
  ].join("\n");
}

export type LlmCall = (prompt: string) => Promise<string>;

export function ollamaCaller(url: string, model: string, timeoutMs = 180_000): LlmCall {
  return async (prompt) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false, format: "json", options: { temperature: 0.1 }, keep_alive: "30m" }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
      const j = (await res.json()) as { response?: string };
      return j.response ?? "";
    } finally {
      clearTimeout(timer);
    }
  };
}

const CATS: readonly TriageCategory[] = ["act_today", "reply_week", "waiting", "fyi"];

export async function classify(
  inp: TriageInput, llm: LlmCall | null, modelName: string | null,
): Promise<Classification & { rules: RuleResult }> {
  const rules = applyRules(inp);
  // Obvious bulk mail never needs the model.
  if (rules.isBulk && !rules.isPriority) {
    return { rules, category: "fyi", summary: "Newsletter or notification.", deadlineText: null, deadlineDate: null, model: null };
  }
  let category: TriageCategory = rules.hintCategory ?? (rules.isPriority ? "reply_week" : "fyi");
  let summary = inp.subject.slice(0, 140) || "(no subject)";
  let deadlineText: string | null = null;
  let usedModel: string | null = null;
  if (llm) {
    try {
      const raw = await llm(buildPrompt(inp, rules));
      const j = JSON.parse(raw);
      if (CATS.includes(j.category)) category = j.category;
      if (typeof j.summary === "string" && j.summary.trim()) summary = j.summary.trim().slice(0, 200);
      if (typeof j.deadline === "string" && j.deadline.trim() && j.deadline.toLowerCase() !== "null") {
        deadlineText = j.deadline.trim().slice(0, 80);
      }
      usedModel = modelName;
    } catch {
      // fall back to rules-only result
    }
  }
  // Safety rail: urgent + priority sender is never demoted below act_today.
  if (rules.isPriority && rules.hits.includes("urgent") && rules.hits.includes("action")) category = "act_today";
  if (!deadlineText) {
    // Rules-only fallback: "by Friday", "due 16/11", "before 3 Dec", "by tomorrow".
    const m = `${inp.subject}\n${inp.body.slice(0, 4000)}`.match(
      /\b(?:by|due(?: by| on)?|before|no later than)\s+((?:next\s+)?(?:today|tomorrow|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}))\b/i,
    );
    if (m) deadlineText = m[1];
  }
  const deadlineDate = resolveDeadline(deadlineText, inp.receivedAt);
  return { rules, category, summary, deadlineText, deadlineDate, model: usedModel };
}
