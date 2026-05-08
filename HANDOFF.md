# Handoff notes — Anchor

Living document. Append new entries at the top. Each entry: date (AEST), thread summary, status, follow-ups.

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
