// filepath: server/log-paths.ts
// Stage 33 — request-log redaction list (kept separate so tests need not boot the server).

// Paths whose JSON response bodies must never be written to logs.
export function isQuietLogPath(path: string): boolean {
  return (
    path.startsWith("/api/ontime/") ||
    path.startsWith("/api/capture") ||
    path.startsWith("/api/calendar") ||
    path.startsWith("/api/today-events") ||
    path.startsWith("/api/planner") ||
    path.startsWith("/api/events")
  );
}

