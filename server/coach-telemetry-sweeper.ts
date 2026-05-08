// Daily retention sweep for coach_context_usage. Runs in-process at the next
// 04:30 server-local boundary, then every 24 hours. No new cron — keeps
// telemetry from accumulating unboundedly in data.db.
//
// Gated by Settings.coach_telemetry_enabled. When disabled, the sweep is a
// no-op (we don't even read the table) — same kill-switch surface as the
// recording path in coach-routes.ts.
//
// Retention default: 90 days. Tunable via env var ANCHOR_COACH_TELEMETRY_RETENTION_DAYS.

import { storage } from "./storage";

const DEFAULT_RETENTION_DAYS = 90;

function getRetentionDays(): number {
  const raw = process.env.ANCHOR_COACH_TELEMETRY_RETENTION_DAYS;
  const n = raw == null ? NaN : Number(raw);
  if (!isFinite(n) || n < 1) return DEFAULT_RETENTION_DAYS;
  return Math.min(Math.floor(n), 3650); // cap at 10 years
}

function msUntilNext(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function runSweepOnce(): void {
  try {
    const settings = storage.getSettings();
    if (settings.coach_telemetry_enabled === false) {
      console.log("[coach-telemetry-sweep] disabled by settings; skipping");
      return;
    }
    const days = getRetentionDays();
    const removed = storage.pruneCoachContextUsage(days);
    if (removed > 0) {
      console.log(
        `[coach-telemetry-sweep] pruned ${removed} rows older than ${days}d`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[coach-telemetry-sweep] failed: ${msg.slice(0, 200)}`);
  }
}

let scheduled = false;

/**
 * Schedule the daily sweep to run at the next 04:30 server-local boundary,
 * then every 24 hours. Idempotent — safe to call multiple times.
 */
export function scheduleCoachTelemetrySweeper(): void {
  if (scheduled) return;
  scheduled = true;
  const initialDelay = msUntilNext(4, 30);
  setTimeout(() => {
    runSweepOnce();
    setInterval(runSweepOnce, 24 * 60 * 60 * 1000).unref?.();
  }, initialDelay).unref?.();
  console.log(
    `[coach-telemetry-sweep] scheduled; first run in ~${Math.round(initialDelay / 60000)}m`,
  );
}

/**
 * Run the sweep synchronously now. Exposed for the manual admin endpoint.
 */
export function runCoachTelemetrySweepNow(): { removed: number; retentionDays: number; enabled: boolean } {
  const settings = storage.getSettings();
  const enabled = settings.coach_telemetry_enabled !== false;
  const retentionDays = getRetentionDays();
  if (!enabled) return { removed: 0, retentionDays, enabled };
  const removed = storage.pruneCoachContextUsage(retentionDays);
  return { removed, retentionDays, enabled };
}
