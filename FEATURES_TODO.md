# Features TODO — pending implementation

Status snapshot: 2026-05-08, after Feature 3 (available hours this week) source landed but publish_website is still gated.

---

## Feature 1 — Pre-event travel time (STATIC defaults)

**Approach:** Static lookup table per location. No traffic API calls. User can override per event.

**Data model**

Add table `travel_locations`:
- `id` (pk)
- `name` (e.g. "Sandringham", "Peninsula", "Elgin Braybrook", "Elgin Carlton")
- `keywords` (comma-separated, used to match event location/title — e.g. "sandy,sandringham,sand hospital")
- `nominal_minutes` (typical drive time)
- `allow_minutes` (recommended block to leave by — buffer included)
- `notes` (free text, optional)

Add column on events (or a side table `event_travel_overrides`):
- `event_id`
- `nominal_minutes_override`
- `allow_minutes_override`

Settings additions:
- `home_address` (default: "Erskine St North Melbourne")
- `maps_provider` (default: "google" — used to construct deep links)

**Seed data** (user-provided, 2026-05-08)

| Name | Keywords | Nominal | Allow |
|---|---|---|---|
| Sandringham | sandy, sandringham, sandringham hospital | 45 | 60 |
| Peninsula | peninsula, frankston, peninsula health | 60 | 90 |
| Elgin Braybrook | elgin braybrook, braybrook | 20 | 30 |
| Elgin Carlton | elgin carlton, carlton, elgin house | 15 | 30 |

Home address: Erskine St North Melbourne.

**Maps link convention**

For a work event, generate two links:
- Outbound: `origin = home_address`, `destination = event_location`
- Return: `origin = event_location`, `destination = home_address`

Use Google Maps query URL format: `https://www.google.com/maps/dir/?api=1&origin=...&destination=...`

**Server endpoints**

- `GET /api/travel-locations` — list all
- `POST /api/travel-locations` — create
- `PATCH /api/travel-locations/:id` — update
- `DELETE /api/travel-locations/:id`
- `GET /api/events/:id/travel` — returns `{matchedLocation, nominalMinutes, allowMinutes, outboundMapsUrl, returnMapsUrl}` based on event title/location matching keywords

**Surfaces**

- Today page: badge on each event "Allow 60 min · Maps"
- Calendar page: same badge in event detail
- Morning briefing: include "Leave by HH:MM" line under each work event for the day

**Client work**

- New `TravelBadge.tsx` component (compact, shows allow time + Maps icon → click opens Google Maps directions)
- Settings page: "Travel locations" section with list/add/edit
- Morning briefing: extend existing event renderer

**Effort:** ~1 evening session.

---

## Feature 2 — Project values (income + benefit + kudos)

**Approach:** Extend `projects` schema with four scoring fields, surface on Projects page.

**Data model — add columns to `projects`**

- `current_income_per_hour` (number, AUD; 0 if not income-generating)
- `future_income_estimate` (number, AUD annualised over next 12 months; 0 if N/A)
- `community_benefit` (integer 1-5)
- `professional_kudos` (integer 1-5)

**Seed values** (user-provided, 2026-05-08)

| Project type | Current $/hr | Future est | Notes |
|---|---|---|---|
| Medicolegal | 400 | — | High hourly, ad-hoc volume |
| Elgin House (private) | 400 | — | High hourly, established |
| Hospital (Sandy/Peninsula/Monash) | 200 | — | Lower hourly, contractual |
| AUPFHS | (TBC) | (highest) | **Primary future-income project** — pre-fill `future_income_estimate` as flagged "primary"; user enters dollar value |

**Server endpoints**

- `PATCH /api/projects/:id` — extend existing endpoint to accept the 4 new fields
- `GET /api/projects/values-summary` — returns aggregate: total active projects, weighted average current rate, identified primary future-income project

**Surfaces**

- Projects page: 4 new columns/fields per project card. Edit inline.
- Projects detail view: scoring sliders for community_benefit and professional_kudos
- Morning page: "Top-paying project today" pill if any of today's events ties to a project with `current_income_per_hour >= 300`

**Client work**

- Extend `ProjectCard.tsx` (or equivalent) with 4 new fields
- Settings/edit form for project values
- Sliders (1-5) for the two qualitative scores

**Effort:** ~1 evening session.

---

## Feature 4 — Life coach function (DEFERRED 2 weeks)

**Why deferred:** Needs Features 1 + 2 to produce real data first. Without project values and travel time, the coach has nothing meaningful to weigh.

**Concept:** Once a week (Sunday weekly review time, ~18:30 AEST), pull:
- Available hours for the week (Feature 3 — already built)
- Project values (Feature 2)
- Top deadlines from Anchor task list
- Last week's actual time spent per project (from event log)

Then ask ONE focused question, e.g.:
- "AUPFHS is your primary future-income project but you spent 0 hours on it last week. Block 4 hours this week?"
- "You have 18 deep-work hours and Medicolegal pays $400/hr. Want to commit 6 of those to clearing the medicolegal queue?"

**Constraints:**
- One question per week, not a chat
- Question lands in Morning page on Sunday only
- User can dismiss or accept (accept = creates a calendar block + task)

**Implementation sketch:**
- New endpoint `GET /api/coach/weekly-prompt`
- Server-side rule engine (no LLM call needed for v1 — deterministic rules over the data)
- Client: Sunday-only banner on Morning page
- Action buttons: "Block this time" (creates calendar event + task), "Snooze a week", "Dismiss"

**Revisit:** ~2026-05-22 once Features 1 + 2 have produced 1-2 weeks of data.

---

## Feature 5 — Life coach page (full dialogue, two modes, persistent + auto-summarised)

**Status:** Designed 2026-05-08, NOT started. Do NOT implement without explicit approval.

**Brief**
Full conversational coach page in Anchor. Two modes the user toggles within a single session:
- **Plan mode** — prioritisation advisor. Reads today's top-3, this week's calendar, available hours, project priorities (incl. Feature 2 values once shipped), open issues, recent factors. More directive.
- **Reflect mode** — reflective sounding board on issues. User picks an open issue (or coach suggests one); coach asks Socratic questions. Less prescriptive. Default stance for relationship/house/kids categories.

One page, mode toggle at the top. Not two pages.

**Context bundle (loaded full read-only at session start)**
- `daily_factors` for today + last 7 days
- `top_three` for today + yesterday's unfinished
- `issues` where `status != resolved`, plus issues resolved in last 14 days
- `available_hours/this-week`
- Today's calendar events + tomorrow's
- Last 3 reflections
- Last 3 coach session summaries (if any)
- Project list with current priorities (and Feature 2 values once shipped — income/benefit/kudos)

Post to model as a structured system prompt block. Roughly 4–8k tokens. Sonar context window handles this fine.

**Persistence: persistent + auto-summarised**
- Full transcript stored in DB.
- On session end, model writes a structured summary (3–6 bullets across: what we discussed, decisions made, commitments set, open threads to revisit).
- Summary is editable by the user before save — forces a moment of consolidation, ADHD-aware design choice. `summary_edited_by_user` flag captures whether the user touched it.
- Subsequent sessions load only the last 2–3 session **summaries** as context, not full transcripts. Transcripts are scrollable in the UI for the user but not fed back into the model.
- Decisions/commitments can be written back to Anchor in structured form (create top-3 candidate, patch issue `supportType`/`status`, shift project priority). Every side-effect requires a confirm step in the UI — coach never writes to `data.db` autonomously.

**Schema (new tables)**
```
coach_sessions
  id (pk)
  started_at, ended_at (timestamps)
  mode (text: 'plan' | 'reflect' — last-active mode; sessions can switch mid-session, last value wins)
  context_snapshot (JSON — the bundle loaded at start, for auditability)
  summary (JSON — structured bullets: { discussed, decisions, commitments, open_threads })
  summary_edited_by_user (int 0/1)
  linked_issue_id (nullable FK to issues — set when reflect mode picks an issue)
  linked_ymd (nullable text YYYY-MM-DD — the date this session belongs to)
  model_provider (text: 'perplexity' | 'anthropic' | etc.)
  model_name (text: e.g. 'sonar-reasoning-pro')
  total_input_tokens, total_output_tokens (int)

coach_messages
  id (pk)
  session_id (FK)
  role (text: 'user' | 'assistant' | 'system')
  content (text)
  created_at (timestamp)
  token_count (int, nullable)
  mode_at_turn (text: 'plan' | 'reflect' — mode active when this turn happened)
```

**Server endpoints**
- `POST   /api/coach/sessions` — start a session, returns `session_id` + initial context bundle for client display.
- `POST   /api/coach/sessions/:id/turn` — append user message, stream assistant reply (SSE).
- `POST   /api/coach/sessions/:id/end` — generate draft summary, return for editing (does NOT save until PATCH).
- `PATCH  /api/coach/sessions/:id/summary` — save edited summary; optionally apply structured side-effects passed in the body.
- `GET    /api/coach/sessions` — list with pagination, newest first.
- `GET    /api/coach/sessions/:id` — full transcript + summary.
- All behind sync-secret header like the rest of Anchor's API.

**Model layer (adapter pattern)**
- New file `server/llm/adapter.ts` defining a thin `LlmProvider` interface (`chatStream(messages, opts) => AsyncIterator<chunk>`).
- Default provider: **Perplexity Sonar** (`sonar-reasoning-pro` for plan mode — reasoning helps prioritisation; `sonar-pro` for reflect mode — lighter, warmer).
- Optional second provider: **Anthropic Claude Sonnet** for reflect mode if Sonar's tone is too directive in practice.
- Selection by mode + per-session override (stored on `coach_sessions.model_provider`/`.model_name`).

**Credentials (baked-secret pattern, identical to `BAKED_SYNC_SECRET`)**
- `.secrets/perplexity_api_key` (and optionally `.secrets/anthropic_api_key`).
- `server/baked-llm-keys.ts` — generated at build time from those files. **Gitignored.** Add to `.gitignore` alongside `server/baked-secret.ts`.
- Bake step folded into the existing pre-build snippet in CONTEXT.md / Space Instructions.
- Never expose to the client. Browser calls `/api/coach/sessions/:id/turn`; server calls the LLM.

**Client (`client/src/pages/Coach.tsx`)**
- Mode toggle at top: Plan | Reflect (segmented control). Switching mid-session is allowed; the next turn's system prompt reflects the new mode.
- Conversation pane: standard chat UI, streamed responses.
- Right rail (collapsible): "What the coach can see" — shows the context bundle so the user can correct it before sending the first message. Counts: "3 open issues, 2 carried over", "18 deep-work hrs this week", "top-3 today: …". Click any item to drill into it.
- "End session" button → opens summary editor modal → user edits/deletes bullets, ticks structured side-effects to apply, saves.
- Session history strip at top: last 5 sessions, click to view transcript + summary read-only.
- Route: `/coach`. Nav link in `Layout.tsx` between Reflect and Review.
- New shared module `client/src/lib/coach.ts` — mode constants, summary schema helpers.

**Safety rails (non-negotiable)**
- System prompt rule: in reflect mode, when discussing relationship/kids/house issues, ask before suggesting; do not prescribe action. Different stance from work issues where directive advice is welcome.
- Crisis-language detector: simple keyword pass on user input. On hit, suspend normal coaching and surface a static "please contact GP / Lifeline 13 11 14 / Marieke" card. Override-able after explicit confirm.
- Coach never writes to `data.db` autonomously. Every side-effect requires a UI confirm step.
- Transcripts contain sensitive content (issues category covers relationship + kids). Confirm `data.db` is included in the existing weekly snapshot cron (it is) and consider whether to add an `apiCoachExport` endpoint for selective deletion. Defer the deletion endpoint to v2.

**Cost shape**
- Plan mode session: ~6k token system prompt + ~2k of conversation = ~8k input, ~1k output per turn. Sonar Reasoning Pro current pricing applies.
- Reflect mode: lighter, ~3k input + ~500 output per turn.
- Show running session token count in the right rail so the user sees the cost surface.

**Relationship to Feature 4**
Feature 4 (deterministic weekly coaching prompt on Sunday Morning page) is complementary, not redundant. Feature 4 is a low-cost rules-based banner; Feature 5 is the deep-dive page. After Feature 5 ships, Feature 4 may become a banner-card on Morning that says "Sunday: ready for a weekly plan session?" and deep-links into `/coach?mode=plan`. Re-evaluate Feature 4 scope after Feature 5 lands.

**Effort:** ~3 evening sessions.
1. Schema + endpoints + adapter + Sonar provider (no streaming yet).
2. Client page + streaming + mode toggle + context rail.
3. Summary editor + structured side-effects + history list.

**Open questions to resolve before starting**
- Confirm Perplexity API key arrangement (which org/account, billing surface).
- Confirm whether to ship with Anthropic adapter on day 1 or just Sonar.
- Confirm whether a coach-session deletion endpoint is needed at v1 (privacy hygiene for relationship/kids transcripts).

---

## Implementation order (when next session starts)

1. Feature 1 first (smaller, self-contained, immediate value on Today page)
2. Feature 2 second (reuses existing Projects page UI patterns) — also unlocks richer plan-mode context for Feature 5
3. Then re-evaluate Feature 4 readiness
4. Feature 5 (life coach page) — best after Feature 2 ships so plan mode has project values to reason over

All features should ship without enabling Outlook writes, without re-running the security review, and without re-pulling MS To Do projects (per standing rules).
