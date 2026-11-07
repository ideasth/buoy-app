// filepath: /home/user/workspace/anchor/test/stage25-1-bulk-upload.test.ts
// Stage 25.1 — bulk zip upload and background sorting while email is off.
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { OnTimeStore } from "../server/ontime/store";
import { OnTimeEngine } from "../server/ontime/engine";
import { parseZip } from "../server/ontime/upload";
import { melbToUtcMs } from "../server/ontime/time";

const NOW = melbToUtcMs("2026-11-10", "07:00");
const eml = (id: string, date: string, subject: string) =>
  `From: "Sam" <sam@example.org>\r\nTo: x@y.com\r\nSubject: ${subject}\r\nDate: ${date}\r\nMessage-ID: <${id}@ex>\r\n\r\nBody ${subject}.\r\n`;

async function makeZip(): Promise<Buffer> {
  const z = new JSZip();
  z.file("Buoy upload/recent1.eml", eml("r1", "Mon, 09 Nov 2026 09:00:00 +1100", "Recent one"));
  z.file("Buoy upload/recent2.eml", eml("r2", "Sun, 01 Nov 2026 09:00:00 +1100", "Recent two"));
  z.file("Buoy upload/old.eml", eml("o1", "Mon, 01 Sep 2026 09:00:00 +1000", "Old one"));
  z.file("__MACOSX/Buoy upload/._recent1.eml", "junk");
  z.file("Buoy upload/.DS_Store", "junk");
  z.file("Buoy upload/notes.txt", "not an email");
  return Buffer.from(await z.generateAsync({ type: "nodebuffer" }));
}

function engineWith(store: OnTimeStore, opts: { noAutoContinue?: boolean } = {}) {
  let calls = 0;
  const engine = new OnTimeEngine({
    store,
    getPlanEvents: async () => [],
    getTop3Titles: () => [],
    createDeadlineTask: () => null,
    send: async () => ({ ok: true }),
    now: () => NOW,
    llmFactory: () => async () => { calls++; return JSON.stringify({ category: "fyi", summary: "s" }); },
    graphCreds: () => null,
    noAutoContinue: opts.noAutoContinue,
  });
  return { engine, calls: () => calls };
}

const row = (i: number) => ({
  source: "upload" as const, externalId: `e${i}`, receivedAt: NOW - i * 60_000, sender: "a@b.c",
  senderName: "A", subject: `s${i}`, snippet: "", webLink: null, bodyForLlm: "hello",
});

describe("parseZip", () => {
  it("reads .eml entries, skips Mac junk, non-emails and anything older than 30 days", async () => {
    const r = await parseZip(await makeZip(), { now: NOW });
    expect(r.emailEntries).toBe(3);
    expect(r.parsed.map((p) => p.subject).sort()).toEqual(["Recent one", "Recent two"]);
    expect(r.skippedOld).toBe(1);
    expect(r.failed).toBe(0);
  });
  it("rejects a file that is not a zip", async () => {
    await expect(parseZip(Buffer.from("hello"), { now: NOW })).rejects.toThrow(/not a valid zip/);
  });
  it("enforces the entry cap", async () => {
    await expect(parseZip(await makeZip(), { now: NOW, maxEntries: 2 })).rejects.toThrow(/too many emails/);
  });
});

describe("background sorting", () => {
  it("continues past one batch until the queue is empty", async () => {
    const store = new OnTimeStore(new Database(":memory:"), () => NOW);
    for (let i = 0; i < 7; i++) store.insertTriage(row(i));
    const { engine, calls } = engineWith(store);
    await engine.drainTriage(3);
    for (let i = 0; i < 20 && store.queuedCount() > 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(store.queuedCount()).toBe(0);
    expect(calls()).toBe(7);
  });
  it("tick sorts uploaded emails even with email reading switched off", async () => {
    const store = new OnTimeStore(new Database(":memory:"), () => NOW);
    store.updateConfig({ enabled: false, emailEnabled: false });
    store.insertTriage(row(1));
    const { engine } = engineWith(store, { noAutoContinue: true });
    await engine.tick(true);
    for (let i = 0; i < 20 && store.queuedCount() > 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(store.queuedCount()).toBe(0);
  });
});
