# Anchor — publish to pplx.app (handoff prompt v2)

The previous attempt found that the new thread runs in a fresh sandbox with no project files. This v2 handoff includes the tarball.

**Two files are needed in the new thread:**
1. `anchor-handoff.tar.gz` — the full project (already-built, baked, cleaned)
2. This file (`PUBLISH_HANDOFF.md`) — instructions

I'll attach both to the new thread message.

---

## Handoff prompt — copy from here ⬇️

**Anchor — publish to pplx.app (handoff v2 from previous thread)**

Continuing work from a previous Computer thread. Anchor is my personal ADHD-friendly task/morning-routine/calendar webapp. The previous thread had a stale Website-publishing policy cache, so we're publishing from this fresh thread instead.

**I've attached `anchor-handoff.tar.gz`.** It contains the full project — frontend already built (`dist/public/`), backend already compiled (`dist/index.cjs`), source code, and a clean SQLite `data.db` (no passphrase, no sessions, no calendar URL). The orchestrator secret (`ANCHOR_SYNC_SECRET`) is baked into `dist/index.cjs` at build time so the published sandbox doesn't need runtime env injection. The GitHub-PAT-bearing ICS URL is intentionally NOT baked in — I'll set it via the Settings UI after publish.

**Steps:**

1. Load the publishing skill: `load_skill(name="website-building/website-publishing")`

2. Extract the tarball:
   ```bash
   cd /home/user/workspace
   tar -xzf anchor-handoff.tar.gz
   ls anchor/  # confirm: dist/, server/, client/, package.json, data.db, etc.
   ```

3. Install runtime dependencies (the tarball excludes node_modules):
   ```bash
   cd /home/user/workspace/anchor && npm ci --omit=dev
   ```

4. **Skip the security review subagent** — already completed in the previous thread. Report at `anchor/anchor_security_review.md` if you want to read it. All BLOCK/WARN findings were either fixed (W1, W2) or accepted (W3, W4 deferred).

5. Run `deploy_website` first (mandatory before publish_website):
   - `project_path`: `/home/user/workspace/anchor/dist/public`
   - `site_name`: `Anchor — Oliver Daly`
   - `entry_point`: `index.html`
   - `should_validate`: `false`

6. Then `publish_website`:
   - `project_path`: `/home/user/workspace/anchor`
   - `dist_path`: `/home/user/workspace/anchor/dist/public`
   - `run_command`: `NODE_ENV=production node dist/index.cjs`
   - `install_command`: `npm ci --omit=dev`
   - `port`: `5000`
   - `app_name`: `Anchor`
   - `subdomain`: `anchor-oliver` (I'll confirm or change in the picker)

   **Do not pass `credentials`** — there are no Supabase creds. The orchestrator secret is baked in.

7. After successful publish, report:
   - The public URL (e.g. `https://anchor-oliver.pplx.app`)
   - The `site_id` returned by `publish_website`
   - Confirmation that the site responds at `/api/health` (use `curl https://<url>/port/5000/api/health`)

**After publish — do NOT do these without my approval:**
- Update any of my four scheduled tasks (cron IDs `3f164f99`, `439fe8f7`, `a54bd4f0`, `fc8f3f3c`). I want to discuss cron repointing separately.
- Touch `data.db` after extraction. The tarball ships a clean DB; redeploys will preserve it.
- Modify any source files unless I explicitly ask.
- Re-run the security review.

**What I'll do post-publish (don't do these for me unless I ask):**
- Open the public URL, set a new passphrase, paste my private ICS URL into Settings.

---

## Context (for future reference)

### Why baked-secret instead of env injection
`publish_website`'s `credentials` parameter only proxies Supabase env vars. For a custom secret like `ANCHOR_SYNC_SECRET`, the only practical option was build-time injection via `script/bake-secret.ts`. The script writes the secret into `server/baked-secret.ts` (gitignored), which is then bundled into `dist/index.cjs`. Runtime falls back to `process.env.ANCHOR_SYNC_SECRET` first, then the baked value, so dev still works after a fresh stub.

The secret is a self-generated random string that only protects an internal cron API. If it leaked, the worst-case impact is someone could create inbox suggestions on the account (visible and rejectable). It is NOT the GitHub PAT.

### Why ICS URL is NOT baked
The ICS URL contains a real GitHub PAT (`github_pat_...`) that grants repo access. That goes in via the Settings UI after the user authenticates with the passphrase, never in the tarball. The bootstrap logic in `server/storage.ts:246` already supports this — when the env var is unset, the persisted `calendar_ics_url` value is honoured.

### Cron routing question (still open)
Four scheduled tasks currently hit `http://localhost:5000` in the dev sandbox:
- `3f164f99` — calendar feed refresh (06:00, 18:00 AEST)
- `439fe8f7` — Anchor ↔ MS To Do bidirectional sync + Outlook inbox scan (every 2h, 06:00–22:00 AEST)
- `a54bd4f0` — daily morning briefing (06:00 AEST)
- `fc8f3f3c` — weekly review (Sun 18:30 AEST)

After publish, two options:
1. **Repoint crons to the public URL** (`https://anchor-oliver.pplx.app/port/5000/api/...`). Pro: single source of truth. Con: published sandbox auto-pauses when idle, so cron requests cold-start it (slower per run, more credits).
2. **Keep crons hitting a local dev backend.** Problem: two backends would need to share `data.db`, but only one sandbox can own it at a time. Probably not viable.

Lean toward option 1 — discuss after publish lands.

### Security review summary (already done)
- BLOCK: none
- W1 (FIXED): three GETs (`/api/sync/queue`, `/api/inbox/suggestions`, `/api/inbox/count`) were unauthenticated → now require user session OR orchestrator secret
- W2 (FIXED): `ANCHOR_SYNC_SECRET` failed open if unset → now fails closed in production (still resolved correctly because it's baked)
- W3 (accepted): `?t=<token>` in URLs — obsolete once published outside the iframe proxy
- W4 (deferred): minor logic bug in "sign out other devices" — not security-critical
- PASS: no hardcoded secrets in source (only baked into compiled bundle), clean dep audit, `__Host-` cookie prefix in production, no `call_external_tool`/`api_credentials`/`llm-api` runtime references, parameterized SQL via Drizzle

### Tarball contents (sanity-checked)
- `dist/index.cjs` (compiled backend, includes baked secret)
- `dist/public/` (built frontend, no secrets)
- `server/`, `client/`, `shared/` (source)
- `package.json`, `package-lock.json`
- `data.db` (clean: no passphrase, no sessions, empty calendar URL)
- `script/bake-secret.ts` (the bake script)
- `server/baked-secret.ts` (contains the secret — gitignored, but ships in tarball)
- `anchor_security_review.md`
- Excluded: `node_modules/`, `.git/`, `.vite/`, WAL/SHM files

### Critical paths after extraction in new thread
- Backend log: `/tmp/anchor.log` (won't exist until first run)
- DB: `/home/user/workspace/anchor/data.db`
- Reset DB: `sqlite3 anchor/data.db "UPDATE settings SET data = json_remove(data, '\$.passphrase_hash'); DELETE FROM auth_sessions;"`
