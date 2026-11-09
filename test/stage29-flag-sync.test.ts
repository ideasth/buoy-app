import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { decideFlag, applyFlag } from "../server/ontime/flagsync";
import { OnTimeStore } from "../server/ontime/store";
import { mergeConfig, DEFAULT_CONFIG } from "../server/ontime/config";

const base: any = { source: "graph", status: "new", category: "act_today", flag_state: null };

describe("Stage 29 flag sync — decisions", () => {
  it("flags open act_today and reply_week emails", () => {
    expect(decideFlag(base)).toBe("flag");
    expect(decideFlag({ ...base, category: "reply_week" })).toBe("flag");
  });
  it("does nothing when already flagged by Buoy", () => {
    expect(decideFlag({ ...base, flag_state: "flagged" })).toBeNull();
  });
  it("clears only flags Buoy set", () => {
    expect(decideFlag({ ...base, status: "done", flag_state: "flagged" })).toBe("clear");
    expect(decideFlag({ ...base, status: "dismissed", flag_state: "flagged" })).toBe("clear");
    expect(decideFlag({ ...base, category: "fyi", flag_state: "flagged" })).toBe("clear");
    expect(decideFlag({ ...base, status: "done", flag_state: null })).toBeNull();
    expect(decideFlag({ ...base, status: "done", flag_state: "cleared" })).toBeNull();
  });
  it("never touches uploads or waiting/fyi emails", () => {
    expect(decideFlag({ ...base, source: "upload" })).toBeNull();
    expect(decideFlag({ ...base, category: "waiting" })).toBeNull();
    expect(decideFlag({ ...base, category: "fyi" })).toBeNull();
  });
  it("switch defaults off", () => {
    expect(DEFAULT_CONFIG.flagSyncEnabled).toBe(false);
    expect(mergeConfig(DEFAULT_CONFIG, { flagSyncEnabled: true }).flagSyncEnabled).toBe(true);
    expect(mergeConfig(DEFAULT_CONFIG, { flagSyncEnabled: "yes" }).flagSyncEnabled).toBe(false);
  });
});

describe("Stage 29 flag sync — apply + store", () => {
  it("adds flag columns idempotently", () => {
    const db = new Database(":memory:");
    new OnTimeStore(db as any);
    new OnTimeStore(db as any);
    const cols = (db.prepare("PRAGMA table_info(email_triage)").all() as any[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["flag_state", "flag_error", "flag_synced_at"]));
  });
  it("records success and failure without throwing", async () => {
    const record = vi.fn();
    const ok = await applyFlag({ setFlag: vi.fn(async () => {}), record }, { id: 1, external_id: "m1", source: "graph" }, "flag");
    expect(ok.ok).toBe(true);
    expect(record).toHaveBeenLastCalledWith(1, "flagged", null);
    const bad = await applyFlag({ setFlag: vi.fn(async () => { throw new Error("graph flag HTTP 403 ErrorAccessDenied"); }), record },
      { id: 2, external_id: "m2", source: "graph" }, "clear");
    expect(bad.ok).toBe(false);
    expect(record).toHaveBeenLastCalledWith(2, null, "graph flag HTTP 403 ErrorAccessDenied");
  });
  it("sends only the flag property to Graph", async () => {
    const { setMessageFlag } = await import("../server/ontime/graph");
    const calls: any[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      return new Response("{}", { status: 200 });
    }) as any;
    try {
      await setMessageFlag({ tenantId: "t", clientId: "c", clientSecret: "s", mailbox: "me@x.au" }, "AAA=", "flagged");
    } finally { globalThis.fetch = orig; }
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(patch.url).toContain("/users/me%40x.au/messages/AAA%3D");
    expect(JSON.parse(patch.init.body)).toEqual({ flag: { flagStatus: "flagged" } });
  });
});
