# Stage 22 — PMT Status ordering fix + first-class space fields

Branch: `stage-22-pmt-status-space`. Additive and backward compatible; no data.db
changes. AU spelling throughout.

## Change 1 — PMT Status above Priority, for all projects

`client/src/pages/ProjectDetail.tsx`

- Removed the generic active/parked `status` Select (testid `select-status`) and the
  now-unused `setStatus` helper.
- The PMT Status Select (testid `select-pmt-status`) now renders for ALL projects
  (the `pmtLabel != null` gate was removed) and is ordered ABOVE the Priority
  Select. Options are Active | Parked | Complete, with the "Set status" placeholder
  for a null value. A stored legacy value of `Open` is displayed as `Active`.

Back-compat / migration (`server/storage.ts`): the idempotent boot migration
`UPDATE projects SET pmt_status='Active' WHERE pmt_status='Open'` maps any legacy
`Open` rows to `Active` (safe to re-run). Server-side validation
(`server/routes.ts`, PATCH `/api/projects/:id`) accepts only `Active|Parked|Complete`
for `pmtStatus` (returns 400 `invalid_pmt_status` otherwise); legacy rows are never
500'd.

## Change 2 — First-class spaceName + spaceUrl on every project

- Schema (`shared/schema.ts`): added nullable `spaceName` (`space_name`) and
  `spaceUrl` (`space_url`) TEXT columns to the `projects` table.
- Storage migration (`server/storage.ts`): idempotent
  `ALTER TABLE projects ADD COLUMN space_name TEXT` and `... space_url TEXT`
  inside the guarded ALTER loop.
- API (`server/routes.ts`): PATCH `/api/projects/:id` accepts optional `spaceName`
  (string|null; trimmed, empty -> null) and `spaceUrl` (string|null). A non-empty
  `spaceUrl` must be an absolute http(s) URL, else 400 `{ "error": "invalid_space_url" }`;
  empty/null clears it. GET payloads return the columns automatically (full-row select).
- UI (`client/src/pages/ProjectDetail.tsx`): an editable "Space" card (testid
  `space-box`) under the header. Shows the space name as a clickable link
  (`link-space`, new tab, `rel="noopener noreferrer"`) when a URL is set, or
  italic "No space linked yet." when empty. An Edit affordance reveals name/url
  inputs (`input-space-name`, `input-space-url`) and a Save button that PATCHes
  the project, mirroring the narrative-status edit pattern.

## Change 3 — Thread name + URL on Action Notes

- Schema (`shared/schema.ts`): added nullable `threadName` (`thread_name`) and
  `threadUrl` (`thread_url`) TEXT columns to `project_action_notes`. The local
  `ActionNote` interface in ProjectDetail.tsx gained the same fields.
- Storage (`server/storage.ts`): idempotent ALTERs for both columns;
  `createActionNote` persists `threadName`/`threadUrl` (trim; empty -> null).
  `updateActionNote` accepts them via its partial-update path; `listActionNotes`
  returns them via full-row select.
- API (`server/routes.ts`): POST `/api/actions/:actionId/notes` and PATCH
  `/api/action-notes/:noteId` accept optional `threadName` (trimmed, empty -> null)
  and `threadUrl`. A non-empty `threadUrl` must be an absolute http(s) URL, else
  400 `{ "error": "invalid_thread_url" }`.
- UI (`client/src/pages/ProjectDetail.tsx`): the add-action-note form gained two
  compact inputs (`input-action-note-thread-name-<actionId>`,
  `input-action-note-thread-url-<actionId>`) wired into the draft state and POST
  body. Existing notes render the thread as a clickable link (new tab,
  `rel="noopener noreferrer"`) showing the thread name (or "Thread" when only a
  URL is set).

## Tests

`test/stage22-space-fields.test.ts` — in-memory SQLite round-trips (additive
migration presence + idempotency, space/thread field persistence, empty-clears,
legacy `Open` -> `Active`), a URL-validation mirror, and source guards on
routes/storage/ProjectDetail. `test/pmt-dashboard-ui.test.ts` updated: the generic
`select-status` control must be absent and PMT status must be ungated and ordered
above priority.

Verification: `npm run build` (tsc) and `npx vitest run` both green.
