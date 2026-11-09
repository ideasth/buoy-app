// filepath: server/ontime/statusfeed.ts
// Stage 32 — public status feed for outside uptime checks.
//
// GET /api/status.rss returns a tiny RSS 2.0 feed with ONE item whose title
// is "OK" or "PROBLEM: <short labels>". Oliver's Microsoft 365 Power
// Automate flow reads it every 15 minutes with the standard RSS connector
// (no Premium licence needed). If the fetch fails (server or Caddy down) or
// the title isn't "OK", the flow alerts him. Because Microsoft checks from
// outside, a full VPS outage is caught too.
//
// No personal data: only fixed labels, never subjects, senders or errors.

export interface StatusInput {
  now: number;
  dbOk: boolean;
  engineRunning: boolean;
  lastPlanAt: number | null;
  emailEnabled: boolean;
  emailPollMinutes: number;
  lastMailPollAt: number | null;
  lastMailError: string | null;
  bootAt: number;
}

export const PLAN_STALE_MS = 15 * 60_000;
export const BOOT_GRACE_MS = 2 * 60_000;

export function statusProblems(s: StatusInput): string[] {
  const out: string[] = [];
  if (!s.dbOk) out.push("database");
  const booting = s.now - s.bootAt < BOOT_GRACE_MS;
  if (!booting) {
    if (!s.engineRunning) out.push("scheduler stopped");
    else if (!s.lastPlanAt || s.now - s.lastPlanAt > PLAN_STALE_MS) out.push("calendar planning stale");
    if (s.emailEnabled) {
      const limit = Math.max(3 * s.emailPollMinutes * 60_000, 30 * 60_000);
      if (!s.lastMailPollAt || s.now - s.lastMailPollAt > limit) out.push("mail check stale");
      else if (s.lastMailError) out.push("mail check failing");
    }
  }
  return out;
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderStatusRss(s: StatusInput, link: string): string {
  const problems = statusProblems(s);
  const title = problems.length ? `PROBLEM: ${problems.join(", ")}` : "OK";
  const when = new Date(s.now).toUTCString();
  const guid = `buoy-status-${Math.floor(s.now / 60_000)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Buoy status</title>
<link>${esc(link)}</link>
<description>Buoy health for outside uptime checks</description>
<lastBuildDate>${when}</lastBuildDate>
<item>
<title>${esc(title)}</title>
<link>${esc(link)}</link>
<description>${esc(problems.length ? `Buoy needs attention: ${problems.join(", ")}.` : "All checks passed.")}</description>
<pubDate>${when}</pubDate>
<guid isPermaLink="false">${guid}</guid>
</item>
</channel>
</rss>
`;
}
