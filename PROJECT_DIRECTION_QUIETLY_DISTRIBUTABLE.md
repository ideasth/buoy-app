# Project direction — Buoy (formerly Anchor): quietly distributable

Decision locked Tue 12 May 2026 ~09:56 AEST. Reference this doc from the top of every Stage spec from Stage 14 onward. Supersedes any contrary framing in earlier stage specs.

**This is a living document.** It is the pipeline-state-of-record for the project. Before starting any new Stage of work, the agent and the user both read this doc, update the pipeline table below if anything has shifted, and only then begin implementation. Treat it like a standing rule: no Stage starts until this doc reflects current reality.

## Pipeline state

Last updated: 2026-05-13 01:39 AEST.

### Shipped (on `main`, deployed to VPS unless noted)

| Stage | Title | Commit | Deployed | Notes |
|---|---|---|---|---|
| 7–10 | Earlier feature stages | (multiple) | yes | See `anchor/HANDOFF.md` and `Stages 7-11 update.md` in space |
| 11 | OneDrive backups + Entra app + rclone | (multiple) | yes | `STAGE_11_*` docs in space |
| 11a | AWS S3 setup (archived, not active) | (n/a) | n/a | OneDrive won |
| 12 | `ops/deploy.sh` in-repo deploy script | (in stage 12b commits) | yes | |
| 12b | Cron offload + 6 Perplexity cron deletes; 6 wmu systemd timers | `ea4fdde` | yes | `STAGE_12b_*` docs |
| 12c | Admin dashboard refresh + restore drill PASS | `f976e06` → `0fb33bc` | yes | Drill log in `STAGE_12c_RESTORE_DRILL.md` |
| 13 | Calm — third Coach mode | `6abde13` | yes (2026-05-12) | Deployed via `ops/deploy.sh` |
| 13a | Calm pre-capture chips + post-capture delta | `fa0e14e` | yes (2026-05-12, smoke-tested) | Spec: `STAGE_13a_CALM_PRECAPTURE_SPEC.md` |
| 14 | Anchor → Buoy rename + AGPL v3 + README + relationships table | `db17b33` | yes (2026-05-12, fully closed out) | Spec: `STAGE_14_BUOY_RENAME_SPEC.md`. Runbook: `STAGE_14_OPERATOR_RUNBOOK.md`. 195 tests passing. Backwards-compat retained: old sync header + env var still accepted. GitHub repo renamed to `ideasth/buoy-app`. `redeploy-republish-anchor` skill replaced by `redeploy-republish-buoy` (old name kept as a retired-redirect stub). Perplexity crons NOT touched — they keep working via back-compat `X-Anchor-Sync-Secret` header + `anchor.thinhalo.com` hostname; defer rename indefinitely. |
| 14b | Relationships settings UI | `e000f73` + `0e00209` | yes (2026-05-12, smoke-tested) | Spec: `STAGE_14b_RELATIONSHIPS_UI_SPEC.md`. CRUD page for the `relationships` table at `/admin#/admin?tab=relationships`. 4 routes `/api/relationships` (GET/POST/PATCH/DELETE) gated by `requireUserOrOrchestrator`, with field-level validation and unknown-field rejection. Soft-delete only — historic coach session prompts must remain reproducible. 32 new tests (237 total, up from 205). Net LOC +1313 (4× the ≤300 soft budget; overage mostly tests + proportionate UI). tsc clean, no secret leak in client bundle. |
| 16 | Natural-language scheduling search | `86437c2` + `98254ed` | pushed to `main` 2026-05-13 00:56 AEST; **awaits deploy via `redeploy-republish-buoy` skill** | Spec: `STAGE_16_SCHEDULING_SEARCH_SPEC.md`. `POST /api/scheduling/search` accepts `{prompt}` (LLM-parse + search) OR `{parsed}` (search-only refinement — free re-tweaks). Standalone `/#/find-time` page + Find-a-time dialog from Calendar header (one component, two mounts). Per-search source filter chip row: `My Outlook` + `My Buoy events` default ON, family ICS feeds (Marieke / Hilde / Axel) default OFF — chips render only when those feeds exist. 07:00–21:00 Australia/Melbourne window all days; narrowed further by parsed `dateConstraints` + `timePreferences`. 57 new tests (294 total, up from 237 — well above the ≥17 target; ranking matrix exhaustively covered). Net LOC +2510 across 14 files (3 modified, 11 new). LLM model: `sonar-pro` (same as Coach/Calm/Reflect). One real bug caught by tests pre-commit: sign error in `melbDateTime()` Melbourne-local-to-UTC converter. No new tables, no migration, no cron/Outlook/data.db changes. |
| 17 | Three-hostname split: public/private calendars + family | (commit pending — being pushed this thread) | pushed to `main` 2026-05-13 AM AEST; **awaits deploy via `redeploy-republish-buoy` skill + operator DNS + Caddy steps** | Spec: `STAGE_17_PUBLIC_PRIVATE_CALENDARS_SPEC.md` §K authoritative. Three new virtual hosts on a single process. `oliver-availability.thinhalo.com`: sanitised 12-week availability page + Available-only ICS (15-min privacy buffer, 60-min min, 12-week horizon, weekdays 07:00-19:00 + Sat 08:00-13:00 AEST), token-gated 404 without. `buoy-family.thinhalo.com`: week-view family calendar + Add Event + day/week notes + family ICS, Basic auth OR token URL. Apex `buoy.thinhalo.com` untouched — no resubscribe required. New tables: `public_calendar_blocks`, `family_events`, `family_day_notes`, `family_week_notes` (all bootstrapped inline). New `app_settings` KV table (12 keys). Hostname routing via `server/hostname-router.ts`. Two new Vite entries. Settings UI on apex at `/#/settings/calendars`. 109 new tests (403 total, up from 294 — well above ≥29 target). tsc clean (added `"target": "ES2022"` to tsconfig). Operator must add 2 DNS A records + 2 Caddy vhosts after deploy. |

### Queued (spec locked, build not started)

| Stage | Title | Spec | Notes |
|---|---|---|---|
| 15 | Therapy report | `STAGE_15_THERAPY_REPORT_SPEC.md` | |
| 18 | Calendar Planner Excel download fix | `STAGE_18_CALENDAR_PLANNER_EXPORT_FIX_SPEC.md` (to be written) | Stage 14b hotfix (commit `de3c064` — switch URL build to `location.origin`, fix `Content-Disposition` filename `anchor-planner` → `buoy-planner`) did NOT resolve the user-reported failure. Symptom: clicking Export → Download on `/#/calendar` still produces a Chrome "Site wasn't available" error or fails to download. Live endpoint verified healthy from sandbox (HTTP 401 without auth; HTTP 200 valid xlsx with sync secret). Suspect remaining causes: (a) browser-side token mismatch — `?t=…` query param holds a `buoy_token` localStorage value that the server's `?t=` auth path does not actually accept (only `buoy-sid` cookie or sync-secret header are checked in `requireUserOrOrchestrator`); needs proper query-param token validation, OR a different auth approach (sign a short-lived signed-URL token server-side and have the client request it before download). (b) Caddy or pm2 path-handling edge case with the `?t=` param. (c) Hash-routing interaction with the synthetic anchor element. First action: collect browser console + Network tab from the user when reproducing; only then commit to a fix. Inserted at this slot 2026-05-12 ~18:43 AEST; bumped Oura and below by one. |
| 19 | Oura integration | `STAGE_19_OURA_SPEC.md` (drafted; upload pending) | PAT auth, 90-day backfill, V1 manual sync, `/health/oura` dashboard. Renumbered from 18 → 19 when Stage 18 Excel download fix inserted. |

### Candidate (not yet specced, listed in priority hint order)

| Stage | Working title | Trigger |
|---|---|---|
| 20 | LLM provider abstraction — add Anthropic + Ollama adapters, settings UI for provider/model | When author has appetite. The Ollama adapter is the strategic one (zero per-call cost). Renumbered from 19 → 20. |
| 21 | Multi-user foundation — `user_id` on owning tables, magic-link auth | Defer until a real second user case exists, OR a future-author wants it. New tables added from Stage 14 onward already include nullable `user_id` so this stays cheap. Renumbered from 20 → 21. |
| 22 | Configurable email priority filter — settings UI replacing hard-coded constants | When `email_status_pull.py` next needs a non-trivial change. Renumbered from 21 → 22. |
| 23 | Integrations-as-plugins (Microsoft 365, Oura, GitHub calendar push become opt-in modules with per-user OAuth) | Only if Stage 21 (multi-user) lands. Renumbered from 24 → 23 when the configurable-people-references candidate row was dropped (Stage 14b covered it). |
| 24 | One-line installer + Docker image variant | Only if author actively wants to invite self-hosters. Renumbered from 25 → 24. |
| 25 | Docs site / setup wizard | Only on path C — currently not chosen. Renumbered from 26 → 25. |
| 26 | Public licence + contribution policy formalised | Most of this lands in Stage 14 already. Renumbered from 27 → 26. |

### Direction changes log

Append a one-line entry whenever the chosen path or its scope shifts. Date in AEST.

- **2026-05-12 09:56** — Initial decision: Path B (quietly distributable). Single author. Local-LLM (Ollama) folded into the strategic provider list.
- **2026-05-12 10:01** — Stage 13 (Calm) deployed to VPS. No direction shift; first Stage to land under the new pipeline-doc workflow.
- **2026-05-12 10:25** — Stage 13a shipped to main (`fa0e14e`). Calm pre-capture rebuilt around Reflect-style chip set + multi-select mind-categories + brain-dump; post-capture re-asks the same chips for delta computation. Issue picker kept but now fully optional. Weekly Review gains chip frequencies + top-3 mind categories + per-session deltas. 22 new nullable columns on `coach_sessions`. 168 tests passing.
- **2026-05-12 10:31** — Stage 13a deployed to VPS and smoke-tested. No direction shift.
- **2026-05-12 10:50** — Stage 14 build started: full Buoy rename + AGPL v3 + README "Running your own" + relationships table (DB-only, no settings UI yet). Backwards-compat retained for old sync header and env var. Runbook written for DNS/VPS/pm2 steps the user executes after deploy.
- **2026-05-12 11:05** — New Stage queued: **Stage 16 — Natural-language scheduling search** (parse prompt → rank free slots over existing calendar data). Renumbered from "Stage 14b" in attached draft because 14b was already reserved for the relationships settings UI follow-up. Oura demoted to 17, LLM-abstraction demoted to 18, multi-user to 19, email priority filter to 20.
- **2026-05-12 11:08** — Stage 14 shipped to main (`db17b33`). Full rename in code; backwards-compat retained for old sync header (`X-Anchor-Sync-Secret`) and env var (`ANCHOR_SYNC_SECRET`). Relationships table seeded with author's three names; Reflect prompt now reads them at runtime and omits the people section cleanly when table is empty. LICENSE (AGPL v3) and README rewrite landed. 195 tests passing. Awaits deploy + operator runbook execution (DNS, Caddy, VPS path rename, pm2 rename, GitHub repo rename).
- **2026-05-12 12:20** — New Stage queued: **Stage 17 — Public/private calendar feeds** (sanitised public ICS for Elgin House + private full ICS via Basic auth + token-URL alternate). Spec: `STAGE_17_PUBLIC_PRIVATE_CALENDARS_SPEC.md`. Inserted at the 17 slot; Oura bumps to 18, LLM-abstraction to 19, multi-user to 20, email priority filter to 21, configurable people refs to 22, integrations-as-plugins to 23, one-line installer to 24, docs site to 25, public licence policy to 26.
- **2026-05-13 01:39** — **Stage 17 shipped to `main`** (commit `a4b39c1`). Three-hostname split: apex `buoy.thinhalo.com` untouched; new `oliver-availability.thinhalo.com` (availability page + Available-only ICS) and `buoy-family.thinhalo.com` (family calendar SPA + family ICS). 7 new server modules, 8 new client files, 11 new test files. 109 new tests (403 total, up from 294 — 3.76× the ≥29 target). tsc clean. Build clean (both new HTML entries emitted). No Outlook writes. No migration files — tables bootstrapped inline. Added `"target": "ES2022"` to tsconfig to enable `\u{...}` Unicode property regex escapes in tests. Awaits deploy via `redeploy-republish-buoy` skill + operator must add 2 DNS A records (`buoy-family.thinhalo.com`, `oliver-availability.thinhalo.com` → `203.29.240.189`) and 2 Caddy reverse-proxy vhosts + `sudo systemctl reload caddy`. **Pipeline state now:** Shipped = 7–14, 14b, 16, 17; Queued = 15 (Therapy report), 18 (Excel download fix), 19 (Oura).
- **2026-05-13 00:56** — **Stage 16 shipped to `main`** (commits `86437c2` + `98254ed`). Natural-language scheduling search: standalone `/#/find-time` page + dialog from Calendar header, LLM-parsed prompts with `{prompt}` and `{parsed}` API paths, per-search source filter (My Outlook + My Buoy events default ON; Marieke / Hilde / Axel ICS feeds default OFF), 07:00–21:00 AEST window narrowed by parsed dateConstraints + timePreferences, deterministic ranking. 57 new tests (294 total, target was ≥17 — ~3.4× overshoot, mostly ranking matrix). Net LOC +2510 across 14 files. No new tables, no migration, no cron/Outlook/data.db changes. LLM model `sonar-pro` reused. Pre-commit caught a `melbDateTime()` sign bug. Awaits deploy via the `redeploy-republish-buoy` skill. **Pipeline state now:** Shipped = 7–14, 14b, 16; Queued = 15 (Therapy report), 17 (Public/private calendars + family hostname), 18 (Excel download fix), 19 (Oura).
- **2026-05-12 12:25** — Stage 14 fully closed out. Deployed to VPS (DNS, Caddy dual-host, VPS path rename, pm2 process rename, start.sh fix, sync-secret env propagation). LLM smoke-test passed at `https://buoy.thinhalo.com`. GitHub repo renamed `ideasth/anchor-app` → `ideasth/buoy-app`. Local remote URL updated. Repo description updated. User skill `redeploy-republish-anchor` retired and replaced by `redeploy-republish-buoy`; old name kept as a retired-redirect stub. Perplexity crons NOT renamed — back-compat header (`X-Anchor-Sync-Secret`) and hostname (`anchor.thinhalo.com`) keep them working unchanged; renaming deferred indefinitely (busywork for zero gain). 2-week sanity sweep: no action required until ~2026-05-26 — at that point check `pm2 logs buoy`, `journalctl -u caddy`, and `pm2 env 0` for any back-compat fallbacks firing in production, and decide whether to drop them.
- **2026-05-12 18:43** — Stage 14b hotfix (commit `de3c064`) deployed but did NOT resolve the user-reported Calendar Planner Excel download failure. Symptom persists: clicking Export → Download still fails for the user. Logged as **Stage 18 — Calendar Planner Excel download fix** for later attention. Oura bumps to 19, LLM-abstraction to 20, multi-user to 21, email priority filter to 22, configurable people refs to 23, integrations-as-plugins to 24, one-line installer to 25, docs site to 26, public licence policy to 27. Next time we pick this up: first ask the user to reproduce while watching the browser DevTools Network tab and copy the exact request URL + response code + response body. Most likely root cause hypothesis: `requireUserOrOrchestrator` in `server/routes.ts` accepts cookie session or sync-secret header but does NOT consume the `?t=…` query token the client sends — so the download request is being rejected with 401, and Chrome surfaces that as a confusing failure for a `<a download>` click.
- **2026-05-13 00:30** — **Stage 17 scope expanded** from single-hostname dual-ICS feeds to three-hostname split. Apex stays untouched (author's existing private ICS subscriptions keep working without resubscribe). New `oliver-availability.thinhalo.com` serves a simple HTML 12-week availability page + Available-only ICS to Elgin House. New `buoy-family.thinhalo.com` serves a single calendar page + Add Event + day/week notes + family ICS to Marieke and the kids, gated by shared Basic auth OR token URL. Family-added events live in a Buoy-only table (`family_events`) — the "no Outlook writes" standing rule remains in force. Family events contribute to public busy by default (`count_as_busy_for_public=1`). Target test count for the stage rose from ≥15 to ≥29. Operator runbook now requires two DNS A records and two new Caddy vhosts. Spec revised in place.
- **2026-05-12 23:50** — **Stage 14b shipped to `main`** (commits `e000f73` + `0e00209`). Relationships CRUD page at `/admin#/admin?tab=relationships`. 32 new tests (237 total). Net LOC +1313 — 4× the ≤300 soft budget; overage is mostly tests + proportionate UI, no architectural concessions, all tests green and tsc clean. Subagent timed out on wall-clock during final HANDOFF polishing but both commits were already pushed by that point; verified clean from the parent session. Configurable-people-references candidate row dropped from the Candidate table because Stage 14 + 14b together cover it; integrations-as-plugins renumbered 24 → 23, installer 25 → 24, docs 26 → 25, licence 27 → 26. **Pipeline state now:** Queued = Stage 15 (Therapy report), 16 (Scheduling search), 17 (Public/private calendars), 18 (Excel download fix), 19 (Oura). Awaits deploy via the `redeploy-republish-buoy` skill.

## How to use this doc

**At the start of every new thread that touches a Stage:**

1. Read this doc top to bottom. The pipeline table tells you what's shipped, what's queued, what's deployed and what isn't.
2. If anything has shifted since the last edit (new shipped commit, abandoned Stage, deferred priority, change of path), update the relevant table and the direction-changes log **before** starting implementation work.
3. If the new work would violate a Path B decision criterion (see "Decision criteria for is this a Path B-friendly change?" below), flag it explicitly in the Stage spec and have the user confirm the trade-off.
4. Only then begin the build.

**At the end of every Stage:**

1. Move the row from Queued → Shipped.
2. Record the commit SHA and whether it's deployed.
3. Add any direction-relevant findings to the direction-changes log (e.g. "Stage 14 found we couldn't cleanly remove names from coach prompts without breaking tests — deferred to a follow-up").
4. Upload the updated doc back to the space (overwrite same remote_path so version history is preserved).

## The chosen path — "Path B: Quietly distributable, not actively marketed"

Buoy will be built and maintained primarily as **the author's personal life-management app**. Repo (`github.com/ideasth/buoy-app` after Stage 14) stays public. The architecture will be steered, gently, so that a technically capable stranger could clone it, plug in their own LLM provider, and run it on their own Linux box.

No landing page. No documentation site. No support channels. No marketing. No promise of stable API surface. The README will state explicitly: "This is the author's personal app. The code is public for portability and curiosity. You may run it yourself; you may not expect support."

## Why this shape, not the alternatives

- **Not personal-only (Path A):** the author wants the optionality of someone else picking it up later without prematurely closing that door.
- **Not full OSS (Path C):** the author does not want a maintainer relationship with strangers, a landing page, a Discord, or a part-time job's worth of issue triage. The cost of becoming a "real" OSS productivity project is materially higher than its return for a single-author project.

## What Path B means for stage-by-stage decisions

Apply these defaults when no specific user direction overrides them.

### LLM provider — abstract, but don't over-engineer

- The existing `LLMAdapter` interface in `server/llm/adapter.ts` is the right abstraction. Keep it.
- Add adapters over time as the author personally wants them. Strongly preferred order: Perplexity (current), Anthropic, OpenAI, **Ollama (local)**, Google Gemini.
- Ollama is the strategic adapter — runs against local open-source models (Llama, Qwen, Mistral). Zero per-call cost. Useful for the author on a beefy local box, essential for anyone who self-hosts Buoy and doesn't want to pay any LLM bill. Build this adapter early-ish (likely Stage 17 or 18).
- Provider selection lives in a settings table, not env vars. So a self-hoster picks their provider in the UI on first run rather than editing a config file.
- Model choice per Coach mode (plan vs reflect vs calm) stays per-provider — `modelForMode` becomes provider-aware. No global "which model" knob.

### Multi-user — defer, but don't paint into a corner

- Today every owning table is implicitly single-user. **Don't fix this proactively.** Adding `user_id` to every table now is months of work for zero current benefit.
- Do, however, **stop adding new single-user assumptions to new tables.** New tables added from Stage 14 onward should include a nullable `user_id INTEGER` from creation. When multi-user does land, the migration is "make it non-null and backfill to user 1" — cheap.
- The sync secret pattern stays for V1. Real auth (magic-link email or passwordless) is a future stage if ever.

### Personal references in prompts and code

- **Coach prompts must not name specific people from this stage forward.** The existing `REFLECT_MODE_INSTRUCTIONS` in `server/coach-context.ts` references Marieke, Hilde, Axel by name — flag for removal in a near-future cleanup stage (call it Stage 14b or fold into Stage 14 itself).
- Replace with a runtime-injected `relationships` slice in the context bundle. Single source of truth: a `relationships` table the user maintains in settings (`name`, `relationship_label`, `notes`). The bundle injects whichever 3-5 are most relevant to today's session.
- The author's `relationships` rows populate from the existing personal references; for a fresh self-host install, the table is empty and the prompts work fine without it.

### Email priority filter

- The hard-coded `PRIORITY_DOMAINS` / `PRIORITY_SENDERS` / `PRIORITY_KEYWORDS` constants in `email_status_pull.py` are AUPFHS-specific.
- Migrate to a settings-driven config (`email_priority_rules` table or single JSON settings row) when the author next touches that file for a non-trivial reason. Don't migrate proactively — wait for a justifying change.
- The author's existing values become the seeded default; a self-host install starts empty.

### Healthcare / clinical framing

- The clinical interests (obstetrics, urogynaecology, RANZCOG, medicolegal) appear in priority keywords, in cron names, in some UI copy. **Leave them where they are for now** — domain-neutralising prematurely is busywork.
- New features added from Stage 13 onward should be **domain-neutral by default** in their copy and prompts. Calm, Oura, therapy reports — none of these need clinical framing in source.

### Integrations (Microsoft 365, Oura, GitHub calendar push)

- Each integration is **single-user, author-configured today.** For a self-hoster these would need per-user OAuth.
- **Don't refactor.** Mark each integration in code with a `// SINGLE_USER_OPT_IN` comment so future-author or a contributor knows where the seams are.
- When/if Stage 21 lands ("integrations as plugins"), the work is contained to each integration module rather than spread through the app.

### Deploy + installation

- `ops/deploy.sh` is the canonical deploy path for the author's VPS today. Keep it.
- A self-hoster's installer story is **not built proactively.** The Docker image, the one-line installer, the systemd unit templates — none of that is built until and unless the author actively wants to invite contributors. Marker for the future: see Stage 22 in `PROJECT_DIRECTION` (this doc).
- The repo's `README.md`, however, gets a short "Running your own" section now — even three paragraphs that say "clone, npm ci, npm run build, point a reverse proxy at port 5000, set BUOY_SYNC_SECRET, BYO LLM key in settings UI" is enough for a determined stranger and signals the project's posture.

### Licence

- Move from current (unlicensed / personal) to **AGPL v3** at Stage 14 (the Buoy rename) or shortly after.
- Why AGPL over MIT: prevents a third party from running a commercial hosted Buoy against the author's labour without contributing back. Standard choice for self-hosted productivity tools (Plausible, Outline, Linkwarden, Mastodon all use AGPL).
- A licence change is a once-and-done action: add `LICENSE` file, add SPDX header preamble, mention in README. ~30 min of work.

### Documentation

- HANDOFF.md stays the author's working journal. Not for external consumption — never sanitise it.
- CONTEXT.md (in the space) stays author-private — it contains real names, real domains, real schedules. Never published.
- A short `README.md` + a `SELF_HOSTING.md` at Stage 14 cover the "stranger could find this and figure it out" bar. No more.
- No screencasts, no marketing site, no comparison-with-competitors page.

## What this does NOT mean

- No commitment to backward compatibility across versions. Schema migrations may be destructive at any time. Self-hosters who care take their own backups.
- No commitment to keeping any integration working for anyone. If the author drops Microsoft 365 from their daily flow, the connector may rot.
- No SLA on releases. There may be one commit a day for two months and then nothing for six.
- No issue tracker promise. Issues may be ignored, locked, or auto-closed.
- No contributor pipeline. PRs may be ignored or rejected without explanation. If someone is intent on contributing, they should fork.

## Decision criteria for "is this a Path B-friendly change?"

When implementing any new feature or refactor, ask:

1. **Does this hard-code anything specific to the author** (a domain, a name, a tenant id, an email, a hospital)? If yes, find a way to externalise it into settings or seed data, OR mark with `// SINGLE_USER_OPT_IN` and move on. Acceptable to defer; not acceptable to add new hard-codes without a marker.
2. **Does this lock the LLM choice?** New code should call through the `LLMAdapter` interface, not directly to any provider SDK.
3. **Does this make multi-user harder?** New tables get a nullable `user_id` from creation. Don't add cross-table queries that would break when multi-user lands.
4. **Does this require the user to have one specific external account?** (E.g. an AUPFHS Microsoft tenant.) If yes, that feature must be optional/feature-flagged so the rest of the app works without it.

If a change fails one of these, it's not a deal-breaker — but the spec should call it out explicitly so the author makes a conscious choice rather than accumulating debt silently.

## Open items to revisit on a longer timescale

- **Stage 14 timing:** rename Anchor → Buoy. Already specced. Land before any other architectural changes so future code uses the new name.
- **Stage 17 candidate scope:** "LLM provider abstraction" — add Anthropic + Ollama adapters, settings UI for provider/model selection. Lock spec when the author next has appetite for it.
- **`README.md` rewrite:** to include the three-paragraph "Running your own" section. Do at Stage 14.
- **`LICENSE` file:** add AGPL v3 at Stage 14.
- **Removal of personal names from Coach prompts:** fold into Stage 14 or split as Stage 14b. Don't ship Stage 13 with the names still in for production traffic if Stage 14 is more than ~4 weeks out.

## Note about this document

This is a **direction-of-travel** doc, not a contract. The author retains the right to change paths at any time. If the author decides at Stage 19 that they want a full Path C marketing site, the cost of pivoting is "go do Path C" — none of the Path B work blocks it. Conversely if the author decides they hate the public-repo dimension, the cost of pivoting to Path A is "make the repo private and stop thinking about generality" — also cheap.

The point of writing this down is not to lock in. The point is to **bias defaults consistently** so the author isn't re-litigating "should this be configurable?" every Stage.
