// Boot-time worker — backfill draft summaries for ENDED coach sessions where
// summary IS NULL. Runs once after registerCoachRoutes mounts. Sequential with
// a small delay between calls to keep API rate gentle. The FTS5 AU trigger on
// coach_sessions.summary will index each row automatically.
//
// Standing rule context: this writes summary, summaryEditedByUser=0, and
// updates token totals — same shape as the /sessions/:id/end handler. It does
// NOT modify endedAt or any other field. If LLM is unavailable, the worker
// logs and exits cleanly.
//
// Boot-time ceiling: a single boot processes at most MAX_BACKFILL_PER_BOOT
// sessions. Larger backlogs are drained by either restarting the server or by
// hitting the manual admin endpoint POST /api/admin/coach/backfill-summaries
// (sync-secret only).

import { storage } from "./storage";
import { getPerplexityAdapter } from "./llm/perplexity";
import { buildSummaryRequestMessages, SUMMARY_MODEL } from "./coach-context";

function stripThinkTags(text: string): string {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const MAX_BACKFILL_PER_BOOT = 50;

export async function backfillCoachSessionSummaries(
  limit: number = MAX_BACKFILL_PER_BOOT,
): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  remainingApprox: number;
}> {
  const llm = getPerplexityAdapter();
  if (!llm.isAvailable()) {
    return { attempted: 0, succeeded: 0, failed: 0, remainingApprox: 0 };
  }

  const cap = Math.max(1, Math.min(limit | 0, 500));
  // Fetch one extra to detect whether there's more work after this batch.
  const probe = storage.listCoachSessionsNeedingSummary(cap + 1);
  const targets = probe.slice(0, cap);
  const remainingApprox = Math.max(0, probe.length - targets.length);
  if (targets.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, remainingApprox: 0 };
  }

  console.log(
    `[coach-backfill] starting backfill of ${targets.length} ended sessions without summaries (cap=${cap}, more after batch=${remainingApprox > 0})`,
  );

  let succeeded = 0;
  let failed = 0;

  for (const session of targets) {
    try {
      const messages = storage.listCoachMessages(session.id);
      const transcript: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const m of messages) {
        if (m.role === "user" || m.role === "assistant") {
          transcript.push({ role: m.role, content: m.content });
        }
      }
      if (transcript.length === 0) {
        // Nothing to summarise; skip silently.
        continue;
      }

      const summaryMessages = buildSummaryRequestMessages(transcript);
      const result = await llm.complete({
        model: SUMMARY_MODEL,
        messages: summaryMessages,
        temperature: 0.2,
        maxTokens: 600,
        disableSearch: true,
      });
      const cleanSummary = stripThinkTags(result.fullText);
      storage.updateCoachSession(session.id, {
        summary: cleanSummary,
        summaryEditedByUser: 0,
        totalInputTokens:
          (session.totalInputTokens ?? 0) + (result.usage.inputTokens ?? 0),
        totalOutputTokens:
          (session.totalOutputTokens ?? 0) + (result.usage.outputTokens ?? 0),
      });
      succeeded += 1;

      // Keep API pressure low.
      await delay(1500);
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[coach-backfill] session ${session.id} failed: ${msg.slice(0, 200)}`,
      );
    }
  }

  console.log(
    `[coach-backfill] done — attempted=${targets.length} succeeded=${succeeded} failed=${failed} remainingApprox=${remainingApprox}`,
  );
  return { attempted: targets.length, succeeded, failed, remainingApprox };
}

/**
 * Fire-and-forget wrapper safe to call from registerCoachRoutes. Delays a few
 * seconds so the server can finish booting before we start LLM calls.
 */
export function scheduleCoachSummaryBackfill(): void {
  setTimeout(() => {
    backfillCoachSessionSummaries().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[coach-backfill] worker crashed: ${msg.slice(0, 200)}`);
    });
  }, 5000);
}
