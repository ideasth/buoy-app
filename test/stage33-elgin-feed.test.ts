// filepath: test/stage33-elgin-feed.test.ts
// Stage 33 — private Elgin House feed: validation, storage, info-only merge, token, log redaction.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  validateElginIcs, storeElginIcs, elginEvents, elginStatus, rotateElginToken, checkElginToken, ELGIN_KEY,
} from "../server/elgin-feed";
import { isQuietLogPath } from "../server/log-paths";
import { busyOnly } from "../server/shared-calendar";

const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "UID:xestro-a@elginhouse.oliverdaly", "DTSTART;TZID=Australia/Melbourne:20261110T111000",
  "DTEND;TZID=Australia/Melbourne:20261110T113000", "SUMMARY:Mrs Test Patient", "LOCATION:Braybrook", "END:VEVENT",
  "END:VCALENDAR", "",
].join("\r\n");

function kv() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), m };
}
const root = path.join(__dirname, "..");

describe("validateElginIcs", () => {
  it("accepts a calendar and counts events", () => {
    expect(validateElginIcs({ ics: ICS })).toMatchObject({ ok: true, count: 1 });
  });
  it("rejects missing, non-ICS and oversized bodies", () => {
    expect(validateElginIcs({}).ok).toBe(false);
    expect(validateElginIcs({ ics: "<html>" }).ok).toBe(false);
    expect(validateElginIcs({ ics: "BEGIN:VCALENDAR\r\n" + "x".repeat(2 * 1024 * 1024 + 1) + "\r\nEND:VCALENDAR" }).ok).toBe(false);
  });
});

describe("store + merge", () => {
  it("parses stored ICS into info-only [Elgin House] events that never count as busy", () => {
    const s = kv();
    expect(elginEvents(s)).toEqual([]);
    storeElginIcs(s, ICS, 123);
    const ev = elginEvents(s);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toBe("[Elgin House] Mrs Test Patient");
    expect(ev[0].infoOnly).toBe(true);
    expect(busyOnly(ev)).toHaveLength(0);
    expect(elginStatus(s)).toEqual({ present: true, updatedAt: 123, eventCount: 1, tokenSet: false });
  });
  it("re-parses after a new upload", () => {
    const s = kv();
    storeElginIcs(s, ICS);
    storeElginIcs(s, ICS.replace("Mrs Test Patient", "Ms Other"));
    expect(elginEvents(s)[0].summary).toContain("Ms Other");
  });
});

describe("token", () => {
  it("is required, constant-length compared, and rotates", () => {
    const s = kv();
    expect(checkElginToken(s, "x")).toBe(false);
    const t1 = rotateElginToken(s);
    expect(t1.length).toBeGreaterThanOrEqual(32);
    expect(checkElginToken(s, t1)).toBe(true);
    expect(checkElginToken(s, t1 + "x")).toBe(false);
    expect(checkElginToken(s, undefined)).toBe(false);
    const t2 = rotateElginToken(s);
    expect(checkElginToken(s, t1)).toBe(false);
    expect(checkElginToken(s, t2)).toBe(true);
    expect(s.m.get(ELGIN_KEY.TOKEN)).toBe(t2);
  });
});

describe("wiring", () => {
  it("routes, auth allowlist, body limit and planner merge are in place", () => {
    const r = readFileSync(path.join(root, "server/routes.ts"), "utf8");
    expect(r).toMatch(/app\.post\("\/api\/calendar\/elgin-feed", \(req, res\) => \{\s*if \(!requireOrchestrator/);
    expect(r).toMatch(/app\.post\("\/api\/calendar\/elgin-feed\/token", \(req, res\) => \{\s*if \(!requireOrchestrator/);
    expect(r).toMatch(/checkElginToken\(elginKv, req\.query\.t\)\) return res\.status\(404\)/);
    expect(r).toContain("elginEvents(elginKv)");
    const a = readFileSync(path.join(root, "server/auth.ts"), "utf8");
    expect(a).toContain('"/api/calendar/elgin.ics"');
    expect(a).not.toMatch(/"\/api\/calendar\/elgin-feed/);
    const i = readFileSync(path.join(root, "server/index.ts"), "utf8");
    expect(i).toContain('req.path === "/api/calendar/elgin-feed"');
  });
  it("calendar and planner bodies are never written to the request log", () => {
    for (const p of ["/api/calendar-events", "/api/calendar/elgin-feed/token", "/api/today-events", "/api/planner/events", "/api/events", "/api/ontime/status", "/api/capture"]) {
      expect(isQuietLogPath(p)).toBe(true);
    }
    expect(isQuietLogPath("/api/health")).toBe(false);
  });
});
