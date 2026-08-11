# Stage 24 — Relationship Transition module

Spec: v2.4 (delivered 2026-08-11 AEST).
Scope: single-pass build, nested under a new `/relationships` hub route.

## Placement

- New apex SPA hub at `/relationships` (moves the existing Relationships CRUD out of the Admin tab into a top-level page with tabs).
- New sub-section at `/relationships/transition` — the Relationship Transition module (this stage).
- Sidebar: single new `Relationships` NAV entry, inserted between `Issues` and `Habits`.
- Admin tab still renders the Relationships CRUD component for back-compat.

## Data model (new tables)

All tables carry `created_at INTEGER NOT NULL` (epoch ms) and `updated_at INTEGER NOT NULL` (epoch ms) unless noted. Every user-authored record carries an explicit `record_type` and `confidentiality` field.

### `transition_state` — singleton KV of module state

Single-row (`id = 1`) settings row for the module.

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | always 1 |
| `phase` | TEXT | `awareness` \| `decision_taken` \| `first_conversations` \| `separation_active` \| `stabilising` \| `co_parenting_steady` — default `decision_taken` |
| `decision_statement` | TEXT | long-form; seeded from spec v2.4 |
| `decision_statement_updated_at` | INTEGER | epoch ms |
| `driver_relationship_end` | INTEGER | 1-5 rating |
| `driver_financial_pressure` | INTEGER | 1-5 |
| `driver_workload_pressure` | INTEGER | 1-5 |
| `driver_child_impact` | INTEGER | 1-5 |
| `driver_relationship_quality` | INTEGER | 1-5 |
| `driver_health_impact` | INTEGER | 1-5 |
| `driver_business_impact` | INTEGER | 1-5 |
| `drivers_updated_at` | INTEGER | epoch ms |
| `interaction_climate` | TEXT | JSON blob: `{ conflict_level: 1-5, communication_quality: 1-5, hostility_signals: [strings], safety_concerns: null|"present" }` |
| `interaction_climate_updated_at` | INTEGER | epoch ms |
| `updated_at` | INTEGER | epoch ms |

### `transition_actions` — dynamic action plan

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `horizon` | TEXT | `72h` \| `2w` \| `1_3m` \| `later` |
| `area` | TEXT | free-text area tag (e.g. `legal`, `finance`, `it_handover`, `communication`, `children`, `health`, `work`) |
| `title` | TEXT NOT NULL | |
| `detail` | TEXT | long-form |
| `status` | TEXT | `Open` \| `Active` \| `Complete` \| `Parked` — default `Open` |
| `due_at` | INTEGER | epoch ms, nullable |
| `record_type` | TEXT | one of the 7 classifications (see below), default `recommendation` |
| `confidentiality` | TEXT | `private` \| `therapist` \| `lawyer` \| `mediator` — default `private` |
| `source_url` | TEXT | nullable |
| `source_label` | TEXT | nullable |
| `seed_key` | TEXT | nullable; set on spec-seeded records so re-boot doesn't dupe |
| `sort_order` | INTEGER | for manual reordering |
| `created_at` | INTEGER | |
| `updated_at` | INTEGER | |
| `completed_at` | INTEGER | nullable |

### `transition_ledger` — evidence / reflection ledger

Unified table for the 7 record types. Every row carries its `record_type`. UI never lets you save a `documented_fact` without a source, and never mixes `documented_fact` next to `inference`/`recommendation` in the same list block — the ledger view groups by record_type.

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `record_type` | TEXT NOT NULL | `documented_fact` \| `self_report` \| `reported_other_statement` \| `historical_summary` \| `inference` \| `recommendation` \| `open_question` |
| `category` | TEXT | free-text (e.g. `communication`, `financial`, `child_related`, `health`, `pattern`, `legal_step`) |
| `title` | TEXT | optional short heading |
| `body` | TEXT NOT NULL | long-form |
| `event_date` | TEXT | ISO date/datetime string, nullable — retrospective entry supported |
| `source_kind` | TEXT | `message` \| `email` \| `document` \| `bank_transaction` \| `photo` \| `witness_report` \| `own_recollection` \| `inference` \| `other` |
| `source_url` | TEXT | nullable |
| `source_label` | TEXT | nullable |
| `perspective` | TEXT | `me` \| `other` \| `both` \| `unknown` — default `me` |
| `confidentiality` | TEXT | `private` \| `therapist` \| `lawyer` \| `mediator` — default `private` |
| `seed_key` | TEXT | nullable |
| `created_at` | INTEGER | |
| `updated_at` | INTEGER | |

### `transition_financial_items` — financial reconciliation register

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `category` | TEXT | `furniture` \| `white_goods` \| `tools` \| `tickets` \| `travel` \| `groceries` \| `renovations` \| `subscriptions` \| `other` |
| `description` | TEXT NOT NULL | |
| `amount_aud_cents` | INTEGER | nullable; store cents to avoid float issues |
| `direction` | TEXT | `paid_by_me` \| `paid_by_other` \| `shared` \| `unknown` |
| `event_date` | TEXT | ISO date, nullable |
| `evidence_status` | TEXT | `documented` \| `partial` \| `recollection_only` |
| `source_url` | TEXT | nullable |
| `source_label` | TEXT | nullable |
| `notes` | TEXT | nullable |
| `record_type` | TEXT | default `documented_fact`; `self_report` when only recollection |
| `confidentiality` | TEXT | default `private` |
| `seed_key` | TEXT | nullable |
| `created_at` | INTEGER | |
| `updated_at` | INTEGER | |

### `transition_it_handover` — IT handover inventory

Never renders raw credentials. `sensitivity` field controls whether a value is masked in normal UI.

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `system` | TEXT NOT NULL | e.g. `Google Workspace`, `Xero`, `Meta Business Suite`, `iCloud`, `Squarespace` |
| `account_context` | TEXT | which account/tenant this refers to |
| `access_status` | TEXT | `me_only` \| `other_only` \| `shared` \| `unknown` \| `revoked` |
| `handover_status` | TEXT | `not_started` \| `in_progress` \| `complete` \| `blocked` |
| `sensitivity` | TEXT | `standard` \| `sensitive` — sensitive rows always render notes as `[redacted — open detail view]` in lists |
| `notes` | TEXT | never store raw credentials here (validated in server route) |
| `next_action` | TEXT | nullable |
| `due_at` | INTEGER | nullable |
| `record_type` | TEXT | default `recommendation` |
| `confidentiality` | TEXT | default `private` |
| `seed_key` | TEXT | nullable |
| `created_at` | INTEGER | |
| `updated_at` | INTEGER | |

## Server-side constants

`RECORD_TYPES = ['documented_fact','self_report','reported_other_statement','historical_summary','inference','recommendation','open_question']`

`CONFIDENTIALITY_LEVELS = ['private','therapist','lawyer','mediator']`

`PHASES = ['awareness','decision_taken','first_conversations','separation_active','stabilising','co_parenting_steady']`

`SENSITIVE_CREDENTIAL_REGEX = /\b(password|passphrase|pin|totp|otp|secret|token|api[_-]?key|recovery[_-]?code)\b/i` — rejects on IT handover write with 400 `credential_in_notes`.

Every write route:
- rejects unknown fields (parity with existing Buoy conventions)
- rejects unknown enum values
- stamps `updated_at` to `Date.now()`
- stamps `completed_at` on transition_actions when status flips to `Complete`

## Seed content (idempotent by `seed_key`)

Seeded once at boot when the respective table is empty **or** when a specific `seed_key` is missing. All seeds are `confidentiality = 'private'` per Oliver's confirmed default.

**Decision statement (transition_state row):**
> "I've made the decision to end my marriage with Marieke. The next 1–3 months are about doing this safely: protecting the children, protecting my recovery and work capacity, sorting finances honestly, and untangling shared IT and household systems. This module is my own governance surface — not a channel to Marieke, and not a tool for Axel or Hilde."

**Decision drivers (defaults, 3/5):** relationship_end 5, financial_pressure 4, workload_pressure 4, child_impact 4, relationship_quality 5, health_impact 4, business_impact 3. Oliver can retune.

**Interaction climate:** `{ conflict_level: 3, communication_quality: 2, hostility_signals: ['post-Bangkok friction'], safety_concerns: null }`.

**Seeded ledger entries:**
1. `historical_summary` — "Long-standing mismatch: repeated pattern of financial imbalance and workload imbalance across the relationship, culminating in the Sunday-message dynamic and the Bangkok trip."
2. `reported_other_statement` — "Sunday message: Marieke stated <...>. Correction: my recollection differs on <...>." (Oliver to fill body; seeded skeleton so entry exists.)
3. `self_report` — "Post-flight morning message (Aug 11): I confirmed my intent and named the reasons."
4. `open_question` — "How and when do we tell Axel (14) and Hilde (10)? Coordinate wording with therapist first, never unilaterally."
5. `recommendation` — "Do not send any of these entries. This module is read-only outbound."

**Seeded financial items (skeleton, amounts null, evidence_status `partial`):**
- Couch (furniture)
- White goods (white_goods)
- Tools (tools)
- Festival tickets (tickets)
- Bangkok flights (travel)
- Groceries — pattern of imbalance (groceries)
- Renovations (renovations)

**Seeded IT handover skeleton:** Google Workspace, iCloud family, Xero, Meta Business Suite, Squarespace, Home network / Apple Home. All `handover_status = not_started`, `sensitivity = sensitive` for Xero / Google Workspace / iCloud, `standard` for the rest.

**Seeded action plan (transition_actions):**
- **72h:** call solicitor for initial consult; brief therapist on decision + wording for children; do NOT initiate any big-ticket transfer or shared-account change; keep normal household running; sleep + eat.
- **2 weeks:** first legal advice appointment; therapist appointment(s); draft (do not send) financial-reconciliation register; identify safe communication channel with Marieke; check-in with GP re: sleep/stress.
- **1–3 months:** mediator vs solicitor pathway decision; property + tenancy plan; IT handover schedule with hard cut-over dates; child-communication plan agreed with therapist; work capacity plan (Bayside/Sandringham/AUPFHS load review).

## API surface

All routes under `/api/transition/*`, all guarded by the existing `requireAuth` gate.

```
GET    /api/transition/state
PATCH  /api/transition/state

GET    /api/transition/actions           (query: horizon, area, status)
POST   /api/transition/actions
PATCH  /api/transition/actions/:id
DELETE /api/transition/actions/:id

GET    /api/transition/ledger            (query: record_type, category, perspective, confidentiality)
POST   /api/transition/ledger
PATCH  /api/transition/ledger/:id
DELETE /api/transition/ledger/:id

GET    /api/transition/financial         (query: category, direction)
POST   /api/transition/financial
PATCH  /api/transition/financial/:id
DELETE /api/transition/financial/:id

GET    /api/transition/it-handover
POST   /api/transition/it-handover
PATCH  /api/transition/it-handover/:id
DELETE /api/transition/it-handover/:id

GET    /api/transition/summary           # counts + phase + last-updated (drives the dashboard)
POST   /api/transition/export            # body: { audience: 'lawyer'|'therapist'|'mediator'|'child_comm'|'redacted_chronology' }
                                         # returns { markdown, json } — never triggers a send
```

## UI (Apex SPA)

Nested inside `/relationships` hub. Hub has two internal tabs:
1. **People** — the existing Relationships CRUD, moved from Admin (Admin still shows it too for back-compat).
2. **Transition** — the new module. Deep-linkable at `/relationships/transition`.

Transition module contains 13 vertical sections on one page (or grouped tab if width demands). MVP grouping this stage:
- Dashboard (phase chip, decision-driver bars, interaction-climate chip, summary counts, big red "No outbound send" banner)
- Action plan (72h / 2w / 1–3m columns with card status chips)
- Evidence & reflection ledger (grouped by `record_type`, filter chips, add button with mandatory record_type selector)
- Financial reconciliation register (table view, category filter)
- IT handover inventory (table view; sensitive rows hide notes with a "Show" affordance)
- Placeholder cards for the remaining sections: Property & Moving, Communications drafts, Children & Family, Health/Recovery, Work/Business capacity, Documents, Export bundles — each shows what will land here and links to the ledger for now.
- Export bundles — Markdown preview per audience, "Copy" button (no send button anywhere).

### Source-classification badges

Every card + row shows a `RecordTypeBadge` component. Colour scheme:
- `documented_fact` — solid neutral chip
- `self_report` — outlined chip (blue)
- `reported_other_statement` — outlined chip (amber)
- `historical_summary` — outlined chip (violet)
- `inference` — outlined chip (rose)
- `recommendation` — outlined chip (teal)
- `open_question` — outlined chip (slate, italic)

Confidentiality badge shown next to it. Documented facts and inferences are never rendered in the same visual list block — the ledger view groups by record_type.

## Redaction on export

Export builder:
- always strips `private` records
- lawyer bundle: `documented_fact` + `self_report` (financial + communications categories only) + `open_question`; excludes `historical_summary` unless flagged
- therapist bundle: all categories, includes `historical_summary` + `self_report` + `open_question`; excludes financial `documented_fact` amounts
- mediator bundle: `documented_fact` + `open_question`; strips `inference` and emotional language markers
- child_comm bundle: only `recommendation` entries flagged `confidentiality = mediator` + agreed-wording items — starts empty until Oliver populates
- redacted_chronology: `event_date` + neutral `category` only; body redacted to first 12 words

Every export bundle carries a header:
```
Buoy Relationship Transition module — <audience> bundle
Generated <ISO>
This is an internal, read-only export. Not a message to any party.
Records included: <count> · Records suppressed as private: <count>
```

## Not built this stage

- No outbound message construction. No send buttons. No child-facing surface.
- No integration with Outlook, iCloud contacts, or bank feeds.
- No AI query surface yet — hooks reserved by including the summary endpoint but no Coach mode change.
- No re-org of Admin's Relationships tab beyond adding the new hub page.

## Tests

Add `test/stage24-transition-*.test.ts`:
- schema migration idempotency
- seed idempotency by `seed_key`
- credential regex rejects `password`/`totp`/`api key`/etc in IT handover notes
- record_type enum enforcement on ledger
- export bundle redaction rules
- action status Complete stamps completed_at

## Deploy

Standard: repo push → `sudo -u jod /opt/buoy/ops/deploy.sh` on `main`.
