// filepath: test/stage36-unsubscribe.test.ts
// Stage 36 — Unsubscribe category and "How to stop these" instructions.
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { OnTimeStore, TRIAGE_CATEGORIES } from "../server/ontime/store";
import { classify, buildPrompt, applyRules } from "../server/ontime/triage";
import { BUOY_LABELS } from "../server/ontime/mailsync";
import { decideFlag } from "../server/ontime/flagsync";
import { buildUnsubPlan, findBodyUnsubLinks, parseListUnsubscribe } from "../server/ontime/unsubscribe";

const inp = (sender: string, body = "Hi Oliver") => ({ sender, senderName: "", subject: "Weekly deals", body, receivedAt: Date.UTC(2026, 10, 17) });

describe("Stage 36 — unsubscribe category", () => {
  it("is a real category with its own Outlook label and no flag", () => {
    expect(TRIAGE_CATEGORIES).toContain("unsubscribe");
    expect(BUOY_LABELS.unsubscribe).toBe("Buoy: Unsubscribe");
    expect(decideFlag({ source: "graph", status: "new", category: "unsubscribe", flag_state: null } as any)).toBeNull();
  });
  it("a sender rule sends mail straight to Unsubscribe without the model", async () => {
    let called = false;
    const r = await classify(inp("news@shop.com"), async () => { called = true; return "{}"; }, "m", { senderRule: "unsubscribe" });
    expect(r.category).toBe("unsubscribe");
    expect(called).toBe(false);
  });
  it("the model may choose unsubscribe, but never for a priority sender", async () => {
    const llm = async () => JSON.stringify({ category: "unsubscribe", summary: "List", deadline: null });
    expect((await classify(inp("someone@gmail.com"), llm, "m")).category).toBe("unsubscribe");
    expect((await classify(inp("someone@monashhealth.org"), llm, "m")).category).toBe("fyi");
  });
  it("the prompt offers the unsubscribe category", () => {
    const i = inp("a@b.com");
    expect(buildPrompt(i, applyRules(i))).toContain("unsubscribe =");
  });
  it("PATCH-style store updates accept unsubscribe", () => {
    const store = new OnTimeStore(new Database(":memory:") as any);
    const { id } = store.insertTriage({ source: "upload", externalId: "u1", receivedAt: 1, sender: "a@b.com", senderName: "", subject: "", snippet: "", webLink: null, bodyForLlm: "" });
    expect(store.updateTriage(id, { category: "unsubscribe" })?.category).toBe("unsubscribe");
  });
});

describe("Stage 36 — finding unsubscribe links", () => {
  it("parses List-Unsubscribe with web and mailto entries", () => {
    const l = parseListUnsubscribe("<mailto:leave@list.example.com?subject=unsubscribe>, <https://list.example.com/u/abc>");
    expect(l.map((x) => x.kind)).toEqual(["email", "web"]);
  });
  it("ignores non-http(s)/mailto schemes", () => {
    expect(parseListUnsubscribe("<javascript:alert(1)>, <ftp://x/y>")).toEqual([]);
  });
  it("finds body links near unsubscribe wording only", () => {
    const body = "Read more <https://shop.com/sale>\n\nTo stop these emails, Unsubscribe <https://shop.com/unsub?id=9>.";
    const l = findBodyUnsubLinks(body);
    expect(l).toHaveLength(1);
    expect(l[0].url).toBe("https://shop.com/unsub?id=9");
  });
  it("plan prefers the header web link and notes one-click", () => {
    const p = buildUnsubPlan({
      headers: [
        { name: "List-Unsubscribe", value: "<mailto:x@y.com>, <https://y.com/u>" },
        { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
      ],
      body: "", sender: "news@y.com", category: "unsubscribe",
    });
    expect(p.links[0]).toMatchObject({ kind: "web", url: "https://y.com/u", source: "header" });
    expect(p.oneClick).toBe(true);
    expect(p.steps.join(" ")).toMatch(/one-click/);
  });
  it("falls back to Outlook block-sender steps when no link exists", () => {
    const p = buildUnsubPlan({ headers: [], body: "Hello", sender: "a@b.com", category: "fyi" });
    expect(p.links).toEqual([]);
    expect(p.steps.join(" ")).toMatch(/Block sender/);
  });
  it("for junk, hides links and warns instead", () => {
    const p = buildUnsubPlan({ headers: [{ name: "List-Unsubscribe", value: "<https://scam.example/u>" }], body: "", sender: "s@scam.example", category: "spam" });
    expect(p.links).toEqual([]);
    expect(p.caution).toMatch(/phishing/);
  });
});
