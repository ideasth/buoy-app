import { describe, it, expect, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { planMailSync, runMailSync, mergeCategories, isEmptyPlan, PerRowQueue, BUOY_LABELS, FILED_DONE } from "../server/ontime/mailsync";
import { OnTimeStore } from "../server/ontime/store";
import { DEFAULT_CONFIG, mergeConfig } from "../server/ontime/config";
import { patchMessage, moveMessage, _resetDoneFolderCache } from "../server/ontime/graph";

const on = { flags: true, filing: true };
const row = (o: any = {}): any => ({ source: "graph", status: "new", category: "act_today", flag_state: null, buoy_label: null, filed_folder: null, ...o });

describe("Stage 30 — planning", () => {
  it("labels each open category with its Buoy label", () => {
    for (const [cat, label] of Object.entries(BUOY_LABELS)) {
      expect(planMailSync(row({ category: cat }), on).label).toBe(label);
    }
  });
  it("swaps the label when re-sorted, no-op when unchanged", () => {
    expect(planMailSync(row({ category: "waiting", buoy_label: "Buoy: Act today" }), on).label).toBe("Buoy: Waiting");
    expect(planMailSync(row({ buoy_label: "Buoy: Act today", flag_state: "flagged" }), on)).toEqual({ flag: null, label: undefined, move: null });
  });
  it("done/dismissed removes label, clears Buoy flag, files the email", () => {
    for (const status of ["done", "dismissed"]) {
      const p = planMailSync(row({ status, buoy_label: "Buoy: Act today", flag_state: "flagged" }), on);
      expect(p).toEqual({ flag: "clear", label: null, move: "file" });
    }
  });
  it("does not re-file an already-filed email", () => {
    expect(isEmptyPlan(planMailSync(row({ status: "done", filed_folder: FILED_DONE }), on))).toBe(true);
  });
  it("reopened filed email moves back to Inbox and is relabelled", () => {
    const p = planMailSync(row({ category: "reply_week", filed_folder: FILED_DONE }), on);
    expect(p).toEqual({ flag: "flag", label: "Buoy: Reply this week", move: "inbox" });
  });
  it("switches are independent; uploads never touched", () => {
    expect(planMailSync(row(), { flags: false, filing: false })).toEqual({ flag: null, label: undefined, move: null });
    expect(planMailSync(row(), { flags: true, filing: false })).toEqual({ flag: "flag", label: undefined, move: null });
    expect(planMailSync(row(), { flags: false, filing: true })).toEqual({ flag: null, label: "Buoy: Act today", move: null });
    expect(isEmptyPlan(planMailSync(row({ source: "upload" }), on))).toBe(true);
  });
  it("keeps Oliver's own categories", () => {
    expect(mergeCategories(["Family", "Buoy: FYI"], "Buoy: Waiting")).toEqual(["Family", "Buoy: Waiting"]);
    expect(mergeCategories(["Family", "Buoy: FYI"], null)).toEqual(["Family"]);
  });
  it("filing switch defaults off", () => {
    expect(DEFAULT_CONFIG.mailFilingEnabled).toBe(false);
    expect(mergeConfig(DEFAULT_CONFIG, { mailFilingEnabled: true }).mailFilingEnabled).toBe(true);
  });
});

describe("Stage 30 — execution", () => {
  it("runs flag+label in one patch, then moves, recording the new id", async () => {
    const calls: string[] = [];
    const recs: any[] = [];
    const ops = {
      getCategories: vi.fn(async () => ["Family", "Buoy: Act today"]),
      patchMessage: vi.fn(async (id: string, b: any) => { calls.push(`patch:${id}:${JSON.stringify(b)}`); }),
      move: vi.fn(async (id: string, d: string) => { calls.push(`move:${id}:${d}`); return { id: "NEW", webLink: "https://x/NEW" }; }),
    };
    const r = await runMailSync(ops, (_id, rec) => recs.push(rec), { id: 7, external_id: "OLD" }, { flag: "clear", label: null, move: "file" });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([`patch:OLD:${JSON.stringify({ flag: { flagStatus: "notFlagged" }, categories: ["Family"] })}`, "move:OLD:file"]);
    expect(recs.at(-1)).toMatchObject({ externalId: "NEW", webLink: "https://x/NEW", filedFolder: FILED_DONE });
  });
  it("moves back to Inbox first, then patches the new id", async () => {
    const calls: string[] = [];
    const ops = {
      getCategories: vi.fn(async () => []),
      patchMessage: vi.fn(async (id: string) => { calls.push(`patch:${id}`); }),
      move: vi.fn(async (id: string, d: string) => { calls.push(`move:${id}:${d}`); return { id: "BACK", webLink: null }; }),
    };
    await runMailSync(ops, () => {}, { id: 1, external_id: "FILED" }, { flag: "flag", label: "Buoy: Act today", move: "inbox" });
    expect(calls).toEqual(["move:FILED:inbox", "patch:BACK"]);
  });
  it("records errors and stops", async () => {
    const recs: any[] = [];
    const ops = {
      getCategories: vi.fn(async () => []),
      patchMessage: vi.fn(async () => { throw new Error("graph patch HTTP 403 ErrorAccessDenied"); }),
      move: vi.fn(),
    };
    const r = await runMailSync(ops as any, (_i, rec) => recs.push(rec), { id: 1, external_id: "A" }, { flag: null, label: null, move: "file" });
    expect(r.ok).toBe(false);
    expect(ops.move).not.toHaveBeenCalled();
    expect(recs.at(-1)).toEqual({ error: "graph patch HTTP 403 ErrorAccessDenied" });
  });
  it("queue runs same-row jobs in order", async () => {
    const q = new PerRowQueue(); const seen: number[] = [];
    await Promise.all([
      q.run(1, async () => { await new Promise((r) => setTimeout(r, 20)); seen.push(1); }),
      q.run(1, async () => { seen.push(2); }),
    ]);
    expect(seen).toEqual([1, 2]);
  });
  it("store records new id, label and folder", () => {
    const db = new Database(":memory:");
    const s = new OnTimeStore(db as any);
    const { id } = s.insertTriage({ source: "graph", externalId: "OLD", receivedAt: Date.now(), sender: "a@b", senderName: "A", subject: "s", snippet: "x", webLink: null, bodyForLlm: "" });
    s.setMailSyncResult(id, { externalId: "NEW", buoyLabel: null, filedFolder: FILED_DONE, error: null });
    const r = s.getTriage(id)!;
    expect([r.external_id, r.buoy_label, r.filed_folder]).toEqual(["NEW", null, FILED_DONE]);
  });
});

describe("Stage 30 — Graph calls", () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; _resetDoneFolderCache(); });
  const creds = { tenantId: "t", clientId: "c", clientSecret: "s", mailbox: "me@x.au" };
  it("refuses to patch anything but flag/categories", async () => {
    await expect(patchMessage(creds, "A", { isRead: true })).rejects.toThrow(/refusing/);
  });
  it("creates Archive > Buoy-DoneDismissed once, then moves", async () => {
    const calls: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      const u = String(url); calls.push({ u, m: init?.method, b: init?.body });
      if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      if (u.includes("childFolders?")) return new Response(JSON.stringify({ value: [] }), { status: 200 });
      if (u.endsWith("childFolders")) return new Response(JSON.stringify({ id: "FOLDER" }), { status: 201 });
      if (u.endsWith("/move")) return new Response(JSON.stringify({ id: "NEW", webLink: "w" }), { status: 201 });
      return new Response("{}", { status: 200 });
    }) as any;
    expect(await moveMessage(creds, "A", "file")).toEqual({ id: "NEW", webLink: "w" });
    await moveMessage(creds, "B", "file");
    const creates = calls.filter((c) => c.m === "POST" && c.u.endsWith("childFolders"));
    expect(creates).toHaveLength(1);
    expect(creates[0].u).toContain("mailFolders('archive')");
    expect(JSON.parse(creates[0].b)).toEqual({ displayName: "Buoy-DoneDismissed" });
    const moves = calls.filter((c) => c.u.endsWith("/move"));
    expect(JSON.parse(moves[1].b)).toEqual({ destinationId: "FOLDER" });
  });
});

describe("Stage 30.1 — 30-day cleanup", () => {
  it("plans removal of Buoy flag and label only", async () => {
    const { planPruneCleanup } = await import("../server/ontime/mailsync");
    expect(planPruneCleanup({ source: "graph", flag_state: "flagged", buoy_label: "Buoy: Act today", filed_folder: null } as any))
      .toEqual({ flag: "clear", label: null, move: null });
    expect(planPruneCleanup({ source: "graph", flag_state: "cleared", buoy_label: null, filed_folder: null } as any))
      .toEqual({ flag: null, label: undefined, move: null });
    expect(planPruneCleanup({ source: "graph", flag_state: "flagged", buoy_label: "x", filed_folder: FILED_DONE } as any))
      .toEqual({ flag: null, label: undefined, move: null });
  });
  it("prune keeps rows still marked in Outlook, drops them once cleared", () => {
    const db = new Database(":memory:");
    const s = new OnTimeStore(db as any);
    const old = Date.now() - 40 * 86_400_000;
    const mk = (ext: string) => s.insertTriage({ source: "graph", externalId: ext, receivedAt: old, sender: "a", senderName: "a", subject: "s", snippet: "", webLink: null, bodyForLlm: "" }).id;
    const marked = mk("M"); const plain = mk("P");
    s.updateTriage(marked, { status: "new" }); s.updateTriage(plain, { status: "done" });
    s.setMailSyncResult(marked, { flagState: "flagged", buoyLabel: "Buoy: Act today", error: null });
    expect(s.pruneCandidatesWithOutlookMarks(Date.now() - 30 * 86_400_000).map((r) => r.id)).toEqual([marked]);
    expect(s.pruneTriage(Date.now() - 30 * 86_400_000)).toBe(1);
    expect(s.getTriage(plain)).toBeUndefined();
    expect(s.getTriage(marked)).toBeDefined();
    s.setMailSyncResult(marked, { flagState: "cleared", buoyLabel: null, error: null });
    expect(s.pruneTriage(Date.now() - 30 * 86_400_000)).toBe(1);
  });
});
