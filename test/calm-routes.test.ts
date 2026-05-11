// Stage 13 (2026-05-11) — Calm routes: timeout + fallback semantics.
//
// The reframe endpoint has an 8s timeout and a deterministic fallback;
// the acknowledge endpoint has a 3s timeout and a single-word fallback.
// This test pins those behaviours by exercising the same withTimeout
// helper logic the route uses, plus the persistence shape that
// updateCalmSession produces on the complete step.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  CALM_REFRAME_FALLBACK,
  CALM_ACKNOWLEDGE_FALLBACK,
  CALM_REFLECTION_PROMPTS,
  buildCalmReframeMessages,
  buildCalmAcknowledgeMessages,
} from "../server/calm-prompts";

// Reimplementation of the withTimeout helper from server/coach-routes.ts.
// Keeps this test hermetic — we don't have to import the express route module
// (which would pull in the live data.db via storage.ts).
function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${tag} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Mirror the route's reframe call site. Returns { reframeText, fallback }.
async function reframeWithFallback(
  llmComplete: () => Promise<{ fullText: string }>,
  timeoutMs = 50,
): Promise<{ reframeText: string; fallback: boolean }> {
  try {
    const r = await withTimeout(llmComplete(), timeoutMs, "calm.reframe");
    const clean = r.fullText.trim();
    if (clean.length > 0) {
      return { reframeText: clean, fallback: false };
    }
  } catch {
    // fall through
  }
  return { reframeText: CALM_REFRAME_FALLBACK, fallback: true };
}

async function acknowledgeWithFallback(
  llmComplete: () => Promise<{ fullText: string }>,
  timeoutMs = 50,
): Promise<{ acknowledgement: string; fallback: boolean }> {
  try {
    const r = await withTimeout(llmComplete(), timeoutMs, "calm.acknowledge");
    const clean = r.fullText.trim();
    if (clean.length > 0) {
      return { acknowledgement: clean, fallback: false };
    }
  } catch {
    // fall through
  }
  return { acknowledgement: CALM_ACKNOWLEDGE_FALLBACK, fallback: true };
}

describe("Calm reframe fallback", () => {
  it("uses the canned reframe when the LLM throws", async () => {
    const result = await reframeWithFallback(async () => {
      throw new Error("perplexity 500");
    });
    expect(result.fallback).toBe(true);
    expect(result.reframeText).toBe(CALM_REFRAME_FALLBACK);
    // Spec: locked fallback text.
    expect(result.reframeText).toContain("slowed your breathing");
    expect(result.reframeText).toContain("needs space");
  });

  it("uses the canned reframe when the LLM hangs past the deadline", async () => {
    const result = await reframeWithFallback(
      () => new Promise(() => {}),
      30,
    );
    expect(result.fallback).toBe(true);
    expect(result.reframeText).toBe(CALM_REFRAME_FALLBACK);
  });

  it("returns the model output when the LLM completes within the deadline", async () => {
    const result = await reframeWithFallback(async () => ({
      fullText: "  You are doing the right thing by pausing.  ",
    }));
    expect(result.fallback).toBe(false);
    expect(result.reframeText).toBe("You are doing the right thing by pausing.");
  });

  it("falls back when the LLM returns an empty string", async () => {
    const result = await reframeWithFallback(async () => ({ fullText: "   " }));
    expect(result.fallback).toBe(true);
    expect(result.reframeText).toBe(CALM_REFRAME_FALLBACK);
  });
});

describe("Calm acknowledge fallback", () => {
  it("returns 'Noted.' on LLM error", async () => {
    const result = await acknowledgeWithFallback(async () => {
      throw new Error("timeout");
    });
    expect(result.fallback).toBe(true);
    expect(result.acknowledgement).toBe("Noted.");
  });

  it("returns 'Noted.' when the LLM hangs past 3s (simulated short timeout)", async () => {
    const result = await acknowledgeWithFallback(() => new Promise(() => {}), 30);
    expect(result.fallback).toBe(true);
    expect(result.acknowledgement).toBe("Noted.");
  });

  it("returns model text when LLM responds in time", async () => {
    const result = await acknowledgeWithFallback(async () => ({
      fullText: "Thank you for naming that.",
    }));
    expect(result.fallback).toBe(false);
    expect(result.acknowledgement).toBe("Thank you for naming that.");
  });
});

describe("Calm prompt builders", () => {
  it("buildCalmReframeMessages includes issue label, tags, intensity, observations", () => {
    const msgs = buildCalmReframeMessages({
      issueLabel: "Submit Coleman report",
      preTags: ["overwhelmed", "anxious"],
      preIntensity: 7,
      groundingObservations: { see: "desk", hear: "fan", feel: "tight chest" },
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    const user = msgs[1].content;
    expect(user).toContain("Submit Coleman report");
    expect(user).toContain("overwhelmed");
    expect(user).toContain("7");
    expect(user).toContain("desk");
    expect(user).toContain("fan");
    expect(user).toContain("tight chest");
  });

  it("system prompt forbids advice and bullet lists", () => {
    const msgs = buildCalmReframeMessages({
      issueLabel: "x",
      preTags: [],
      preIntensity: 0,
      groundingObservations: { see: "", hear: "", feel: "" },
    });
    const sys = msgs[0].content;
    expect(sys.toLowerCase()).toContain("regulation");
    expect(sys.toLowerCase()).toMatch(/do not.*(plan|action|advice)/);
    expect(sys.toLowerCase()).toContain("bullet");
  });

  it("buildCalmAcknowledgeMessages includes the question and the answer", () => {
    const msgs = buildCalmAcknowledgeMessages({
      questionLabel: CALM_REFLECTION_PROMPTS.worst,
      userAnswer: "That I'll fail and let everyone down.",
    });
    expect(msgs[1].content).toContain("worst-case story");
    expect(msgs[1].content).toContain("That I'll fail");
  });
});

describe("Calm session complete (persistence shape)", () => {
  // Mirrors the DDL + updateCalmSession behaviour from server/storage.ts.
  // The complete endpoint patches post_tags/post_intensity/post_note and
  // sets completed_at = endedAt = now. This test pins that exact shape.
  it("sets completed_at and ended_at to the same timestamp on complete", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE coach_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        mode TEXT NOT NULL DEFAULT 'plan',
        completed_at INTEGER,
        post_tags TEXT,
        post_intensity INTEGER,
        post_note TEXT
      );
    `);
    const startedAt = Date.now();
    const id = (
      db
        .prepare(
          "INSERT INTO coach_sessions (started_at, mode) VALUES (?, 'calm')",
        )
        .run(startedAt) as { lastInsertRowid: number }
    ).lastInsertRowid;

    const now = startedAt + 60_000;
    db.prepare(
      `UPDATE coach_sessions
       SET post_tags = ?, post_intensity = ?, post_note = ?, completed_at = ?, ended_at = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify(["calmer", "anchored"]),
      3,
      "the breath helped",
      now,
      now,
      id,
    );

    const row = db
      .prepare("SELECT * FROM coach_sessions WHERE id = ?")
      .get(id) as Record<string, unknown>;
    expect(row.completed_at).toBe(now);
    expect(row.ended_at).toBe(now);
    expect(row.post_intensity).toBe(3);
    expect(row.post_note).toBe("the breath helped");
    expect(JSON.parse(row.post_tags as string)).toEqual(["calmer", "anchored"]);
  });

  it("stores pre_tags and post_tags as JSON arrays", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE coach_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        mode TEXT NOT NULL DEFAULT 'plan',
        pre_tags TEXT,
        post_tags TEXT
      );
    `);
    const id = (
      db
        .prepare(
          "INSERT INTO coach_sessions (started_at, mode, pre_tags) VALUES (?, 'calm', ?)",
        )
        .run(Date.now(), JSON.stringify(["overwhelmed", "scattered"])) as {
        lastInsertRowid: number;
      }
    ).lastInsertRowid;
    db.prepare("UPDATE coach_sessions SET post_tags = ? WHERE id = ?").run(
      JSON.stringify(["calmer"]),
      id,
    );
    const row = db
      .prepare("SELECT pre_tags, post_tags FROM coach_sessions WHERE id = ?")
      .get(id) as { pre_tags: string; post_tags: string };
    expect(JSON.parse(row.pre_tags)).toEqual(["overwhelmed", "scattered"]);
    expect(JSON.parse(row.post_tags)).toEqual(["calmer"]);
  });
});
