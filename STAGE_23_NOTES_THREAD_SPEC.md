# Stage 23 — Remove Actions; Notes-timeline thread URL with fetched title

Branch: `stage-23-notes-thread`. AU spelling, no emoji. All builds and tests green.

## Summary

Two changes:

1. **The Actions feature is removed entirely** — UI, API, storage helpers, DDL,
   schema definitions, and tests. This also removes the Stage 22
   `threadName` / `threadUrl` columns that were (mistakenly) attached to action
   notes. A guarded, idempotent boot migration drops the two tables.
2. **The project Notes timeline gains a thread pointer.** The existing
   `project_component_notes.sourceUrl` / `sourceLabel` pair is repurposed:
   `sourceUrl` is a user-entered thread/source URL and `sourceLabel` is the page
   title, auto-fetched server-side on create (and on update). The manual
   source-label input is gone from the UI.

## Change 1 — Remove Actions

### Client — `client/src/pages/ProjectDetail.tsx`
- Removed the entire Actions `<section>` (`section-actions`), the `ActionRow`,
  `ActionStatusBadge`, and `ACTION_STATUS_OPTIONS`.
- Removed the `ActionItem` / `ActionNote` interfaces.
- Removed the `actions` `useQuery`, the `newAction` draft state, and the
  `addAction` / `setActionStatus` / `deleteAction` / `refreshActions` handlers.
- `projects.nextActionTaskId` (a **task** pointer) and the "Next action" surface
  are untouched.

### API — `server/routes.ts`
- Removed all Actions routes: `GET/POST /api/projects/:id/actions`,
  `PATCH/DELETE /api/actions/:actionId`, `GET/POST /api/actions/:actionId/notes`,
  `PATCH/DELETE /api/action-notes/:noteId`.
- Removed the now-unused `ACTION_STATUSES` enum.
- The project GET payloads never carried an actions field; nothing to strip
  there.

### Storage — `server/storage.ts`
- Removed the `project_actions` / `project_action_notes` `CREATE TABLE` DDL and
  the `listActions` / `createAction` / `updateAction` / `deleteAction` /
  `listActionNotes` / `createActionNote` / `updateActionNote` /
  `deleteActionNote` helpers.
- Removed the Stage 22 `ALTER TABLE project_action_notes ADD COLUMN thread_*`
  migrations.
- `getPmtDashboard` no longer counts open/active actions; the
  `openActiveActionCount` rollup is now always `0` (the dashboard badge simply
  never renders).
- **Boot migration (idempotent, guarded):**
  ```sql
  DROP TABLE IF EXISTS project_action_notes;
  DROP TABLE IF EXISTS project_actions;
  ```
  Child table dropped first, then the parent. Safe to re-run on every boot.

### Schema — `shared/schema.ts`
- Removed `projectActions`, `projectActionNotes`, and their `$inferSelect` /
  `$inferInsert` exported types (including the Stage 22 `threadName` /
  `threadUrl` columns).

## Change 2 — Notes timeline thread pointer

### `server/thread-title.ts` (new)
- `fetchThreadTitle(url): Promise<string | null>` — GET with an ~8s timeout and
  a normal User-Agent, parse `<title>` then fall back to `og:title`, trim /
  collapse whitespace / decode common entities / cap at ~200 chars. Returns
  `null` on any failure and **never throws**.
- `resolveNoteSource(sourceUrl, fetcher = fetchThreadTitle)` — shared create /
  update logic, with an **injectable fetcher** so tests run offline:
  - blank / null URL → clears both fields;
  - non-absolute-http(s) URL → `{ ok: false, error: "invalid_source_url" }`;
  - valid URL → stores the trimmed URL plus the fetched title (which may be
    `null`).
- Helpers `isAbsoluteHttpUrl`, `extractTitleFromHtml`, `normaliseTitle` are
  exported for direct testing.

### `server/routes.ts`
- `POST /api/projects/:id/notes` is now `async`. Accepts `noteDate`, `title`,
  `body`, `sourceUrl` — **`sourceLabel` is no longer an accepted client field**.
  It calls `resolveNoteSource(sourceUrl)`: on `invalid_source_url` it returns
  `400 { "error": "invalid_source_url" }`, otherwise it stores the resolved
  `sourceUrl` + server-fetched `sourceLabel`.
- `PATCH /api/component-notes/:noteId` applies the same resolution whenever
  `sourceUrl` is present in the update.

### `client/src/pages/ProjectDetail.tsx`
- `newNote` draft dropped its `sourceLabel` field.
- The Add-note form keeps Date / Title / Note and now has **one** URL input
  (`input-new-note-source-url`, placeholder `Thread URL (title auto-detected)`).
  There is no source-label input.
- A saved note's `sourceUrl` renders as a new-tab `rel="noopener noreferrer"`
  link whose text is `sourceLabel`, falling back to the URL hostname (or
  `"Link"`) when the title is `null`.

## Tests

- Removed the Stage 22 action-note thread tests and all action tests; retargeted
  the affected source-guard suites:
  - `test/stage22-space-fields.test.ts` — dropped the action-note DDL / ALTERs /
    round-trip and the thread-pointer source guards; kept the space-field and
    pmtStatus coverage.
  - `test/pmt-fields.test.ts` — dropped the `project_actions` /
    `project_action_notes` DDL and the "actions + action notes" describe block.
  - `test/pmt-fields-routes.test.ts` — replaced the Actions-route assertions with
    a guard that those routes are **gone**; dropped the `ACTION_STATUSES` /
    `invalid_link_url` guards.
  - `test/pmt-fields-ui.test.ts` — replaced the Actions-section guards with a
    guard that the section is **gone**, and added the thread-URL input guard.
- New `test/stage23-notes-thread.test.ts` — fully offline (stubs the fetcher):
  valid URL stores the fetched title; failed fetch still stores the URL with a
  `null` label; invalid URL → `invalid_source_url`; empty / null URL clears both;
  the fetcher is not called for empty / invalid URLs; `<title>` / `og:title`
  parsing and title normalisation; and the boot migration drops both action
  tables idempotently. Plus source guards over storage / routes / schema.

## Verification

- `npm run build` (runs `tsc --noEmit`, client Vite build, and server bundle) —
  passes.
- `npx vitest run` — 55 files, 646 tests, all passing.

## Notes on out-of-scope files

- `client/src/pages/PmtDashboard.tsx` was left untouched: it reads the
  `openActiveActionCount` rollup, which the server now always reports as `0`, so
  the open-actions badge simply never renders. This keeps the dashboard tests
  green without expanding Stage 23's blast radius.
