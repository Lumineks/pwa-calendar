# Audit Checkpoint 1

Date: 2026-05-11
Model: opus-4.7
Repo HEAD: 5165bb3

## What runs

The local-only MVP runs cleanly on `npm run dev` after a one-time `nvm use 20.19.0`
(repo `.nvmrc` already says `20`; the audit host happened to be on Node 18, so the
build refuses to start without the switch). `npm run build` succeeds and produces
`dist/assets/index-*.js` at 194.59 kB (gzip 65.16 kB) and a 21.64 kB CSS bundle.
`npm run check` fails with exactly the 7 svelte-check errors the Phase 4 report
called out — every one is the `allowImportingTsExtensions` complaint against
`import … from './x.ts'` lines in `App.svelte`, `TokenGate.svelte`,
`WeekView.svelte`, `DayView.svelte`, `db.ts`. `tsc -p tsconfig.node.json` never
runs (the `&&` short-circuits).

`git log --oneline` shows five commits in the expected Phase 0 → 4 order with the
planned messages:

```
5165bb3 feat: phase 4 — dayview ui (textarea on lined paper, debounced autosave)
beeb40a feat: phase 3 — weekview ui (paper, spiral, day tabs, month picker)
feff645 feat: phase 2 — local data layer (dexie + repo + debounce)
565e1ff feat: phase 1 — frontend foundation (routing, auth store, token gate)
ba4c3ed chore: phase 0 — repo bootstrap (svelte 5 + vite + ts + tailwind v4.2)
```

`git status` is clean.

The full acceptance walk (a–h in the audit prompt) was performed through
`cursor-ide-browser` against `localhost:5173`. Every step behaved as PLAN.md
specified — screenshots in `audits/screenshots/audit-1/`:

| Step | Outcome | Screenshot |
|---|---|---|
| a — empty submit on TokenGate shows "Неверный код" | PASS | `audit1-step-a1-tokengate.png`, `audit1-step-a2-empty-error.png` |
| b — submit "audit-1-token" → `/week/2026-05-11`, 7 day tabs with correct Russian narrow names, Пн 11 highlighted as today | PASS | `audit1-step-b-weekview-current.png` |
| c — tap a tab → `/day/2026-05-12`, header reads "Вторник, 12 мая", indicator reads "Сохранено", textarea empty | PASS | `audit1-step-c-dayview-empty.png` |
| d — typed a 3-line Russian paragraph; lines sit on the paper rules; indicator settled on "Сохранено" | PASS | `audit1-step-d-dayview-typed.png`, `audit1-step-d2-saving-indicator.png` |
| e — Назад → `/week/2026-05-11`; Вт 12 card shows clipped preview ("Аудит 1: проверка / сохранения. / Вторая строка на линейке…") | PASS | `audit1-step-e-weekview-with-preview.png` |
| f — full page reload; token and entry both persist | PASS | `audit1-step-f-reload-persisted.png` |
| g — next/prev chevrons update URL and render the right dates (`/week/2026-05-18` then `/week/2026-05-04`) | PASS | `audit1-step-g-next-week.png` |
| h — "Сегодня" pill jumps back to `/week/2026-05-11` and disables itself on the current week | PASS | (covered by re-entry to `audit1-step-b-weekview-current.png`) |

No app-level console errors fired during any of the eight steps — the only
non-`[vite]` log lines are the audit host's own "native dialog overrides
installed" warnings.

The "Сохраняется…" transient state was not captured in a still image because the
300 ms debounce + the speed of the IndexedDB write closes the window before the
screenshot tool can fire; the saved-state cycle is verified by code review of
`src/routes/DayView.svelte` (the `oninput` handler sets `saveState = 'saving'`
synchronously before scheduling `save()`).

The blank-page bug noted in Phase 4 was reproduced cleanly from
`/day/garbage` and `/week/garbage` — see Bug 2 below.

## Visual fit vs. reference

Reference image: `assets/image-cb5873ec-2234-48d4-acd7-1ab9f3856dfc.png`
(Ukrainian-locale reference of "План недели — Ежедневник", week 19 of May 2026).
WeekView screenshot: `audits/screenshots/audit-1/audit1-step-b-weekview-current.png`.

| Element | Reference | Implementation | Verdict |
|---|---|---|---|
| Page split | Mon/Tue/Wed left, Thu/Fri/(Sat top half + Sun bottom half) right | Identical | Match |
| Today highlight | Deep red tab (Ср 6) | Deep red tab (Пн 11) | Match |
| Spiral binding | ~25 dense rings, wire-coil shading | 26 rings, simple oval gradient | Close; the rings read as ovals rather than coiled wire, but the density and color are right |
| Tab geometry | Notched outer corner (bottom-outer), rounded outer edge | Notched inner-bottom corner (toward the page), rounded outer edge | Mirrored from the reference — ours notches inward, the reference notches outward; both read as "torn tab" but ours is the opposite asymmetry |
| Paper color | Near-white off-cream | Warmer cream (`#fbf6e9`) | Acceptable — warmer feel, still "paper" |
| Lined background | Visible rules on every page | Visible rules on every page | Match |
| Day tab content | "Пн / 4 / ⤢" | "Пн / 11 / ↗" | Match (different arrow glyph, same meaning) |
| Background outside the spread | Watercolor seasonal scene (autumn leaves) | Warm gradient, no imagery | Intentional simplification per AGENTS.md "same spirit, simpler aesthetic" |
| Chrome (search, premium banner, nav bar) | Yes | No (out of scope) | Intentional |

Overall the implementation reads as the same archetype on first glance.
The only true visual gap I'd flag for a future polish pass (NOT a v1 blocker) is
the spiral-ring shading — the reference's rings look like a wound wire, ours
look like flat ovals. That's a CSS pseudo-element nicety, not an architectural
concern.

## Gaps vs. plan

| Gap | Severity | Notes |
|---|---|---|
| `npm run check` fails | medium | Exactly the 7 errors the Phase 4 report predicted (`allowImportingTsExtensions`). Pure tsconfig fix. See Bug 1. |
| Direct visits to `/day/<garbage>` and `/week/<garbage>` yield a blank page | medium | The in-component `$effect` calls `navigate(...)` but the running `Router` does not re-match. Reload fixes. See Bug 2. |
| Tailwind installed is v4.3.0 (PLAN.md/AGENTS.md say "v4.2") | trivial | Same major; the v4-native `@tailwindcss/vite` plugin is wired correctly. No action. |
| Vite scaffold leftovers still tracked (`src/lib/Counter.svelte`, `src/assets/{hero.png,svelte.svg,vite.svg}`) | trivial | Unused by the app; PLAN.md Phase 0 didn't require deleting them. Harmless. Defer to Phase 8 cleanup. |
| `tsconfig.app.json` does not match PLAN.md Phase 0 task 6 verbatim | trivial | PLAN.md said `tsconfig.json` should hold the strict flags; they live in `tsconfig.app.json` (which `tsconfig.json` references). Same effect; safer because the strict flags should apply to the app, not to root. PASS. |

## Bugs found

### Bug 1 — `svelte-check` fails with 7 `allowImportingTsExtensions` errors

**Reproduction.** `nvm use 20.19.0 && npm run check`. Each of the seven `.ts`
imports under `src/` is reported with:

> An import path can only end with a '.ts' extension when
> 'allowImportingTsExtensions' is enabled. (ts)

Imports flagged: `src/App.svelte:2` (`./state/auth.ts`), `src/data/db.ts:2`
(`./sync.ts`), `src/routes/TokenGate.svelte:2`, `src/routes/DayView.svelte:14,15`,
`src/routes/WeekView.svelte:13,14`. Build (`vite build`) is unaffected because
the bundler strips the suffix.

**Root cause.** The Phase 0 / Phase 1 code wrote literal `.ts` extensions on all
intra-`src/` imports (a Svelte 5 + TS habit that the latest Svelte tooling
endorses), but `tsconfig.app.json` extends `@tsconfig/svelte` and never opts in
to `allowImportingTsExtensions`. The base config uses
`moduleResolution: "bundler"` which is otherwise compatible with `.ts`-suffix
imports — only the explicit opt-in is missing. `noEmit: true` is already set,
which is the precondition for `allowImportingTsExtensions`.

**Fix scope.** Phase 4.5 (bundled with Bug 2 below). Single-line tsconfig change:

```jsonc
// tsconfig.app.json compilerOptions
"allowImportingTsExtensions": true,
```

No production code changes. `npm run check` should go green.

**Recommended approach.** Add `"allowImportingTsExtensions": true` to
`tsconfig.app.json` `compilerOptions`. No other file touched.

**Alternatives considered.**
1. Strip all `.ts` suffixes from imports across `src/` (~10 imports). Larger
   diff, churns five files, doesn't actually improve runtime behavior, and goes
   against the modern Svelte 5 docs convention. Rejected.
2. Switch `tsconfig.app.json` to a different base preset that already enables
   the flag. Larger churn; risks affecting unrelated compiler options.
   Rejected.

### Bug 2 — Blank page after direct visit to an invalid `/day/:date` or `/week/:isoMonday`

**Reproduction.** With a token set, paste `http://localhost:5173/day/garbage`
into the address bar. The URL bar updates to `http://localhost:5173/week/2026-05-11`
(or whatever the current ISO Monday is), but the body stays blank. The browser's
accessibility tree confirms an empty document (`role: document, children: []`).
Cmd-R (hard reload) fixes it. Same behavior on `/week/garbage`.
Screenshots: `audits/screenshots/audit-1/audit1-step-3-issueB-day-garbage-blank.png`,
`audit1-step-3-issueB-week-garbage-blank.png`.

**Root cause hypothesis (validated by code reading + observed behavior).** The
sequence is:

1. User navigates to `/day/garbage`. `svelte-routing`'s `Router` mounts and
   matches `/day/:date` with `params.date === 'garbage'`.
2. `DayView` mounts with `date = "garbage"`. `validInput` is `false`, so the
   main render short-circuits via `{#if validInput}` (page is blank by design,
   pending redirect).
3. `DayView`'s `$effect` fires after mount and calls
   `navigate('/week/2026-05-11', { replace: true })`.
4. The navigate succeeds: `history.replaceState` runs, `window.location.pathname`
   becomes `/week/2026-05-11`, `svelte-routing`'s internal `location` store
   updates.
5. The `Router` re-reads the location and its child `Route` components
   re-evaluate matches. But — and this is the failure — by this point in the
   same microtask, `DayView`'s render is already pinned to the old `Route`
   match. The `Route path="/week/:isoMonday"` element never gets a chance to
   mount a `WeekView`, and the `Route path="/day/:date"` element keeps its
   non-rendering `DayView` instance. Net result: nothing on screen.

By contrast, the root-redirect in `App.svelte` (lines 11–13) runs in the
component's `<script>` block BEFORE `<Router>` mounts. That mutates
`history.location` first and only then lets the `Router` initialize, so
`Router` reads the corrected URL on its first pass and matches `/week/:isoMonday`
correctly. The in-component `$effect` cannot do this because it runs strictly
after mount.

A hard reload works because the second load follows the App.svelte root-redirect
path through history-already-correct.

**Fix scope.** Phase 4.5 (small, isolated, ~1 hour). Covers Bug 2 plus the
trivial Bug 1 tsconfig flag.

**Recommended approach.** Option 2 — centralize date validation in `App.svelte`
alongside the existing root-redirect. Before the `<Router>` mounts, inspect
`window.location.pathname` against `/^\/day\/(\d{4}-\d{2}-\d{2})$/` and
`/^\/week\/(\d{4}-\d{2}-\d{2})$/`; if it doesn't match (or the date is invalid
via `date-fns/isValid`), `navigate(/week/<today>, { replace: true })` and let
the Router initialize on the corrected URL. Then drop the in-component
`$effect` redirects from `DayView.svelte` and `WeekView.svelte` — the App-level
gate makes them dead code. Single source of truth for "where to go on bad
input," matches the pattern already used for `/`, and removes two `$effect`
hooks per route that were already a workaround in disguise.

**Alternatives considered (ranked from simplest workaround to nuclear).**
1. `queueMicrotask(() => navigate(...))` inside each component's `$effect`.
   The microtask delay lets the Router commit before the redirect fires. Pro:
   one-line change per route. Con: race-y by construction (relies on
   svelte-routing's internal scheduling); doesn't deduplicate the validation
   logic; risks a one-frame flash of nothing followed by a correct render.
   Rank: 2nd choice if Option 2 turns out painful.
2. **Centralize validation in `App.svelte`** — recommended above.
3. Wrap each `<Route>` body in a `{#key params.date}` / `{#key params.isoMonday}`
   block to force a remount whenever the param changes. Pro: forces the Router
   tree to re-evaluate. Con: doesn't fix the fundamental "Router's
   already-pinned" issue, just hides it behind a remount that may flicker;
   solves the wrong layer.
4. Replace `svelte-routing` with a hand-rolled 50-LOC location store + match
   table. Big scope creep; deferred indefinitely.

**Why Phase 4.5 and not a fixup inside Phase 5.** Phase 5 [sonnet-4.6] is a
worker-only session — touching `worker/*` only. The frontend Router fix
deserves its own short session, in part so the Phase 5 agent doesn't lose
context-budget on it. Both bug fixes are tiny and isolated; one session covers
both.

## Design decisions reviewed

| # | Decision | Verdict | Rationale |
|---|---|---|---|
| 4a | Phase 3 page split: 3 left + Thu/Fri full + Sat-top/Sun-bottom split row on right | PASS | Matches the reference image exactly; PLAN.md's "Чт-Пт-Сб-Вс four-row right page" misread the reference. The Phase 3 agent corrected it. |
| 4b | Phase 3 added `side: 'left' \| 'right'` prop to `DayTab` | PASS | Necessary for the asymmetric `clip-path` notch; cleanly encapsulated on the component rather than leaked into the parent. |
| 4c | Phase 3 set `SpiralBinding count={26}` (default would be 8) | PASS | 8 rings would look sparse at the actual page height (~900 px); 26 rings hit the reference's ring density. The default in the component is 8 but only the call-site at 26 is used. |
| 4d | Phase 4 `pendingSave` boolean guard around `save.flush()` on unmount | PASS | Without it, every "open day → close day" without editing would call `putEntry` (because `util.ts`'s `flush` always fires the function), bumping `updatedAt` on every visit. Phase 6 sync would then push spurious writes to KV. The guard is small and correct. |
| 4e | Phase 4 `save.cancel()` in the body-load `$effect` cleanup on date change | REVISIT | Today the only way to change `date` while the component stays mounted is browser URL-bar navigation between two `/day/...` URLs (because `svelte-routing` reuses the same Route component when only params change). In that flow, `save.cancel()` drops uncommitted typing — silent data loss for the previous date. Not a Phase 4.5 blocker (Phase 4's primary path is Backwards-via-Назад which unmounts and runs `onDestroy(flush)`), but Phase 6 should switch this to `save.flush()` keyed by the *previous* date once the sync layer can reason about per-date queues. Recommend pre-task note in Phase 6 acceptance criteria. |
| 4f | Phase 4 fly direction `getISODay(parsed) <= 3 ? -40 : 40` at 220 ms `quintOut` | PASS | Mon-Wed (ISO 1-3) live on the left page and slide in from the left; Thu-Sun (ISO 4-7) live on the right and slide in from the right. Matches PLAN.md's "fly from the tab's page side". 220 ms is snappy enough to not feel laggy. |
| 4g | Phase 4 textarea `padding-top: 9px` to align text baselines with paper rules | PASS | Visual check in the typed-text screenshot confirms the three Russian lines sit *on* the rules. The `line-height: 28px` / `font-size: 16px Georgia` combination plus the 9 px push aligns the baseline with the rule, which is the goal. |

## AGENTS.md compliance

| Locked-in decision | Status | Notes |
|---|---|---|
| Svelte 5 with runes | ✅ | `$state`, `$props`, `$derived`, `$effect` used throughout the routes and components. `svelte@^5.55.5`. |
| `svelte-routing` | ✅ | `svelte-routing@^2.13.0` installed; `Router`/`Route`/`navigate` imported in `App.svelte`. |
| Tailwind v4 | ✅ | Installed as `tailwindcss@^4.3.0` + `@tailwindcss/vite@^4.3.0`. AGENTS.md / PLAN.md say "v4.2"; the v4-native plugin model is preserved (no `tailwind.config.js`, no `postcss.config.js`); `app.css` is just `@import "tailwindcss"`. Minor version drift only. |
| Dexie 4 | ✅ | `dexie@^4.4.2`; single `journal` DB, single `entries` table keyed by `date`. |
| date-fns with `ru` locale | ✅ | `date-fns@^4.1.0`; `import { ru } from 'date-fns/locale'` used in `DayView`, `WeekView`, `MonthPicker`, `DayTab`. |
| Russian-only UI strings | ✅ | All visible strings audited: "Введите код доступа", "Код", "Сохранить", "Неверный код", "Назад", "Сохранено", "Сохраняется…", "Ошибка сохранения", "Сегодня", "Выйти", "Предыдущая/Следующая неделя", "Неделя N, YYYY", "Запись на день", weekday and month names via `date-fns/locale/ru`. No English in user-visible copy. |
| UI never touches Dexie directly | ✅ | `rg "from 'dexie'"` matches only `src/data/db.ts`. |
| `src/data/sync.ts` is still the `markDirty` stub | ✅ | Two lines of no-op, exactly as Phase 6 expects. |
| svelte-routing `let:params` workaround in `App.svelte` | ✅ | Lines 19–26: `<Route path="/week/:isoMonday" let:params>` and `let:params` for `/day/:date`. |
| Root-redirect-in-script workaround in `App.svelte` | ✅ | Lines 11–13: pre-`Router` `navigate` only when `window.location.pathname === '/'`. |

## Conscious deviations still hold

| Deviation (per PLAN.md) | Status |
|---|---|
| No `BackupButton.svelte`, no `src/data/backup.ts` | ✅ Neither file exists; no reference to "backup" / "export" in any source file. |
| No in-app onboarding/install screen | ✅ Not present. The TokenGate is the only first-launch screen. |
| No test scaffolding (no Vitest, no Playwright, no fake-indexeddb) | ✅ `rg "vitest\|playwright\|fake-indexeddb"` returns nothing. `package.json` has no test deps and no test scripts. |
| `.gitignore` covers required paths | ✅ Covers `node_modules`, `dist`, `.wrangler`, `.dev.vars`, `.env`, `*.local` (which covers `.env.local`), `.DS_Store`. Phase 0 task 2 listed `.env.local` explicitly; the scaffold's `*.local` pattern is a strict superset. |
| No accidentally tracked secrets | ✅ `git ls-files \| rg "^\.env\|secret\|credential"` returns nothing. |
| `worker:dev` / `worker:deploy` placeholder scripts | ✅ Both present in `package.json`, echoing "worker not yet scaffolded — Phase 5". |

## PLAN.md edits made by this audit

- Inserted **Phase 4.5 [sonnet-4.6] — Frontend bugfix micro-phase** in the
  todos frontmatter (id `phase-4.5`), positioned between `phase-4`/`audit-1`
  and `phase-5`.
- Added a new **Phase 4.5** section to the body describing both fixes
  (tsconfig flag + centralize date validation in `App.svelte`), with
  prerequisites, tasks, deliverable, and acceptance criteria.
- Updated the **Model strategy** table to include the Phase 4.5 row.
- Updated the build-order Mermaid diagram so it now flows
  `A1 → P4.5 → P5`.
- Added a `Pre-task fixups` paragraph at the top of **Phase 5**'s Tasks
  section noting that Phase 4.5 must be merged first (so the worker code
  Phase 5 produces compiles against a passing `npm run check`).
- Added one bullet to **Phase 6**'s Tasks describing the data-loss edge case
  in `DayView`'s body-load `$effect` cleanup (`save.cancel()` vs.
  `save.flush()` once date-keyed sync queues exist).
- No other phases were edited. Phases 0–4 task lists are left intact, as
  required by the audit-checkpoint protocol.

## Recommendation

Run **Phase 4.5** next (single short sonnet-4.6 session) to land both fixes,
then proceed to Phase 5 as planned. Both bugs are real, both are isolated, both
are easier to fix now than after the cloud sync layer lands on top.
