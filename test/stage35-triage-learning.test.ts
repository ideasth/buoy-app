// filepath: test/stage35-triage-learning.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { OnTimeStore } from "../server/ontime/store";
import { classify, buildPrompt, applyRules } from "../server/ontime/triage";
import { planMailSync } from "../server/ontime/mailsync";

const mk = () => {
  let t = 1_000;
  const store = new OnTimeStore(new Database(":memory:") as any, () => (t += 1000));
  const add = (sender: string, subject = "Hello") => {
    const { id } = store.insertTriage({ source: "upload", externalId: `x-${Math.random()}`, receivedAt: Date.now(), sender, senderName: "", subject, snippet: "", webLink: null, bodyForLlm: "" });
    store.saveClassification(id, { category: "fyi", summary: "", deadlineText: null, deadlineDate: null, isPriority: false, ruleHits: [], model: null });
    return store.getTriage(id)!;
  };
  return { store, add };
};
const inp = (sender: string, subject = "Quarterly update", body = "Hi Oliver") => ({ sender, senderName: "", subject, body, receivedAt: Date.UTC(2026, 10, 16) });

describe("Stage 35 — learning from re-sorts", () => {
  it("two moves of the same sender to the same category create a learned rule", () => {
    const { store, add } = mk();
    expect(store.recordCorrection(add("Promo@Shop.com"), "spam")).toBeNull();
    const rule = store.recordCorrection(add("promo@shop.com"), "spam");
    expect(rule).toMatchObject({ sender: "promo@shop.com", category: "spam", origin: "learned" });
  });
  it("a conflicting move removes a learned rule; manual rules are kept", () => {
    const { store, add } = mk();
    store.recordCorrection(add("a@x.com"), "waiting");
    store.recordCorrection(add("a@x.com"), "waiting");
    expect(store.recordCorrection(add("a@x.com"), "act_today")).toBeNull();
    expect(store.getSenderRule("a@x.com")).toBeUndefined();
    store.setSenderRule("b@x.com", "act_today", "manual");
    store.recordCorrection(add("b@x.com"), "fyi");
    store.recordCorrection(add("b@x.com"), "fyi");
    expect(store.getSenderRule("b@x.com")).toMatchObject({ category: "act_today", origin: "manual" });
  });
  it("examples rank same sender, then same domain", () => {
    const { store, add } = mk();
    store.recordCorrection(add("z@other.org", "Other"), "fyi");
    store.recordCorrection(add("p@dom.com", "Domain"), "waiting");
    store.recordCorrection(add("me@dom.com", "Mine"), "act_today");
    expect(store.correctionExamples("me@dom.com").map((e) => e.subject)).toEqual(["Mine", "Domain", "Other"]);
  });
  it("sender rule decides category; spam/fyi skip the model", async () => {
    let called = 0;
    const llm = async () => { called++; return JSON.stringify({ category: "act_today", summary: "Do it", deadline: null }); };
    const spam = await classify(inp("promo@shop.com"), llm, "m", { senderRule: "spam" });
    expect(spam.category).toBe("spam");
    expect(called).toBe(0);
    const wait = await classify(inp("a@x.com"), llm, "m", { senderRule: "waiting" });
    expect(wait.category).toBe("waiting");
    expect(wait.summary).toBe("Do it");
    expect(called).toBe(1);
  });
  it("a sender rule overrides the newsletter shortcut", async () => {
    const c = await classify(inp("noreply@college.org", "Exam results", "unsubscribe here"), null, null, { senderRule: "act_today" });
    expect(c.category).toBe("act_today");
  });
  it("prompt lists spam and Oliver's examples", () => {
    const p = buildPrompt(inp("a@x.com"), applyRules(inp("a@x.com")), { examples: [{ sender: "a@x.com", subject: "Invoice", to_category: "waiting" }] });
    expect(p).toContain("act_today|reply_week|waiting|fyi|spam");
    expect(p).toContain("From a@x.com | Subject: Invoice -> waiting");
  });
  it("Spam/Junk gets a label but is never filed to another folder while open", () => {
    const plan = planMailSync({ source: "graph", status: "new", category: "spam", flag_state: null, buoy_label: null, filed_folder: null } as any, { flags: true, filing: true });
    expect(plan.label).toBe("Buoy: Spam/Junk");
    expect(plan.move).toBeNull();
  });
});
