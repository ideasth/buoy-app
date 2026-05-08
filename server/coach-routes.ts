// Feature 5 — Coach API routes.
//
// Endpoints (all require sync-secret / auth):
//   POST   /api/coach/sessions              start a new session (returns id + bundle)
//   GET    /api/coach/sessions              list recent sessions (id + summary stub)
//   GET    /api/coach/sessions/:id          full session detail (messages + summary + bundle)
//   PATCH  /api/coach/sessions/:id          partial update (mode, linked_issue_id)
//   DELETE /api/coach/sessions/:id          hard delete (cascades messages)
//   POST   /api/coach/sessions/:id/turn     send user message; SSE-stream assistant reply
//   POST   /api/coach/sessions/:id/end      end session, generate draft summary (non-streaming)
//   PATCH  /api/coach/sessions/:id/summary  user edits the summary
//   GET    /api/coach/health                returns { available: boolean, provider, models }

import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { getPerplexityAdapter } from "./llm/perplexity";
import {
  buildCoachContextBundle,
  buildSystemMessages,
  buildSummaryRequestMessages,
  detectCrisisLanguage,
  CRISIS_RESPONSE,
  modelForMode,
  SUMMARY_MODEL,
  type CoachContextBundle,
} from "./coach-context";
import type { CalEvent } from "./ics";
import type { AvailableHoursThisWeek } from "./available-hours";
import type { CoachMessage, CoachSession } from "@shared/schema";

type Mode = "plan" | "reflect";

function asMode(v: unknown): Mode {
  return v === "reflect" ? "reflect" : "plan";
}

function safeParseSnapshot(s: string | null | undefined): CoachContextBundle | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as CoachContextBundle;
  } catch {
    return null;
  }
}

// sonar-reasoning-pro emits a <think>...</think> reasoning block before the
// actual answer. Per Perplexity docs, the response_format parameter does not
// remove these tokens; the recommended approach is to strip them ourselves.
function stripThinkTags(text: string): string {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
}

interface RegisterArgs {
  app: Express;
  requireUserOrOrchestrator: (req: Request, res: Response) => boolean;
  getMergedPlannerEvents: () => Promise<CalEvent[]>;
  computeAvailableHoursThisWeek: (events: CalEvent[], now?: Date) => AvailableHoursThisWeek;
}

export function registerCoachRoutes({
  app,
  requireUserOrOrchestrator,
  getMergedPlannerEvents,
  computeAvailableHoursThisWeek,
}: RegisterArgs) {
  const llm = getPerplexityAdapter();

  // --- Health -----------------------------------------------------------
  app.get("/api/coach/health", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    res.json({
      available: llm.isAvailable(),
      provider: llm.providerId,
      models: {
        plan: modelForMode("plan", false),
        planDeepThink: modelForMode("plan", true),
        reflect: modelForMode("reflect"),
      },
    });
  });

  // --- Sessions: list ---------------------------------------------------
  app.get("/api/coach/sessions", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || "25", 10)));
    const list = storage.listCoachSessions(limit);
    res.json({
      sessions: list.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        mode: s.mode,
        linkedIssueId: s.linkedIssueId,
        linkedYmd: s.linkedYmd,
        modelName: s.modelName,
        totalInputTokens: s.totalInputTokens,
        totalOutputTokens: s.totalOutputTokens,
        summaryPreview:
          typeof s.summary === "string" && s.summary.length > 0
            ? s.summary.slice(0, 220)
            : null,
        messageCount: storage.countCoachMessages(s.id),
        deepThink: s.deepThink ?? 0,
        archivedAt: s.archivedAt ?? null,
      })),
    });
  });

  // --- Sessions: search (FTS5 over summaries) --------------------------
  // Registered before /:id so 'search' is not interpreted as a session id.
  app.get("/api/coach/sessions/search", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const q = String(req.query.q ?? "").trim();
    const limit = Math.max(1, Math.min(50, parseInt((req.query.limit as string) || "20", 10)));
    if (!q) return res.json({ q, hits: [] });
    const hits = storage.searchCoachSessions(q, limit);
    res.json({ q, hits });
  });

  // --- Sessions: detail -------------------------------------------------
  app.get("/api/coach/sessions/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = Number(req.params.id);
    const s = storage.getCoachSession(id);
    if (!s) return res.status(404).json({ error: "Session not found" });
    const messages = storage.listCoachMessages(id);
    res.json({
      session: {
        ...s,
        contextSnapshot: safeParseSnapshot(s.contextSnapshot),
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        modeAtTurn: m.modeAtTurn,
        tokenCount: m.tokenCount,
      })),
    });
  });

  // --- Sessions: create -------------------------------------------------
  app.post("/api/coach/sessions", async (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    if (!llm.isAvailable()) {
      return res.status(503).json({
        error: "Coach unavailable: Perplexity API key not configured",
        provider: llm.providerId,
      });
    }
    const mode = asMode(req.body?.mode);
    const linkedIssueId =
      typeof req.body?.linkedIssueId === "number" ? req.body.linkedIssueId : null;
    const deepThink = req.body?.deepThink === true || req.body?.deepThink === 1 ? 1 : 0;

    const events = await getMergedPlannerEvents();
    let availableHours: ReturnType<typeof computeAvailableHoursThisWeek> | null = null;
    try {
      availableHours = computeAvailableHoursThisWeek(events);
    } catch {
      availableHours = null;
    }
    const bundle = buildCoachContextBundle({ storage, events, availableHours });

    const session = storage.createCoachSession({
      mode,
      contextSnapshot: JSON.stringify(bundle),
      summary: null,
      summaryEditedByUser: 0,
      linkedIssueId: linkedIssueId ?? null,
      linkedYmd: bundle.todayYmd,
      modelProvider: llm.providerId,
      modelName: modelForMode(mode, deepThink === 1),
      totalInputTokens: 0,
      totalOutputTokens: 0,
      deepThink,
      archivedAt: null,
    });

    res.json({ session, bundle });
  });

  // --- Sessions: patch (mode, linkedIssueId) ---------------------------
  app.patch("/api/coach/sessions/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = Number(req.params.id);
    const existing = storage.getCoachSession(id);
    if (!existing) return res.status(404).json({ error: "Session not found" });
    const patch: Partial<CoachSession> = {};
    const nextMode: "plan" | "reflect" =
      req.body?.mode === "plan" || req.body?.mode === "reflect"
        ? req.body.mode
        : (existing.mode as "plan" | "reflect");
    const nextDeepThink: 0 | 1 =
      typeof req.body?.deepThink === "boolean"
        ? (req.body.deepThink ? 1 : 0)
        : ((existing.deepThink ?? 0) as 0 | 1);
    if (req.body?.mode === "plan" || req.body?.mode === "reflect") {
      patch.mode = req.body.mode;
    }
    if (typeof req.body?.deepThink === "boolean") {
      patch.deepThink = nextDeepThink;
    }
    // Whenever mode or deepThink changes, recompute modelName so /turn picks
    // up the new value next call.
    if (
      req.body?.mode === "plan" ||
      req.body?.mode === "reflect" ||
      typeof req.body?.deepThink === "boolean"
    ) {
      patch.modelName = modelForMode(nextMode, nextDeepThink === 1);
    }
    if ("linkedIssueId" in (req.body ?? {})) {
      const v = req.body.linkedIssueId;
      patch.linkedIssueId = typeof v === "number" ? v : null;
    }
    const updated = storage.updateCoachSession(id, patch);
    res.json({ session: updated });
  });

  // --- Sessions: archive (soft, retains row + summary, drops transcript) ---
  app.post("/api/coach/sessions/:id/archive", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = Number(req.params.id);
    const existing = storage.getCoachSession(id);
    if (!existing) return res.status(404).json({ error: "Session not found" });
    if (existing.archivedAt) {
      return res.json({ ok: true, alreadyArchived: true, session: existing });
    }
    const updated = storage.archiveCoachSession(id);
    res.json({ ok: true, session: updated });
  });

  // --- Sessions: delete -------------------------------------------------
  app.delete("/api/coach/sessions/:id", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = Number(req.params.id);
    const existing = storage.getCoachSession(id);
    if (!existing) return res.status(404).json({ error: "Session not found" });
    storage.deleteCoachSession(id);
    res.json({ ok: true, deleted: id });
  });

  // --- Sessions: streaming turn ----------------------------------------
  app.post("/api/coach/sessions/:id/turn", async (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    if (!llm.isAvailable()) {
      return res.status(503).json({ error: "Perplexity API key not configured" });
    }
    const id = Number(req.params.id);
    const session = storage.getCoachSession(id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.archivedAt) {
      return res
        .status(409)
        .json({ error: "Session is archived (transcript purged); start a new session to continue." });
    }
    const userText: string = String(req.body?.content ?? "").trim();
    if (!userText) return res.status(400).json({ error: "content is required" });
    if (userText.length > 8000)
      return res.status(400).json({ error: "content too long (8000 char max)" });

    // Crisis short-circuit. Do not call the model. Persist the user message
    // and a deterministic crisis response.
    if (detectCrisisLanguage(userText)) {
      storage.appendCoachMessage({
        sessionId: id,
        role: "user",
        content: userText,
        modeAtTurn: session.mode,
        tokenCount: null,
      });
      storage.appendCoachMessage({
        sessionId: id,
        role: "assistant",
        content: CRISIS_RESPONSE,
        modeAtTurn: session.mode,
        tokenCount: null,
      });
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      res.write(`: ping\n\n`);
      res.write(`event: crisis\ndata: ${JSON.stringify({ kind: "crisis" })}\n\n`);
      res.write(`event: delta\ndata: ${JSON.stringify({ text: CRISIS_RESPONSE })}\n\n`);
      res.write(`event: done\ndata: ${JSON.stringify({ ok: true, crisis: true })}\n\n`);
      res.end();
      return;
    }

    // Persist the user turn first.
    storage.appendCoachMessage({
      sessionId: id,
      role: "user",
      content: userText,
      modeAtTurn: session.mode,
      tokenCount: null,
    });

    const mode = session.mode === "reflect" ? "reflect" : "plan";
    const deepThink: boolean = (session.deepThink ?? 0) === 1;
    const bundle =
      safeParseSnapshot(session.contextSnapshot) ??
      buildCoachContextBundle({
        storage,
        events: await getMergedPlannerEvents(),
        availableHours: null,
      });

    const systemMessages = buildSystemMessages(mode, bundle);
    const transcript = storage.listCoachMessages(id).map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));
    // Drop any persisted system rows; we always rebuild system from current bundle/mode.
    const userAssistantTranscript = transcript.filter((m) => m.role !== "system");

    const messages = [...systemMessages, ...userAssistantTranscript];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    // Send an immediate comment-line so the client/proxy commits the response
    // and starts forwarding bytes (some intermediaries buffer until the first
    // non-comment chunk).
    res.write(`: ping\n\n`);

    // Periodic heartbeat keeps the connection from being closed by an
    // intermediary while waiting for the first model token.
    const heartbeat = setInterval(() => {
      try {
        res.write(`: hb\n\n`);
      } catch {
        // socket closed
      }
    }, 15000);

    let aborted = false;
    req.on("close", () => {
      console.log(`[coach] req close fired (was=${aborted})`);
      aborted = true;
    });

    const tStart = Date.now();
    console.log(`[coach] turn started session=${id} mode=${mode} deepThink=${deepThink} model=${modelForMode(mode, deepThink)}`);

    // Reliability over fancy: published-sandbox SSE relay can swallow
    // upstream streaming chunks. Use non-streaming complete() and emit the
    // full text as a single SSE delta. The wire format stays SSE so the
    // client can be upgraded to true streaming later without changes.
    try {
      const r = await llm.complete({
        model: modelForMode(mode, deepThink),
        messages,
        temperature: mode === "reflect" ? 0.55 : 0.4,
        maxTokens: 1200,
        // Coach is grounded in the supplied context bundle; web search results
        // only confuse the conversation. Disable for both modes.
        disableSearch: true,
      });
      // Strip sonar-reasoning-pro's <think>...</think> reasoning preamble.
      const cleanText = stripThinkTags(r.fullText);
      console.log(`[coach] complete() returned in ${Date.now() - tStart}ms (${r.fullText.length} chars raw, ${cleanText.length} chars clean), aborted=${aborted}, writable=${!res.writableEnded}`);
      // Always persist the assistant message even if the client aborted, so
      // the next page load shows the full conversation.
      storage.appendCoachMessage({
        sessionId: id,
        role: "assistant",
        content: cleanText,
        modeAtTurn: mode,
        tokenCount: r.usage.outputTokens,
      });
      storage.updateCoachSession(id, {
        totalInputTokens: (session.totalInputTokens ?? 0) + r.usage.inputTokens,
        totalOutputTokens: (session.totalOutputTokens ?? 0) + r.usage.outputTokens,
      });
      if (!res.writableEnded) {
        res.write(`event: delta\ndata: ${JSON.stringify({ text: cleanText })}\n\n`);
        res.write(
          `event: done\ndata: ${JSON.stringify({
            ok: true,
            usage: r.usage,
            citations: r.citations ?? [],
            modelUsed: r.modelUsed,
          })}\n\n`,
        );
      }
      clearInterval(heartbeat);
      res.end();
    } catch (err) {
      clearInterval(heartbeat);
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[coach] turn failed after ${Date.now() - tStart}ms: ${msg}`);
      try {
        if (!aborted) {
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: msg.slice(0, 400) })}\n\n`,
          );
        }
      } catch {
        // socket may already be closed
      }
      res.end();
    }
  });

  // --- Sessions: end + summary ------------------------------------------
  app.post("/api/coach/sessions/:id/end", async (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = Number(req.params.id);
    const session = storage.getCoachSession(id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!llm.isAvailable()) {
      return res.status(503).json({ error: "Perplexity API key not configured" });
    }

    const messages = storage.listCoachMessages(id);
    const transcript: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of messages) {
      if (m.role === "user" || m.role === "assistant") {
        transcript.push({ role: m.role, content: m.content });
      }
    }
    if (transcript.length === 0) {
      // Nothing said; just close without a summary.
      const updated = storage.updateCoachSession(id, { endedAt: Date.now() });
      return res.json({ session: updated, summary: null });
    }

    try {
      const summaryMessages = buildSummaryRequestMessages(transcript);
      const result = await llm.complete({
        model: SUMMARY_MODEL,
        messages: summaryMessages,
        temperature: 0.2,
        maxTokens: 600,
        disableSearch: true,
      });
      const cleanSummary = stripThinkTags(result.fullText);
      const updated = storage.updateCoachSession(id, {
        endedAt: Date.now(),
        summary: cleanSummary,
        summaryEditedByUser: 0,
        totalInputTokens:
          (session.totalInputTokens ?? 0) + (result.usage.inputTokens ?? 0),
        totalOutputTokens:
          (session.totalOutputTokens ?? 0) + (result.usage.outputTokens ?? 0),
      });
      res.json({ session: updated, summary: cleanSummary });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Still mark ended so the user can move on; summary stays null.
      const updated = storage.updateCoachSession(id, { endedAt: Date.now() });
      res.status(502).json({ session: updated, error: msg.slice(0, 400) });
    }
  });

  // --- Sessions: edit summary -------------------------------------------
  app.patch("/api/coach/sessions/:id/summary", (req, res) => {
    if (!requireUserOrOrchestrator(req, res)) return;
    const id = Number(req.params.id);
    const existing = storage.getCoachSession(id);
    if (!existing) return res.status(404).json({ error: "Session not found" });
    const summary: string | null =
      typeof req.body?.summary === "string"
        ? req.body.summary
        : req.body?.summary === null
          ? null
          : undefined === req.body?.summary
            ? existing.summary
            : null;
    if (typeof summary === "string" && summary.length > 8000) {
      return res.status(400).json({ error: "summary too long (8000 char max)" });
    }
    const updated = storage.updateCoachSession(id, {
      summary,
      summaryEditedByUser: 1,
    });
    res.json({ session: updated });
  });
}

// Re-export message type so client can reuse if needed.
export type { CoachMessage };
