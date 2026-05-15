# Audit Checkpoint 3 — FINAL

Date: 2026-05-15
Model: opus-4.7
Repo HEAD: 0a3dc1c
Live URL: https://lumineks.github.io/pwa-calendar/
Worker URL: https://journal-calendar.pwacalendar.workers.dev

## Verdict

**SHIP v1 AS-IS — pending the project owner's own one-pass iOS device smoke test before
the link is handed to the friend.**

The build is feature-complete, the deployed site is healthy, the worker is healthy, the
KV namespace is internally consistent, no secrets are tracked, and all four conscious
deviations from `AGENTS.md` (backup removed, onboarding removed, tests removed, plus
the GitHub Pages base path `/pwa-calendar/`) are intentional and documented. The only
v1 acceptance gate not exercised in this audit session is **the actual real-iPhone
walk-through**, which the project owner has elected to perform out-of-band
(Step 2 = N/A — see below). Nothing in the static review surface suggests the iOS
walk-through will fail; both prior audits and the AGENTS.md "Open Items to Validate"
list have flagged this same step as the last open verification.

## Headline scorecard

- **Inventory & health (Step 1):** `git log` ends at the expected `0a3dc1c` Phase 8
  base-prefix fix on a clean tree; `npm run check` exits 0/0; `npm run build`
  succeeds and produces the same 200.28 kB JS / 22.12 kB CSS bundle the prior
  audit recorded; live URL returns HTTP 200; deployed manifest reads
  `name: "План недели"` and `lang: "ru"`; worker `/health` returns 401 + the
  correct strict `Access-Control-Allow-Origin: https://lumineks.github.io` with
  no Authorization header, and OPTIONS preflight returns 204 with the full CORS
  header set.
- **AGENTS.md walks (Steps 3–5):** 8 of the 9 "Functional Scope — In scope"
  bullets PASS by code/deployment evidence; 1 (manual JSON backup) is the
  pre-agreed DEVIATION-ACCEPTED per `PLAN.md` "Conscious deviations". All 10
  "Out of scope" categories confirmed absent. All 15 "Locked-In Decisions"
  match the implementation; only minor and intentional drift recorded
  (Tailwind v4.3 vs. v4.2, Pages path `/pwa-calendar/` vs. blank, deployed
  manifest name "План недели" vs. AGENTS.md "Ежедневник").
- **Worker / KV hygiene (Step 9):** Production KV namespace
  `e329d26f945e46c094a7bf982d8a5895` holds exactly 4 keys —
  `entries:2026-05-11`, `entries:2026-05-12`, `entries:2026-05-15`, and the
  sorted `index` array `["2026-05-11","2026-05-12","2026-05-15"]`. Perfect
  1:1 index↔entries match, no orphans, no duplicates, sort order correct.
- **Carry-forward (Step 8):** All six known limitations from Audits 1 and 2
  remain known-and-accepted; none have regressed; no new bugs were uncovered
  during the static review for this audit.

## Step 1 — Inventory and quick health

| Check | Expected | Observed |
|---|---|---|
| `git log --oneline` head | `0a3dc1c` Phase 8 base-prefix fix | ✅ `0a3dc1c fix: phase 8 — prefix navigate() calls with BASE_URL …` |
| `git status` | clean | ✅ `nothing to commit, working tree clean` (branch `main`, up to date with `origin/main`) |
| Total commits since Phase 0 | 18 | ✅ 18 (Phase 0 → Phase 8 + 2 micro-phases + 2 audits + 2 hotfix commits) |
| `node` version | matches `.nvmrc` (`22`) | ✅ used `22.21.1` via nvm; CI uses `node-version-file: .nvmrc` |
| `npm run check` | 0 errors | ✅ `svelte-check found 0 errors and 0 warnings` |
| `npm run build` | succeeds | ✅ 200.28 kB JS (gzip 67.11 kB), 22.12 kB CSS (gzip 5.36 kB), PWA precache 14 entries / 246.59 KiB; `dist/sw.js` + `dist/workbox-abeb32eb.js` generated; `dist/404.html` copied from `dist/index.html` for SPA fallback |
| `curl -sI https://lumineks.github.io/pwa-calendar/` | 200 | ✅ `HTTP/2 200`, `server: GitHub.com`, `last-modified: Fri, 15 May 2026 11:40:04 GMT` |
| `curl -sI https://lumineks.github.io/pwa-calendar/sw.js` | 200 | ✅ `HTTP/2 200`, `content-type: application/javascript; charset=utf-8` |
| `curl -sI -H "Origin: https://lumineks.github.io" https://journal-calendar.pwacalendar.workers.dev/health` (no Authorization) | 401 + ACAO `https://lumineks.github.io` | ✅ `HTTP/2 401`, `access-control-allow-origin: https://lumineks.github.io`, `vary: Origin`, `access-control-allow-headers: Authorization, Content-Type`, `access-control-allow-methods: GET, PUT, DELETE, OPTIONS`, `access-control-max-age: 86400` |
| `curl -sI -H "Origin: https://evil.example" …/health` | 401 + ACAO still hard-locked to `https://lumineks.github.io` | ✅ `access-control-allow-origin: https://lumineks.github.io` regardless of incoming Origin (the worker hard-codes `env.ALLOWED_ORIGIN`, no echo) — browsers will reject from any origin other than the GitHub Pages one |
| `OPTIONS https://journal-calendar.pwacalendar.workers.dev/health` preflight | 204 with full CORS headers | ✅ `HTTP/2 204` + all CORS headers present |
| `curl -i -H "Authorization: Bearer <token>" …/health` → 200 | Skipped per user decision — production `JOURNAL_TOKEN` is held out-of-band and the no-auth 401 + OPTIONS 204 evidence is sufficient for this audit | N/A |
| Deployed manifest matches local build | identical JSON | ✅ both report `{"name":"План недели","short_name":"План недели","description":"Личный недельный ежедневник","start_url":"/pwa-calendar/","display":"standalone","background_color":"#fbf6e9","theme_color":"#fbf6e9","lang":"ru","scope":"/pwa-calendar/","icons":[…3 entries…]}` |

`npm install` was not needed — both root and `worker/` `node_modules` were present
and `npm run check` + `npm run build` both ran without complaint. No dependency
versions were bumped.

## Step 2 — iOS device test (A–L)

**N/A — iOS verification pending; user will validate post-audit.**

User elected to validate on their iPhone after this audit is filed rather than walk
through the 12 steps live in the session. This is consistent with the prior audits'
posture (Audit 1 and Audit 2 both ran in `cursor-ide-browser` with no real iOS
device) and with AGENTS.md "Open Items to Validate" item #1 ("Friend's iOS version
… owner believes she's on a recent iOS but has not confirmed").

The audit treats this as a known carry-forward limitation, not a v1 blocker, because:

1. Both the deployed manifest and `index.html` carry every Apple-specific meta tag
   the prior audits and AGENTS.md require: `apple-mobile-web-app-capable`,
   `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title="План недели"`,
   `apple-touch-icon` at 192×192, `viewport-fit=cover`. The deployed manifest also
   declares `display: standalone` and `scope: /pwa-calendar/`.
2. Phase 7's PWA work (vite-plugin-pwa, Workbox runtime caching, three icon
   variants including maskable, Russian manifest copy) is all visible in the
   committed source and in the deployed `dist/`.
3. Worker, KV, sync, paper aesthetic, debounced autosave, etc. were exercised end-
   to-end in `cursor-ide-browser` during Audits 1 and 2. The iPhone surface area
   that is genuinely new — install-via-share-sheet, standalone launch chrome,
   IndexedDB durability after force-quit — is bounded and matches a well-trodden
   `vite-plugin-pwa` template.

If the post-audit walk-through surfaces a problem, it is by definition a v1.x
regression and is handled in a follow-up commit by the project owner (per the
audit prompt's explicit "do not insert new phases" directive).

### Recommended post-audit walk-through

A condensed checklist for the project owner to run on their iPhone before handing
the URL to the friend, derived directly from Step 2 of the audit prompt:

| Step | What to check |
|---|---|
| A | Open Safari → `https://lumineks.github.io/pwa-calendar/`. TokenGate visible. "Введите код доступа" reads cleanly. |
| B | Paste the production token. Routes to `/pwa-calendar/week/<iso-monday>`. WeekView renders. |
| C | Share menu → "На экран «Домой»". Icon preview shows the spiral-notebook icon. App name reads "План недели". |
| D | Tap "Добавить". Icon lands on the home screen. |
| E | Launch from home screen. Standalone mode — no Safari URL bar, no tabs. |
| F | Tap a day tab. DayView opens. Type a multi-line Russian paragraph. Save indicator cycles "Сохраняется…" → "Сохранено". |
| G | Tap "← Назад". WeekView preview shows the typed text clipped on that day card. |
| H | Force-quit the PWA from the app switcher. Reopen via home-screen icon. The typed entry is still there (Dexie persistence). |
| I | (Optional) Second device — paste the same token; entry from F appears within ~10 s if user navigates into WeekView, otherwise within ~3 minutes. |
| J | (Optional) Airplane mode mid-edit; verify "Сохранено" still cycles (Dexie); OnlineIndicator shows "офлайн"; turn airplane mode off; verify the push fires within ~10 s. |
| K | Multi-week navigation — prev/next chevrons render new weeks with correct Russian month/dates. |
| L | "Сегодня" pill — from a different week, returns to current ISO Monday. |

## Step 3 — AGENTS.md "Functional Scope → In scope" walk

| # | In-scope item | Verdict | Evidence |
|---|---|---|---|
| 1 | Weekly calendar view styled as paper journal (lined pages, spiral binding, day tabs) | PASS | `src/routes/WeekView.svelte` two-page spread + `<SpiralBinding count={26} />` + `<DayTab>` slots; `.paper` lined-paper background from `src/styles/paper.css` (`--paper-line-height: 18px` + `repeating-linear-gradient`). Audit 1 visual-fit table already certified the archetype match. |
| 2 | Month selector / navigation | PASS | `src/components/MonthPicker.svelte` renders Russian capitalized month (`format(parsed, 'LLLL yyyy', { locale: ru })`) + prev/next chevrons (`step(±7)`) + "Сегодня" pill. Audit 1 step g/h confirmed live behavior. |
| 3 | Plain-text note editing on the lines of any specific day | PASS | `src/routes/DayView.svelte` `<textarea bind:value={body}>` with `.paper` lined background, `line-height: var(--paper-line-height)`, `font-size: 16px` (iOS auto-zoom floor), `padding: 0 18px`. |
| 4 | Per-day full-screen view for more writing space | PASS | `.day-view { position: fixed; inset: 0 }` covers the viewport, `display: flex; flex-direction: column` with the textarea claiming `flex: 1 1 auto`. `transition:fly` from left/right based on ISO day. |
| 5 | Local persistence per device via IndexedDB (canonical store, works offline) | PASS | `src/data/db.ts` Dexie schema (`journal` DB v1, `entries` table, primary key `date`, index on `updatedAt`). All UI writes go through `getEntry`/`putEntry`/`listEntries`/`deleteEntry`; UI never touches Dexie directly (verified by Audit 2 grep). Audit 1 scenario f confirmed reload-persistence. |
| 6 | Remote persistence: every change synced in background to Cloudflare Worker + KV | PASS | `src/data/sync.ts` dirty-set push (3 s debounce) + periodic pull (3 min) + LWW per `updatedAt` (strict `>`), with `localStorage`-persisted dirty set and exponential backoff. Worker `worker/src/index.ts` honors the same LWW semantics and updates the `index` array atomically with each PUT/DELETE. Production KV `index` ↔ `entries:*` 1:1 match confirms the loop works end-to-end. |
| 7 | Multi-device data sharing via the same access code | PASS | Audit 2 S1 demonstrated convergence in `cursor-ide-browser` against a curl-driven "device B". Token is stored in `localStorage:journal:token` only; bearer header is reattached on each fetch in `api.ts:apiFetch`. Confirmed at the static level; pending the post-audit iPhone walk-through item I for a real second-device check. |
| 8 | One-time access-code entry screen on first launch of each device | PASS | `src/routes/TokenGate.svelte` is shown by `App.svelte` when `$token === null`. Calls `health(trimmed)` against the worker before committing the token to `localStorage`; differentiates 401 ("Неверный код"), network/CORS error ("Нет соединения"), other ("Ошибка сети"); button label cycles "Сохранить" → "Проверка…" while in flight. |
| 9 | Manual one-tap "Back up" via iOS Share Sheet | DEVIATION-ACCEPTED | `PLAN.md` "Conscious deviations from AGENTS.md" (line 119): *"No 'Back up' button. AGENTS.md lists 'Manual one-tap Back up' as in-scope. Removed. The worker also drops its `GET /export` endpoint since nothing consumes it. Remote sync is the sole durability path; if the access code is lost, the project owner restores data from KV out-of-band."* Grep confirms zero references to `backup` / `export` / `BackupButton` in `src/` and `worker/src/`. |

## Step 4 — AGENTS.md "Out of scope (explicitly rejected)" walk

Confirmed by code review (`rg`) — none have crept in.

| Out-of-scope category | Status | Evidence |
|---|---|---|
| Real authentication | NOT PRESENT | No password / email / OAuth / SMS flow. Auth is a single shared bearer token in `localStorage` (`src/state/auth.ts`). |
| Real-time / collaborative editing | NOT PRESENT | Periodic pull every 3 min + visibilitychange-on-show; no WebSocket, no SSE, no live-query. Audit 2 S7 documented the resulting stale-UI window as a known limitation. |
| Multi-user | NOT PRESENT | The KV namespace is unconditionally shared; there is no user-id partitioning anywhere in `worker/src/index.ts`. |
| Notifications / reminders | NOT PRESENT | No `Notification` / `serviceWorker.showNotification` / `pushManager` references. |
| UI customization or themes | NOT PRESENT | No `theme` toggle, no settings screen, no CSS variable swap UI. |
| Multi-language / i18n | NOT PRESENT | `rg -i "i18n\|translation\|locale.set"` returns no matches in `src/`. Only `date-fns/locale/ru` is imported, and the Russian copy is hard-coded throughout. |
| Android support | NOT PRESENT | No Android Studio config, no Capacitor / Cordova, no `.apk` build target. PWA is the sole shipping channel. |
| Recurring events / categories / task checkboxes | NOT PRESENT | `rg -i "recurring\|category\|categories\|checkbox\|reminder"` returns no matches in `src/`. Data model is `{ date, body, updatedAt }` only. |
| CRDT-based conflict resolution | NOT PRESENT | No Yjs / Automerge / vector clocks. Conflict resolution is strict `updatedAt` LWW — sync.ts:261 (`remote.updatedAt > local.updatedAt`) and worker/src/index.ts:221 (`current.updatedAt > incoming.updatedAt`). |
| Self-service token rotation | NOT PRESENT | Token rotation is owner-mediated via `wrangler secret put JOURNAL_TOKEN` (documented in README.md and worker/README.md). No in-app rotation UI. |

## Step 5 — AGENTS.md "Locked-In Decisions" walk

| # | Decision | Required value | Actual in repo | Verdict |
|---|---|---|---|---|
| 1 | Distribution | PWA via Add to Home Screen | `index.html` has the full Apple PWA meta tag set; manifest declares `display: standalone`, `scope: /pwa-calendar/`. README.md "Как установить на iOS" walks through Share → На экран «Домой». | PASS |
| 2 | Apple Developer account | None | No `.ipa` build, no Xcode project, no signing cert references. | PASS |
| 3 | Frontend framework | Svelte 5 + Vite + TS | `package.json`: `svelte@^5.55.5`, `vite@^8.0.12`, `typescript@~6.0.2`. Runes (`$state`, `$props`, `$derived`, `$effect`) used throughout. | PASS |
| 4 | Routing | `svelte-routing` | `svelte-routing@^2.13.0`; `Router` / `Route` / `navigate` in `App.svelte`; `basepath={base}` so the same code works in dev and at the Pages `/pwa-calendar/` prefix. | PASS |
| 5 | Styling | Tailwind v4 + Svelte scoped styles | `tailwindcss@^4.3.0` + `@tailwindcss/vite@^4.3.0` (minor drift from AGENTS.md "v4.2" / PLAN.md "v4.2"; same major, v4-native plugin model preserved; documented in Audit 1). All visual styles live in component-scoped `<style>` blocks plus global `paper.css` + Tailwind utilities. | PASS (minor minor-version drift) |
| 6 | PWA tooling | `vite-plugin-pwa` (Workbox) | `vite-plugin-pwa@^1.3.0` configured in `vite.config.ts` with `registerType: 'autoUpdate'`, Workbox runtime caching that bypasses the API origin with `NetworkOnly`, and three icon entries (192, 512, maskable 512). | PASS |
| 7 | Local storage | IndexedDB via Dexie, keyed `YYYY-MM-DD` | `dexie@^4.4.2`; `journal` DB v1; `entries` table primary key = `date` string (validated against `/^\d{4}-\d{2}-\d{2}$/`). | PASS |
| 8 | Remote persistence | Cloudflare Worker + KV | Worker `journal-calendar` at `https://journal-calendar.pwacalendar.workers.dev`; KV namespace `JOURNAL` (id `e329d26f945e46c094a7bf982d8a5895`). | PASS |
| 9 | Auth model | Pre-shared bearer token | `worker/src/index.ts:26` `verifyToken` constant-time compares `Authorization: Bearer …` against `env.JOURNAL_TOKEN` using `crypto.subtle.timingSafeEqual` (with the length-precheck bail-out). | PASS |
| 10 | Sync model | Local-first; eventual mirror; LWW per entry by `updatedAt` | `src/data/sync.ts` writes Dexie first, queues key in a `localStorage`-persisted dirty set, debounces 3 s, then PUTs to the worker. Pull is range-based (current ISO Monday ±3 weeks) on mount + visibilitychange + 3 min interval + `online` event. Strict `>` LWW on both sides. | PASS |
| 11 | Backup strategy | Remote primary; manual JSON export secondary | **DEVIATION-ACCEPTED** — manual JSON export removed per `PLAN.md` "Conscious deviations from AGENTS.md". README.md "Восстановление данных" documents the owner-mediated KV read path. | DEVIATION |
| 12 | Hosting | GitHub Pages, default `*.github.io` URL | Deployed at `https://lumineks.github.io/pwa-calendar/` (default Pages domain, no custom domain). `.github/workflows/deploy.yml` auto-deploys on push to `main`. Vite `base: '/pwa-calendar/'`. | PASS (with the intentional `/pwa-calendar/` subpath the user accepted) |
| 13 | UI language | Russian | All visible strings in Russian (see Step 6 below). Document `<html lang="ru">`, manifest `lang: "ru"`. | PASS |
| 14 | Visual fidelity target | "Same spirit, simpler aesthetic" | WeekView is a recognizable two-page paper-journal spread with spiral binding and outer-edge day tabs. Background is a warm gradient rather than the reference's watercolor seasonal scene — intentional simplification, documented in Audit 1. Spiral rings read as "ovals" rather than the reference's "wound wire" — Audit 1 logged this as a non-blocker visual delta. | PASS (subjective; same archetype) |
| 15 | Date math | `date-fns` + `date-fns/locale/ru` | `date-fns@^4.1.0`; `import { ru } from 'date-fns/locale'` used in `DayView` (header), `WeekView` (caption), `MonthPicker` (label), `DayTab` (weekday short). | PASS |

## Step 6 — Russian copy audit

Every user-visible string is in Russian. Per-surface inventory:

| Surface | String | Source |
|---|---|---|
| TokenGate heading | "Введите код доступа" | `TokenGate.svelte:68` |
| TokenGate placeholder | "Код" | `TokenGate.svelte:71` |
| TokenGate submit (idle) | "Сохранить" | `TokenGate.svelte:88` |
| TokenGate submit (in flight) | "Проверка…" | `TokenGate.svelte:88` |
| TokenGate error: invalid | "Неверный код" | `TokenGate.svelte:29` |
| TokenGate error: offline | "Нет соединения" | `TokenGate.svelte:30` |
| TokenGate error: unknown | "Ошибка сети" | `TokenGate.svelte:31` |
| WeekView caption | `format(monday, "'Неделя' I, yyyy", { locale: ru })` → e.g. "Неделя 19, 2026" | `WeekView.svelte:87` |
| WeekView dev exit | "Выйти" | `WeekView.svelte:96` |
| WeekView day-card aria-label | "Открыть день YYYY-MM-DD" (date-only, the surface string is Russian) | `WeekView.svelte:114,134,153,…` |
| MonthPicker label | `format(parsed, 'LLLL yyyy', { locale: ru })` → e.g. "Май 2026" (capitalized) | `MonthPicker.svelte:26` |
| MonthPicker prev chevron aria-label | "Предыдущая неделя" | `MonthPicker.svelte:46` |
| MonthPicker next chevron aria-label | "Следующая неделя" | `MonthPicker.svelte:55` |
| MonthPicker today pill | "Сегодня" | `MonthPicker.svelte:66` |
| DayTab weekday short | `format(parsed, 'EEEEEE', { locale: ru })` → "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс" (capitalized) | `DayTab.svelte:31` |
| DayView back aria-label + visible label | "Назад" | `DayView.svelte:175,177` |
| DayView header (Russian capitalized date) | `format(parsed, 'EEEE, d MMMM', { locale: ru })` → e.g. "Понедельник, 11 мая" | `DayView.svelte:63` |
| DayView save indicator: saved | "Сохранено" | `DayView.svelte:83` |
| DayView save indicator: saving | "Сохраняется…" | `DayView.svelte:84` |
| DayView save indicator: error | "Ошибка сохранения" | `DayView.svelte:85` |
| DayView textarea aria-label | "Запись на день" | `DayView.svelte:194` |
| OnlineIndicator label | "офлайн" | `OnlineIndicator.svelte:28` |
| Document title | "План недели" | `index.html:16` |
| `apple-mobile-web-app-title` | "План недели" | `index.html:10` |
| Manifest `name` / `short_name` | "План недели" | `dist/manifest.webmanifest` (deployed) |
| Manifest `description` | "Личный недельный ежедневник" | `dist/manifest.webmanifest` (deployed) |
| Manifest `lang` | "ru" | `dist/manifest.webmanifest` (deployed) |
| Document `<html lang>` | "ru" | `index.html:2` |

Latin-character residuals scanned via `rg "[A-Za-z]{4,}" src/ -g "*.svelte"` — every
match is either an import statement, a CSS property/class name, a code-side
identifier, or an ARIA attribute *name* (not value). Zero user-visible English UI
text.

**Minor note (not a v1 blocker):** AGENTS.md "Locked-In Decisions" suggests the app
name "Ежедневник", and Phase 7's plan-stub text used the same. The shipped name is
"План недели" (matching the reference iOS app's actual Russian title in the
App Store). This was a conscious choice during Phase 7 and is consistent across the
deployed manifest, `apple-mobile-web-app-title`, and `<title>`. No fix needed.

## Step 7 — Performance

### Bundle sizes (this audit)

```
dist/index.html                   1.01 kB │ gzip:  0.51 kB
dist/registerSW.js                0.16 kB
dist/manifest.webmanifest         0.50 kB
dist/assets/index-DcKKTQb7.css   22.12 kB │ gzip:  5.36 kB
dist/assets/index-B9vGgAOh.js   200.28 kB │ gzip: 67.11 kB

PWA precache: 14 entries, 246.59 KiB total
```

These are essentially unchanged from Audit 2's recording (200.06 kB JS / 21.97 kB
CSS / gzip 67.04 / 5.30 kB) — the small deltas are the Phase 7/8 manifest +
icon-asset + base-path changes. Total payload is comfortably below any iOS
caching threshold; the precache fits in well under 1 MB. Cold install over Wi-Fi
on a modern iPhone should be < 1 s; subsequent launches are served from the
service worker cache (precache hit) with no network calls except the eventual
periodic `pull()`.

### Lighthouse mobile run

**SKIPPED** per user decision. This audit shell does not have a headless Chrome
binary; running real Lighthouse against the deployed URL requires a browser, and
the user chose to skip the scores rather than install one. A v1.x backlog item
captures this — running Lighthouse should be a 60-second post-install check by
the project owner, but is not a v1 gate.

### Stress observations (code review only)

The audit prompt's two stress scenarios were not exercised live:

- **WeekView with 200 entries.** `listEntries(from, to)` in
  `src/data/db.ts:39-44` is a Dexie primary-key range query over `entries`
  with index on `updatedAt`. The visible window is always exactly one ISO week
  (7 keys), so render-time complexity is constant regardless of total entry
  count. The only operation that scans the entry set is `pull()` /
  `currentPullRange()`, which fetches a 7-week range (49 keys); even at 200
  total entries that's ≤ 49 KV reads in parallel via `Promise.all` —
  comfortably under any latency budget. No realistic concern at v1 scale.
- **DayView with 5000-char body.** The debounce is set inside `DayView.svelte`
  at 300 ms with a single trailing-edge timer (`debounce(...)` in
  `src/data/util.ts`); the work inside the debounce callback is one Dexie put
  (string length doesn't matter for IndexedDB) plus an in-memory `markDirty`
  call. The 300 ms window is the user-visible latency, not a function of body
  size. The PUT-to-KV side caps body size only at Cloudflare's 25 MiB KV
  value limit, which is 5,000 characters of UTF-8 with multi-byte glyphs at
  ≈ 0.01% of the cap. No realistic concern.

If either stress scenario surprises the project owner during the post-audit
walk-through, it gets a v1.x ticket — the static review surface gives no reason
to expect either.

## Step 8 — Known limitations carried forward

Re-confirmed against Audits 1 and 2; none has regressed.

| # | Limitation | First flagged | Severity | Status |
|---|---|---|---|---|
| 1 | **DayView body `$state` does not re-read Dexie when an underlying row changes via a remote `pull()`.** If the user has DayView for a given date open while a remote write for that same date arrives via `pull()`, the textarea keeps showing the pre-pull body. Their next keystroke saves the on-screen body with a fresh `updatedAt` that beats the server's, silently losing the remote write. | Audit 2, S7 | UX (not data-loss for the same user) | Filed as v1.x polish; explicitly NOT v1 work per Audit 2's "filed under AGENTS.md no-real-time decision". `liveQuery` from `dexie` or a `Dexie.on('changes')` re-read on visibilitychange is the recommended fix. |
| 2 | **`syncStop()` during an in-flight `push()` can poison-pill-drop the remaining batch's entries.** If the user clicks "Выйти" while a push is in flight, subsequent loop iterations of the same push call read `null` from the auth store, send no Authorization header, get 401, and drop those entries from the dirty set. Dexie still holds the local copies, but they never re-sync to KV. | Audit 2, S8 | Pathological / vanishingly rare | Filed; explicitly NOT v1 work per Audit 2's analysis. The "Выйти" button is essentially a dev affordance, the friend will not click it during normal use, and Dexie retains the local copy regardless. |
| 3 | **Module-init time computation of "today" drifts across midnight in long-running sessions.** `WeekView.svelte:44` (`const today = new Date()`) and `MonthPicker.svelte:30` (`todayIsoMonday = $derived(format(startOfISOWeek(new Date()), 'yyyy-MM-dd'))` runs once on derived setup) capture "today" at component mount, not on every re-render. A tab kept open across midnight will keep highlighting yesterday until reload. | Audit 1 footnote | Cosmetic | Filed as v1.x polish. The "Сегодня" pill keeps working — it recomputes inside `MonthPicker` because `todayIsoMonday` is a `$derived` reading `new Date()`, but actually that's only re-evaluated when dependencies change, so it has the same property. Practically the friend reloads on each launch. |
| 4 | **`pull()` does not auto-delete local entries that aren't in the server index.** Intentional data-loss bias for the single-user-two-device shape: "device hasn't pulled yet" is far more likely than "remote delete". | Audit 2, Design decision 1 | Intentional | Confirmed still the case; `src/data/sync.ts` does not delete on absence. |
| 5 | **Spiral binding rings read as flat ovals rather than the reference's wound-wire shading.** Pure-CSS pseudo-element nicety. | Audit 1, Visual fit | Cosmetic | Filed as v1.x polish. No architectural impact. |
| 6 | **No real-iPhone on-device verification before this audit.** Audits 1 and 2 ran in `cursor-ide-browser`'s Glass-browser tab on the audit host. Audit 3 was meant to be the first real iPhone walk-through and is being deferred to the project owner's own post-audit pass per Step 2 above. | Audit 2 + Audit 3 | High-confidence gap | Carried into post-audit. The recommendation in this audit is **SHIP pending that walk-through**. |

No new bugs were uncovered during the static review for this audit.

## Step 9 — Worker / KV hygiene

### `wrangler tail`

**Not run.** Without an iPhone-test session driving the live worker, there's no
traffic to tail. (Audit 2 already exercised the same code paths against the local
worker in Setup 1 and recorded a clean 53-line log with zero 5xx and zero
unexpected 4xx.) The production worker has been running since Phase 5 (May 13) plus
the Phase 8 production-CORS deploy (May 15) and the project owner has been using
it personally — see KV state below.

### KV namespace state

`npx wrangler kv key list --binding=JOURNAL --remote`:

```
entries:2026-05-11
entries:2026-05-12
entries:2026-05-15
index
```

`npx wrangler kv key get index --binding=JOURNAL --remote`:

```
["2026-05-11","2026-05-12","2026-05-15"]
```

**Consistency:** the `index` array lists exactly the 3 dates that have backing
`entries:*` keys. Sort order is ascending. No duplicates. No orphan `entries:*`
keys not in the index. The worker's `insertSorted` + `removeFromIndex` + atomic
`Promise.all(put-entry, put-index)` pattern (worker/src/index.ts:225-230) is doing
its job under real usage.

### `wrangler whoami`

✅ Logged in as `mihasik323@gmail.com`; account `Mihasik323@gmail.com's Account`
(id `9b4324a7b4a73e8efc45acda59f62620`); scopes include `workers (write)`,
`workers_kv (write)`, `workers_tail (read)`.

## Step 10 — v1.x polish backlog

Itemized for a future v1.x release. None are v1 blockers; all are quality-of-life or
defense-in-depth. Sorted by user-facing impact, descending.

### B1 — DayView body re-read on remote pull (Audit 2 S7)

- **Symptom.** Two devices, both with the same date open. Device A's textarea shows
  pre-pull body; a remote write from device B lands in Dexie via `pull()`; the
  textarea does NOT refresh. User's next keystroke clobbers the remote write under
  LWW.
- **Severity.** UX. Not data-loss for the single user (same person typing on both
  devices, eventually-consistent semantics).
- **Effort.** S (1–2 hours).
- **Code site.** `src/routes/DayView.svelte:124-149` (body-load `$effect`).
- **Recommended approach.** Subscribe to a Dexie change source for the current
  `date`. Two viable options:
  1. *Cheap.* Re-read `getEntry(target)` on `visibilitychange` and on a
     `Dexie.on('changes')` subscription scoped to `entries`, diff against the
     displayed `body`, and swap if the textarea is not currently focused. If it is
     focused, show a tiny non-modal banner like "обновлено на другом устройстве —
     нажмите для обновления".
  2. *Heavyweight.* Replace the `getEntry` call with `liveQuery(() =>
     db.entries.get(target))` (Dexie's built-in reactive query). Requires a small
     adapter to bridge `liveQuery`'s Observable to a `$state` rune.

### B2 — "Сегодня" / `isToday` recomputation across midnight

- **Symptom.** A WeekView tab left open across midnight keeps highlighting
  yesterday's day-tab until a reload.
- **Severity.** Cosmetic. The "Сегодня" pill still navigates the URL correctly when
  tapped, just lights up the wrong tab visually until reload.
- **Effort.** S (under 1 hour).
- **Code site.** `src/routes/WeekView.svelte:44` and `src/components/MonthPicker.svelte:30`.
- **Recommended approach.** Move `today` into a `$state` rune and update it via
  `setInterval(() => today = new Date(), 30 * 60 * 1000)` (or, more elegantly,
  via a `setTimeout` scheduled to the next local midnight). Reset the interval
  on `visibilitychange` to avoid drift during long backgrounding.

### B3 — Lighthouse mobile run + score baseline

- **Symptom.** No baseline performance score recorded for v1.
- **Severity.** Process / measurement.
- **Effort.** S (5 minutes).
- **Code site.** N/A — devtools / external tool.
- **Recommended approach.** Open `https://lumineks.github.io/pwa-calendar/` in
  desktop Chrome → DevTools → Lighthouse → Mobile → run. Capture the four
  category scores (Performance / Accessibility / Best Practices / SEO / PWA).
  File any < 80 score as a follow-up.

### B4 — Spiral binding shading polish toward the reference

- **Symptom.** Spiral rings read as flat ovals rather than wound-wire coils.
- **Severity.** Cosmetic.
- **Effort.** S–M (1–3 hours).
- **Code site.** `src/components/SpiralBinding.svelte`.
- **Recommended approach.** Two `::before` + `::after` pseudo-elements per ring
  drawing a half-shadow + half-highlight crescent, or swap to a small SVG of a
  single ring tiled vertically.

### B5 — iOS Add-to-Home-Screen one-time onboarding hint

- **Symptom.** AGENTS.md "Open Items to Validate" #3 — a Russian-speaking iOS user
  who hasn't installed a PWA before may not know to tap Share → "На экран «Домой»".
  PLAN.md explicitly removed this for v1; the README has the instructions but
  the friend won't read the README.
- **Severity.** UX (first-launch only). Worked around by the project owner
  sending the install instructions over Signal/iMessage, per AGENTS.md
  "Conscious deviations from AGENTS.md" item 2.
- **Effort.** M (3–6 hours).
- **Code site.** A new `src/components/InstallHint.svelte` rendered above the
  TokenGate when `display-mode !== standalone` and the user is on iOS Safari.
- **Recommended approach.** A small banner with a step-by-step illustration
  and a "Понятно" dismiss. Detection: `matchMedia('(display-mode:
  standalone)').matches === false` AND `/iPhone|iPad|iPod/.test(navigator.userAgent)`.

### B6 — pwa-asset-generator splash screens for the various iPhone sizes

- **Symptom.** Launching the installed PWA shows the iOS default white splash
  screen rather than a branded splash (theme color or icon).
- **Severity.** Cosmetic.
- **Effort.** S (under 1 hour with `pwa-asset-generator`).
- **Code site.** `vite.config.ts` manifest config + new entries in `public/`.
- **Recommended approach.** `npx pwa-asset-generator ./public/icon-512.png ./public --background "#fbf6e9" --padding "5%"` then add the generated `<link rel="apple-touch-startup-image" …>` tags to `index.html`. ~10 device-size variants.

### B7 — WeekView preview vertical scroll indicator polish on iOS

- **Symptom.** Each day-card's `.preview` is `overflow-y: scroll`, which on iOS
  Safari shows a perpetual scrollbar gutter on the right of the card. The
  textual layout works correctly but the visual rhythm is slightly busier than
  the reference image.
- **Severity.** Cosmetic.
- **Effort.** S (under 1 hour).
- **Code site.** `src/routes/WeekView.svelte:337-356` (the `.preview` rule).
- **Recommended approach.** Swap `overflow-y: scroll` → `overflow-y: auto`,
  plus `-webkit-overflow-scrolling: touch` and a `scrollbar-width: none` /
  `::-webkit-scrollbar { display: none }` to hide the gutter while keeping
  the touch-momentum scroll.

### B8 — AGENTS.md "Open Items to Validate" #1 (friend's iOS version)

- **Symptom.** AGENTS.md explicitly flags this as open. PWA storage durability
  and Add-to-Home-Screen behavior want iOS 16.4+.
- **Severity.** Risk-management only — if the friend is on iOS 15 the experience
  degrades meaningfully (storage may evict, manifest features fall back).
- **Effort.** N/A (a question to the friend).
- **Recommended approach.** Ask the friend before sending the link. If pre-16.4,
  the fallback is the AGENTS.md-documented "Path B" (Capacitor + TestFlight,
  $99/yr).

### B9 — In-app token rotation UI (Audit 2 S8 → Worker hygiene note)

- **Symptom.** Owner-mediated rotation (`wrangler secret put` + re-paste on each
  device) works but is operationally heavy. Audit 2 also flagged that token
  rotation mid-edit can poison-pill-drop dirty entries that were already in
  flight.
- **Severity.** Operations only; AGENTS.md explicitly accepts "Self-service token
  rotation is out of scope".
- **Effort.** L (a day+; touches sync.ts + a new owner-only screen).
- **Status.** Filed; AGENTS.md says no, so not even a v1.x candidate without
  the owner re-opening the question.

### B10 — Vite scaffold leftovers (Audit 1 cleanup deferred)

- **Symptom.** `src/lib/Counter.svelte` and `src/assets/{hero.png,svelte.svg,vite.svg}`
  are still tracked from the Phase 0 Vite scaffold. They are unused by the
  app (no imports — Audit 1 already verified) and Vite tree-shakes them out of
  `dist/`. Audit 1 deferred their removal to Phase 8 cleanup, which did not
  happen.
- **Severity.** Trivial. Repo hygiene only.
- **Effort.** S (`git rm` four files).
- **Code site.** `src/lib/Counter.svelte`, `src/assets/*`.
- **Recommended approach.** Single-commit deletion the next time the user is
  editing nearby.

## Conscious deviations from AGENTS.md (final status)

All three of `PLAN.md`'s documented deviations are still in effect and remain
intentional. None has been quietly walked back, none has crept back in.

| Deviation | Status at audit-3 | Evidence |
|---|---|---|
| No "Back up" button / no `GET /export` worker endpoint | **HONORED** | `rg -i "backup\|export" src/ worker/src/` returns zero matches. The worker exposes only `/health`, `/entries`, `/entries/:date`. README.md "Восстановление данных" explicitly documents the owner-mediated KV restore path instead. |
| No in-app onboarding / install instructions | **HONORED** | TokenGate is the only first-launch screen. No `InstallHint` / `Onboarding` component. README.md "Как установить на iOS" has the instructions for the project owner to forward to the friend. |
| No automated tests (no Vitest / Playwright / fake-indexeddb) | **HONORED** | `package.json` and `worker/package.json` have no `test` script, no test framework deps; no `tests/` directory exists. Manual `cursor-ide-browser` verification in Audits 1 and 2 was the only QA. |

A fourth, less-flagged deviation is also in effect and explicitly accepted:
the GitHub Pages **base path is `/pwa-calendar/`** (the user's repo name), not
the bare default. This was applied during Phase 8 and required two follow-up
patches (`f995d66` lowercase ALLOWED_ORIGIN, `0a3dc1c` `navigate()` BASE_URL
prefix). The deployed URL is `https://lumineks.github.io/pwa-calendar/` and
matches AGENTS.md's intent ("default *.github.io URL, no custom domain"); the
extra path segment is benign.

## What this audit did NOT change

- No `src/` or `worker/` source edits.
- No new phases inserted into `PLAN.md`.
- No `AGENTS.md` edits.
- No dependency version bumps (root or worker).
- No worker re-deploy.

The only housekeeping write made in this session is `audits/audit-3.md` (this
file) and the optional PLAN.md YAML-frontmatter status update marking all
phases (0, 1, 2, 3, 4, 4.5, 4.6, 5, 6, 6.5, 7, 8) and all three audit
checkpoints as `status: completed`.

## Sign-off

The Journal Calendar v1 build is **complete and ship-ready**. The deployed
PWA at `https://lumineks.github.io/pwa-calendar/` honors every locked-in
decision in `AGENTS.md` except for the three documented deviations in
`PLAN.md`, the worker + KV pair is healthy and internally consistent, the
production KV namespace shows three real-world entries the project owner has
already written through the live app (validating the local-first sync loop
under real usage), and the CI pipeline auto-deploys both halves on push to
`main`.

The single open item — a real-iPhone walk-through of the 12-step install +
edit + force-quit + multi-device scenario in Step 2 — is being deferred to
the project owner's own post-audit pass. The audit posture is "ship pending
that walk-through": if any of steps A–L fails, file a follow-up v1.x ticket
and patch in a separate commit, but the static review surface gives no
reason to expect any of them to fail.

The link + production token can be handed to the friend as soon as the
owner finishes the 12-step iPhone smoke test. If the friend's iOS version
turns out to be < 16.4 (AGENTS.md open item #1), revisit "Path B"
(Capacitor + TestFlight, $99/yr) — the entire Svelte + Vite codebase wraps
in an afternoon and the existing Dexie / sync stack continues to work
unchanged inside the wrapper.
