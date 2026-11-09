// filepath: test/stage34-email-threads.test.ts
import { describe, it, expect } from "vitest";
import { threadKey, groupByThread } from "../client/src/lib/emailThreads";
import { messageIdOf, linkUploadedEmails } from "../server/ontime/upload-links";

describe("Stage 34 — email threads", () => {
  it("strips reply/forward prefixes and tags", () => {
    expect(threadKey("Re: Fwd: [EXTERNAL] Theatre list  Monday")).toBe("theatre list monday");
    expect(threadKey("RE: re: FW: Theatre list Monday")).toBe("theatre list monday");
    expect(threadKey("AW: Theatre list Monday")).toBe("theatre list monday");
    expect(threadKey("")).toBe("");
  });
  it("groups by thread, newest thread first, newest email first", () => {
    const g = groupByThread([
      { id: 1, subject: "Theatre list", received_at: 100 },
      { id: 2, subject: "Invoice", received_at: 300 },
      { id: 3, subject: "Re: Theatre list", received_at: 400 },
      { id: 4, subject: "", received_at: 200 },
      { id: 5, subject: "", received_at: 150 },
    ]);
    expect(g.map((x) => x.items.map((i) => i.id))).toEqual([[3, 1], [2], [4], [5]]);
  });
});

describe("Stage 34 — upload links", () => {
  it("reads Message-IDs, skips hashed fallbacks", () => {
    expect(messageIdOf("eml:<abc@x.com>")).toBe("<abc@x.com>");
    expect(messageIdOf("msg:abc@x.com")).toBe("<abc@x.com>");
    expect(messageIdOf("eml:" + "a".repeat(32))).toBeNull();
    expect(messageIdOf("paste:xyz")).toBeNull();
  });
  it("links, removes open duplicates, keeps rows with tasks", async () => {
    const linked: Array<[number, string]> = []; const deleted: number[] = [];
    const r = await linkUploadedEmails({
      rows: () => [
        { id: 1, external_id: "eml:<dup@x>", status: "new", task_id: null },
        { id: 2, external_id: "eml:<dup2@x>", status: "new", task_id: 9 },
        { id: 3, external_id: "eml:<solo@x>", status: "new", task_id: null },
        { id: 4, external_id: "eml:<gone@x>", status: "new", task_id: null },
        { id: 5, external_id: "eml:<err@x>", status: "new", task_id: null },
      ],
      hasGraphRow: (gid) => gid.startsWith("g-dup"),
      setWebLink: (id, w) => { linked.push([id, w]); },
      deleteRow: (id) => { deleted.push(id); return true; },
      lookup: async (mid) => {
        if (mid === "<err@x>") throw new Error("boom");
        if (mid === "<gone@x>") return null;
        return { id: mid === "<solo@x>" ? "g-solo" : `g-${mid.slice(1, -3)}`, webLink: `https://owa/${mid}` };
      },
    });
    expect(deleted).toEqual([1]);
    expect(linked.map((l) => l[0])).toEqual([2, 3]);
    expect(r).toMatchObject({ checked: 5, linked: 2, duplicatesRemoved: 1, notFound: 1, errors: 1 });
  });
});
