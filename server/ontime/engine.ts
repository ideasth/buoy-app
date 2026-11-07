// filepath: /home/user/workspace/anchor/server/ontime/engine.ts
// Stage 25 (On Time) — background engine. Runs inside the Buoy process on
// the VPS (no Perplexity credits). Every 30 s it:
//   1. re-plans cues for the next 20 h (every 5 min) from the calendar
//   2. fires due cues to ntfy (phone + Amazfit via Zepp mirroring)
//   3. escalates un-acknowledged "Leave now" alerts
//   4. polls the AUPFHS inbox (read-only Graph) every N minutes
//   5. classifies queued emails one at a time with rules + local Ollama
// Master switch `enabled` gates every send. Email polling is gated
// separately by `emailEnabled` and the presence of the Graph secret file.

import type { OnTimeConfig } from "./config";
import type { AlertRow, OnTimeStore } from "./store";
import { planCues, runningLateSmsUrl, type PlanEvent } from "./plan";
import { ntfyConfigured, type NtfyAction, type NtfyMessage, type Sender } from "./notify";
import { classify, ollamaCaller, type LlmCall } from "./triage";
import { pollInbox, readGraphCreds, type GraphCreds } from "./graph";
import { addDaysKey, inQuietHours, melbDateKey, melbHHMM, melbToUtcMs } from "./time";

export interface EngineDeps {
  store: OnTimeStore;
  getPlanEvents: () => Promise<PlanEvent[]>;
  getTop3Titles: (dateKey: string) => string[];
  createDeadlineTask: (t: { title: string; dueAt: number; notes: string }) => number | null;
  send: Sender;
  now?: () => number;
  llmFactory?: (cfg: OnTimeConfig) => LlmCall | null;
  graphCreds?: () => GraphCreds | null;
  pollInboxFn?: typeof pollInbox;
}

export interface EngineStatus {
  running: boolean;
  lastPlanAt: number | null;
  lastPlanError: string | null;
  lastPlanCounts: { inserted: number; updated: number; removed: number } | null;
  lastSendAt: number | null;
  lastSendError: string | null;
  lastMailPollAt: number | null;
  lastMailError: string | null;
  lastMailFetched: number;
  lastClassifyMs: number | null;
  lastClassifyError: string | null;
}

const STALE_MS = 10 * 60_000;
const PLAN_EVERY_MS = 5 * 60_000;
const HORIZON_MS = 20 * 60 * 60_000;
const MAX_EMAIL_NUDGES_PER_DAY = 4;

export class OnTimeEngine {
  status: EngineStatus = {
    running: false, lastPlanAt: null, lastPlanError: null, lastPlanCounts: null,
    lastSendAt: null, lastSendError: null, lastMailPollAt: null, lastMailError: null,
    lastMailFetched: 0, lastClassifyMs: null, lastClassifyError: null,
  };
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private classifying = false;
  private lastPruneAt = 0;

  constructor(private d: EngineDeps) {}

  private now(): number { return this.d.now ? this.d.now() : Date.now(); }
  private cfg(): OnTimeConfig { return this.d.store.getConfig(); }

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.status.running = true;
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    // first tick shortly after boot so the ICS cache is warm
    setTimeout(() => { void this.tick(true); }, 15_000);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.running = false;
  }

  async tick(forcePlan = false): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const cfg = this.cfg();
      const now = this.now();
      if (forcePlan || !this.status.lastPlanAt || now - this.status.lastPlanAt >= PLAN_EVERY_MS) {
        await this.refreshPlan();
      }
      if (cfg.enabled && ntfyConfigured(cfg)) {
        await this.fireDue(cfg);
        await this.escalate(cfg);
      }
      if (cfg.emailEnabled) {
        const last = this.status.lastMailPollAt ?? 0;
        if (now - last >= cfg.emailPollMinutes * 60_000) await this.pollMail();
        void this.drainTriage();
      }
      if (now - this.lastPruneAt > 3_600_000) {
        this.lastPruneAt = now;
        this.d.store.pruneAlerts(now - 14 * 86_400_000);
        this.d.store.pruneTriage(now - 30 * 86_400_000);
      }
    } catch (e) {
      this.status.lastPlanError = (e as Error).message;
    } finally {
      this.ticking = false;
    }
  }

  async refreshPlan(): Promise<void> {
    const now = this.now();
    try {
      const cfg = this.cfg();
      const events = await this.d.getPlanEvents();
      const from = now - STALE_MS;
      const to = now + HORIZON_MS;
      const cues = planCues(events, cfg, from, to);
      this.status.lastPlanCounts = this.d.store.reconcile(cues, from, to);
      this.status.lastPlanAt = now;
      this.status.lastPlanError = null;
    } catch (e) {
      this.status.lastPlanAt = now;
      this.status.lastPlanError = (e as Error).message;
    }
  }

  ackUrl(cfg: OnTimeConfig, a: AlertRow, action: string): string {
    return `${cfg.publicBaseUrl}/api/ontime/ack/${a.ack_token}?a=${action}`;
  }

  buildMessage(cfg: OnTimeConfig, a: AlertRow, escalation = false): NtfyMessage {
    const actions: NtfyAction[] = [];
    const canSnooze = a.snooze_count < cfg.maxSnoozes;
    const http = (label: string, action: string): NtfyAction =>
      ({ action: "http", label, url: this.ackUrl(cfg, a, action), method: "POST", clear: true });
    if (a.kind === "leave_now") {
      actions.push(http("On my way", "omw"));
      if (canSnooze) actions.push(http(`Snooze ${cfg.snoozeMinutes}`, "snooze"));
      const lateBy = a.event_start_ms ? Math.max(5, Math.round((this.now() + 25 * 60_000 - a.event_start_ms) / 60_000 / 5) * 5) : 10;
      actions.push({ action: "view", label: "Running late", url: runningLateSmsUrl(cfg, Math.max(5, lateBy)) });
    } else if (a.kind === "digest") {
      actions.push({ action: "view", label: "Open Buoy", url: `${cfg.publicBaseUrl}/#/on-time` });
    } else if (a.kind === "email") {
      actions.push({ action: "view", label: "Open Email Status", url: `${cfg.publicBaseUrl}/#/email-status` });
      actions.push(http("Seen", "ok"));
    } else {
      actions.push(http(a.kind === "routine" ? "Starting" : "OK", "ok"));
      if (canSnooze) actions.push(http(`Snooze ${cfg.snoozeMinutes}`, "snooze"));
    }
    const tags: Record<string, string[]> = {
      get_ready: ["hourglass_flowing_sand"], wrap_up: ["warning"], leave_now: ["rotating_light"],
      starts_soon: ["alarm_clock"], routine: ["seedling"], digest: ["sunrise"], email: ["envelope"],
    };
    return {
      title: escalation ? `Still here? ${a.title}` : a.title,
      message: escalation ? `You were due to leave at ${a.leave_at_ms ? melbHHMM(a.leave_at_ms) : "now"}. Go now, or tap Running late.` : a.body,
      priority: escalation ? 5 : (Math.min(5, Math.max(1, a.priority)) as 1 | 2 | 3 | 4 | 5),
      tags: tags[a.kind] ?? [],
      click: `${cfg.publicBaseUrl}/#/on-time`,
      actions,
    };
  }

  composeDigest(cfg: OnTimeConfig, dateKey: string): string {
    const store = this.d.store;
    const dayStart = melbToUtcMs(dateKey, "00:00");
    const dayEnd = melbToUtcMs(addDaysKey(dateKey, 1), "00:00");
    const alerts = store.listAlerts(dayStart, dayEnd);
    const leaves = alerts.filter((r) => r.kind === "leave_now" && r.status !== "skipped");
    const lines: string[] = [];
    if (leaves.length) {
      const first = leaves[0];
      lines.push(`First leave-by: ${first.leave_at_ms ? melbHHMM(first.leave_at_ms) : melbHHMM(first.fire_at)} (${first.title.replace(/^Leave now - /, "")}).`);
      if (leaves.length > 1) lines.push(`${leaves.length} trips today.`);
    } else {
      lines.push("No travel today.");
    }
    const top3 = this.d.getTop3Titles(dateKey);
    lines.push(top3.length ? `Top 3: ${top3.join("; ")}` : "Top 3 not locked yet - do it at 07:30.");
    const counts = store.triageCounts();
    const act = counts.act_today ?? 0;
    if (cfg.emailEnabled) lines.push(act ? `${act} email${act === 1 ? "" : "s"} to act on today.` : "No act-today emails.");
    return lines.join("\n");
  }

  async fireDue(cfg: OnTimeConfig): Promise<void> {
    const now = this.now();
    for (const a of this.d.store.dueAlerts(now)) {
      if (now - a.fire_at > STALE_MS) { this.d.store.markStatus(a.id, "skipped"); continue; }
      const eventCue = ["get_ready", "wrap_up", "leave_now", "starts_soon"].includes(a.kind);
      if (!eventCue && inQuietHours(now, cfg.quietStart, cfg.quietEnd)) {
        this.d.store.markStatus(a.id, "skipped");
        continue;
      }
      let body: string | undefined;
      let row = a;
      if (a.kind === "digest") {
        body = this.composeDigest(cfg, melbDateKey(a.fire_at));
        row = { ...a, body };
      }
      const r = await this.d.send(cfg, this.buildMessage(cfg, row));
      if (r.ok) {
        this.d.store.markSent(a.id, body);
        this.status.lastSendAt = now;
        this.status.lastSendError = null;
      } else {
        this.status.lastSendError = r.error ?? "send failed";
      }
    }
  }

  async escalate(cfg: OnTimeConfig): Promise<void> {
    const now = this.now();
    for (const a of this.d.store.needsEscalation(now, cfg.escalateAfterMinutes)) {
      if (a.event_start_ms && now > a.event_start_ms) { this.d.store.markEscalated(a.id); continue; }
      const r = await this.d.send(cfg, this.buildMessage(cfg, a, true));
      if (r.ok) this.d.store.markEscalated(a.id);
      else this.status.lastSendError = r.error ?? "send failed";
    }
  }

  /** Handle an action-button tap. Returns a short plain-text reply. */
  handleAck(token: string, action: string): { status: number; text: string } {
    const a = this.d.store.getAlertByToken(token);
    if (!a) return { status: 404, text: "Not found" };
    if (this.now() - a.fire_at > 24 * 3_600_000) return { status: 410, text: "Expired" };
    const cfg = this.cfg();
    if (action === "snooze") {
      if (a.snooze_count >= cfg.maxSnoozes) {
        this.d.store.ack(a.id, "snooze_denied");
        return { status: 200, text: "No more snoozes - time to go." };
      }
      this.d.store.snooze(a.id, cfg.snoozeMinutes);
      return { status: 200, text: `Snoozed ${cfg.snoozeMinutes} min` };
    }
    const act = ["omw", "ok"].includes(action) ? action : "ok";
    this.d.store.ack(a.id, act);
    return { status: 200, text: act === "omw" ? "Great - travel safe." : "Noted." };
  }

  async pollMail(): Promise<void> {
    const now = this.now();
    this.status.lastMailPollAt = now;
    const creds = (this.d.graphCreds ?? readGraphCreds)();
    if (!creds) { this.status.lastMailError = "Graph credentials not installed"; return; }
    try {
      const prev = this.d.store.kvGet("graph_delta_link");
      const fn = this.d.pollInboxFn ?? pollInbox;
      const { messages, deltaLink } = await fn(creds, prev);
      for (const m of messages) {
        this.d.store.insertTriage({
          source: "graph", externalId: m.id, receivedAt: m.receivedAt, sender: m.sender,
          senderName: m.senderName, subject: m.subject, snippet: m.body.slice(0, 400),
          webLink: m.webLink, bodyForLlm: m.body,
        });
      }
      if (deltaLink) this.d.store.kvSet("graph_delta_link", deltaLink);
      else if (prev) this.d.store.kvSet("graph_delta_link", "");
      this.status.lastMailFetched = messages.length;
      this.status.lastMailError = null;
    } catch (e) {
      this.status.lastMailError = (e as Error).message;
    }
  }

  async drainTriage(maxItems = 50): Promise<number> {
    if (this.classifying) return 0;
    this.classifying = true;
    let n = 0;
    try {
      const cfg = this.cfg();
      const llm = this.d.llmFactory ? this.d.llmFactory(cfg) : ollamaCaller(cfg.ollamaUrl, cfg.ollamaModel);
      while (n < maxItems) {
        const row = this.d.store.nextQueued();
        if (!row) break;
        const t0 = this.now();
        const c = await classify({
          sender: row.sender, senderName: row.sender_name, subject: row.subject,
          body: row.body_for_llm ?? row.snippet, receivedAt: row.received_at,
        }, llm, llm ? cfg.ollamaModel : null);
        this.d.store.saveClassification(row.id, {
          category: c.category, summary: c.summary, deadlineText: c.deadlineText,
          deadlineDate: c.deadlineDate, isPriority: c.rules.isPriority, ruleHits: c.rules.hits, model: c.model,
        });
        this.status.lastClassifyMs = this.now() - t0;
        this.status.lastClassifyError = c.model || !llm ? null : "model unavailable - rules only";
        this.afterClassified(cfg, row.id);
        n++;
      }
    } catch (e) {
      this.status.lastClassifyError = (e as Error).message;
    } finally {
      this.classifying = false;
    }
    return n;
  }

  /** Deadline -> Buoy task; act-today + near deadline -> phone nudge. */
  afterClassified(cfg: OnTimeConfig, id: number): void {
    const row = this.d.store.getTriage(id);
    if (!row || !row.category) return;
    const now = this.now();
    const today = melbDateKey(now);
    if (row.deadline_date && row.deadline_date >= today && (row.category === "act_today" || row.category === "reply_week") && !row.task_id) {
      const dueAt = melbToUtcMs(row.deadline_date, "17:00");
      const taskId = this.d.createDeadlineTask({
        title: `Email: ${row.subject}`.slice(0, 120),
        dueAt,
        notes: `From ${row.sender_name || row.sender}. ${row.summary ?? ""}${row.web_link ? `\n${row.web_link}` : ""}`.slice(0, 1000),
      });
      if (taskId) this.d.store.updateTriage(id, { taskId });
    }
    const nearDeadline = !row.deadline_date || row.deadline_date <= addDaysKey(today, 1);
    const fresh = now - row.received_at < 12 * 3_600_000;
    if (cfg.enabled && cfg.emailNudges && row.category === "act_today" && nearDeadline && fresh && !row.nudged_at) {
      if (this.d.store.countKindSince("email", now - 86_400_000) >= MAX_EMAIL_NUDGES_PER_DAY) return;
      const who = row.is_priority ? (row.sender_name || row.sender).slice(0, 30) : "an important sender";
      this.d.store.insertOneOff({
        key: `mail:${row.id}`, kind: "email", fireAt: now,
        title: "Email to action today",
        body: `From ${who}. Details in Buoy Email Status.`,
        priority: 4,
      });
      this.d.store.updateTriage(id, { nudgedAt: now });
    }
  }
}
