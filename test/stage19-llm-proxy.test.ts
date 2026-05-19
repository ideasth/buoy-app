// Stage 19 (2026-05-16) — Sibling LLM proxy.
//
// Tests cover the pure helpers (loopback matcher, secret compare, model
// allow-list, body validator, rate limiter, sibling registry, provider
// resolver) directly. Source-text guards confirm the route module wires
// them together correctly and does not log message content or secrets.
//
// We deliberately do NOT spin up an Express app here — the existing test
// suite is node-env (no jsdom, no supertest) and the live route behaviour
// is exercised by the operator's curl smoke test in
// STAGE_19_SIBLING_LLM_PROXY_SPEC.md ("Acceptance criteria").

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isLoopbackIp,
  secretsMatch,
  validateChatBody,
  MAX_TOKENS_HARD_CAP,
} from "../server/llm-proxy-routes";
import {
  PROXY_ALLOWED_MODELS,
  PROXY_DEFAULT_MODEL,
  isAllowedModel,
} from "../server/llm/proxy-models";
import {
  ProxyRateLimiter,
  DEFAULT_PER_MINUTE,
} from "../server/llm/proxy-rate-limit";
import {
  getSiblingSecret,
  isKnownSiblingId,
  listSiblingIds,
  REGISTRY,
} from "../server/llm/sibling-registry";
import { getProxyAdapter, currentProvider, DEFAULT_PROVIDER } from "../server/llm/proxy";

const ROUTES_SRC = readFileSync(
  path.resolve(__dirname, "../server/llm-proxy-routes.ts"),
  "utf8",
);
const TOP_ROUTES_SRC = readFileSync(
  path.resolve(__dirname, "../server/routes.ts"),
  "utf8",
);

// ----- Loopback matcher -----

describe("Stage 19 — loopback IP matcher", () => {
  it("accepts the documented loopback addresses", () => {
    expect(isLoopbackIp("127.0.0.1")).toBe(true);
    expect(isLoopbackIp("::1")).toBe(true);
    expect(isLoopbackIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects external-looking IPs and falsey input", () => {
    expect(isLoopbackIp("203.0.113.5")).toBe(false);
    expect(isLoopbackIp("8.8.8.8")).toBe(false);
    expect(isLoopbackIp("192.168.0.10")).toBe(false);
    expect(isLoopbackIp("10.0.0.1")).toBe(false);
    // Private-range IPs that happen to start with "127" must NOT be
    // considered loopback by an over-eager prefix match.
    expect(isLoopbackIp("127.1.2.3")).toBe(false);
    expect(isLoopbackIp("")).toBe(false);
    expect(isLoopbackIp(undefined)).toBe(false);
    expect(isLoopbackIp(null)).toBe(false);
  });
});

// ----- Sibling registry -----

describe("Stage 19 — sibling registry", () => {
  const MARIEKE_ENV = "MARIEKE_BUOY_PROXY_SECRET";
  const LACHIE_ENV = "LACHIE_BUOY_PROXY_SECRET";

  beforeEach(() => {
    delete process.env[MARIEKE_ENV];
    delete process.env[LACHIE_ENV];
  });

  afterEach(() => {
    delete process.env[MARIEKE_ENV];
    delete process.env[LACHIE_ENV];
  });

  it("registers both Stage 19 siblings", () => {
    const ids = listSiblingIds();
    expect(ids).toContain("marieke-buoy");
    expect(ids).toContain("lachie-buoy");
    expect(ids).toHaveLength(2);
  });

  it("isKnownSiblingId discriminates registered vs unknown", () => {
    expect(isKnownSiblingId("marieke-buoy")).toBe(true);
    expect(isKnownSiblingId("lachie-buoy")).toBe(true);
    expect(isKnownSiblingId("buoy")).toBe(false);
    expect(isKnownSiblingId("")).toBe(false);
    expect(isKnownSiblingId("MARIEKE-BUOY")).toBe(false); // case-sensitive
  });

  it("returns the configured secret for a known ID", () => {
    process.env[MARIEKE_ENV] = "marieke-secret-aaaa";
    process.env[LACHIE_ENV] = "lachie-secret-bbbb";
    expect(getSiblingSecret("marieke-buoy")).toBe("marieke-secret-aaaa");
    expect(getSiblingSecret("lachie-buoy")).toBe("lachie-secret-bbbb");
  });

  it("returns null for an unknown sibling ID", () => {
    process.env[MARIEKE_ENV] = "anything";
    expect(getSiblingSecret("fake-sibling")).toBeNull();
    expect(getSiblingSecret("")).toBeNull();
  });

  it("returns null when the env var for a registered ID is unset or empty", () => {
    // Env var entirely unset.
    expect(getSiblingSecret("marieke-buoy")).toBeNull();
    // Env var present but empty string.
    process.env[MARIEKE_ENV] = "";
    expect(getSiblingSecret("marieke-buoy")).toBeNull();
  });

  it("uses distinct env vars for each sibling", () => {
    const envVars = REGISTRY.map((e) => e.envVar);
    expect(new Set(envVars).size).toBe(envVars.length);
  });
});

// ----- Constant-time secret compare -----

describe("Stage 19 — secretsMatch", () => {
  it("accepts identical secrets", () => {
    expect(secretsMatch("abc123", "abc123")).toBe(true);
    // 64-character base64-ish secrets, what we'd actually deploy.
    const long = "x".repeat(64);
    expect(secretsMatch(long, long)).toBe(true);
  });

  it("rejects different secrets of the same length", () => {
    expect(secretsMatch("abc123", "abc124")).toBe(false);
    expect(secretsMatch("x".repeat(64), "y".repeat(64))).toBe(false);
  });

  it("rejects different-length secrets", () => {
    expect(secretsMatch("abc123", "abc1234")).toBe(false);
    expect(secretsMatch("abc1234", "abc123")).toBe(false);
  });

  it("fails closed on empty inputs", () => {
    expect(secretsMatch("", "")).toBe(false);
    expect(secretsMatch("abc", "")).toBe(false);
    expect(secretsMatch("", "abc")).toBe(false);
  });
});

// ----- Model allow-list -----

describe("Stage 19 — model allow-list", () => {
  it("documents Perplexity Sonar models for v1", () => {
    expect(PROXY_ALLOWED_MODELS.perplexity).toEqual(
      expect.arrayContaining(["sonar", "sonar-pro", "sonar-reasoning-pro"]),
    );
  });

  it("defaults Perplexity to sonar-pro", () => {
    expect(PROXY_DEFAULT_MODEL.perplexity).toBe("sonar-pro");
  });

  it("isAllowedModel returns true for documented models", () => {
    expect(isAllowedModel("perplexity", "sonar")).toBe(true);
    expect(isAllowedModel("perplexity", "sonar-pro")).toBe(true);
    expect(isAllowedModel("perplexity", "sonar-reasoning-pro")).toBe(true);
  });

  it("isAllowedModel rejects unknown models and unknown providers", () => {
    expect(isAllowedModel("perplexity", "gpt-4")).toBe(false);
    expect(isAllowedModel("perplexity", "")).toBe(false);
    expect(isAllowedModel("openai", "gpt-4")).toBe(false); // provider not wired in v1
  });
});

// ----- Body validation -----

describe("Stage 19 — validateChatBody", () => {
  const baseValid = {
    model: "sonar-pro",
    messages: [{ role: "user", content: "hi" }],
  };

  it("accepts a minimal valid body and fills in defaults", () => {
    const r = validateChatBody(baseValid, "perplexity");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.model).toBe("sonar-pro");
      expect(r.value.temperature).toBe(0.4);
      expect(r.value.maxTokens).toBe(1200);
      expect(r.value.disableSearch).toBe(true);
    }
  });

  it("defaults model to sonar-pro when omitted", () => {
    const r = validateChatBody({ messages: [{ role: "user", content: "hi" }] }, "perplexity");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.model).toBe("sonar-pro");
  });

  it("rejects an unknown model", () => {
    const r = validateChatBody({ ...baseValid, model: "gpt-4" }, "perplexity");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_model");
  });

  it("rejects empty messages", () => {
    const r = validateChatBody({ ...baseValid, messages: [] }, "perplexity");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_request");
  });

  it("rejects messages with wrong shape", () => {
    expect(
      validateChatBody({ ...baseValid, messages: [{ role: "user" }] }, "perplexity").ok,
    ).toBe(false);
    expect(
      validateChatBody({ ...baseValid, messages: [{ role: "bot", content: "x" }] }, "perplexity")
        .ok,
    ).toBe(false);
    expect(
      validateChatBody(
        { ...baseValid, messages: [{ role: "user", content: "" }] },
        "perplexity",
      ).ok,
    ).toBe(false);
  });

  it("rejects maxTokens > 4000 (hard cap)", () => {
    expect(MAX_TOKENS_HARD_CAP).toBe(4000);
    const r = validateChatBody({ ...baseValid, maxTokens: 4001 }, "perplexity");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_request");
  });

  it("rejects non-integer or non-positive maxTokens", () => {
    expect(validateChatBody({ ...baseValid, maxTokens: 1.5 }, "perplexity").ok).toBe(false);
    expect(validateChatBody({ ...baseValid, maxTokens: 0 }, "perplexity").ok).toBe(false);
    expect(validateChatBody({ ...baseValid, maxTokens: -1 }, "perplexity").ok).toBe(false);
  });

  it("rejects temperature outside [0, 1]", () => {
    expect(validateChatBody({ ...baseValid, temperature: -0.1 }, "perplexity").ok).toBe(false);
    expect(validateChatBody({ ...baseValid, temperature: 1.5 }, "perplexity").ok).toBe(false);
    expect(validateChatBody({ ...baseValid, temperature: "hot" as any }, "perplexity").ok).toBe(
      false,
    );
  });

  it("accepts disableSearch override (false to enable Sonar web search)", () => {
    const r = validateChatBody({ ...baseValid, disableSearch: false }, "perplexity");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.disableSearch).toBe(false);
  });

  it("rejects non-boolean disableSearch", () => {
    expect(validateChatBody({ ...baseValid, disableSearch: "yes" as any }, "perplexity").ok).toBe(
      false,
    );
  });
});

// ----- Rate limiter -----

describe("Stage 19 — ProxyRateLimiter", () => {
  it("allows up to the per-minute cap then rejects the next request", () => {
    const rl = new ProxyRateLimiter(60, 600);
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) {
      const d = rl.check("marieke-buoy", t0 + i);
      expect(d.allowed).toBe(true);
    }
    const blocked = rl.check("marieke-buoy", t0 + 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("minute");
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("isolates rate-limit state per sibling", () => {
    const rl = new ProxyRateLimiter(60, 600);
    const t0 = 2_000_000;
    // marieke exhausts her minute cap entirely.
    for (let i = 0; i < 60; i++) rl.check("marieke-buoy", t0 + i);
    expect(rl.check("marieke-buoy", t0 + 60).allowed).toBe(false);
    // lachie is untouched.
    expect(rl.check("lachie-buoy", t0 + 60).allowed).toBe(true);
  });

  it("releases capacity as old entries fall out of the minute window", () => {
    const rl = new ProxyRateLimiter(60, 600);
    const t0 = 3_000_000;
    for (let i = 0; i < 60; i++) rl.check("marieke-buoy", t0 + i);
    expect(rl.check("marieke-buoy", t0 + 60).allowed).toBe(false);
    // 61 seconds after the very first request → first entry has rolled off,
    // so one slot is available again.
    const afterRollOff = rl.check("marieke-buoy", t0 + 61_000);
    expect(afterRollOff.allowed).toBe(true);
  });

  it("fires the hour cap independently of the minute cap", () => {
    const rl = new ProxyRateLimiter(10_000, 5);
    const t0 = 4_000_000;
    for (let i = 0; i < 5; i++) {
      expect(rl.check("marieke-buoy", t0 + i * 1000).allowed).toBe(true);
    }
    const blocked = rl.check("marieke-buoy", t0 + 6000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("hour");
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("uses the documented production defaults", () => {
    expect(DEFAULT_PER_MINUTE).toBe(60);
  });
});

// ----- Provider resolver -----

describe("Stage 19 — provider resolver", () => {
  const original = process.env.LLM_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  });

  it("defaults to perplexity when LLM_PROVIDER is unset", () => {
    delete process.env.LLM_PROVIDER;
    expect(currentProvider()).toBe("perplexity");
    expect(DEFAULT_PROVIDER).toBe("perplexity");
  });

  it("lower-cases the env var", () => {
    process.env.LLM_PROVIDER = "PERPLEXITY";
    expect(currentProvider()).toBe("perplexity");
  });

  it("getProxyAdapter resolves Perplexity", () => {
    process.env.LLM_PROVIDER = "perplexity";
    expect(() => getProxyAdapter()).not.toThrow();
  });

  it("getProxyAdapter throws for an unknown provider", () => {
    process.env.LLM_PROVIDER = "definitely-not-real";
    expect(() => getProxyAdapter()).toThrow(/Unsupported LLM_PROVIDER/);
  });
});

// ----- Route module wiring + security source-text guards -----

describe("Stage 19 — routes module wiring", () => {
  it("server/routes.ts imports and calls registerLLMProxyRoutes", () => {
    expect(TOP_ROUTES_SRC).toContain(
      'import { registerLLMProxyRoutes } from "./llm-proxy-routes"',
    );
    expect(TOP_ROUTES_SRC).toContain("registerLLMProxyRoutes(app)");
  });

  it("the chat route enforces all three gates in order", () => {
    // Order matters: loopback first, then sibling ID, then secret. If any
    // future refactor reverses these, this guard fails. We slice from the
    // POST /api/llm/chat handler onwards so imports and helper declarations
    // earlier in the file don't fool indexOf.
    const handlerStart = ROUTES_SRC.indexOf('app.post("/api/llm/chat"');
    expect(handlerStart).toBeGreaterThan(0);
    const handlerSlice = ROUTES_SRC.slice(handlerStart);
    const idxLoopback = handlerSlice.indexOf("isLoopbackIp(req.ip)");
    const idxIdLookup = handlerSlice.indexOf("isKnownSiblingId(");
    const idxSecret = handlerSlice.indexOf("secretsMatch(");
    expect(idxLoopback).toBeGreaterThan(0);
    expect(idxIdLookup).toBeGreaterThan(idxLoopback);
    expect(idxSecret).toBeGreaterThan(idxIdLookup);
  });

  it("never logs message content, response text, or secret header values", () => {
    // The log helper is the only console.log in the module. Confirm it
    // never receives messages, text, or x-sibling-auth values.
    expect(ROUTES_SRC).not.toMatch(/logLine\([^)]*messages/);
    expect(ROUTES_SRC).not.toMatch(/logLine\([^)]*\.fullText/);
    expect(ROUTES_SRC).not.toMatch(/logLine\([^)]*x-sibling-auth/i);
    // Defence against an accidental console.log of the body or secret.
    expect(ROUTES_SRC).not.toMatch(/console\.log\([^)]*req\.body/);
    expect(ROUTES_SRC).not.toMatch(/console\.log\([^)]*x-sibling-auth/i);
  });

  it("rate-limits AFTER auth so anonymous probes can't drain the bucket", () => {
    const idxSecret = ROUTES_SRC.indexOf("secretsMatch(");
    const idxRate = ROUTES_SRC.indexOf("proxyRateLimiter.check(");
    expect(idxSecret).toBeGreaterThan(0);
    expect(idxRate).toBeGreaterThan(idxSecret);
  });

  it("/health is loopback-only and never exposes the key or env-var names", () => {
    const healthBlock = ROUTES_SRC.match(
      /app\.get\("\/api\/llm\/health"[\s\S]*?\}\);/,
    );
    expect(healthBlock).not.toBeNull();
    const block = healthBlock![0];
    expect(block).toContain("isLoopbackIp");
    // No env-var leakage.
    expect(block).not.toMatch(/process\.env\./);
    expect(block).not.toMatch(/PERPLEXITY_API_KEY/);
    expect(block).not.toMatch(/PROXY_SECRET/);
  });
});

// ---------------------------------------------------------------------------
// Stage 19 follow-up (2026-05-19) — auth.ts allowlist regression guard.
//
// The Stage 19 spec assumed `requireAuth` would simply not match `/api/llm/*`
// because it's a separate router. In reality, `requireAuth` is a global
// middleware that intercepts every `/api/*` path that isn't allowlisted, and
// returns `401 {"error":"auth required"}` before the proxy gates ever run.
//
// Discovered during the initial VPS rollout: anonymous loopback probes to
// /api/llm/health returned 401 with `{"error":"auth required"}` instead of
// the expected `{"error":"forbidden"}`. Fixed by adding `/api/llm/` to
// SYNC_ALLOWLIST_PREFIXES in server/auth.ts. The proxy's own gates
// (loopback + X-Sibling-Id + X-Sibling-Auth) take over from there.
//
// These tests guard against the allowlist entry being removed in a future
// auth refactor (which would silently break the proxy again).
// ---------------------------------------------------------------------------

import { isAllowlistedPath } from "../server/auth";

describe("Stage 19 — auth.ts allowlist for /api/llm/*", () => {
  it("/api/llm/chat is allowlisted (proxy enforces its own gates)", () => {
    expect(isAllowlistedPath("/api/llm/chat")).toBe(true);
  });

  it("/api/llm/health is allowlisted", () => {
    expect(isAllowlistedPath("/api/llm/health")).toBe(true);
  });

  it("future /api/llm/* routes are also allowlisted by the prefix match", () => {
    expect(isAllowlistedPath("/api/llm/chat/stream")).toBe(true);
    expect(isAllowlistedPath("/api/llm/models")).toBe(true);
  });

  it("does NOT allowlist sibling paths that look similar but aren't /api/llm/", () => {
    expect(isAllowlistedPath("/api/llmx/chat")).toBe(false);
    expect(isAllowlistedPath("/api/llm")).toBe(false); // no trailing slash, not the prefix
    expect(isAllowlistedPath("/api/anything-else")).toBe(false);
  });

  it("does NOT regress other guarded paths", () => {
    // Sanity: things that should still require auth.
    expect(isAllowlistedPath("/api/tasks")).toBe(false);
    expect(isAllowlistedPath("/api/coach/turn")).toBe(false);
  });
});
