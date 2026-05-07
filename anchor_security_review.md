# Anchor Pre-Publish Security Review

**Date:** 2025-05-05  
**Project:** `/home/user/workspace/anchor`  
**Context:** Oliver Daly's personal ADHD-friendly task/morning-routine/calendar webapp. Single-user, private. Express + SQLite backend, React/Vite frontend. Bearer-token auth with `?t=<token>` query-string fallback (known constraint: proxy strips `Authorization` headers). External integrations (MS To Do, Outlook, GitHub, ICS) driven by cron jobs outside the published sandbox.

---

## Security Review Results

### BLOCK (must fix before publishing)

*No BLOCK findings.*

---

### WARN (inform user, let them decide)

**W1 — Three unauthenticated GET endpoints expose Oliver's data without any auth**

- `GET /api/sync/queue` — `server/routes.ts:511` — No session check, no orchestrator secret check. Returns the last 50 sync queue items (action type, JSON payload, error text). Listed in `SYNC_ALLOWLIST_PREFIXES` to allow cron access, but the GET has no guard inside. Any unauthenticated HTTP client can call this on the published URL.
- `GET /api/inbox/suggestions` — `server/routes.ts:595` — No session check, no orchestrator check. Returns all inbox scan items including **email subjects, from-addresses, received timestamps, and AI-suggested actions**. Moderate sensitivity — Oliver's email metadata is readable by anyone who knows the URL.
- `GET /api/inbox/count` — `server/routes.ts:600` — No session check. Returns `{ pending: N }`. Low sensitivity (just a count), but leaks that inbox scanning is running.

  **Suggested fix:** Add `if (!requireOrchestrator(req, res)) return;` to each of these three GET handlers. The cron/orchestrator already sends `x-anchor-sync-secret` for POST calls; it can do the same for GETs. Alternatively, move them out of the `SYNC_ALLOWLIST_PREFIXES` so `requireAuth` catches them — the in-browser client already sends a session token.

---

**W2 — `ANCHOR_SYNC_SECRET` unset causes open-door on all sync/inbox POST endpoints**

- `server/routes.ts:44-47` — `requireOrchestrator()` returns `true` (passes) when `ANCHOR_SYNC_SECRET` env var is not set (`if (!SYNC_SECRET) return true`). If the env var is not injected at startup in the published sandbox, **all** `/api/sync/*` and `/api/inbox/suggestions` POST endpoints are fully unauthenticated.
- The same applies to `/api/sync/request` and `/api/inbox/suggestions/:id/approve|dismiss`, which rely on `SYNC_SECRET` being truthy before even checking the header (lines 491, 606, 626).
- The code logs a `console.warn` at boot, but this is silent in production logs unless monitored.

  **Suggested fix:** Confirm `ANCHOR_SYNC_SECRET` is provided in the `publish_website` credentials/env or runtime env injection. Consider making the code **fail-closed** in production: `if (IS_PROD && !SYNC_SECRET) { res.status(503).json({ error: 'misconfigured' }); return false; }`.

---

**W3 — `?t=<token>` is appended to every API request URL**

- `client/src/lib/queryClient.ts:37-43` — `withAuthQuery()` appends `?t=<token>` to every API fetch URL. The token is a 32-byte hex session token stored in `localStorage`.
- This means the token appears in: (a) browser network logs / DevTools HAR exports, (b) server-side access logs if anything logs `req.url` or `req.originalUrl` (vite.ts uses `req.originalUrl` in dev), (c) `Referer` headers on any outbound requests initiated after an API call (mitigated because the app is hash-routed and makes API requests, not navigations).
- This is the **known architectural constraint** (proxy strips `Authorization`/cookies). The risk is low for a private single-user app — the token is long-lived (90 days) and stored in localStorage anyway, so the exposure surface is similar.
- `Authorization: Bearer` and `X-Anchor-Token` headers are also sent simultaneously and work in contexts that don't strip them.

  **Suggested fix (optional):** Set a `Referrer-Policy: no-referrer` header on API responses, so the token doesn't leak via `Referer` on any server-to-third-party requests. This is a one-liner in the Express middleware chain.

---

**W4 — `revokeAllSessions(exceptToken)` has a logic bug (non-security, data correctness)**

- `server/auth.ts:122-132` — When `exceptToken` is provided, the code first sets `revokedAt` on ALL active sessions (including the one to keep), then tries to restore the kept session by setting `revokedAt = null`. If the kept session was already `revokedAt != null` (already revoked), the restore step will erroneously un-revoke it. Also, the first `update` uses `.where(and(isNull(...)))` which is correct, but the restore has a race window.
- Not a security issue for single-user/single-session use, but "Sign out all other devices" could misbehave.

  **Suggested fix:** Revoke all sessions *except* the kept one in a single query: `.where(and(isNull(authSessions.revokedAt), ne(authSessions.tokenHash, exceptHash)))`.

---

### PASS

- **Dependency audit:** `npm audit` reports 0 vulnerabilities (0 critical, 0 high, 0 moderate, 0 low).

- **Hardcoded secrets in source:** No API keys, tokens, or passwords hardcoded in `server/`, `client/`, `shared/`, or `script/`. `ANCHOR_SYNC_SECRET` and `ANCHOR_ICS_URL` are read exclusively via `process.env.*` — never inlined.

- **Hardcoded secrets in `dist/index.cjs`:** Only `process.env.ANCHOR_SYNC_SECRET` and `process.env.ANCHOR_ICS_URL` references appear — no actual values baked in. Confirmed with regex scan for known secret patterns (OpenAI `sk-`, AWS `AKIA`, GitHub `ghp_`, Slack `xox*`, JWT `eyJ`, etc.).

- **Hardcoded secrets in `dist/public/` frontend bundles:** Clean scan — no secret patterns found in any JS asset.

- **`.env` files:** No `.env` or `.env.*` files present in the project (correctly excluded by `.gitignore`). `.env.example` not present (minor — would be helpful documentation but not a security issue).

- **`call_external_tool` / `api_credentials` / `llm-api` in runtime backend:** Zero occurrences in `server/` source and confirmed 0 occurrences in compiled `dist/index.cjs`. The `openai` and `@google/generative-ai` packages appear in the esbuild allowlist template (copied from the webapp template) but are not imported anywhere in server code and are not bundled.

- **Supabase:** `@supabase/supabase-js` is in `package.json` as a dependency but is not imported in any server file. It will be bundled into the tarball but poses no runtime risk since it's never instantiated.

- **CORS:** No `cors()` middleware or `Access-Control-Allow-Origin: *` headers found anywhere in the Express app. CORS is absent (default browser same-origin restrictions apply). No concern.

- **Cookie name — `__Host-` prefix:** Correctly implemented. In production (`NODE_ENV=production`), the cookie is named `__Host-anchor-sid` with `secure: true`, `sameSite: 'none'`, `path: '/'`. This satisfies the pplx.app proxy requirement that strips non-`__Host-` cookies. In development it falls back to `anchor-sid` (no `__Host-` needed in non-secure contexts). Confirmed present in `dist/index.cjs`.

- **Auth gate coverage:** `requireAuth` middleware is registered before all routes. Only explicitly allowlisted paths bypass it. The allowlist is intentional and documented inline. Login rate limiting (5 failures / 10 min / IP) is implemented in `server/auth-routes.ts`.

- **SQL injection:** All database access uses Drizzle ORM with parameterized queries (`eq()`, `and()`, `gte()`, etc.). No raw string interpolation into SQL found. User input entering database operations is validated via Zod schemas (`insertTaskSchema.safeParse(req.body)` pattern).

- **XSS — `dangerouslySetInnerHTML`:** Found one usage in `client/src/components/ui/chart.tsx:81`. The injected HTML is constructed entirely from `config` (developer-supplied theme colors and CSS variable names) and the `id` prop (`chart-${id}`). Neither the `id` nor the color values come from user-submitted data — `ChartContainer` is not used in any page component in this project. Not exploitable.

- **Multi-tenant data isolation:** This is a single-user app on a single SQLite database. There are no user IDs, row-level permissions, or tenant separation concerns. Oliver's data cannot leak to other pplx.app tenants because the published sandbox is isolated per `site_id`.

- **Token in URL (page navigation):** Uses hash-based routing (`wouter/use-hash-location`). Page navigation URLs do not change (always `https://<subdomain>.pplx.app/#/...`). The `?t=<token>` is only appended to individual API fetch requests, not to the page URL in the browser bar or history.

- **Access log token exposure:** The logging middleware (`server/index.ts:44-62`) logs `req.path` (path only, no query string) plus the JSON response body. `?t=` tokens do NOT appear in server access logs.

- **`vite.ts` (`req.originalUrl`):** Only runs in development mode (`process.env.NODE_ENV !== 'production'`), not in the published production build. No production token leak via this path.

---

## Summary

**No blocking issues.** The app is safe to publish with the following caveats:

| Priority | Finding | Action |
|----------|---------|--------|
| High | W1: Three unauthenticated GETs expose sync queue and email metadata | Add `requireOrchestrator()` to those handlers before publishing |
| High | W2: Sync/inbox endpoints fully open if `ANCHOR_SYNC_SECRET` not set | Confirm env var is injected at publish time |
| Low | W3: Token in API request URLs | Optional: add `Referrer-Policy: no-referrer` header |
| Low | W4: `revokeAllSessions` logic bug | Fix before "sign out all devices" feature is used |

**W1 is the most actionable** — it should be fixed in source before publishing since it exposes email metadata regardless of whether `ANCHOR_SYNC_SECRET` is set.
