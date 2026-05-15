# Stage 18 — Settings default page + sidebar reshuffle + Calm music

Status: **DRAFT — awaiting user sign-off**
Date: 2026-05-15
Owner: Oliver
Pipeline slot: ships after Stage 17c (`d17b0ca`), before Stage 19

---

## Goals

Three discrete UX changes, scoped tight so they can ship in one commit.

1. **Settings — default landing page.** Let the user pick which page Buoy opens to. The choice is one of every top-level sidebar route. Persists per-installation.
2. **Sidebar reshuffle.** New top-of-nav order: **Check-in, Calm, Capture, Coach**, divider, then **Today, Calendar**, then the rest of the existing list in its current order. Adds a new **Calm** sidebar item pointing to the existing `/calm` route. Adds a divider after Coach.
3. **Calm session music + box-breathing visual.** Switch the Calm session from the current 2-phase breathing (5 s inhale + 5 s exhale = 10 s cycle) to **box breathing**: 4 s inhale + 4 s hold + 4 s exhale + 4 s hold = **16 s cycle**. Bundle a synthesised audio loop with one distinct sustained note per phase: **B4 (inhale) → A4 (hold full) → C♯4 (exhale) → A3 (hold empty)**. Visual is circle-only, no phase labels: circle expands during inhale, sits at full during hold, contracts during exhale, sits small during empty hold.

Non-goals (deferred):
- Per-user multi-track picker (we chose single bundled loop).
- Phase labels under the circle (we chose circle-only).
- User-configurable breath ratio (we chose box 4-4-4-4 only for now).
- Volume slider in settings (use OS volume; revisit if needed).
- Music in any other Coach mode (Calm only for now).

---

## Out of scope reminders

- Standing rules from CONTEXT.md still apply. Do not touch crons, secrets, or `data.db` directly.
- AU spelling everywhere. No emoji.
- Times in events are UTC; convert for display. (Not relevant to this stage but stated for completeness.)

---

## Change set

### 1. Settings — default landing page

**Storage.** New key in the existing `app_settings` KV table (`server/app-settings.ts`):

```
key   = "default_landing_route"
value = "/"   (default — equivalent to Today)
```

Add the key to the `KEY` const and seed the default to `"/"` so existing installs get a sensible value on first boot.

**Server.**
- Extend the existing `GET /api/settings` response to include `defaultLandingRoute`.
- Extend `PATCH /api/settings` to accept `defaultLandingRoute` (string, must be one of the allowed routes — validated server-side against an allow-list).

Allow-list (mirrors the sidebar's `NAV` const, dividers excluded):

```
/coach, /capture, /, /calendar-planner, /checkin, /calm,
/morning, /evening, /review,
/tasks, /email-status, /projects, /issues, /habits,
/admin
```

If an unknown route is submitted, return 400 `{error: "invalid_route"}`. This stops a stale client from poisoning the value if we delete a page in future.

**Client — Admin / Settings page.**

The Admin page (`client/src/pages/Admin.tsx`) is the consolidated Settings host. Add a new card titled **"Default landing page"** containing:

- A short description: *"The page Buoy opens to when you first load the app or open a new tab."*
- A `<Select>` populated from a shared `NAV_ROUTES` constant (label + href) exported from `Layout.tsx`. Default value is the current setting.
- Save is debounced (300 ms) and calls `PATCH /api/settings`. Toast on success.

**Client — App boot.**

`client/src/App.tsx` currently mounts on whatever route the browser is on. We add a one-shot redirect on first paint when the path is the root and the user has chosen a non-root default:

```ts
// in App.tsx, after the existing auth-status query
const { data: settings } = useQuery({ queryKey: ["/api/settings"] });
const [location, navigate] = useLocation();
const redirected = useRef(false);
useEffect(() => {
  if (redirected.current) return;
  if (!settings?.defaultLandingRoute) return;
  if (location !== "/") return;                  // only when landing on root
  if (settings.defaultLandingRoute === "/") return;
  redirected.current = true;
  navigate(settings.defaultLandingRoute, { replace: true });
}, [settings, location, navigate]);
```

Notes:
- The redirect only fires when the user lands on `/`. Deep links (e.g. `/calm` shared from another window) are not overridden.
- `replace: true` so the back button doesn't bounce them to `/`.
- The `redirected` ref guards against re-firing if settings refetch returns the same value.

### 2. Sidebar reshuffle

Edit `client/src/components/Layout.tsx`:

**Current NAV (top of file):**

```ts
{ href: "/coach", label: "Coach" },
{ href: "/capture", label: "Capture" },
{ href: "/", label: "Today" },
{ href: "/calendar-planner", label: "Calendar" },
{ href: "/checkin", label: "Check-in" },
{ divider: true },
...
```

**New NAV:**

```ts
{ href: "/checkin", label: "Check-in" },
{ href: "/calm", label: "Calm" },
{ href: "/capture", label: "Capture" },
{ href: "/coach", label: "Coach" },
{ divider: true },
{ href: "/", label: "Today" },
{ href: "/calendar-planner", label: "Calendar" },
{ divider: true },
{ href: "/morning", label: "Morning" },
{ href: "/evening", label: "Evening" },
{ href: "/review", label: "Review" },
{ divider: true },
{ href: "/tasks", label: "Tasks/Priorities" },
{ href: "/email-status", label: "Email Status" },
{ href: "/projects", label: "Projects" },
{ href: "/issues", label: "Issues" },
{ href: "/habits", label: "Habits" },
{ divider: true },
{ href: "/admin", label: "Admin" },
```

Also export a `NAV_ROUTES` constant (filtered, no dividers) for the Settings page allow-list and the Admin select dropdown to consume.

No new routes needed — `/calm` already exists in `App.tsx` line 121.

### 3. Calm session music

**Audio asset.** One royalty-free ambient loop. Requirements:

- Format: `.mp3` (broad browser support, smaller than `.ogg` for ambient pads). Stereo, 128 kbps target. Sub-1 MB ideal.
- Length: loop point clean. Target either ~10 s (one breath cycle = one bar) or ~20 s / ~30 s (clean multiples of 10).
- Style: ambient pad / drone, no melodic top line that would pull attention. Tonally neutral (one sustained chord works best).
- Licence: CC0 or equivalent — must be redistributable without attribution requirements that would clutter the UI.

Bundle at `client/src/assets/calm-loop.mp3`. Imported via Vite's static asset handling so the hash gets fingerprinted into the build output.

Sourcing plan: candidates I will evaluate before commit, in priority order:

1. Freesound.org CC0 ambient drones / pads.
2. Pixabay Music (CC0 / Pixabay Licence) ambient tracks.
3. Generative fallback — if no clean license-compatible asset surfaces, render a 20 s pad in-process using a single offline Web Audio render at build time and check the result in. Documented as "generated, no attribution required."

**Player wiring.** Inside `client/src/pages/Calm.tsx`:

- Import the asset: `import calmLoop from "@/assets/calm-loop.mp3";`
- Add a `useRef<HTMLAudioElement | null>(null)` and a `<audio>` element with `loop`, `preload="auto"`, `src={calmLoop}`. Audio is not visible (no `controls`).
- New helper hook `useCalmAudio()` returning `{ start, stop }`:
  - `start()` — sets `currentTime = 0`, awaits `play()`. Wrapped in `try/catch` for autoplay-blocked browsers; on rejection logs once and skips silently.
  - `stop()` — calls `pause()` and resets `currentTime = 0`.
- Hook into state machine:
  - When `state` transitions **into** `"breathing"`, call `start()`.
  - When it transitions **out of** `"breathing"`, call `stop()`.
  - On unmount, call `stop()`.
- Respect prefers-reduced-motion **and** a new user preference (Stage 18b candidate): for now we ship without an off-switch in settings; if the user wants one we add it as a follow-up.

**Autoplay caveat.** Modern browsers require a user gesture before audio plays. The breathing state is always entered via a button click (the "Begin" / "Continue" CTA in pre-capture), so the gesture chain is already satisfied. No need for an unlock primer.

**Volume.** Default to `0.6`. No UI control in this stage.

---

## Tests

New file `test/stage18-settings-nav-calm-music.test.ts` covering:

1. **GET `/api/settings`** returns `defaultLandingRoute` with a string value.
2. **PATCH `/api/settings` with valid route** persists and round-trips.
3. **PATCH `/api/settings` with invalid route** returns 400 and does not write.
4. **Sidebar NAV order** — render `<Layout/>` with a stub child, assert the first six nav items in DOM order are: Check-in, Calm, Capture, Coach, (divider), Today, Calendar.
5. **Sidebar Calm item** — clicking the Calm link navigates to `/calm`.
6. **Default landing redirect** — mount `<App/>` with settings stub returning `/checkin`, location `/`; assert navigate called with `/checkin`, `{replace: true}`.
7. **Default landing redirect skipped on deep link** — same stub, location `/coach`; assert navigate not called.
8. **Calm audio mounts** — render `<Calm/>` and confirm an `<audio>` element with `loop` is present with the bundled src.
9. **Calm audio starts on breathing phase** — fast-forward state to breathing, assert `play()` was called.
10. **Calm audio stops on unmount** — unmount the component, assert `pause()` was called.

Mocks: `HTMLMediaElement.prototype.play` and `.pause` are stubbed (vitest standard pattern) since jsdom doesn't implement them.

Target: keep test suite >= 438 passing (current baseline), add 10 new tests → 448 total.

---

## Files touched

```
server/app-settings.ts                  (+ key, + seed, + getter/setter)
server/routes.ts                        (extend /api/settings handlers)
client/src/components/Layout.tsx        (NAV reorder, export NAV_ROUTES)
client/src/pages/Admin.tsx              (new Default Landing Page card)
client/src/App.tsx                      (one-shot redirect effect)
client/src/pages/Calm.tsx               (audio ref + start/stop hooks)
client/src/assets/calm-loop.mp3         (new asset, ~1 MB)
test/stage18-settings-nav-calm-music.test.ts  (new)
```

Estimated diff: ~300 lines source + ~200 lines tests + 1 binary asset.

---

## Routing and credit notes for this build

- All work in this stage is **thread action** — interactive coding session.
- Credit cost estimate for the build: **low–medium**. Source/license search may need one or two web searches; build + test cycle is local. No subagents, no wide_research, no crons.
- The deploy is one VPS command (`sudo -u jod /opt/buoy/ops/deploy.sh`) — light cost, free of Perplexity credits.

---

## Open questions before coding

None — all decisions captured in Q&A:

| Decision | Answer |
|---|---|
| Default-page options | All top-level sidebar pages |
| Calm sidebar label | "Calm" |
| Calm sidebar route | `/calm` (existing) |
| Sidebar order | Check-in, Calm, Capture, Coach, divider, Today, Calendar, then existing |
| Music source | Built-in royalty-free loop, single track |
| Music sync | Tempo-matched (no realtime lock) |

---

## Sign-off

Sign off triggers implementation. Implementation follows the test-first, typecheck-first, build-first discipline established in earlier stages, with `Co-Authored-By: Oliver Daly <drjoliverdaly@wmu.com.au>` on the commit.
