<!-- filepath: /home/user/workspace/anchor/STAGE_21_FOCUS_OF_WEEK_SPEC.md -->
# Stage 21 — Focus of the Week tier + daily focus action + Projects UI status/priority fixes

Owner: J Oliver Daly. AU spelling, no emoji. Times Australia/Melbourne.
Additive only. Do NOT touch `data.db` directly — migrations run inline on boot
via the ALTER TABLE loop in `server/storage.ts` (idempotent try/catch).

## Goal

1. A "Focus of the week" tier that ranks ABOVE `high` priority. A project (any
   PMT kind) can be flagged as focus-of-week. Focus-of-week projects sort and
   render above Active·High on the Projects page.
2. A "today's action" concept: the user (or the morning cron) can nominate ONE
   task/action per day, ideally drawn from a focus-of-week project, as the
   day's action. Surfaced on the Today page and readable via API.
3. Projects UI fixes:
   - On the ProjectDetail header, render the **Status selector ABOVE the
     Priority selector**.
   - **All** projects must expose BOTH a Status selector and a Priority
     selector — currently the plain Status selector is hidden when
     `pmtLabel != null`. Fix so every project shows: (a) a status control, and
     (b) a priority control including the Focus-of-week option. PMT-labelled
     projects keep their PMT status control too, but must also get the standard
     status + priority controls.

## Data model (server/schema.ts + storage.ts migration loop)

### projects table — add columns
- `focus_of_week_at INTEGER` (nullable, epoch-ms). Non-null ⇒ currently
  focus-of-week; the value records when it was set. NULL ⇒ not focus-of-week.
  Schema (shared/schema.ts): `focusOfWeekAt: integer("focus_of_week_at")`.

Migration line to add to the ALTER loop in storage.ts:
`"ALTER TABLE projects ADD COLUMN focus_of_week_at INTEGER"`

Do NOT change the `priority` column semantics. Focus-of-week is a separate,
orthogonal flag that ranks above `priority=high` for ordering/grouping.

### new table — daily_focus
One nominated action per date.
```
CREATE TABLE IF NOT EXISTS daily_focus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  focus_date TEXT NOT NULL UNIQUE,        -- 'YYYY-MM-DD' Melbourne
  task_id INTEGER,                        -- FK to tasks.id (nullable)
  project_id INTEGER,                     -- source project (nullable)
  title TEXT NOT NULL,                    -- denormalised action title for display
  link_url TEXT,                          -- optional deep link
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```
Add matching drizzle table `dailyFocus` in shared/schema.ts with types.

## Storage methods (server/storage.ts)
- `setFocusOfWeek(projectId: number, on: boolean): Project` — sets/clears
  `focus_of_week_at` (Date.now() or null), stamps `updated_at`.
- `listFocusOfWeek(): Project[]` — projects where focus_of_week_at IS NOT NULL,
  ordered by focus_of_week_at ASC then name.
- `getDailyFocus(date: string): DailyFocus | null`
- `setDailyFocus(input: { focusDate; taskId?; projectId?; title; linkUrl? }): DailyFocus`
  — upsert on focus_date (unique).
- `clearDailyFocus(date: string): void`

## API (server/routes.ts)

### PATCH /api/projects/:id
- Add `"priority"` validation: allowed values `["high","low"]` when present
  (reject others with 400 `invalid_priority`). (Currently unvalidated.)
- Add `"focusOfWeek"` to accepted body keys. If present (boolean/0/1), call
  `storage.setFocusOfWeek(id, !!focusOfWeek)` and reflect in the response.
  Keep it out of the generic `updates` object (it maps to focus_of_week_at via
  the storage helper, not a direct column set from the client).

### GET /api/projects (existing)
- Include `focusOfWeekAt` in each returned row (comes for free once the column
  and schema exist, since it selects the whole row). Confirm the projects
  select returns it.

### GET /api/projects/focus-of-week
- Registered BEFORE `/api/projects/:id`.
- Returns focus-of-week projects, each with up to N (say 8) candidate next
  actions/tasks drawn from that project's incomplete tasks, shaped as:
  `{ projects: [{ id, name, kind, pmtLabel, link, tasks: [{ id, title, deadline, link }] }] }`
  where `link` for a project is `/projects/<id>` and a task link is the same
  project link (tasks live inside the project detail).

### daily focus routes
- `GET /api/daily-focus?date=YYYY-MM-DD` → the row or null. Default date =
  today Melbourne if omitted.
- `POST /api/daily-focus` body `{ focusDate?, taskId?, projectId?, title, linkUrl? }`
  → upsert, returns the row. `title` required.
- `DELETE /api/daily-focus?date=YYYY-MM-DD` → clears.

All under `requireUserOrOrchestrator`.

## Client UI

### client/src/pages/Projects.tsx
- Add to `ProjectWithNext` type: `focusOfWeekAt?: number | null`.
- New top group rendered FIRST, above Active·High:
  `{ key: "focus", label: "Focus of the week", items: sorted.filter(p => p.focusOfWeekAt != null) }`
  Then Active·High EXCLUDING focus-of-week items, then Active·Low excluding
  focus-of-week, then Parked.
- `priorityBucket`: focus-of-week ⇒ -1 (sorts first), then existing buckets.
- Badge: focus-of-week rows get a distinct badge (e.g. label "focus") using the
  amber accent already used for Primary future income; keep the existing
  priority badge too.

### client/src/pages/ProjectDetail.tsx (header block ~L386-425)
- Reorder so the **Status selector renders ABOVE the Priority selector**.
- Show BOTH controls for ALL projects (remove the `pmtLabel == null` gate on the
  plain status selector; render it unconditionally). For pmt-labelled projects,
  ALSO keep the existing PMT status control below.
- Priority selector: add a third option "Focus of the week". Model it as:
  the Select value is "focus" when `project.focusOfWeekAt != null`, else
  `project.priority`. On change:
    - value "focus" ⇒ PATCH `{ focusOfWeek: true }` (leave priority as-is, or
      set priority:"high" as well so it's high when unflagged — set priority
      "high" AND focusOfWeek true).
    - value "high" ⇒ PATCH `{ priority: "high", focusOfWeek: false }`.
    - value "low"  ⇒ PATCH `{ priority: "low", focusOfWeek: false }`.
  SelectItems order: Focus of the week / High priority / Low priority.
- Ensure the ProjectDetail project type includes `focusOfWeekAt`.

### client/src/pages/Today.tsx
- Add a prominent "Today's action" card near the top: reads
  `GET /api/daily-focus?date=<today Melbourne>`. If set, show the title as a
  clickable link (link_url or the project link) with a "Change / Clear"
  affordance. If not set, show focus-of-week candidate actions (from
  `GET /api/projects/focus-of-week`) as clickable buttons that POST to set the
  day's action. Keep it compact and low-friction (ADHD: one tap).

## Morning cron payload (consumed by Perplexity cron, not app code)
No app code needed beyond the endpoints above. The cron will:
- GET /api/projects/focus-of-week
- Build a notification listing each focus-of-week project and its candidate
  actions as clickable links (`https://buoy.thinhalo.com/projects/<id>`), plus
  a link to the Today page to set the day's action.

## Tests
- Extend test/pmt-schema.test.ts (or add test/focus-of-week.test.ts):
  - migration adds focus_of_week_at and daily_focus without error (idempotent).
  - setFocusOfWeek on/off toggles focus_of_week_at.
  - PATCH /api/projects/:id rejects invalid priority (400).
  - daily_focus upsert is unique per date.
- Keep existing tests green: `npm test` / `npx vitest run`.

## Build / typecheck
- `npm run build` must pass (tsc + vite). Fix any type errors introduced.
- Do NOT commit server/baked-secret.ts. Do NOT bake secrets anywhere.

## Out of scope
- No Inbox page. No MS To Do re-pull. No cron creation (parent handles that).
- No deploy from the subagent — parent handles bake + deploy to the VPS.
