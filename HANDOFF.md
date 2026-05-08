# Handoff notes — Anchor

Living document. Append new entries at the top. Each entry: date (AEST), thread summary, status, follow-ups.

---

## 2026-05-08 (22:25 AEST) — Sidebar reorder + Admin consolidation + Settings fix DEPLOYED

**Status:** Live on https://anchor-jod.pplx.app, bundle `index-CuxQmtbn.js`. Commit `2357416` on `main`. tsc clean (pre-build hook).

**What changed**

1. **Settings blank-page fix** — root cause: `GET /api/travel-locations` returns `{locations: TravelLocation[]}` but `Settings.tsx > TravelLocationsSection` typed the response as `TravelLocation[]` and called `.map`, which threw on the wrapper object and blanked the whole page. Now defensively unwraps `Array.isArray(q.data) ? q.data : q.data?.locations ?? []`. Also dropped the unused `domainLabel` import.
2. **Sidebar nav reorder + dividers** — new order per user spec: Coach, Capture | Today, Calendar, Morning, Reflect, Review | Priorities, Email Status, Projects, Issues, Habits | Admin. Three dividers, drawn as a horizontal `bg-sidebar-border` rule on md+ and a thin vertical separator inside the horizontal mobile scroller. `NavItem` is now a discriminated union (`{href, label} | {divider: true}`).
3. **Admin consolidation** — Admin / Usage / Settings merged into a single `/admin` page using a `Tabs` component (Radix `tabs.tsx` already in the design system). Tabs are Health (the previous Admin dashboard, lifted into a `<HealthDashboard />` inner component), Usage (renders the existing `<Usage />` page verbatim), Settings (renders the existing `<SettingsPage />` verbatim).
4. **Tab state in URL** — active tab is mirrored in `?tab=health|usage|settings` (using `replaceState` so back-history isn't polluted), and `hashchange` keeps tabs in sync when the user uses browser back/forward. Default tab is Health (no query string).
5. **Legacy route redirects** — `/settings` → `/admin?tab=settings`, `/usage` → `/admin?tab=usage`. Implemented as tiny `SettingsRedirect` / `UsageRedirect` components in `App.tsx` that call `navigate(…, {replace: true})` from `useLocation`.
6. **Wouter hash hook wrapper** — created `useHashLocationStripQuery` so wouter's route matcher sees `/admin` regardless of any `?tab=…` suffix on the hash. Otherwise `<Route path="/admin">` wouldn't match `#/admin?tab=settings` and the redirect would dead-end on NotFound.
7. **MorningGuard** updated to also skip the auto-redirect on `/admin` (the consolidated page absorbs the old `/settings` skip).

**Smoke tests (live, post-publish)**
- Bundle `index-CuxQmtbn.js` returns 200 with `content-type: text/javascript` ✓
- `/api/admin/health` 200 ✓
- `/api/travel-locations` returns `{locations:[…]}` (server unchanged) ✓
- Headless playwright loaded `#/settings` and `#/admin?tab=usage` with **zero console errors and zero pageerrors** — confirms the Tabs wiring, the wrapper hook, and the redirect logic do not throw at import time ✓
- Pre-build typecheck hook fired and passed ✓

**Files modified (commit 2357416, 4 files, 168+/31-)**
- `client/src/App.tsx` — `useHashLocationStripQuery` wrapper, `SettingsRedirect` + `UsageRedirect` components, `/settings` and `/usage` routes now point to redirect components, MorningGuard ignores `/admin`, `Router` now uses the wrapper hook
- `client/src/components/Layout.tsx` — nav becomes a discriminated `NavItem[]` with `{divider:true}` rows; new render branch draws a separator; usage/settings nav links removed; reorder per spec
- `client/src/pages/Admin.tsx` — default export is now a tabbed shell (Health/Usage/Settings) with hash-query-mirrored tab state; previous dashboard body extracted into a private `<HealthDashboard />` component
- `client/src/pages/Settings.tsx` — unwrap `{locations}` shape; remove unused import

**Notes / open items**
- Capture vs Quick capture: `/capture` is the full Capture page. The sidebar's "Quick capture" button is just a navigation shortcut (`window.location.hash = "#/capture"`) — it opens the same page, no separate quick-entry flow. Worth deciding later whether to drop the duplicate or convert it into a real one-tap modal.
- Settings was hitting the old `/settings` route via the sidebar link; now bookmarks/links to `/settings` and `/usage` continue to work but land on the new consolidated page with the right tab pre-selected.
- Standing rules respected: no cron changes, no data.db edits, no security re-review, secrets only read from `.secrets/`.

---

## 2026-05-08 (22:05 AEST) — Coach polish v2 + admin dashboard + CI gate DEPLOYED

**Status:** Live on https://anchor-jod.pplx.app, bundle `index-Dr3g4p9S.js`. Commit `6859eed` on `main`. TypeScript still strict-clean and now enforced via pre-build hook. Standing rules respected: skipped security review; no cron changes; no data.db edits.

**What changed**

1. **Drizzle type cleanup** — removed all 5 remaining `as any` casts in `server/coach-routes.ts` around `deepThink` / `archivedAt` reads/writes. `npx tsc --noEmit` clean.
2. **tsc CI gate** — `package.json` adds `"typecheck": "tsc --noEmit"`. `script/build.ts` runs typecheck via `spawnSync` before bundling and aborts on non-zero exit. Escape hatch: `SKIP_TYPECHECK=1 npm run build`.
3. **Boot-time auto-archive logging** — already gated on `archived > 0` (only logs when something was actually archived). Verified, no edit required.
4. **Coach session search (FTS5)** — new virtual table `coach_sessions_fts` (porter unicode61 tokenizer) over coachSessions.summary; AI/AU/AD triggers keep it in sync; one-shot `backfillCoachSessionsFts()` runs at boot (logs only when n>0). New endpoint `GET /api/coach/sessions/search?q=…&limit=20` returns `{q, hits:[{id, modelName, mode, status, startedAt, endedAt, snippet}]}`. Registered BEFORE `/:id` to avoid route collision. Quoted-token query construction tolerates arbitrary input.
5. **Context-bundle preview modal at session start** — `Coach.tsx` `startSession` now creates the session, fetches the detail (which includes `contextBundle`), and pops a `Dialog` with a per-section read-only preview (`BundlePreview` + `Section` + `Empty` components) before the user starts typing. Confirm activates the session; cancel deletes/archives it.
6. **New anchor-action kinds** — `applyAction` in `Coach.tsx` now handles `repeat_last_top3` (clones the most recent locked top-three to today) and `swap_in_underworked_project` (lock today's slot to a task from the lowest-time-spent active project). Plan-mode instructions in `coach-context.ts` updated: discriminator is now `kind` (not `type`); examples for the two new kinds. Client supports BOTH new payload shape (`taskIds`, `issueId`+`fields`) and legacy (`items`, `id`+`patch`) for backwards compatibility with old transcripts.
7. **`/api/admin/health` endpoint** — added to `server/admin-db.ts`. Returns `{db: {sizeBytes, importEnabled}, backups: {readable, count, latestMtime?, note?}, crons: [{id, cron, description, dstNote?}]}`. Auth: accepts EITHER user cookie OR `X-Anchor-Sync-Secret` (new optional `requireUserOrOrchestrator` param threaded through `registerAdminDbRoutes` from `routes.ts`). Crons list is a static `KNOWN_CRONS` const because the published sandbox can't run `pplx-tool`; UI explains this.
8. **`/admin` dashboard page** — new `client/src/pages/Admin.tsx` (read-only). Three cards (DB / Backups / Crons) + Refresh button, uses standard react-query client. Wired into `App.tsx` route + Layout.tsx nav link.

**Smoke tests (live, post-publish)**
- `GET /api/admin/health` → 200, db.sizeBytes=479232, importEnabled=false, backups.readable=false (expected — Computer-side fs only), crons[0].id="8e8b7bb5" ✓
- `GET /api/coach/sessions/search?q=top` → 200, `{q:"top", hits:[]}` (no summaries yet on existing sessions, expected) ✓
- `GET /api/admin/db/status` → 200, db.exists=true ✓
- Pre-build typecheck hook fired and passed during `npm run build` ✓

**Files modified (commit 6859eed, 11 files, 848+/31-)**
- `client/src/App.tsx` — `/admin` route + lazy import
- `client/src/components/Layout.tsx` — Admin nav link
- `client/src/pages/Coach.tsx` — pendingSession state + bundle preview modal + BundlePreview/Section/Empty components + search box + searchQ query + new applyAction kinds + canonical `kind`+payload (taskIds/issueId/fields) with legacy fallback
- `client/src/pages/Admin.tsx` (NEW, 236 lines)
- `package.json` — `typecheck` script
- `script/build.ts` — pre-build typecheck via spawnSync
- `server/admin-db.ts` — `/api/admin/health` + optional `requireUserOrOrchestrator` 3rd param
- `server/coach-context.ts` — PLAN_MODE_INSTRUCTIONS updated: `kind` discriminator + repeat_last_top3 + swap_in_underworked_project examples
- `server/coach-routes.ts` — 5x `as any` removed; `/api/coach/sessions/search` endpoint placed before `/:id`
- `server/routes.ts` — passes `requireUserOrOrchestrator` to `registerAdminDbRoutes`
- `server/storage.ts` — FTS5 virtual table + AI/AU/AD triggers, `searchCoachSessions(q, limit=20)`, `backfillCoachSessionsFts()`, boot-time backfill (n>0 only)

**Follow-ups / open items**
- DST retune Sun 5 Oct 2026 — still pending (unchanged from previous entry).
- Backup verification on first cron run Sun 10 May — still pending (unchanged).
- Backups card on `/admin` shows `readable:false` from the published sandbox — that's by design; if a future need arises to surface backup status from the live site, a small Computer-side endpoint posting metadata to Anchor could fill the gap.

---

## 2026-05-08 (21:50 AEST) — Coach polish + ops hygiene DEPLOYED

**Status:** Live on https://anchor-jod.pplx.app, bundle `index-DX_YM7vp.js`. TypeScript now strict-clean (`tsc --noEmit` zero errors). Standing rules respected: skipped security review; no data.db edits beyond additive `coach_sessions` ALTER TABLE migrations; new weekly backup cron added with explicit user approval (cron id `8e8b7bb5`).

**What changed**

1. **Plan-mode latency fix** — plan now defaults to `sonar-pro` (~1.5s, was ~22s on `sonar-reasoning-pro`). Per-session opt-in **deep-think toggle** routes plan turns to `sonar-reasoning-pro` when the user wants deeper reasoning. Reflect mode unchanged (`sonar-pro`). Implemented in `server/coach-context.ts:modelForMode(mode, deepThink=false)` and wired through POST/PATCH `/api/coach/sessions` (`deepThink` body param) + `/turn` reads `session.deepThink` per call.
   - `GET /api/coach/health` now returns `{plan, planDeepThink, reflect}` (3 model fields).
2. **Context bundle additions** in `server/coach-context.ts:buildCoachContextBundle()`:
   - `lastWeekTimeSpentPerProject` — best-effort calendar matching against active projects over the last 7 days. Mirrors `/api/projects/top-paying-today` matching: case-insensitive substring on `summary+location+description`, project name needle ≥ 3 chars. Clips events to the last-7-days window so a long ongoing event doesn't over-attribute. Sorted by minutes desc, limit 10.
   - `recentTopThreeHistory` — last 7 days of locked top-three (oldest → newest), with task names + statuses resolved per slot. Backed by new `storage.listTopThreeBetween(fromYmd, toYmd)`.
   - Smoke-tested on session 16: bundle keys grew to 14, matched 1 medicolegal event for 60 minutes.
3. **Coach session retention (auto-archive > 90 days)**:
   - New schema columns on `coachSessions`: `deepThink integer NOT NULL DEFAULT 0` and `archivedAt integer NULL`. Additive ALTER TABLE migrations in `server/storage.ts`, idempotent.
   - New storage methods: `listTopThreeBetween`, `archiveCoachSession(id)` (drops messages + sets `archivedAt=Date.now()`), `autoArchiveOldCoachSessions(olderThanMs)` (only archives ENDED sessions where `archivedAt IS NULL` AND `startedAt <= cutoff`).
   - **Boot-time auto-archive** runs once after `export const storage = new Storage()` and BEFORE `seedDefaultHabitsIfNeeded()`. 90-day cutoff (`90 * 24 * 3600 * 1000`).
   - **Manual archive endpoint:** `POST /api/coach/sessions/:id/archive` — drops transcript, retains row + summary.
   - `/turn` now blocks archived sessions with **409** + clear error message ("Session is archived (transcript purged); start a new session to continue.").
4. **data.db weekly backup cron (NEW, approved):** uses the existing `GET /api/admin/db/export` endpoint (online SQLite backup API → consistent snapshot, not a JSON dump). Cron id `8e8b7bb5`, runs **Sun 03:00 AEST = `0 17 * * 6` UTC**, exact=true, background=true. Saves to `/home/user/workspace/anchor-backups/anchor-YYYY-MM-DD.db`, uploads via the OneDrive connector (sharepoint fallback), prunes to last 12 weeks, silent on success, in-app notification on failure.
   - **DST follow-up:** Sun 5 Oct 2026 → AEDT cutover. Cron must be retuned to `0 16 * * 6` to stay at 03:00 Melbourne local. The cron's task body itself emits a one-line reminder in its success notification on/after that date so this doesn't get forgotten. Do not retune without explicit user approval (standing rule).
5. **Pre-existing TS errors fixed (all 5):**
   - `client/src/pages/CalendarPlanner.tsx:733` — wrapped `map.values()` in `Array.from()`; line 735 — typed sort callback as `(a: CellEntry, b: CellEntry)`.
   - `server/routes.ts:1196,1221` — added `createdAt: Date.now()` to `createProjectPhase` and `createProjectComponent` payloads.
6. **Coach.tsx UI** — deep-think checkbox (visible only in plan mode, hidden when archived), Archive button (with confirm: "transcript will be removed but the summary is kept"), "archived" badge in both the session rail and session header, composer disabled with explanatory message on archived sessions, mode toggles + End/summarise disabled when archived. Session list and detail responses now include `deepThink` + `archivedAt`.

**Smoke tests (live)**
- `/api/coach/health` → `{plan:"sonar-pro", planDeepThink:"sonar-reasoning-pro", reflect:"sonar-pro"}` ✓
- Create plan session deepThink=false → modelName=`sonar-pro` ✓
- PATCH deepThink=true → modelName recomputed to `sonar-reasoning-pro` ✓
- POST /sessions/:id/archive → archivedAt=1778240436139 ✓
- POST /turn on archived session → HTTP 409 with correct error body ✓
- New context-bundle keys present and populated (lastWeekTimeSpentPerProject, recentTopThreeHistory) ✓
- /api/admin/db/status → existing DB online (479232 bytes, importEnabled=false) ✓
- All test sessions cleaned up after smoke test.

**Files modified**
- `shared/schema.ts` — `coachSessions`: added `deepThink`, `archivedAt`
- `server/storage.ts` — 2 ALTER TABLE migrations; 3 new methods (`listTopThreeBetween`, `archiveCoachSession`, `autoArchiveOldCoachSessions`); boot-time auto-archive call
- `server/coach-context.ts` — `modelForMode(mode, deepThink=false)`; bundle interface + builder extended; helpers for project-time matching and top-three history
- `server/coach-routes.ts` — `/health` shape change, POST /sessions accepts deepThink, PATCH /sessions accepts deepThink (recomputes modelName), NEW POST /sessions/:id/archive, /turn 409-on-archived + reads session.deepThink, list endpoint exposes deepThink + archivedAt
- `server/routes.ts` — createdAt added to createProjectPhase + createProjectComponent calls
- `client/src/pages/CalendarPlanner.tsx` — Array.from + typed sort callback (downlevelIteration fix)
- `client/src/pages/Coach.tsx` — deepThink state + toggle UI, archiveSession action + button, archived badge in rail and header, composer disabled when archived, mode/end disabled when archived; HealthResponse + CoachSessionRow + CoachSessionDetail interfaces extended

**Follow-ups / open items**
- **DST retune** Sun 5 Oct 2026 — cron `8e8b7bb5` from `0 17 * * 6` to `0 16 * * 6`. Reminder is baked into the cron's own task body.
- Feature 4 (deferred weekly coach prompt) still parked — revisit ~2026-05-22 once 1-2 weeks of Feature 1+2 telemetry exist.
- Backup verification: after the first cron run on Sun 10 May, manually confirm the OneDrive file landed and `pragma integrity_check` passes on the snapshot. The Computer-side cron will report failures via in-app notification but a one-time successful verify is cheap insurance.

---

## 2026-05-08 (21:30 AEST) — Feature 5 DEPLOYED — Coach page (Sonar plan + reflect, persistent + auto-summarised)

**Status:** Live on https://anchor-jod.pplx.app, bundle `index-BMs2zHHC.js`. Standing rule respected: skipped security review. No cron changes. No data.db edits beyond additive `coach_sessions` + `coach_messages` migrations done in Feature 5 schema phase. Both modes smoke-tested live. Plan-mode latency ~22s (sonar-reasoning-pro), reflect-mode ~1.5s (sonar-pro).

**Backend additions**
- `server/baked-llm-keys.ts` (gitignored) — baked Perplexity key for AUPFHS org account. Read at boot via `BAKED_PERPLEXITY_KEY` constant; environment override `PERPLEXITY_API_KEY` honoured first.
- `server/llm/adapter.ts` (NEW) — provider-agnostic `LLMAdapter` interface with `streamChat()` and `complete()`. Includes `disableSearch?: boolean` on `StreamRequest` for Sonar grounding control.
- `server/llm/perplexity.ts` (NEW) — `PerplexityAdapter` calling `https://api.perplexity.ai/chat/completions`. Both streaming SSE parser (`parseSSE`) and non-streaming `complete()` paths. `buildBody()` honours `disable_search: true` when requested.
- `server/coach-context.ts` (NEW) — `buildCoachContextBundle()` produces a JSON snapshot (today YMD, recent daily factors, today's top-3, yesterday unfinished, open issues, available hours this week, weather hook). `bundleForModel()` strips `availableHoursDetail` and trims daily factors to last 3 to keep system prompt < ~3KB. `detectCrisisLanguage()` matches 10 patterns (suicidal ideation, self-harm, hopelessness keywords) and returns canned `CRISIS_RESPONSE` (Lifeline 13 11 14, 000, GP, Marieke, Beyond Blue 1300 22 4636). System prompts: `COMMON_PREAMBLE` + `PLAN_MODE_INSTRUCTIONS` + `REFLECT_MODE_INSTRUCTIONS`. **`buildSystemMessages()` returns ONE combined system message** — sonar-reasoning-pro otherwise treats a separate context-bundle system row as something to ignore in favour of (now-disabled) web search.
- `server/coach-routes.ts` (NEW) — 8 endpoints registered via `registerCoachRoutes({app, requireUserOrOrchestrator, getMergedPlannerEvents, computeAvailableHoursThisWeek})`:
  - `GET /api/coach/health` — `{available, provider, models:{plan, reflect}}`
  - `GET /api/coach/sessions?limit=N` — list recent sessions
  - `GET /api/coach/sessions/:id` — full detail (messages + summary + bundle)
  - `POST /api/coach/sessions` — start session, returns `{session, bundle}`
  - `PATCH /api/coach/sessions/:id` — mode/linked-issue update
  - `DELETE /api/coach/sessions/:id` — hard delete (cascade)
  - `POST /api/coach/sessions/:id/turn` — send user msg; SSE-stream assistant reply
  - `POST /api/coach/sessions/:id/end` — end + generate summary
  - `PATCH /api/coach/sessions/:id/summary` — user-edit summary (sets `summaryEditedByUser=1`)
- `server/routes.ts` — wired `registerCoachRoutes` import + call right before `return httpServer`.

**Critical implementation notes (do NOT regress)**
1. **`/turn` is non-streaming**, not SSE-streaming. Published-sandbox proxy buffers upstream Sonar SSE chunks and the connection hangs forever. Implementation: `await llm.complete(...)` then emit full text as a single `event: delta` followed by `event: done`. Wire format kept SSE so the React client and a future true-streaming upgrade need no client changes. Crisis path is purely synchronous `res.write` so it's unaffected.
2. **Always-persist-assistant pattern.** `req.on('close')` fires under HTTP/2 over Cloudflare even on normal completion, setting `aborted=true`. The assistant message is appended to storage **before** any `if (!res.writableEnded)` check, so transcripts never lose a turn even if the SSE write fails.
3. **`<think>...</think>` strip.** sonar-reasoning-pro emits a reasoning preamble in `<think>` tags before the actual answer. Per Perplexity docs, `response_format` does NOT remove these. `stripThinkTags()` in `coach-routes.ts` strips them with regex `/<think>[\s\S]*?<\/think>\s*/gi` from BOTH the turn output and the end-summary output before persisting and emitting.
4. **`disable_search: true` on every coach request.** The coach is grounded in the supplied bundle, not the open web. Without this flag, sonar-reasoning-pro performed real web searches and used the search results in lieu of (or in addition to) the system context. Applied for plan, reflect, AND summary calls.
5. **Models.** plan → `sonar-reasoning-pro`, reflect → `sonar-pro`, summary → `sonar-pro`. Defined in `coach-context.ts` (`modelForMode()`, `SUMMARY_MODEL`).
6. **Crisis terms** trigger `CRISIS_RESPONSE` immediately; the LLM is not called and no `<think>` strip is needed there. Verified working.

**UI additions**
- `client/src/pages/Coach.tsx` (NEW, 729 lines) — mode toggle (plan/reflect), SSE consumption via `fetch` with `getReader()` (handles `: ping`, `event: delta`, `event: done`, `event: error`, `event: crisis`), context rail showing today's bundle, summary editor modal, delete-session button with confirm, crisis card display, anchor-action confirm UI for `top3_candidate` (PUT /api/top-three) and `issue_patch` (PATCH /api/issues/:id) blocks the model emits.
- `client/src/App.tsx` — added Coach route at `/coach`.
- `client/src/components/Layout.tsx` — added Coach nav between Reflect and Review.
- `client/src/lib/queryClient.ts` — exported `buildApiUrl(path)` and `buildAuthHeaders(extra)` for SSE fetch.

**Smoke tests (live)**
- `GET /api/coach/health` → `{available:true, provider:"perplexity", models:{plan:"sonar-reasoning-pro", reflect:"sonar-pro"}}`
- Plan turn: `"What should my top 3 today be?"` → `"No open tasks to rank. You're 9 hours into the evening in couple time, with Marieke's physio at 10. Looking to plan tomorrow or next week instead?"` (22s, grounded in context bundle, no `<think>` leakage, no web search noise).
- Reflect turn: `"I am tired. Just say hi briefly."` → `"Hi Justin. Tired sounds heavy today."` (1.5s, single Socratic line as designed).
- End/summary on reflect session → returns updated session with summary in 2.1s.
- Test sessions deleted after smoke test.

**Build recipe (CRITICAL)**
```
cd /home/user/workspace/anchor
SECRET=$(cat /home/user/workspace/.secrets/anchor_sync_secret)
printf 'export const BAKED_SYNC_SECRET = "%s";\n' "$SECRET" > server/baked-secret.ts
PPLX_KEY=$(cat /home/user/workspace/.secrets/perplexity_api_key)
printf 'export const BAKED_PERPLEXITY_KEY = "%s";\n' "$PPLX_KEY" > server/baked-llm-keys.ts
npm ci && npm run build
```
Both `server/baked-secret.ts` AND `server/baked-llm-keys.ts` must be regenerated before each build. Both gitignored.

**Pre-existing TS errors safe to ignore (5):** CalendarPlanner.tsx 733/735 (downlevelIteration), routes.ts 1196/1221 (createdAt missing on projects/components/tasks). Build still emits successfully.

**Follow-ups (none blocking, all optional)**
- Plan-mode latency is 20s+ due to sonar-reasoning-pro. If this feels too slow in daily use, consider switching plan mode to `sonar-pro` (drops `<think>` reasoning, faster).
- Coach.tsx is large (729 lines) — could be split into `Coach/MessageList`, `Coach/ContextRail`, `Coach/SummaryModal` if it grows further.
- Future: Anthropic adapter as v2. Adapter interface already in place in `server/llm/adapter.ts`.

---

## 2026-05-08 (20:15 AEST) — Feature 2 DEPLOYED — Project values (income + benefit + kudos)

**Status:** Live on https://anchor-jod.pplx.app, bundle `index-CgmvfR1g.js`. Standing rule respected: skipped security review. No cron changes. No data.db edits beyond additive `ALTER TABLE` migrations.

**Schema additions (`projects` table)**
- `current_income_per_hour` INTEGER nullable
- `future_income_estimate` INTEGER nullable
- `is_primary_future_income` INTEGER NOT NULL DEFAULT 0 (single-flag invariant enforced server-side)
- `community_benefit` INTEGER nullable (1–5)
- `professional_kudos` INTEGER nullable (1–5)

Auto-migrated on server boot via idempotent `ALTER TABLE … ADD COLUMN` alongside existing tasks-table migration block (`server/storage.ts`).

**API additions**
- `PATCH /api/projects/:id` extended to accept all 5 fields with range validation (rate 0–100000, future 0–100000000, sliders 1–5). Setting `isPrimaryFutureIncome=1` clears the flag on every other project in a single transaction.
- `GET /api/projects/values-summary` → `{totalActive, totalParked, scoredCurrentIncome, weightedAvgCurrentRate, primaryFutureIncome}`. Registered before `/:id`.
- `GET /api/projects/top-paying-today` → `{project, matchedEvent}`. Matches today's calendar events (via `getMergedPlannerEvents` + `eventsForDate`) against active projects with `currentIncomePerHour >= 300`, case-insensitive substring on event summary+location+description against project name (length ≥ 3). Returns the highest-rate match. Registered before `/:id`.

**UI additions**
- `client/src/lib/projectValues.ts` (new) — `formatAUDPerHour`, `formatAUDAnnualised` (compact ≥ $10K), `clampScore`. Uses `Intl.NumberFormat("en-AU")`.
- Projects page (`Projects.tsx`) — summary section (active count / weighted avg rate / primary project) + per-row values badges (rate, primary star, future estimate, benefit/kudos).
- Project detail (`ProjectDetail.tsx`) — Project values section: rate input (onBlur PATCH), future estimate + primary switch, two 0–5 sliders for community benefit and professional kudos. Sliders use **local draft state + `onValueCommit`** so dragging is smooth and the PATCH only fires on release (avoids spamming the server). Slider position 0 stores DB null ("unscored"), 1–5 stores literal score.
- Morning page (`Morning.tsx`) — "Top-paying today" pill rendered between sticky header and Reflect section, conditionally on `topPayingQ.data?.project`. Hovering shows the matched event summary.

**Smoke tests (live)**
- `GET /api/projects/values-summary` → `{totalActive:8, totalParked:2, scoredCurrentIncome:0, weightedAvgCurrentRate:null, primaryFutureIncome:null}` (initial state — no values seeded yet, awaiting user input).
- `GET /api/projects/top-paying-today` → `{project:null, matchedEvent:null}` (no rates set, so no match — expected).
- `PATCH /api/projects/8` with `{currentIncomePerHour:400, communityBenefit:4, professionalKudos:3}` → 200, fields persisted; `values-summary` recomputed to `{scoredCurrentIncome:1, weightedAvgCurrentRate:400}`. Reverted to nulls cleanly.
- Single-primary invariant verified: setting `isPrimaryFutureIncome=1` on project 1, then on project 5, leaves only project 5 flagged. Reverted.
- Bundle hash check: `curl -s https://anchor-jod.pplx.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'` → `index-CgmvfR1g.js` (live).

**Seed values (NOT applied yet — user to set in-app)**
Spec calls for: Medicolegal $400/hr, Elgin House $400/hr, Hospital lists $200/hr, AUPFHS = primary future-income (TBC value). Standing rule "don't touch data.db after extraction" applies — Oliver enters these via the Projects page rather than a seed script.

**Files changed (committed on main)**
- `shared/schema.ts`
- `server/storage.ts`
- `server/routes.ts`
- `client/src/lib/projectValues.ts` (new)
- `client/src/pages/Projects.tsx`
- `client/src/pages/ProjectDetail.tsx`
- `client/src/pages/Morning.tsx`
- `FEATURES_TODO.md` (Feature 2 marked done)

**Pre-existing TS errors (still safe to ignore)** — `CalendarPlanner.tsx` 705/707 and `routes.ts` ~1072/1097 (the latter shifted because Feature 2 added routes above). Verified by stash-and-recheck on `94eab07`: identical 5-error baseline. Build passes.

**Follow-ups carried over**
- Feature 1 (travel time, STATIC) still pending. Do NOT start without approval.
- Feature 5 (Coach page — plan + reflect, persistent + auto-summarised, Sonar adapter) spec only; implementation not started.
- Deferred bake-time fix for `AUPFHS_ICS_URL` / `ANCHOR_ICS_URL` (see 2026-05-08 16:20) still not folded in.

---

## 2026-05-08 (19:45 AEST) — Feature 5 BUGFIX DEPLOYED — `m.map is not a function` resolved

**Deploy succeeded**
- Fresh Computer task in this Life Management space had `publish_website` available (cached-capability bug from earlier today had cleared, as predicted by ticket `9a2f2c0a-7c54-4eb2-a1df-cd53f7823aac` and the standard "open a fresh task" workaround in CONTEXT.md / RECOVERY.md).
- `publish_website` returned `{status: "published", site_id: 77eb73a0-..., app_slug: anchor-jod, url: https://anchor-jod.pplx.app}` on first try.
- Built from main @ `1aa8752` (the bugfix commit). Build clean.
- Live frontend now serves `index-R1tlKsA8.js` (920.82 kB) + `index-d-ACTGzM.css` (81.21 kB) — confirmed by `curl -s https://anchor-jod.pplx.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.(js|css)'`. Old broken `index-BBkJT4Sl.js` is no longer served.
- Standing rule respected: skipped security review.

**Smoke test results**
- `GET /` → 200, serves new bundle.
- API endpoints behind sync secret, all 200:
  - `GET /port/5000/api/issues/this-week` → 200
  - `GET /port/5000/api/daily-factors/today` → 200
  - `GET /port/5000/api/available-hours/this-week` → 200
- Direct curl on SPA subroutes (`/today`, `/reflect`, `/review`, `/issues`) returns the static-host JSON 404 (`{"detail": "No static asset at /today..."}`). This is **expected** — the SPA serves all routes from `/` and the user reaches subroutes via in-app navigation. Not a regression.
- Browser smoke test (cloud) confirmed `/` loads cleanly to the passphrase login screen with no JS errors. Static analysis of the served bundle confirms all four affected components (`IssueList`, `IssuesThisWeek`, `DailyFactorsCard`, `WeeklyFactorsStrip`, `Issues.tsx`) now use `apiRequest` and have `Array.isArray()` guards before `.map()` / `.filter()` / spread. The `m.map is not a function` crash path is gone.

**Files changed in this deploy** — none beyond the 5 client files already committed in `1aa8752`. No schema, no routes, no server code, no cron changes.

**Follow-ups carried over (unchanged)**
- Pre-existing TS errors still safe to ignore: `CalendarPlanner.tsx` 705/707, `routes.ts` 935/960 (`createdAt` missing — build still works).
- Deferred bake-time fix for `AUPFHS_ICS_URL` / `ANCHOR_ICS_URL` (see 2026-05-08 16:20) still not folded in.
- `FEATURES_TODO.md` — Feature 1 (travel time, STATIC) and Feature 2 (project values) waiting. Explicitly DO NOT start without approval.

---

## 2026-05-08 (19:38 AEST) — Feature 5 BUGFIX (NOT YET DEPLOYED) — raw fetch → apiRequest

**Bug**
- Live pages (Today/Reflect/Review/Issues) crashed with `TypeError: m.map is not a function` after the 17:55 deploy.
- Root cause: 5 components added in Feature 5 used raw `fetch('/api/...')` in their `queryFn` instead of `apiRequest`. Raw `fetch` bypasses `__PORT_5000__` substitution — in production it hit `https://anchor-jod.pplx.app/api/...` (no such route, returns JSON 404) and the page parsed the 404 body as data, then `.map()` on an object crashed.
- Webapp template explicitly warns against this: "NEVER use raw `fetch()`. Raw `fetch()` bypasses `__PORT_5000__` URL rewriting and API calls will 404 after deployment." My mistake.

**Fix (committed locally, not yet on live)**
- `client/src/components/IssueList.tsx`, `IssuesThisWeek.tsx`, `DailyFactorsCard.tsx`, `WeeklyFactorsStrip.tsx`, `client/src/pages/Issues.tsx` — all converted to `apiRequest("GET", url)` and added `Array.isArray()` defensive guards before `.map()`/`.filter()` / spread.
- Mutations (`IssueQuickAdd`, `IssueRow`, `DailyFactorsCard`'s PATCH) were already using `apiRequest` and didn't need changes.
- New built bundle: `index-R1tlKsA8.js` (920.82 kB) + `index-d-ACTGzM.css` (unchanged). Built clean.

**Deploy blocked**
- `publish_website` returned `{"error":"Website publishing is not enabled"}` — same gating regression as diagnostic ticket `9a2f2c0a-7c54-4eb2-a1df-cd53f7823aac`.
- `deploy_website` succeeded but pushes to a different deployment URL (`https://www.perplexity.ai/computer/a/anchor-oliver-daly-HWSAYZTSST6ZF7IN70WMoA`) and does NOT update the `anchor-jod.pplx.app` subdomain bound to the original publish.
- Live site at `https://anchor-jod.pplx.app/` is still serving the broken `index-BBkJT4Sl.js` bundle. Filed second diagnostic ticket `fb8d387e-6105-4575-b9fc-c12469fb96a9` earlier today for the same gating regression.
- **In the meantime**: the broken pages remain broken on live. Use the deploy_website preview URL (above) for the fixed version, or wait for `publish_website` to come back so the fix can land at the canonical URL.

**Files changed (this commit)** — 5 client files only. No schema, no routes, no server code.

---

## 2026-05-08 (17:55 AEST) — Feature 5 LIVE — Mood/Factors + Issues Log

**Deploy succeeded**
- `publish_website` succeeded with `site_id=77eb73a0-...` — gating remains cleared (second successful publish this thread).
- Live frontend now serves `index-BBkJT4Sl.js` (920.7 kB) + `index-d-ACTGzM.css` (81.2 kB). Server bundle `dist/index.cjs` ~1.0 MB.
- Standing rule respected: security review skipped.

**What's new — schema** (`shared/schema.ts`, `server/storage.ts`)
- `daily_factors` table — UNIQUE per `date` (YYYY-MM-DD). Six nullable text columns: `mood`, `energy`, `cognitiveLoad`, `sleepQuality`, `focus`, `valuesAlignment`. `capturedAt`, `updatedAt` timestamps. Partial upsert via PATCH so users fill progressively.
- `issues` table — `category` (relationship | house | kids | work | other), `note` (≤200 chars), `needSupport` (0/1), `supportType` (listen | problem_solve | practical), `status` (open | ongoing | resolved), `resolvedYmd`, `sourcePage` (morning | reflect | issues), `createdYmd`, timestamps.
- Exported types: `DailyFactors`, `InsertDailyFactors`, `Issue`, `InsertIssue`.

**New endpoints** (`server/routes.ts`)
- `GET /api/daily-factors/today`
- `GET /api/daily-factors/:ymd` → `{date, factors}`
- `PATCH /api/daily-factors/:ymd` — partial upsert
- `GET /api/daily-factors?from=&to=` — range
- `GET /api/issues/this-week` → `{mondayYmd, sundayYmd, thisWeek, carriedOver}`
- `GET /api/issues?status=&from=&to=`, `GET /api/issues/:id`, `POST /api/issues`, `PATCH /api/issues/:id`, `DELETE /api/issues/:id`
- Route ordering: `/today` and `/this-week` placed before `/:ymd`/`/:id` to avoid Express path conflicts.

**Frontend wiring**
- New shared module `client/src/lib/factors.ts` — `FACTOR_MEASURES`, `ISSUE_CATEGORIES`, `SUPPORT_TYPES`, `ISSUE_STATUSES`, helpers.
- New components: `DailyFactorsCard` (compact|full), `IssueQuickAdd`, `IssueRow`, `IssueList`, `IssuesThisWeek`, `WeeklyFactorsStrip`.
- New page `client/src/pages/Issues.tsx` — full add+filter+list view. Route `/issues` registered in `App.tsx`. Nav link added in `Layout.tsx`.
- Wired into existing pages:
  - `Morning.tsx` — Mood&Factors compact after `01 Reflect`; Issues mini-section after `02 Braindump`.
  - `Today.tsx` — compact factors card + today's issues between If-time and Done today.
  - `Reflect.tsx` — full DailyFactorsCard + Issues add/list after daily reflection submit.
  - `Review.tsx` — `WeeklyFactorsStrip` (Mon–Sun icon table) and `IssuesThisWeek` (this-week + carried-over) after Available project time.

**Smoke test — all endpoints**
- POST/GET/PATCH/DELETE for both `/api/issues` and `/api/daily-factors` returned HTTP 200 with correct shapes.
- `GET /api/issues/this-week` returned `{mondayYmd: "2026-05-04", sundayYmd: "2026-05-10", thisWeek: [...], carriedOver: [...]}`.
- Test data cleaned up after smoke test (issues 1+2 deleted; daily_factors row for 2026-05-08 nulled).
- Regression: `GET /api/available-hours/this-week` still HTTP 200 — week 2026-W19, freeMinutes 2875, 19 deepWorkBlocks (unchanged from Feature 3 deploy).

**Follow-ups**
- Pre-existing TS errors still safe to ignore: `CalendarPlanner.tsx` 705/707, `routes.ts` 935/960 (`createdAt` missing — build still works).
- Deferred bake-time fix for `AUPFHS_ICS_URL` / `ANCHOR_ICS_URL` (see 2026-05-08 16:20) still not folded in.
- `FEATURES_TODO.md` has Feature 1 (travel time, STATIC) and Feature 2 (project values) waiting — explicitly DO NOT start without approval.

---

## 2026-05-08 (17:13 AEST) — Feature 3 LIVE — publish unblocked

**Deploy succeeded**
- `publish_website` returned `{status: "published", site_id: 77eb73a0-..., url: https://anchor-jod.pplx.app}` on the first try this thread (no error this time — the gating that blocked the previous three threads has cleared).
- Live frontend now serves `index-lCIIXRfQ.js` + `index-CwN8LvOx.css` (matches the freshly built bundle). Server bundle `dist/index.cjs` is 1022.2kb.
- Followed standing rule: skipped the security review.

**Smoke test — `GET /api/available-hours/this-week`**
HTTP 200, sensible numbers for Mon 2026-05-04 to Sun 2026-05-10 (week 2026-W19):
- `totalWakingMinutes`: 6720 (= 7 d × 16 h × 60, sleep 23:00–07:00 carved out correctly)
- `sleepMinutes`: 3360, `paidWorkMinutes`: 1115, `familyMinutes`: 1740, `otherCommittedMinutes`: 990
- `freeMinutes`: 2875
- `deepWorkBlocks`: 19 entries, all ≥30 min during waking hours

No unexpected output. Diagnostic ticket `9a2f2c0a-7c54-4eb2-a1df-cd53f7823aac` can be closed (or at least noted as resolved — the publish path is working again).

**Follow-ups (do NOT start in the deploy thread without explicit approval)**
- `FEATURES_TODO.md` has next-up specs: Feature 1 (travel time, STATIC) and Feature 2 (project values).
- Pre-existing TS errors flagged in the previous entry (`CalendarPlanner.tsx` 705/707, `routes.ts` 935/960) remain — still safe to ignore, build still works.
- Deferred bake-time fix for `AUPFHS_ICS_URL` / `ANCHOR_ICS_URL` (see 2026-05-08 16:20 entry) still not folded in.

---

## 2026-05-08 (17:05 AEST) — Feature 3 (available hours this week) — source merged, deploy STILL gated

**What changed (source only — NOT live yet)**
- New module `server/available-hours.ts` (348 lines): `computeAvailableHoursThisWeek(events, now)` returns Mon-Sun Melbourne breakdown — sleep 23:00-07:00, family/paid_work/other_committed event classification, deep-work blocks ≥30 min during waking hours.
- New endpoint `GET /api/available-hours/this-week` in `server/routes.ts`. Uses existing calendar fetch helpers; respects `[Personal]` AUPFHS tagging.
- New client component `client/src/components/AvailableHoursCard.tsx` (204 lines) — two variants: compact (Morning page) + detailed (Review page).
- Wired into `client/src/pages/Morning.tsx` (after Lock Priorities) and `client/src/pages/Review.tsx` (after Last 7 Days).
- `npm run build` succeeded — bundle hashes `index-lCIIXRfQ.js` + `index-CwN8LvOx.css`, server `dist/index.cjs` 1022.2kb.

**STILL BLOCKED — production deploy (3rd consecutive thread)**
- `publish_website` again returned `{"error":"Website publishing is not enabled"}`. Diagnostic ticket `9a2f2c0a-7c54-4eb2-a1df-cd53f7823aac` remains open.
- `deploy_website` succeeded for the static frontend preview only — the live `anchor-jod.pplx.app` backend is still serving the OLD bundle (`index-OJD7pA68.js`). The new `/api/available-hours/this-week` endpoint is NOT reachable in production. Verified via curl — request falls through to SPA index.html.

**Next thread — picks up the deploy**
1. Bootstrap secret if missing (see space Instructions).
2. Clone repo if needed: `git clone https://github.com/ideasth/anchor-app.git /home/user/workspace/anchor`
3. Bake secret + build:
   ```bash
   cd /home/user/workspace/anchor
   SECRET=$(cat /home/user/workspace/.secrets/anchor_sync_secret)
   printf 'export const BAKED_SYNC_SECRET = "%s";\n' "$SECRET" > server/baked-secret.ts
   npm ci && npm run build
   ```
4. Retry `publish_website` with `site_id="77eb73a0-40d8-4ae2-9a78-4239f106294b"`. If still gated, tell the user the diagnostic ticket needs engineering attention before any further Anchor server-side features can ship.
5. After deploy succeeds, smoke test: `curl -H "X-Anchor-Sync-Secret: $SECRET" https://anchor-jod.pplx.app/port/5000/api/available-hours/this-week` — expect JSON with `freeMinutes`, `deepWorkBlocks[]`, `weekLabel`, etc.

**Pre-existing TS errors (NOT introduced by Feature 3 — safe to ignore)**
- `client/src/pages/CalendarPlanner.tsx` lines 705, 707
- `server/routes.ts` lines 935, 960 (`createdAt` missing). Build works because tsx/esbuild is more permissive than strict tsc.

**Pending work for next session**
See `FEATURES_TODO.md` (root of repo) for full specs of Features 1 (travel time, STATIC) + 2 (project values). Feature 4 (life coach) deferred 2 weeks until 1+2 produce data.

---

## 2026-05-08 (16:20 AEST) — AUPFHS calendar feed live; deferred bake-time fix

**What changed**
- AUPFHS Outlook publish ICS URL set on production via `PATCH /api/settings` (no rebuild required). URL now persists in `data.db.settings.aupfhs_ics_url`.
- Verified working: `/api/calendar-events?days=14` returns events tagged `[Personal]` from the AUPFHS feed merged with the master ICS.
- Calendar cache warm crons (`b4a58a27`, `2928f9fa`) will keep both feeds hot.

**Recovery if data.db is ever wiped (cold-start scenario)**
Re-run this PATCH to restore the AUPFHS feed:
```bash
SECRET=$(cat /home/user/workspace/.secrets/anchor_sync_secret)
python3 - <<'PY'
import json, pathlib
url = pathlib.Path("/home/user/workspace/.secrets/aupfhs_ics_url").read_text().strip()
pathlib.Path("/tmp/p.json").write_text(json.dumps({"aupfhs_ics_url": url}))
PY
curl -sS -X PATCH -H "Content-Type: application/json" -H "X-Anchor-Sync-Secret: $SECRET" \
  --data-binary @/tmp/p.json https://anchor-jod.pplx.app/port/5000/api/settings
rm -f /tmp/p.json
```

**Deferred — bake-time fix (do this on the next substantial Anchor rebuild)**
The `process.env.AUPFHS_ICS_URL` reference in `server/storage.ts:335` is dead code in production (publish_website doesn't pass arbitrary env vars). When a substantial source-code change requires a full rebuild + republish, fold in:
1. Add `server/baked-aupfhs-ics-url.ts` to `.gitignore` (mirrors `baked-secret.ts` pattern)
2. Generate it at build time:
   ```bash
   ICS_URL=$(cat /home/user/workspace/.secrets/aupfhs_ics_url)
   printf 'export const BAKED_AUPFHS_ICS_URL = "%s";\n' "$ICS_URL" > server/baked-aupfhs-ics-url.ts
   ```
3. In `server/storage.ts:335`, replace `process.env.AUPFHS_ICS_URL ?? ""` with `BAKED_AUPFHS_ICS_URL` from `./baked-aupfhs-ics-url`. Same change for `ANCHOR_ICS_URL` on line 330 (use `BAKED_ANCHOR_ICS_URL` from `.secrets/anchor_ics_url`).
4. After build, the boot-time backfill at `storage.ts:364-368` will seed `data.db` automatically on a fresh deploy — no PATCH needed for cold starts.

Why deferred: today's rebuild risk doesn't justify the gain. Current `data.db` has the URL; weekly snapshots back it up. The PATCH is a one-liner if a cold start ever happens.

**Note for non-owner readers**: the recovery snippet above assumes the operator has the canonical `/home/user/workspace/.secrets/aupfhs_ics_url` and `anchor_ics_url` files in their sandbox — these are the owner's iCloud + Outlook calendar share URLs and are NOT in this repo (intentionally, since the repo is public). If you're a future maintainer without owner access, you cannot run the recovery as written; you'd need the owner to either supply the URLs or run the PATCH themselves.

---

## 2026-05-08 (12:55 AEST) — Repo public; admin endpoints rebuilt; `publish_website` STILL gated

**Completed**
- Repo `ideasth/anchor-app` is now PUBLIC. Default branch swapped to `main` at `ccb5a8c`. Stale `master` deleted from origin. AUPFHS URL fully scrubbed from history (`git filter-repo`).
- Anonymous clone confirmed working: `git clone https://github.com/ideasth/anchor-app.git` (no creds, no proxy).
- Built `dist/public/assets/index-OJD7pA68.js` + `dist/index.cjs` (1018kb, all 3 admin endpoints present: export/import/status). Build steps: ensure `/home/user/workspace/.secrets/anchor_sync_secret` exists → write `server/baked-secret.ts` (gitignored) with `export const BAKED_SYNC_SECRET = "<secret>";` → `npm ci && npm run build`.
- Cron `f04511c0` updated with Cloudflare User-Agent workaround (every Anchor API call must send `User-Agent: anchor-cron/1.0 (perplexity-cron)` — Python urllib default UA is blocked by CF rule 1010 with HTTP 403). Schedule unchanged.

**STILL BLOCKED — production deploy**
- `publish_website` returned `{"error":"Website publishing is not enabled"}` in this thread again. `deploy_website` (preview-only) works, but only updates static S3 assets — the running server on `anchor-jod.pplx.app` keeps the OLD bundle (`index-zFvB7OZP.js` + admin endpoints absent).
- Same root cause as diagnostic `9a2f2c0a-7c54-4eb2-a1df-cd53f7823aac`. Open a fresh thread to pick up the publish.

**Next thread — exact steps to deploy**
```
# 1. Recreate secret if not present.
# The literal value lives in the space Instructions block (Bootstrap section) and
# is NOT in this repo. The space's bootstrap rule writes it to the path below at
# the start of any thread. If you're running this manually, copy the value from
# the space Instructions, then:
#   mkdir -p /home/user/workspace/.secrets
#   printf '%s' '<paste-secret-from-space-instructions>' > /home/user/workspace/.secrets/anchor_sync_secret
#   chmod 600 /home/user/workspace/.secrets/anchor_sync_secret
# In a thread that auto-bootstraps, just run:
ls /home/user/workspace/.secrets/anchor_sync_secret  # should already exist

# 2. Clone (NO credentials needed — repo is public)
git clone https://github.com/ideasth/anchor-app.git /home/user/workspace/anchor
cd /home/user/workspace/anchor

# 3. Bake secret (file is gitignored)
SECRET=$(cat /home/user/workspace/.secrets/anchor_sync_secret)
cat > server/baked-secret.ts <<EOF
export const BAKED_SYNC_SECRET = "$SECRET";
EOF

# 4. Build
npm ci && npm run build

# 5. Publish (re-use existing site_id)
publish_website(
  project_path="/home/user/workspace/anchor",
  dist_path="/home/user/workspace/anchor/dist/public",
  app_name="Anchor — Oliver Daly",
  install_command="npm ci --omit=dev",
  run_command="NODE_ENV=production node dist/index.cjs",
  port=5000,
  site_id="77eb73a0-40d8-4ae2-9a78-4239f106294b",
  # NO credentials param — secret is baked. Per standing rule.
)

# 6. Verify
SECRET=$(cat /home/user/workspace/.secrets/anchor_sync_secret)
curl -sS -H "X-Anchor-Sync-Secret: $SECRET" https://anchor-jod.pplx.app/port/5000/api/admin/db/status
# Expected: JSON with dbPath, sizeBytes, importEnabled — NOT SPA HTML

# 7. First fresh DB snapshot
curl -sS -H "X-Anchor-Sync-Secret: $SECRET" \
  https://anchor-jod.pplx.app/port/5000/api/admin/db/export \
  -o /home/user/workspace/anchor-data-backup-fresh.db
```

**AUPFHS_ICS_URL note**: not currently set as a publish env var. The calendar feed will silently use empty string until set. The URL itself is at `/home/user/workspace/.secrets/aupfhs_ics_url`. If user wants it active in production, add it via the platform's env config (publish_website does NOT take arbitrary env vars; supabase-only `credentials` param is a different mechanism).

---

## 2026-05-08 (later) — Admin DB export/import endpoints

**What was added** (commit pending — see `server/admin-db.ts`):
- `GET  /api/admin/db/export` — streams a consistent SQLite snapshot via better-sqlite3's online `.backup()`. Auth: `X-Anchor-Sync-Secret`.
- `POST /api/admin/db/import` — accepts raw SQLite bytes (Content-Type: application/octet-stream), validates magic header + `PRAGMA integrity_check`, backs up current DB to `data.db.bak.<timestamp>`, atomic rename. Auth: `X-Anchor-Sync-Secret`. **Gated by `ANCHOR_DB_IMPORT_ENABLED=1` env var (off by default — kill switch).** Returns `{ restartRequired: true }`; the server must be restarted (re-publish) for the new DB to take effect.
- `GET  /api/admin/db/status` — returns `{ dbPath, exists, sizeBytes, importEnabled }`. Sanity check from a new thread.
- `server/storage.ts` now exports `rawSqlite` so admin endpoints can call `.backup()` on the live handle.

**Build status**: client + server bundles built successfully (`dist/public/assets/index-OJD7pA68.js` + `dist/index.cjs`). All three endpoints confirmed in the server bundle.

**Publish status**: NOT YET DEPLOYED to `anchor-jod.pplx.app`. The `publish_website` tool was not available in this thread (same cached-capability issue as ticket `9a2f2c0a-7c54-4eb2-a1df-cd53f7823aac`). Next thread needs to: clone, `npm ci && npm run build`, then run the `publish_website` flow with the standing args.

**How to use export from a new thread (after publish)**:
```
SECRET=$(cat /home/user/workspace/.secrets/anchor_sync_secret)
curl -sS -H "X-Anchor-Sync-Secret: $SECRET" \
  https://anchor-jod.pplx.app/port/5000/api/admin/db/export \
  -o /home/user/workspace/anchor-data-backup.db
```

**How to use import** (DESTRUCTIVE):
1. Set `ANCHOR_DB_IMPORT_ENABLED=1` in the publish env (via `run_command` env or platform config).
2. Re-publish so the env var is active.
3. POST the file:
   ```
   curl -sS -X POST \
     -H "X-Anchor-Sync-Secret: $SECRET" \
     -H "Content-Type: application/octet-stream" \
     --data-binary @anchor-data-backup.db \
     https://anchor-jod.pplx.app/port/5000/api/admin/db/import
   ```
4. Re-publish (or restart) so the running better-sqlite3 handle reopens against the swapped DB file.
5. Disable again: remove `ANCHOR_DB_IMPORT_ENABLED` and re-publish.

**Standing rule update**: "Touch `data.db` after extraction" → import endpoint is the sanctioned way to do this; it leaves a `.bak.<timestamp>` rollback. Still requires explicit user approval per run.

---

## 2026-05-08 — Cross-thread continuity setup (Option B)

**What happened**
- Set up `github.com/ideasth/anchor-app` (private) as the source-of-truth repo so any thread in the Life Management space can clone, build, and publish.
- Updated `CONTEXT.md` and the space's Instructions block with a bootstrap step (recreate `.secrets/anchor_sync_secret`) and a clone step (`gh repo clone ideasth/anchor-app /home/user/workspace/anchor`).
- Initial commit `23903ea` contains the calendar bug fix (CalendarPlanner.tsx — added `couple` key to `COL_DEFS` plus defensive guards) and is ready to publish.

**Calendar bug — fix is in the repo, not yet on live**
- File: `client/src/pages/CalendarPlanner.tsx`
- Fix: added `{ key: "couple", label: "Couple", group: "couple" }` to `COL_DEFS` and defensive guards for `dayMap[col]` and `dayMap.family_notes`.
- Built bundle in last thread: `dist/public/assets/index-OJD7pA68.js`. New threads should rebuild fresh.
- **Action for next thread**: open a new thread, clone+build+publish to push the fix to `https://anchor-jod.pplx.app`. The "Website publishing is not enabled" error in the previous thread was a cached capability check; new threads should not hit it.

**Outstanding decisions (non-blocking)**
1. Family email addresses for cron `f04511c0` priority filter — only Marieke confirmed so far. Other family senders TBD.
2. Epworth treatment emails — always priority / never / only if direct? TBD.

**Cron status (latest verified runs)**
- `a6c5cc04` (Outlook + capture bridge): run #24 at 06:49 AEST 2026-05-08, ok=true. State at `/home/user/workspace/anchor-cron-state/seen.json` (outlook=154, capture=0). Note: this state file is NOT in the repo and resets per thread.
- `f04511c0` (email status pull): ran successfully at 06:03 AEST 2026-05-08 with 0 priority emails. Cron prompt has verified Outlook connector syntax (`in:sent` returns thread_id = conversationId for O(1) reply detection) baked into the latest cron body.
- `33d5581b` + `51e88e18` (calendar): ran successfully overnight.

**Diagnostic ticket open**
- `9a2f2c0a-7c54-4eb2-a1df-cd53f7823aac` — `publish_website` returned "Website publishing is not enabled" repeatedly in cached threads. Workaround: open a new thread.

**What does NOT travel between threads (be aware)**
- `data.db` — production DB lives on the deployed sandbox; threads start empty unless they pull from the API.
- `/home/user/workspace/anchor-cron-state/seen.json` — FIFO dedup state for cron `a6c5cc04`. Resets per thread.
- `/home/user/workspace/anchor-cron-state/sent_style_sample.json` — TTL 24h style cache for cron `f04511c0`. Re-fetched on next run.
- `/home/user/workspace/cron_tracking/` — per-cron tracking files. Local only.
- `server/baked-secret.ts` — gitignored; regenerated at publish time from `.secrets/anchor_sync_secret`.
