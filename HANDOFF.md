# Handoff notes — Anchor

Living document. Append new entries at the top. Each entry: date (AEST), thread summary, status, follow-ups.

## Standing audit — read this on every fresh thread

This section is a deliberate test of the Space `CONTEXT.md` framing. If a future agent (or a future you in a new thread) finds itself doing any of the things below, the framing in `CONTEXT.md` failed and needs sharper wording.

- Did the agent propose adding an Inbox page? (Section: "Why no Inbox page" in `CONTEXT.md`.)
- Did the agent propose enabling Outlook writes without first asking for the three preconditions: write-policy doc, `outlook_writes` audit table, one-click reversal admin tab? (Section: "Why Outlook writes stay disabled" in `CONTEXT.md`.)
- Did the agent propose retuning a cron schedule without explicit approval? (Standing rule list.)
- Did the agent bake a secret into a tarball or commit? (Standing rule list.)

If yes to any: add a one-line "framing miss" note to your session entry below. The cumulative count of misses is the signal that the framing needs another revision pass.

---

## 2026-05-09 (01:45 AEST) — Admin ICS feeds: published-feeds sub-section DEPLOYED

**Status:** Live on https://anchor-jod.pplx.app. tsc clean, vitest 103/103, 6 published-feed labels and the `cal-07ec8bc0` repo URL all confirmed baked into `Admin-CtVXxov1.js`. Live `/api/admin/health` still returns 2 upstream feeds.

**Why.** User asked to add a list of 6 named per-category ICS calendars (Oliver — Work / Personal, Family, Marieke — Art / Personal, plus Master) to the Admin page with iPhone / iPad / Mac setup instructions. The URLs they pasted first were signed `sites.pplx.app/sites/proxy/<JWT>` proxy URLs that expire Sun 10 May 17:47 AEST (~40h). I asked where the stable form lives; they pointed at `https://raw.githubusercontent.com/ideasth/cal-07ec8bc0/main/<file>.ics`. Verified all 6 return HTTP 200 with real VEVENT counts (Work: 990, Personal: 1, Family: 1242, Marieke-Art: 51, Marieke-Personal: 148, Master: 1799). The Master count of 1799 matches the live `calendar_ics_url` cache event count from yesterday's smoke, so MASTER is what `calendar_ics_url` already points to.

**What was implemented**

- **`client/src/pages/Admin.tsx`** — IcsFeedsCard restructured into two labelled sub-sections:

  1. **Upstream feeds (Anchor reads these)** — unchanged: the existing 2-feed diagnostic block driven by `/api/admin/health.icsFeeds`, with per-feed cache status dot, event count, mask/full URL toggle by auth path. Now under an explicit uppercase tracking-wider label so it doesn't get confused with sub-section 2.

  2. **Subscribe to your calendars** (NEW) — a static `PUBLISHED_FEEDS` array hard-coded into the component with the 6 GitHub raw URLs, each rendered as a card with: label, plaintext filename link (anchor with `target="_blank" rel="noopener noreferrer"`), one-line description, full URL in monospace, Copy button. The Copy state uses a `pub:` prefix in the keyspace so it doesn't collide with the upstream-feed Copy buttons. No privacy gating: these URLs are public (read-only GitHub raw, no credentials in the URL itself).

- Replaced the old single "Subscribe instructions (per device)" `<details>` with three separate collapsibles — **Setup — iPhone / iPad** (with the user's exact wording about long-press → Copy), **Setup — Mac**, and **Setup — Outlook (web and desktop)**. Outlook stays on a single combined details since the user's instructions only covered iPhone / iPad and Mac; rather than drop Outlook I kept it as the same generic block as before.

**Visual QA**

Captured a 1280px screenshot via Playwright after signing into a local cookie session. Verified: card hierarchy is clear, no text overflow, Copy buttons sit right-edge with the URL code element flexing left, descriptions wrap cleanly on a desktop viewport, the three setup sections collapse by default. Spotted and fixed one nit — the link text generation was `f.label.replace(/\s+/g,"-").replace(/—/g,"-")` which produced `Oliver---Work.ics` (em-dash already had spaces around it). Replaced with `f.url.split("/").pop()` so it just shows the actual filename. Re-built before publish.

**Live verification**

```
curl -s https://anchor-jod.pplx.app/assets/Admin-CtVXxov1.js | grep -oE "<filename>.ics|cal-07ec8bc0"
```

Returns all 6 filenames + `cal-07ec8bc0` + `raw.githubusercontent.com`. The card renders for any authenticated user; cookie-only sessions still see masked URLs in the upstream-feeds sub-section but FULL URLs in the subscribe sub-section (correct — they're meant to be subscribed to from the user's phone).

**Files changed**

- `client/src/pages/Admin.tsx` (+105 lines: PUBLISHED_FEEDS const, restructured IcsFeedsCard, 3 setup details)
- `HANDOFF.md` (this entry)

**Trade-off accepted**

The 6 URLs are hard-coded in source. If the user adds a 7th category to `cal-07ec8bc0`, they (or I) need to ship a build to surface it. Alternative: a settings array driven by the DB, but that's overkill for a list that has changed once in 6 months and is owned by the same person who owns the build pipeline.

**Follow-ups**

- The `cal-07ec8bc0` repo isn't documented anywhere in this codebase or in `CONTEXT.md`. If a future agent needs to understand the relationship between Anchor, the `live-sync` project, and `cal-07ec8bc0`, they'll have to follow links from this entry. Worth a short paragraph in `CONTEXT.md` once the user confirms the relationship is stable.

---

## 2026-05-09 (01:15 AEST) — Admin ICS feeds card DEPLOYED

**Status:** Live on https://anchor-jod.pplx.app. tsc clean, vitest 103/103 (no test changes — UI + privacy-gated read endpoint). Privacy gating verified locally on both auth paths (sync-secret → full URL, cookie → url=null + masked only) and on the live endpoint with sync-secret (1799 events on Personal feed, 73 on AUPFHS, both fresh).

**Why.** User asked "Add a section on the Admin page called ICS feeds with details of all the ics calendars and how to add them to my calendar." Clarified scope: Both inbound diagnostic AND outbound subscribe instructions; Reveal full URL (sync-secret gated). Important wrinkle: Anchor has no outbound ICS publisher, so "add to my calendar" means re-subscribing the user's Apple Calendar / Outlook / iPhone to the SAME upstream URLs Anchor reads from.

**What was implemented**

- **`server/ics.ts`** — added `getIcsCacheStatus(url)` exporter that reads the module-private `cacheByUrl` Map and returns `{fetchedAt, eventCount} | null`. Read-only introspection so the Admin page can surface last-fetch + count without having to refetch the feed.

- **`server/admin-db.ts`** — extended `/api/admin/health` with an `icsFeeds` array. Each feed: `{label, url, urlMasked, hasUrl, lastFetchedAt, eventCount, cacheStatus}`. Cache status is `fresh` when last-fetch is <30 min old (cache TTL is 15 min so 30 min headroom), `stale` if older, `never` if not cached. Reads `calendar_ics_url` and `aupfhs_ics_url` via `storage.getSettings()`.

- **Privacy gating.** Added a new optional `hasSyncSecret: (req) => boolean` parameter to `registerAdminDbRoutes()`. The full URL is only included in the response when this predicate returns true; cookie-only callers see `url: null` plus `urlMasked` (regex `//.*@` → `//[secret]@`, same as existing Settings page). Threading a predicate beats re-implementing secret comparison inside admin-db.ts and keeps the Authed type untouched. `routes.ts` builds the predicate from the same `SYNC_SECRET` constant the auth helpers already use, so there's a single source of truth.

- **`client/src/pages/Admin.tsx`** — new `IcsFeedsCard` rendered after the Scheduled crons card. Shows per-feed: status dot (emerald=fresh, amber=stale, muted=never), label, event count, full URL in monospace (or masked when cookie auth) with Copy button, last-fetch timestamp + relative "X min ago". Below the feeds, a collapsible `<details>` with subscribe instructions for Apple Calendar (macOS), Apple Calendar (iOS / iPadOS), Outlook (web), and Outlook (desktop). Clipboard copy uses `navigator.clipboard.writeText` with a 1.5s "Copied" confirmation; falls back silently on browsers that block clipboard.

**Privacy verification (local)**

Seeded data.db with `https://user:pass@example.com/cal.ics` and `https://aup:sec@aupfhs.example.com/cal.ics`. Three calls:

1. With `X-Anchor-Sync-Secret: $SECRET` → `url` is the full credentialed URL, `urlMasked` shows `//[secret]@`. ✓
2. With cookie session (created via `/api/auth/setup`) → `url: null`, `urlMasked` shows `//[secret]@`. ✓
3. With no auth → `401 auth required` (no body, no leak). ✓

Then reverted data.db (deleted both URLs and the test passphrase hash) so the live build picks up the user's actual env-configured feeds.

**Live smoke**

```
curl -s -H "X-Anchor-Sync-Secret: $SECRET" https://anchor-jod.pplx.app/port/5000/api/admin/health | jq .icsFeeds
```

Returns 2 feeds (Personal: 1799 events fresh, AUPFHS: 73 events fresh). Without the header: 401. The Admin UI is reachable at https://anchor-jod.pplx.app/admin (cookie auth path — user will see masked URLs there, which is the correct privacy posture for a browser session that could be left open on a shared laptop).

**Files changed**

- `server/ics.ts` (+11 lines: `getIcsCacheStatus`)
- `server/admin-db.ts` (+50 lines: import, `SyncSecretCheck` type, fourth `hasSyncSecret` param, icsFeeds block, response field)
- `server/routes.ts` (+10 lines: build `hasSyncSecret` predicate, pass to `registerAdminDbRoutes`)
- `client/src/pages/Admin.tsx` (+170 lines: HealthResponse type extended, `IcsFeedsCard` component, render after Scheduled crons)

**Commit:** see next push. No test changes — the new logic is straight-line read code that is exercised end-to-end by the smoke tests above.

**Follow-ups**

- The cookie-auth view shows `url: null` + masked, which is correct but means there is no "copy URL" affordance for the user when they hit /admin from the iPad. If they want to subscribe a phone, they need to load /admin with the sync secret header (curl, or the bookmarklet pattern documented elsewhere) once and grab the URL. Could revisit if it becomes painful — e.g. add a "reveal" button that prompts for the secret in-page.
- Cache status `never` will show on a freshly-restarted sandbox until the next calendar fetch. Not worth fixing — the calendar is fetched on every `/api/calendar` hit which the user's home page triggers immediately.

---

## 2026-05-09 (00:45 AEST) — Option 3 cron heartbeat canary DEPLOYED

**Status:** Live on https://anchor-jod.pplx.app. tsc clean, vitest 103/103 (was 81; +22 cron-heartbeat). Cron `8e8b7bb5` task body updated via `schedule_cron action=update` with explicit user approval ("approved").

**Why.** User asked "can you generate an error if a cron fires unexpectedly". Picked Option 3 (single-cron canary, 8e8b7bb5 only) over a global watchdog to keep blast radius small. The canary detects three anomaly classes: unknown cronId (forged POST or missing allowlist entry), off-window fire (>30 min jitter from expected UTC schedule), and double-fire (two heartbeats within 24h). Missed-fire detection is intentionally NOT in the canary — cron `d08f13f1` already detects staleness via backup-receipt age.

**What was implemented**

- **`shared/cron-inventory.ts` reused** as the source of truth for the heartbeat allowlist via `buildExpectedWindows()` in `server/cron-heartbeat.ts`. Adding a new cron to the inventory automatically extends the allowlist; removing it makes its heartbeats fire `unknown_cron_id`. Trade-off accepted: an actively-retuned cron without a matching inventory update will trip `off_window` for one cycle.

- **`server/cron-heartbeat.ts` (new).** Pure classifier with no DB dependency: takes `cronId`, `ranAtMs`, and an array of recent heartbeat timestamps; returns `{anomaly, detail}`. Anomaly priority order: `unknown_cron_id` > `off_window` > `double_fire` > clean. The off-window check parses the cron expression's hour-list, dom (must be `*`), and dow (`*` or comma list of 0-6), and computes signed minute-distance to the nearest expected fire-time. Ranges/steps in cron fields are intentionally unsupported (none of our crons use them). `parseHeartbeatBody()` validates the POST payload: cronId must be 4-32 chars (alphanumeric, dash, underscore); ranAt is optional unix seconds (or ms if >= 10^12), rejected if >1 day in the future or >7 days in the past.

- **SQLite migration in `server/storage.ts`.** New `cron_heartbeats` table (id, cron_id, ran_at, anomaly_reason, created_at) with two indices (created_at DESC; cron_id + created_at DESC). Storage methods: `recordCronHeartbeat()` (with 365-row global prune so a runaway double-fire can't fill the table), `latestCronHeartbeat(cronId)`, `recentCronHeartbeats(limit)`, `cronHeartbeatsSince(cronId, sinceMs)`. The migration is idempotent so existing live DBs adopt the schema without manual intervention.

- **`POST /api/admin/cron-heartbeat`** in `server/admin-db.ts`. Sync-secret only (no user cookie — cron-only endpoint). Body: `{cronId, ranAt?}`. Pulls the last 24h of heartbeats for that cron, classifies, records with the anomaly_reason set, and on anomaly ALSO calls `recordError()` on the in-memory error ring so the Admin UI's Recent errors card surfaces it immediately. Always returns 200 even on anomaly so the cron sees success and doesn't retry.

- **`GET /api/admin/cron-heartbeats`** (cookie OR sync-secret) for drilldown. Returns most-recent N heartbeats across all crons.

- **`/api/admin/health` extended** with a `cronHeartbeats` field: one row per allowlisted cron with the most-recent heartbeat (or null). The Admin UI's Scheduled crons card now shows last-heartbeat timestamp per cron and a red dot + monospace `anomaly: <reason>` line when the latest heartbeat had an anomaly.

- **Cron `8e8b7bb5` task body update.** Prepended a new step 0 that POSTs the heartbeat with `|| true` so it CANNOT block the backup. Step 0 is documented as best-effort and explicitly outside the success criteria. Old steps 1-6 unchanged (numbering preserved). The cron next runs Sun 10 May 03:00 AEST — expected: silent success on the backup, plus a clean (anomaly=null) heartbeat row visible on the Admin UI.

- **`test/cron-heartbeat.test.ts` (22 cases).** Covers `buildExpectedWindows` (every inventory cron present, currentCron used not aedtCron); clean heartbeats (on-schedule, jitter window, multi-hour comma-list crons); each anomaly class (unknown_cron_id, off_window for wrong hour / wrong weekday / outside jitter); double_fire detection plus 7-day-clean weekly verification; anomaly priority ordering; `parseHeartbeatBody` validation (rejects malformed cronId, accepts unix-seconds AND ms, rejects out-of-range ranAt).

**Smoke tests (live).** Posted `{cronId:"8e8b7bb5"}` at the wrong hour — returned `{anomaly:"off_window", detail:"...1440 min outside the expected window..."}`. Posted `{cronId:"deadbeef"}` — returned `{anomaly:"unknown_cron_id"}`. Both anomalies appeared in `/api/admin/recent-errors` immediately. Cleared the error ring after smoke test (the cron_heartbeats rows remain in the live DB; they will be replaced by Sun 10 May's real fire because `latestCronHeartbeat()` orders by created_at DESC).

**Risks documented**
- Allowlist drift if a cron gets retuned without updating `shared/cron-inventory.ts`: the next heartbeat trips `off_window`. Mitigation: cron-inventory drift test enforces inventory shape; document the expectation in HANDOFF.
- The published sandbox is ephemeral, so the cron_heartbeats table travels with `data.db` snapshots only. The 365-row prune ensures the table stays small even if the cron double-fires forever.
- Heartbeat POST failure cannot block the backup (`|| true`). Trade-off: if the heartbeat endpoint is down, we lose the canary signal that cycle; acceptable because the backup itself produces an independent durable signal (OneDrive file + receipt row).
- Pre-existing `f04511c0` cron mentioned in CONTEXT.md is NOT in `AEDT_RETUNE_INVENTORY`, so if it ever POSTs a heartbeat it will fire `unknown_cron_id`. Item M (verify f04511c0 status) remains open.

**Watch tonight.** Cron `d08f13f1` fires Sat 9 May 18:00 AEST — expected: "backup-receipt loop verified" notification (the smoke-test receipt id=2 from the previous batch is recent enough to be "fresh"). Cron `8e8b7bb5` fires Sun 10 May 03:00 AEST — expected: silent success, clean heartbeat row replaces the smoke-test off_window row in `latestCronHeartbeat("8e8b7bb5")`.

**Files changed**
- `server/storage.ts` (cron_heartbeats migration + 4 storage methods)
- `server/cron-heartbeat.ts` (NEW — pure classifier, ~237 lines)
- `server/admin-db.ts` (POST + GET endpoints, cronHeartbeats in /health)
- `client/src/pages/Admin.tsx` (HealthResponse type + per-cron heartbeat block)
- `test/cron-heartbeat.test.ts` (NEW — 22 cases)
- Cron `8e8b7bb5` task body via schedule_cron API (step 0 prepended)

**Framing miss check.** No: cron edit was preceded by explicit per-cron approval ("approved"). No Inbox page proposed. No Outlook writes proposed. No secret baked into commit. CI's secret-check (added in the prior batch) will catch any future drift.

---

## 2026-05-09 (00:15 AEST) — Revised batch (A, B+D-merge, C-Opt3, E, H-lite) DEPLOYED

**Status:** Live on https://anchor-jod.pplx.app. Commits `0de5254` on `main`. tsc clean, vitest 81/81 (was 59; +13 cron-inventory, +9 error-buffer). Pre-commit hook fired. Two cron task body updates applied via schedule_cron action=update with explicit user approval.

**Approval flow.** User picked A, B, C, D, E, H from a recommendations list; I pushed back on D (skipped local pre-commit `npm run build` as too slow) and proposed merging it into B's CI typecheck job, and on H (skipped Sentry, proposed in-memory ring buffer "H-lite"). User approved revised set. Both cron updates were sent for explicit per-cron approval before applying — standing rule respected.

**What was implemented**

- **A — Backup-receipt loop wiring (cron updates).**
  - Cron `8e8b7bb5` task body: appended a new step 4 that POSTs `{onedriveUrl, mtime, sizeBytes, note}` to `/api/admin/backup-receipt` with the sync-secret header. Step 4 is non-blocking on failure: backup is preserved, low-severity 'Anchor backup OK but receipt POST failed' notification fires, run continues to step 5. ONEDRIVE_URL guard skips the POST if step 3 fell through. Old steps 4-5 renumbered to 5-6.
  - Cron `d08f13f1` task body: parser updated from non-existent `lastReceipt.snapshotDate` to `lastReceipt.mtime` (with `createdAt` fallback when mtime is null). Schema-aligned with `latestBackupReceipt()` in `server/storage.ts`. Notification bodies now log mtime/createdAt as ISO 8601 UTC, sizeBytes, and onedriveUrl.

- **B + D-merge — CI hardening.** `.github/workflows/ci.yml`:
  - Secret-check job now writes filenames + line numbers (NEVER values) to `_ci-artifacts/` and uploads via `actions/upload-artifact@v4` (14-day retention) on failure. Caller can grep the artifact instead of re-running CI to debug.
  - Typecheck job now runs `npm run build` after `tsc --noEmit` to catch bundler errors that tsc misses (circular imports, missing default exports in dynamic imports, vite/esbuild config drift). Adds ~30s to CI; cheaper than a mid-publish failure.
  - **Local pre-commit unchanged** (kept fast for tight commit loops). The CI build is the safety net.

- **C (Option 3) — Cron inventory drift test.** New `shared/cron-inventory.ts` is the canonical source for the 9 retune candidates with `currentCron` + `aedtCron` per entry, plus `renderAedtRetuneList()` that produces the markdown bullets used in cron `236aa4a4`'s reminder body. New `test/cron-inventory.test.ts` (13 cases) asserts: (a) the list contains exactly the 9 known IDs and not 236aa4a4 itself, (b) every entry's AEDT hours equal current hours minus 1 modulo 24, (c) minute/dom/month/dow are byte-identical between current and AEDT, (d) `parseHourField` rejects ranges/steps. Next time `236aa4a4` body is touched, regenerate the bullet list with `renderAedtRetuneList()` instead of hand-editing.

- **E — Telemetry kill switch toggle in Admin UI.** Existing badge ("Telemetry: enabled/disabled") now sits next to a Disable/Enable button in the coach context usage card. Click opens an `AlertDialog` describing the consequence (immediate stop on disable, recording resumes on enable, reversible) and the value being written. Confirm fires `apiRequest("PATCH", "/api/settings", { coach_telemetry_enabled: <bool> })`, invalidates `/api/admin/health` query, and closes the dialog. Error path renders inline; in-flight state disables both confirm and cancel.

- **H-lite — In-memory error ring buffer.** New `server/error-buffer.ts`: 100-entry ring with `recordError`, `listErrors(limit?)`, `clearErrors()`. **Privacy choices**: querystring stripped from path; no headers, body, or query data recorded; messages clipped to 500 chars; stacks clipped to 2000 chars. Wired into the existing express error middleware in `server/index.ts` inside a try/catch so it can never break the response. New endpoints in `server/admin-db.ts`: `GET /api/admin/recent-errors` (cookie OR sync-secret) and `POST /api/admin/recent-errors/clear` (sync-secret only). New Admin UI card `RecentErrorsCard` renders most-recent errors as collapsible `<details>` blocks with statuscode + method + path summary, plus the error message and stack on expand. New `test/error-buffer.test.ts` (9 cases) covers shape, querystring stripping, ordering, ring cap, limit clamp, truncation, clear, non-Error inputs.

**Smoke tests (live, post-publish)**

- `GET /api/admin/recent-errors` → `{ringSize: 100, errors: []}`. ✓
- `POST /api/admin/recent-errors/clear` → `{ok: true, removed: 0}`. ✓
- `POST /api/admin/backup-receipt` with `{onedriveUrl, mtime: <unix-now>, sizeBytes: 512000, note: "smoke test 2026-05-09"}` → `{ok: true, id: 2, createdAt: <ms>}`. ✓ Confirms the patched cron 8e8b7bb5 payload shape works against the live endpoint.
- `GET /api/admin/health` → `coachTelemetryEnabled: true`, `lastReceipt` populated with the smoke receipt (`mtime` is finite, ~30 minutes old, well within 8-day window). ✓ Cron `d08f13f1` running tonight at 18:00 AEST will see this receipt and notify "verified" rather than "NOT populated" — proves the parser fix end-to-end.

**Standing rules respected**: cron `c751741f` and the seven other AEDT-affected crons untouched. Cron `8e8b7bb5` and `d08f13f1` were updated **only after explicit approval** — both bodies presented to the user verbatim, then patched via `schedule_cron action=update`. No data.db direct edits. No security re-review. Secrets only read from `.secrets/`; baked-secret/baked-llm-keys gitignored. Outlook writes still gated. No Inbox page.

**Outstanding follow-ups**

- A smoke-test backup receipt row exists in production data.db (id=2, note="smoke test 2026-05-09 (replaces stale)"). It is benign — `latestBackupReceipt()` returns the most recent row, which will be replaced by tomorrow's real backup. Cleanup not required; leaves an audit trail of the H-lite/A wiring proof.
- Cron `8e8b7bb5` runs Sun 10 May 03:00 AEST (i.e. tonight UTC). First real receipt POST will happen then. If the OneDrive upload step has a connector quirk that produces an empty ONEDRIVE_URL, the cron will skip the POST silently and the backup itself still succeeds; cron `d08f13f1` next Saturday (16 May) will then surface "stale" rather than success. That's the intended fail-loud behaviour.
- D08f13f1 also fires Sat 9 May 18:00 AEST (today). Expected outcome: "Anchor backup-receipt loop verified" notification with the smoke-test receipt details. If it instead fires "NOT populated" or "stale", the parser fix didn't take — investigate.
- H-lite ring is in-memory only; it resets on every sandbox restart. Acceptable for a single-user app. If errors ever need to survive a restart, add a `error_log` SQLite table and swap the buffer for a writer (≤30 lines).

---

## 2026-05-08 (23:35 AEST) — Recommendations batch (1, 4, 6, 7, 8, 10) DEPLOYED

**Status:** Live on https://anchor-jod.pplx.app. Commit `049f9c0` on `main` (rebased onto `bac01ce`). tsc clean, vitest 22/22 passing. Pre-commit hook fired. Two new date-guarded crons created. CI workflow added.

**Sequence.** This thread ran in parallel with the email-flag regression fix from another thread. My initial commit (`515afa2`) was rebased onto `origin/main` (which had `1b3858d` + `bac01ce` from the other thread); rebased commit became `049f9c0`. The pre-rebase deploy briefly overwrote the email-priority fix on the live site; the post-rebase redeploy restored both. Smoke tests confirm `isFlagged=1` is being written (priority evaluator live) AND `coachTelemetryEnabled=true` is exposed (this batch live).

**What was implemented**

- **#1 — Backup-receipt verification reminder.** Cron `d08f13f1` "Anchor — verify backup-receipt loop". Schedule `0 8 * * 6` UTC (Sat 18:00 AEST). One-shot date-guarded for 2026-05-09; later runs ask the user if the reminder is still useful. GETs `/api/admin/health`, parses `backups.lastReceipt`, sends in_app notification with one of three states (null / stale >8d / OK). Does NOT auto-delete; only deletes on user reply.
- **#10 — AEDT cutover retune reminder.** Cron `236aa4a4` "Anchor — AEDT cutover retune reminder". Schedule `0 12 * * 6` UTC (Sat 22:00 AEST). Date-guarded for 2026-10-03 only; uses sentinel `/home/user/workspace/.cron-state/aedt_2026_reminder_sent` to prevent re-fire. Body lists all nine retune candidates (8e8b7bb5, 0697627f, 2928f9fa, 67fb0e91, b4a58a27, 17df3d7e, c751741f, 28a67578, d08f13f1) with proposed UTC patches. **Does NOT auto-retune** — standing rule, awaits explicit approval.
- **#4 — Backfill ceiling.** `server/coach-summary-backfill.ts`: `MAX_BACKFILL_PER_BOOT = 50`; `backfillCoachSessionSummaries(limit)` now returns `{attempted, succeeded, failed, remainingApprox}` and probes `cap+1` to estimate remaining. New admin endpoint `POST /api/admin/coach/backfill-summaries` (sync-secret only), body `{limit?: 1-500}`.
- **#6 — Telemetry kill switch + retention sweep.** `shared/schema.ts`: SettingsBlob gains optional `coach_telemetry_enabled?: boolean` (default true; kill via false). `server/coach-routes.ts`: turn endpoint reads the flag before recording telemetry. NEW `server/coach-telemetry-sweeper.ts` (`scheduleCoachTelemetrySweeper()` runs at next 04:30 server-local then every 24h; `runCoachTelemetrySweepNow()` exposed for admin endpoint). 90-day retention default, env override `ANCHOR_COACH_TELEMETRY_RETENTION_DAYS`. `server/storage.ts`: new `pruneCoachContextUsage(days=90)`. `server/admin-db.ts`: new `POST /api/admin/coach/telemetry-sweep` (sync-secret only); `coachTelemetryEnabled` added to `/api/admin/health` response. `server/routes.ts`: PATCH `/api/settings` whitelists `coach_telemetry_enabled`. `client/src/pages/Admin.tsx`: card now shows "Telemetry: enabled/disabled" badge; renders even when no rows; mentions kill switch and retention.
- **#7 — CONTEXT.md framing audit.** Added "Standing audit — read this on every fresh thread" preamble at top of `HANDOFF.md` (already present above this entry). Lists four checks: Inbox proposal, Outlook writes proposal, cron retune without approval, baked secret commit. Future agents log "framing miss" notes; cumulative count signals when CONTEXT.md needs revision.
- **#8 — CI mirror.** New `.github/workflows/ci.yml` with three jobs (`secret-check`, `typecheck`, `test`) on push/PR to main. Secret-check verifies `server/baked-secret.ts` and `server/baked-llm-keys.ts` are NOT tracked AND no `BAKED_<NAME> = "..."` literal anywhere except placeholders. Typecheck and test stub baked-*.ts with PLACEHOLDER strings then run `npx tsc --noEmit` and `npx vitest run`. Rationale: pre-commit hook is bypassable via `--no-verify`; CI is enforcement of last resort.
- **#5 — DELIBERATELY SKIPPED.** Usage chunk lazy chart load was recommended but user did not ask for it. Marginal benefit for single-user app; not worth the indirection.

**Smoke tests (live, post-publish)**

- `GET /api/admin/health` → `coachTelemetryEnabled: true`, `coachContextUsage: []`, `lastReceipt: null` (cron `8e8b7bb5` task body still NOT updated to POST receipt — flagged below). ✓
- `POST /api/admin/coach/telemetry-sweep` (verified pre-rebase) → `{ok:true, removed:0, retentionDays:90, enabled:true}`. ✓
- `POST /api/admin/coach/backfill-summaries limit=1` (verified pre-rebase) → `{ok:true, attempted:0, ..., remainingApprox:0}`. ✓
- `PATCH /api/settings` round-trip on `coach_telemetry_enabled` (false→true) verified pre-rebase. ✓
- `GET /api/email-status?limit=10` → 6 rows, all `isFlagged=1` (commit `1b3858d` from other thread restored on live site after rebase redeploy). ✓

**Standing rules respected**: cron `8e8b7bb5` (weekly backup) and `c751741f` (Email Status pull) **untouched**. No data.db edits. No security re-review run. Secrets only read from `.secrets/`; baked-secret/baked-llm-keys gitignored and excluded from CI repo state via PLACEHOLDER stub. Outlook writes still gated. No Inbox page.

**Outstanding follow-ups**

- Cron `8e8b7bb5` task body still NOT updated to POST receipt to `/api/admin/backup-receipt` — awaiting user approval (flagged in earlier HANDOFF entry; standing rule prevents auto-update). Cron `d08f13f1` will surface this on the first 2026-05-09+ run as a "receipt NOT populated" notification.
- AEDT cutover Sun 5 Oct 2026: cron `236aa4a4` will fire on Sat 3 Oct 2026 to remind. Retunes still require explicit approval.

---

## 2026-05-08 (23:15 AEST) — Email-flag regression FIXED (server-side priority evaluator + backfill) DEPLOYED

**Status:** Live on https://anchor-jod.pplx.app. Commit `1b3858d` on `main`. tsc clean, vitest 59/59 passing (37 new email-priority cases). Pre-commit hook fired. Security review clean (BLOCK 0, WARN 0).

**Problem.** Audit on 2026-05-08 (23:00 entry, Item 5) found 5 of 6 most-recent priority emails stored with `isFlagged=0` despite criteria matching. Root cause: the 2026-05-08 cron edit that removed Outlook flag/importance filtering also dropped the `isFlagged=1` write path; the cron upserts rows but never sets the flag. Standing rule forbids modifying the cron without explicit approval.

**Fix approach (user-approved option 1).** Move priority evaluation to the server. The cron's `isFlagged` value is now ignored; the server computes priority itself from `sender + subject + bodyPreview` on every upsert. This makes the cron's correctness irrelevant for the priority flag and gives a single source of truth.

**What changed (commit `1b3858d`, 5 files, 525+/15-)**

- `shared/email-priority.ts` (NEW) — canonical `evaluateEmailPriority()` plus `extractSenderEmail()`, `PRIORITY_DOMAINS`, `PRIORITY_SENDERS`, `PRIORITY_KEYWORDS`, `NO_REPLY_PATTERNS`. Dependency-free (works in node and vitest). Encodes CONTEXT.md criteria verbatim. **Adds `medicolegalassessmentsgroup.com.au` to `PRIORITY_DOMAINS`** so the active medicolegal booking from `medneg@…` (where the keyword only appears in the domain, not subject/body) flags correctly. No-reply rule matches local-part only (so `alerts@newsletter-host.com` is not falsely rejected). Domain rule supports subdomains via `endsWith('.' + target)`.
- `server/routes.ts` — `POST /api/email-status/upsert` now calls `evaluateEmailPriority({sender, subject, bodyPreview})` and writes `isFlagged: isPriority ? 1 : 0`, **overriding** whatever the cron sent. Comment explains why.
- `server/storage.ts` — new `recomputeAllEmailPriority()` (returns `{scanned, updated, flagged}`, only writes changed rows). Boot-time call wrapped in try/catch repairs existing rows on every server start.
- `server/admin-db.ts` — new `POST /api/admin/email-priority-recompute` (user-cookie or sync-secret auth) for on-demand recompute.
- `test/email-priority.test.ts` (NEW, 37 cases) — covers every domain in PRIORITY_DOMAINS, every sender, every keyword, no-reply rejection of `no-reply@epworth.org.au` even on a priority domain, the `newsletter-host.com` non-rejection corner case, malformed input, and CONTEXT.md sanity checks against the constants.

**Smoke tests (live, post-publish)**

- `GET /api/email-status?limit=20` → 6 rows, **all 6 with `isFlagged=1`** (was 0 of 6 pre-fix). The previously-missed `medneg@medicolegalassessmentsgroup.com.au` is now flagged via `domain:medicolegalassessmentsgroup.com.au`. ✓
- `POST /api/admin/email-priority-recompute` → `{ok:true, scanned:6, updated:0, flagged:6}` (idempotent — backfill already ran at boot). ✓
- `GET /api/admin/db/status` → 200, `exists:true, sizeBytes:512000` (data.db preserved across the publish). ✓
- `npm run build` clean (typecheck + vite + esbuild). ✓
- `npx vitest run` → 59/59 passing. ✓

**Standing rules respected**: cron `c751741f` (Email Status pull) **untouched**. No data.db direct edit (the backfill goes through storage methods). No security re-review (subagent found nothing to fix). Secrets only read from `.secrets/`; baked-secret/baked-llm-keys gitignored. Outlook writes still gated. No Inbox page.

**Notes / follow-ups**

- The cron script (`cron_tracking/f04511c0/email_status_pull.py`) still has the broken flag-write path, but that is now harmless — its `isFlagged` value is ignored server-side. If the cron ever needs touching for another reason, the dead code can be removed at the same time. Not blocking.
- The `lifestyle/EpworthChiefMedicalOfficer@epworth.org.au` row in CONTEXT.md's audit table is now correctly flagged via `domain:epworth.org.au` (no special handling needed; subdomain rule covers it).
- `medicolegalassessmentsgroup.com.au` is a one-domain addition to CONTEXT.md's `PRIORITY_DOMAINS` list. CONTEXT.md text should be updated to reflect this on the next substantive doc pass; not done in this thread because CONTEXT.md is a Space-side file.

---

## 2026-05-08 (23:00 AEST) — Batch: Quick Capture + deep-think badge + bundle split + tsc/husky + summary backfill + telemetry + backup receipt + plan-mode test suite DEPLOYED

**Status:** Live on https://anchor-jod.pplx.app. Commit `a4c1c7b` on `main` (pushed via GitHub connector). Build clean. tsc clean. Vitest 22/22 passing.

**Items implemented (numbered per user's batch request)**

1. **Item 2 — Quick Capture (option B):** new `client/src/components/QuickCaptureModal.tsx` plus a Cmd/Ctrl+K hotkey wired in `Layout.tsx`. Opens a modal with text + domain + estimate + commit-or-defer. The sidebar "Quick capture" entry now opens this modal rather than navigating to `/capture`.
2. **Item 3 — Deep-think state surfaced:** Coach session rail and search-hit list now show a deep-think badge whenever the persisted session row has the deep-think flag.
3. **Item 4 — Backup receipt:** new `backup_receipts` table; storage methods `recordBackupReceipt` + `latestBackupReceipt`; new `POST /api/admin/backup-receipt` (sync-secret only) in `server/admin-db.ts`; `backups.lastReceipt` field added to `/api/admin/health`; new "Last OneDrive backup" sub-section in the Admin Local backups card. **Cron 8e8b7bb5's task body has NOT been updated** to POST the receipt yet — see follow-ups.
4. **Item 5 — Email priority cron sanity-check (read-only audit):** fetched `/api/email-status?limit=50`, re-applied criteria locally. **Finding: 5 of 6 most-recent emails meet criteria but were stored with `isFlagged=0`.** All 6 received in a 4-hour window 2026-05-07 04–07Z, all `updatedAt` ~06:16Z (cron ran but flag write path is broken). Likely regression from the 2026-05-08 cron edit that removed Outlook flag/importance filtering. Audit report saved to `EMAIL_PRIORITY_AUDIT_2026-05-08.md`. Edge case: `medneg@medicolegalassessmentsgroup.com.au` not flagged because "medicolegal" only appears in the domain, not subject/body — candidate for `PRIORITY_DOMAINS`. Did not modify the cron.
5. **Item 6 — Backfill coach session summaries:** new `server/coach-summary-backfill.ts` with `scheduleCoachSummaryBackfill()` that runs 5s after server boot, finds ENDED sessions with NULL summary (via new `storage.listCoachSessionsNeedingSummary`), summarises sequentially with 1.5s delay between calls. Wired into `registerCoachRoutes`.
6. **Item 7 — Bundle split:** `client/src/App.tsx` switched to `lazy()`+`Suspense` for Coach, CalendarPlanner, Admin, Settings, Usage. Resulting chunks: index 483 kB / Usage 405 kB / CalendarPlanner 52 kB / Coach 22 kB / Settings 14 kB / Admin 14 kB.
7. **Item 8 — `tsc --noEmit`:** the build script now runs `npx tsc --noEmit` before vite/esbuild and fails fast on type errors.
8. **Item 10 — Coach context-bundle telemetry:** new `server/coach-context-telemetry.ts` does substring-scan of bundle string values against assistant text (`detectReferencedBundleKeys`). New `coach_context_usage` table. Storage methods `recordCoachContextUsage` + `summariseCoachContextUsage`. Wired into the turn endpoint after the assistant message is persisted, wrapped in try/catch (telemetry must never break a turn). Surfaced as `coachContextUsage` (top 10 keys, last 30 days) in `/api/admin/health` and as a card in Admin.
9. **Item 11 — Plan-mode regression suite (vitest, fixture-based, mocked LLM):** new `shared/anchor-action.ts` is now the single source of truth for `extractAnchorActions`, `stripAnchorActions`, `validateAnchorAction`, and the action types. Coach.tsx imports from `@shared/anchor-action`. New `test/anchor-action.test.ts` with 22 fixture-based tests (extraction, stripping, validation, kind discriminator, malformed payloads). New `vitest.config.ts`. tsconfig includes `test/**/*` with `vitest/globals` types. `.husky/pre-commit` now runs tsc, then `npx vitest run --reporter=dot`, then blocks commits that include any `server/baked-*.ts`. `package.json` gained `test` and `test:watch` scripts.

**Build / publish guardrail discovered this session:** the husky devDep is excluded by `npm ci --omit=dev` in the published sandbox, but the `prepare` script still runs and fails (`sh: 1: husky: not found`, exit 127). Fixed by changing `prepare` to `husky || true` in `package.json`. This survives without devDeps in production while still installing the local hooks during dev.

**Smoke tests (live, post-publish)**
- `/api/admin/health` returns 200 with new keys present: `backups.lastReceipt` (currently `null`, expected until cron 8e8b7bb5 is updated), `coachContextUsage` (currently `[]`, expected until coach turns produce telemetry rows). ✓
- Build output shows the lazy chunks. ✓
- Pre-commit hook fired before `a4c1c7b`: tsc clean + 22/22 vitest passing. ✓

**Files modified (commit `a4c1c7b`, 18 files, 2046+/53−)**
- `package.json`, `package-lock.json` — husky, lint-staged, vitest devDeps; `test`/`test:watch` scripts; `prepare` guarded
- `.husky/pre-commit` (NEW) — baked-secret check, tsc, vitest
- `client/src/App.tsx` — lazy() + Suspense for 5 routes
- `client/src/components/Layout.tsx` — QuickCaptureModal + Cmd/Ctrl+K hotkey
- `client/src/components/QuickCaptureModal.tsx` (NEW)
- `client/src/pages/Admin.tsx` — "Last OneDrive backup" sub-section, Coach context usage card
- `client/src/pages/Coach.tsx` — deep-think badge in rail + search hits; refactored to import from `@shared/anchor-action`; slot type narrowing fix
- `server/admin-db.ts` — `lastReceipt` + `coachContextUsage` in `/api/admin/health`; new `POST /api/admin/backup-receipt`
- `server/coach-routes.ts` — wires summary backfill + telemetry capture
- `server/coach-summary-backfill.ts` (NEW)
- `server/coach-context-telemetry.ts` (NEW)
- `server/storage.ts` — new tables (`coach_context_usage`, `backup_receipts`) + methods
- `shared/anchor-action.ts` (NEW)
- `test/anchor-action.test.ts` (NEW, 22 tests)
- `vitest.config.ts` (NEW)
- `tsconfig.json` — include test/, vitest/globals types
- `EMAIL_PRIORITY_AUDIT_2026-05-08.md` (NEW)

**Follow-ups (need user approval before doing)**

1. **Cron `8e8b7bb5` task body update — task-body only, NOT a schedule retune.** The backup-receipt feature is wired server-side but the cron does not yet POST after the OneDrive upload. Proposed patch: add a single curl POST after step 3 (OneDrive upload), e.g.
   ```bash
   SHA256=$(sha256sum "$OUT" | awk '{print $1}')
   SIZE=$(stat -c%s "$OUT")
   curl -fsS --max-time 30 \
     -H "X-Anchor-Sync-Secret: $SECRET" \
     -H "Content-Type: application/json" \
     -X POST \
     --data-binary "{\"onedriveUrl\":\"$ONEDRIVE_URL\",\"sha256\":\"$SHA256\",\"sizeBytes\":$SIZE,\"snapshotDate\":\"$STAMP\"}" \
     https://anchor-jod.pplx.app/port/5000/api/admin/backup-receipt
   ```
   Standing rule says do not modify any cron without explicit approval. Awaiting yes/no.

2. **Email Status flag-write regression** (Item 5 audit). The cron is firing on schedule but not setting `isFlagged=1` despite criteria matching 5 of the 6 most recent rows. Inspect `cron_tracking/f04511c0/email_status_pull.py` — specifically the criteria-eval branch that writes `isFlagged` — in a fresh thread before re-tuning the cron. Edge case: consider adding `medicolegalassessmentsgroup.com.au` to `PRIORITY_DOMAINS`.

3. **DST cutover Sun 5 Oct 2026** — cron 8e8b7bb5 backup needs retune from `0 17 * * 6` to `0 16 * * 6` to stay at 03:00 Melbourne local. Self-reminder is in the cron task body; do not auto-retune.

**Standing rules respected**: no cron schedule changes, no `data.db` edits, no security re-review, secrets only read from `.secrets/` and never logged or committed, Outlook writes still gated, no Inbox page (rationale persisted in Space `CONTEXT.md`).

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
