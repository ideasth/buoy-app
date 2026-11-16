// filepath: /home/user/workspace/anchor/test/stage35a-triage-per-tab.test.ts
// Stage 35a — each triage tab must get its own rows, not a slice of the
// newest 300 overall (older Act today emails were hidden behind FYI/Waiting).
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { OnTimeStore } from "../server/ontime/store";

describe("listTriage category filter", () => {
  it("returns older act_today rows even when newer rows exceed the limit", () => {
    const db = new Database(":memory:");
    const store = new OnTimeStore(db as any);
    const ins = db.prepare(
      `INSERT INTO email_triage (source, external_id, received_at, sender, subject, category, status, created_at, updated_at)
       VALUES ('graph', ?, ?, 'a@b.c', 's', ?, 'new', 0, 0)`,
    );
    for (let i = 0; i < 5; i++) ins.run(`old-${i}`, 1000 + i, "act_today");
    for (let i = 0; i < 20; i++) ins.run(`new-${i}`, 5000 + i, "fyi");
    expect(store.listTriage({ limit: 10 }).filter((r) => r.category === "act_today")).toHaveLength(0);
    const act = store.listTriage({ limit: 10, category: "act_today" });
    expect(act).toHaveLength(5);
    expect(act.every((r) => r.category === "act_today")).toBe(true);
  });
});
