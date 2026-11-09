// filepath: test/stage27-email-backfill.test.ts
// Housekeeping 9 Nov 2026: configurable mail backfill window (default 30 days)
// and a one-off re-backfill that resets the Graph delta link.
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { OnTimeStore } from "../server/ontime/store";
import { OnTimeEngine } from "../server/ontime/engine";
import { DEFAULT_CONFIG, mergeConfig } from "../server/ontime/config";

function setup() {
  const db = new Database(":memory:");
  const now = Date.UTC(2026, 10, 9, 5, 0, 0);
  const store = new OnTimeStore(db, () => now);
  const calls: { delta: string | null; days: number | undefined }[] = [];
  const engine = new OnTimeEngine({
    store,
    getPlanEvents: async () => [],
    getTop3Titles: () => [],
    createDeadlineTask: () => null,
    send: async () => ({ ok: true }),
    now: () => now,
    llmFactory: () => null,
    graphCreds: () => ({ tenantId: "t", clientId: "c", clientSecret: "s", mailbox: "m@x" }) as any,
    pollInboxFn: (async (_c: any, delta: string | null, days?: number) => {
      calls.push({ delta, days });
      return {
        messages: [{ id: "m1", subject: "Hi", sender: "a@b", senderName: "A", receivedAt: now - 20 * 86_400_000, body: "x", webLink: null }],
        deltaLink: "DELTA-" + calls.length,
      };
    }) as any,
    noAutoContinue: true,
  } as any);
  return { store, engine, calls };
}

describe("email backfill window", () => {
  it("defaults to 30 days and clamps to 1-60", () => {
    expect(DEFAULT_CONFIG.emailBackfillDays).toBe(30);
    expect(mergeConfig(DEFAULT_CONFIG, { emailBackfillDays: 500 }).emailBackfillDays).toBe(60);
    expect(mergeConfig(DEFAULT_CONFIG, { emailBackfillDays: 0 }).emailBackfillDays).toBe(1);
  });

  it("first poll passes the configured window; later polls use the delta link", async () => {
    const s = setup();
    await s.engine.pollMail();
    expect(s.calls[0]).toEqual({ delta: null, days: 30 });
    await s.engine.pollMail();
    expect(s.calls[1].delta).toBe("DELTA-1");
  });

  it("rebackfill resets the delta link, honours an override and dedupes", async () => {
    const s = setup();
    await s.engine.pollMail();
    await s.engine.rebackfill(14);
    expect(s.calls[1]).toEqual({ delta: null, days: 14 });
    expect(s.store.kvGet("graph_delta_link")).toBe("DELTA-2");
    expect(s.store.queuedCount()).toBe(1); // same message id not inserted twice
  });
});
