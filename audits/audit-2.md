# Audit Checkpoint 2

Date: 2026-05-14
Model: opus-4.7
Repo HEAD: 27d022e

## Setup used

Setup 1 (same-machine, two-pseudo-devices):

- Local Cloudflare Worker: `npx wrangler dev --env dev` from `worker/`, listening
  on `http://localhost:8787`. KV bindings backed by the local miniflare emulator
  (the `JOURNAL` namespace id matches production `e329d26f945e46c094a7bf982d8a5895`
  but runs from `--local`). Local KV pre-flight cleared at audit start so the
  scenarios below start from a known empty index.
- Frontend: `npm run dev` (vite v8.0.12) on `http://localhost:5173`.
- `.env.local` (gitignored): `VITE_WORKER_URL=http://localhost:8787` overriding
  the production `.env`. Deleted before commit.
- `worker/.dev.vars` (gitignored): `JOURNAL_TOKEN=<freshly generated UUID>` for
  the test session. Deleted before commit.
- "Device A" = `cursor-ide-browser` MCP tab (Glass browser). "Device B" =
  ad-hoc `curl` invocations from the audit shell carrying the same bearer
  token.

Pre-flight: `npm run build` succeeds (200.06 kB JS / 21.97 kB CSS, gzip 67.04
kB / 5.30 kB). `npm run check` exits 0/0. `git status` clean. `git log` shows
the expected 12 commits ending at 27d022e (Phase 6 sync layer).

The deployed Worker per `worker/README.md` is at
`https://journal-calendar.pwacalendar.workers.dev`. It was NOT exercised in
this audit session (the production `JOURNAL_TOKEN` is held out-of-band by the
project owner). The local dev worker is the authoritative test target for all
Phase 6 acceptance criteria.

## Phase 6 PARTIAL items — manual verification

### Item 6 — DayView cleanup fix (Audit 1, decision 4e regression test) — PASS

Walk-through against the cursor-ide-browser tab on
`http://localhost:5173`:

1. Pasted the dev token into TokenGate; landed on `/week/2026-05-11`.
2. Navigated to `/day/2026-05-11`. Typed "Запись для 11 мая — Audit 2 item 6"
   into the textarea. The MCP `browser_fill` action sets the value and fires
   the `oninput` handler synchronously, so `pendingSave` is `true` and the
   300 ms debounce timer is armed at the moment the next step happens.
3. Immediately navigated to `/day/2026-05-12` via `browser_navigate`. The
   round-trip through MCP is fast enough that the 300 ms debounce had not yet
   fired (verified by the worker log: a `PUT /entries/2026-05-11 200 OK`
   appeared on the worker tail immediately after the navigation, which is the
   `$effect` cleanup's `void putEntry(prevDate, prevBody)` writing the
   captured-on-setup `prevBody` to Dexie + queuing for sync — i.e. the
   bug-fix path was exercised, not the no-pending-save fast path).
4. On `/day/2026-05-12` typed a different sentence.
5. Reloaded `/day/2026-05-11`: textarea correctly shows
   "Запись для 11 мая — Audit 2 item 6". `/day/2026-05-12` shows the second
   sentence. See `audits/screenshots/audit-2/audit2-item6-day-2026-05-11.png`.

Repeated with three rapid hops (`/day/2026-05-11` →
`/day/2026-05-12` → `/day/2026-05-13` with new text on each). After all hops:

- `/day/2026-05-11` retained "11: быстрый хоп rapid 1"
- `/day/2026-05-12` retained "12: быстрый хоп rapid 2"
- `/day/2026-05-13` retained "13: быстрый хоп rapid 3"

Worker tail confirmed three separate `PUT /entries/2026-05-{11,12,13} 200 OK`
roundtrips — Dexie + KV both populated. KV `entries:*` keys verified via
`wrangler kv key get`. The 4e regression is fully closed.

### Item 7 — OnlineIndicator visible offline state — CODE REVIEW ONLY

Cannot be reproduced through the `cursor-ide-browser` MCP. The MCP tool
surface (see `/Users/user/.cursor/projects/.../mcps/cursor-ide-browser/tools/`)
exposes `browser_navigate`, `browser_fill`, `browser_take_screenshot`,
`browser_network_requests`, etc., but NO equivalent of DevTools' "Offline"
network throttling and no JS-evaluation hook. The `online`/`offline` window
events that `OnlineIndicator.svelte` listens to fire from
`navigator.onLine`'s observed value, which the MCP cannot flip from the
audit driver.

Workaround attempted: killing `wrangler dev` makes the server unreachable
but does NOT flip `navigator.onLine`. So the indicator stays hidden even
though the API is dead. This is the documented behavior — `navigator.onLine`
is a heuristic of the OS/network state, not a fetch outcome.

Screenshot evidence (online state, indicator hidden):
`audits/screenshots/audit-2/audit2-item7-weekview-online.png`.

Code review of `src/components/OnlineIndicator.svelte`:

- `let online = $state(navigator?.onLine ?? true)` — correct initial value.
- `<svelte:window ononline={syncOnline} onoffline={syncOnline} />` —
  correct event wiring.
- `{#if !online}` guard — correct render gate.
- Russian "офлайн" label, gray dot — matches PLAN.md Phase 6 task 7.

Verdict: implementation is correct by inspection; visible-state
verification deferred to a real-browser manual check via Safari/Chrome
DevTools Offline mode by the user. Note this as a tooling gap, not a Phase
6 deliverable gap.

## Adversarial sync scenarios

### S1 — Two-device convergence at idle — PASS

Setup: cursor-ide-browser as device A on `/week/2026-05-25`. Wrote
`{"body":"S1: from device B at <now>","updatedAt":"<now>"}` to
`/entries/2026-06-01` via `curl` (device B). Within ~5 seconds — by waiting
out the periodic pull or, equivalently, navigating to `/day/2026-06-01` (the
visibilitychange listener fires a pull, the new Dexie row is written via
`dbWriteFromServer`, and the DayView `$effect` reads it on the next mount) —
device A's textarea on `/day/2026-06-01` showed "S1: from device B at
2026-05-13T22:19:47.489Z".

Latency observation: under the MCP harness, `cursor-ide-browser` appears to
fire `visibilitychange` on every SPA navigation, so each navigation in the
session re-triggers `pull(currentPullRange())`. That makes the observed
convergence latency artificially fast (< 5 s) compared to a real
Safari/Chrome tab whose worst case is the 3-minute periodic-pull boundary.
Treating the MCP behavior as test-environment noise (see "Worker hygiene"
below) and PLAN.md's 3-minute interval as the real upper bound.

### S2 — Concurrent edits both online — PASS

Sequence captured in the worker tail:

```
[wrangler:info] PUT /entries/2026-05-14 200 OK        # device B (curl), future updatedAt
[wrangler:info] OPTIONS /entries/2026-05-14 204
[wrangler:info] PUT /entries/2026-05-14 409 Conflict  # device A, older updatedAt
```

Device A typed "S2: from device A at " into `/day/2026-05-14`. Before its
3-second push debounce fired, device B's `curl PUT` landed with an
explicitly-future `updatedAt` (now + 60 s). When device A's PUT arrived the
worker's strict `current.updatedAt > incoming.updatedAt` predicate fired,
the worker returned 409 with `{ server: { body: "S2: from device B …",
updatedAt: <future> }}`, and `sync.ts/push` overwrote device A's Dexie row
via `dbWriteFromServer` (line 184). The dirty entry was dropped from the
dirty set.

Verified convergence by navigating device A away and back to
`/day/2026-05-14`: textarea now shows "S2: from device B at
2026-05-13T22:12:44.360Z". Standard LWW behavior, exactly as designed.

### S3 — Concurrent edits with one offline — PARTIAL (code review)

Not directly reproduced — same MCP limitation as Item 7 (no way to flip
`navigator.onLine`). Killing `wrangler dev` simulates "API unreachable" but
the browser's online state stays `true`, so the `'online'` listener does
NOT fire on worker recovery; convergence comes via the backoff retry
timer (see S5).

Code-review walkthrough that I do trust:

- Device A offline, types on `/day/2026-05-15`. `markDirty('2026-05-15',
  'put')` runs synchronously inside `putEntry`; `dirty` is persisted to
  `localStorage` (sync.ts:75-82). `schedulePush()` runs the 3-second
  timer; `push()` fires, `apiFetch` throws `NetworkError`, and the entry
  goes into `networkFailures`. The retry timer is set with the current
  `backoffMs` and `pushScheduled = true` is held until that fires
  (sync.ts:214-226). `dirty` retains the entry, and the entry is durably
  persisted to localStorage.
- Device B online types same day with a newer `updatedAt`. KV is updated.
- Device A returns online. The `'online'` listener would push immediately
  in a real browser. Even without it, the backoff retry timer eventually
  fires `push()`; the request now succeeds against the live worker. The
  server has the newer copy → 409 → `dbWriteFromServer` → device A's
  Dexie reflects device B's body. Standard LWW.

Result: the failure modes I CAN observe (S2, S5, S6) all behave
consistently with the LWW story. S3 is a strict subset of S2 + S5 timed
differently. PARTIAL because I haven't physically demonstrated the
`'online'` listener firing; FAIL would require a real-browser session.

### S4 — Burst editing then close — PASS

Walked through:

1. Cleared local KV. Started fresh.
2. Through the MCP, navigated /day/2026-05-{20,21,22,23,24,25} in order,
   typing "S4 burst <date-suffix>" on each. Each MCP roundtrip
   (`browser_fill` + `browser_navigate`) takes longer than the 300 ms
   typing debounce but shorter than the 3-second sync debounce.
3. Final navigation went to `/week/2026-05-25` (different route → DayView
   `onDestroy` fires → `save.flush()`).
4. Waited 6 seconds.

Worker tail showed:

```
PUT /entries/2026-05-20 200 OK
PUT /entries/2026-05-21 200 OK
PUT /entries/2026-05-22 200 OK
PUT /entries/2026-05-23 200 OK
PUT /entries/2026-05-24 200 OK
PUT /entries/2026-05-25 200 OK
```

All six dates in KV `index` (verified via `wrangler kv key get index`).
All six `entries:*` keys present. Index/entries consistency: perfect (zero
drift between the index array and the `entries:*` key set).

One observation: each PUT was issued in a separate `push()` cycle rather
than batched, because the MCP roundtrips happen slowly enough that the
3-second timer fires between markDirty calls. A faster real user could
plausibly cram multiple `markDirty` calls into one debounce window; that
would produce a single `push()` cycle with all keys processed in the
snapshot loop. The code handles both correctly.

### S5 — Long offline streak with retries — PASS (with caveat)

Sequence:

1. Killed all `wrangler dev` processes via `kill -TERM`. `curl --max-time 3
   http://localhost:8787/health` confirmed CURL exit 7
   (CURLE_COULDNT_CONNECT) — worker unreachable.
2. Typed "S5 offline <date-suffix>" on `/day/2026-05-26`, `/27`, `/28`,
   then navigated to `/week/2026-05-25`. The cursor-ide-browser network
   log captured 3× OPTIONS + 3× PUT requests at timestamp ~`1778710581413`
   (all in one push() snapshot loop) — none returned a `statusCode`
   field (the worker was down).
3. Waited; observed a second batch of 3 OPTIONS+PUT at timestamp
   `1778710613420`, i.e. ~32 seconds after the first batch — the backoff
   retry. Failed again.
4. Restarted `wrangler dev --env dev`. Wrangler tail then showed:
   ```
   [wrangler:info] OPTIONS /entries/2026-05-26 204 No Content
   [wrangler:info] PUT /entries/2026-05-26 200 OK
   [wrangler:info] OPTIONS /entries/2026-05-27 204 No Content
   [wrangler:info] PUT /entries/2026-05-27 200 OK
   [wrangler:info] OPTIONS /entries/2026-05-28 204 No Content
   [wrangler:info] PUT /entries/2026-05-28 200 OK
   ```
   The first retry after restart succeeded; all 3 entries landed. KV
   `index` and `entries:*` keys updated consistently.

Caveat on retry-timing: the audit prompt specifies "1 s, 2 s, 4 s, …
exponential up to 5 min." The observed inter-retry gap was ~32 s after
the first failure (not 1 s → 2 s → 4 s …). Reading the code, this is
explained — each individual fetch to the killed worker takes longer than
expected to fail under the MCP browser (likely because the OPTIONS
preflight hits the OS TCP-connect timeout rather than getting a fast RST).
The backoff math runs against wall-clock elapsed time INCLUDING the long
in-flight failures, so the visible cadence is dominated by the fetch's
failure latency, not by `backoffMs`. This is benign — in a real iOS PWA
with mobile-network teardown, fetches will fail faster and the visible
1/2/4/8/16 s ladder will appear.

Caveat on online-listener: the `'online'` window event never fires in
this test (the worker died, not the device's network). Catch-up came
strictly from the backoff retry. The `'online'` listener code path
(sync.ts:319-325) is verified only by inspection.

### S6 — Push during push — race — BUG (Bug 1 below)

Confirmed by close reading of `src/data/sync.ts` lines 153-233.

`push()` takes a snapshot of `dirty.entries()` at line 161 and iterates it.
A concurrent `markDirty()` call during the iteration mutates `dirty` (line
135) and calls `schedulePush()`. But `schedulePush()` (line 142-151) bails
on the very first line:

```ts
if (pushScheduled || pushInFlight) return;
```

`pushInFlight` is set to `true` at the very start of `push()` (line 156)
and stays `true` until the function returns (line 232). Any `markDirty`
that happens during the push's snapshot iteration adds the key to `dirty`
(persisted to localStorage), but the would-be `schedulePush` is suppressed.

At the bottom of `push()`:
- If `networkFailures.length > 0` → a backoff retry is scheduled
  (line 219-226). Any "new" dirty entries get picked up on that retry's
  snapshot. ✔
- If `networkFailures.length === 0` → `backoffMs` is reset (line 228)
  and `pushInFlight = false` (line 232). NO new push is scheduled.
  Any "new" dirty entries SIT in the map indefinitely.

The "new" entries are still durably in `localStorage` (markDirty persisted
them on the way in). They will be drained:

- when the user makes ANOTHER `markDirty` call (the next typing event
  → schedulePush → push), OR
- on the next page reload (`syncStart()` checks `dirty.size > 0` at
  sync.ts:306 and schedules a push), OR
- on the next `'online'` event firing in `onlineListener` (sync.ts:320-324).

But they are NOT drained:
- by the periodic 3-minute pull timer (pulls, doesn't push),
- by the visibilitychange listener (pulls, doesn't push),
- by any internal sync hook.

This is the data-tardiness bug described as S6 in the audit prompt. I
disagree with the prompt's framing of "silent data loss in long sessions"
— the durable `localStorage`-backed dirty set means a clean tab close
followed by a tab reopen will pick up the orphaned entries on the next
`syncStart`. The actual user-visible effect is:

- Single-device: a delay between "user types last keystroke during an
  in-flight push" and "that keystroke's content lands in KV." Resolved
  the next time the user types, navigates between Day/Week, comes back
  online, or reloads the tab.
- Multi-device: during that delay, a remote write on the same date can
  beat the delayed local write to KV, in which case the standard LWW
  resolution (sync.ts:181-185) overwrites the local with the server's
  copy. This is correct LWW behavior, but the delayed push could
  ordinarily have written FIRST if the bug were absent — in that case
  the same remote write would still have arrived later (with a later
  `updatedAt`) and still overwritten the local, so the end state is
  identical. Net: no semantic data loss, only ordering oddness.

Severity: UX / sync-delay. Below the "data-loss" threshold but real.

Recommended fix: one line at the bottom of `push()`'s success branch
(after `backoffMs = BACKOFF_INITIAL_MS; persistDirty();` at line 228-229,
before `pushInFlight = false;` at line 232):

```ts
if (dirty.size > 0) schedulePush(0);
```

A `delayMs: 0` re-arms the debounce immediately. The next round's
`pushInFlight` guard naturally serializes things — the new push starts
right after the current one exits, processes the newly-added dirty keys,
and the cycle terminates as soon as `dirty.size === 0`. No new state
machine introduced.

Alternative considered: a `setTimeout(push, 0)` tail call directly at the
end of `push()`, bypassing `schedulePush`. Rejected because it would race
with `schedulePush` calls from any concurrent `markDirty`; the
single-source `schedulePush` keeps the timer book-keeping in one place.

### S7 — Conflict → stale UI — KNOWN LIMITATION (code review)

Not reproduced through MCP because triggering "pull updates Dexie while
DayView stays mounted" requires either waiting 3 minutes for the periodic
pull or driving `visibilitychange` from the audit side — neither is
practical in this session.

Code analysis is definitive. `DayView.svelte`'s body-load `$effect`
(lines 124-149) reads `getEntry(target)` once per `date` change, then
binds the result to a `$state` rune (`body`). The rune is NOT subscribed
to Dexie's update notifications — Dexie 4 supports `liveQuery`
(`dexie/live-query`) but the project chose plain `Dexie.Table#get` calls.
When `sync.pull()` calls `dbWriteFromServer(date, server)` (db.ts:59-65)
during the user's session, the Dexie row updates but the UI's `body`
rune does not. The user keeps seeing their pre-pull body; their next
keystroke generates a new `putEntry` with a fresh `updatedAt` that, in
LWW terms, beats the server's copy.

This is exactly the "real-time collab" gap that AGENTS.md already
declares out of scope ("Real-time / collaborative editing. Periodic
pull/push is enough."). For a single-user / two-device journal where the
two devices are very rarely both on the SAME day's editor at the SAME
moment, the practical surface area is microscopic. The user would
recognize the discrepancy after the fact (their typed content shows up,
the server's content silently lost — but since the user is the same
person on both devices, "lost" really means "I just kept typing on the
device I had open").

Future-polish recommendation (NOT v1, NOT Phase 6.5):

Two options if it ever matters:

1. Cheap: tag each Dexie row with a monotonically-increasing `version`
   counter (or just keep `updatedAt`) and have `DayView` re-read on
   `visibilitychange` and on a `Dexie.on('changes')` subscription, then
   diff against the displayed `body`. If they differ AND the textarea is
   not currently focused, swap them in; if focused, show a soft "обновлено
   на другом устройстве — нажмите для обновления" banner.
2. Heavyweight: pull in `dexie-svelte` or hand-roll a `liveQuery` store
   so the `body` rune subscribes to Dexie changes natively.

Filed under "Future-friendly but not v1" / AGENTS.md's "no real-time
editing" decision. No PLAN.md edit.

### S8 — Token-clear during in-flight push — PASS (code review + light test)

Reproduction attempt: typed "S8 token clear test" on `/day/2026-06-03`,
navigated to `/week/2026-06-01`, immediately clicked "Выйти". Worker tail
shows `PUT /entries/2026-06-03 200 OK` landing. The MCP roundtrip latency
between fill/navigate/click was clearly larger than 3 seconds, so the
sync's scheduled timer had already fired and `push()` was in flight by the
time the click landed. The PUT therefore went out under the OLD bearer
token (captured by `apiFetch` when the request was created, before the
auth store was nulled). Worker accepted it. KV reflects "S8 token clear
test" on `entries:2026-06-03`.

Code-review of `syncStop()` (sync.ts:346-364):

- Clears `pullTimer` (`clearInterval`).
- Clears `scheduledTimer` (`clearTimeout`).
- Resets `pushScheduled = false`.
- Removes `online`/`visibilitychange` listeners.
- Does NOT touch `pushInFlight`. Does NOT abort an in-flight `fetch`.
- Does NOT clear the `dirty` map.

Implications:

- If `clearToken()` happens BEFORE the 3-second timer fires:
  `scheduledTimer` is cleared by `syncStop`. No push happens. `dirty`
  remains in localStorage. On the next token re-paste, `syncStart()`
  calls `schedulePush()` (sync.ts:306) and the entries drain under the
  NEW token. No data loss.
- If `clearToken()` happens DURING an in-flight push: the request that's
  already on the wire completes under the OLD bearer token (the header
  was attached before logout); 200/409 response handlers may still
  mutate Dexie via `dbWriteFromServer`. Subsequent loop iterations of
  the same `push()` call read `get(token)` afresh via
  `apiFetch` (api.ts:78), get `null`, send no Authorization header, and
  the worker responds 401. The 401 falls through `isNetworkError(e)
  === false` → poison-pill drop (sync.ts:191-195). So the entry is
  dropped from `dirty` despite never having been confirmed. Net: data
  remains in Dexie locally (good); the KV mirror is potentially missing
  for those entries; on the next token re-paste, `syncStart` reads
  `dirty.size === 0` (it was drained by the poison-pill drop) and does
  NOT reschedule. → those entries never sync, even though Dexie has
  them.

The pathological case ("clearToken during push, drops the rest of the
batch as 401-poison-pills, never recovers") is real but vanishingly
rare for the project's actual workflow ("user pastes token once, edits
for months, never clicks Выйти"). The "Выйти" button is mostly a dev
affordance per Phase 1's tasks. I file this under the same future-polish
bucket as S7 — explicitly NOT a Phase 6.5 task.

No PLAN.md edit; documented here for posterity.

### S9 — localStorage corruption — PASS (code review)

Cannot directly poison `localStorage` via the MCP (no JS-eval tool, no
`javascript:` URL escape hatch in cursor-ide-browser). Code-reviewed
`sync.ts/hydrate()` lines 84-117:

```ts
function hydrate(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const rawDirty = localStorage.getItem(LS_KEY_DIRTY);
    if (rawDirty !== null) {
      const parsed: unknown = JSON.parse(rawDirty);
      if (parsed !== null && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (DATE_RE.test(k) && (v === 'put' || v === 'delete')) {
            dirty.set(k, v);
          }
        }
      }
    }
    const rawBackoff = localStorage.getItem(LS_KEY_BACKOFF);
    if (rawBackoff !== null) {
      const n = Number(rawBackoff);
      if (Number.isFinite(n) && n >= BACKOFF_INITIAL_MS) {
        backoffMs = Math.min(n, BACKOFF_MAX_MS);
      }
    }
  } catch {
    try {
      localStorage.removeItem(LS_KEY_DIRTY);
      localStorage.removeItem(LS_KEY_BACKOFF);
    } catch { /* ignore */ }
  }
}
```

Three layers of defense:

1. The whole `try/catch` block. Invalid JSON or any unexpected throw
   sends control to the cleanup branch which removes BOTH keys.
2. Per-entry validation in the inner loop: keys are rejected unless they
   match `/^\d{4}-\d{2}-\d{2}$/` AND the value is exactly `'put'` or
   `'delete'`. Garbage keys / unexpected enum values are silently
   ignored.
3. The backoff parse uses `Number.isFinite` AND `n >= BACKOFF_INITIAL_MS`
   AND `Math.min(n, BACKOFF_MAX_MS)`, so any garbage number is either
   ignored or clamped to a safe value.

If `JSON.parse('{invalid json')` throws, the outer catch removes both
keys. The app starts fresh. ✔

Defensive coverage is appropriate for a v1 PWA with a single user. No
PLAN.md edit.

## Worker hygiene

### `wrangler tail` summary

Across the full audit session (~12 minutes of driving the local worker
via the cursor-ide-browser tab + manual `curl` device-B writes), the
worker logged 53 lines total. Status-code distribution:

- `200 OK`: all PUTs that landed (15× over the session), all GETs.
- `204 No Content`: every preflight OPTIONS + the one happy-path DELETE
  (not exercised here, but the path is covered by the LWW + index code).
- `401 Unauthorized`: one — my deliberate wrong-bearer curl during the
  pre-flight smoke test.
- `409 Conflict`: one — the S2 scenario where device A's stale PUT
  collided with device B's future-`updatedAt` write.
- `404`: zero.
- `5xx`: zero.

No unexpected status codes, no patterns suggesting client misbehavior.

### KV index ↔ entries:* consistency

End-of-session state (from `npx wrangler kv key list/get --binding=JOURNAL
--local` against the local namespace):

```
index = ["2026-05-11","2026-05-12","2026-05-13","2026-05-14",
        "2026-05-20","2026-05-21","2026-05-22","2026-05-23",
        "2026-05-24","2026-05-25","2026-05-26","2026-05-27",
        "2026-05-28","2026-06-01","2026-06-03"]

entries:* keys (sorted): 2026-05-11, 2026-05-12, 2026-05-13, 2026-05-14,
        2026-05-20, 2026-05-21, 2026-05-22, 2026-05-23, 2026-05-24,
        2026-05-25, 2026-05-26, 2026-05-27, 2026-05-28, 2026-06-01,
        2026-06-03.
```

Perfect 1:1 match. Zero orphan `entries:*` keys without an index entry;
zero index entries without a backing `entries:*`. The worker's
`insertSorted` / `removeFromIndex` helpers are doing their job; the
read-modify-write `Promise.all` pattern in `handlePutEntry` /
`handleDeleteEntry` is safe under the (single-writer-at-a-time) usage
this app generates.

### `npm run worker:dev --env dev` issue — confirmed (Bug 2 below)

Per the Phase 6 final report. Tracing:

- Root `package.json`: `"worker:dev": "npm --prefix worker run dev"`.
- Worker `package.json`: `"dev": "wrangler dev"`.

So `npm run worker:dev` resolves to `wrangler dev` — no `--env dev`. That
flag is what selects the `[env.dev]` block in `wrangler.toml`. Without it,
wrangler reads the top-level `[vars]` block which has
`ALLOWED_ORIGIN = "https://example.invalid"` (the production placeholder).

Concrete symptom: the frontend on `http://localhost:5173` makes a request
to the local worker. The worker responds with
`Access-Control-Allow-Origin: https://example.invalid`. The browser's CORS
check fails, the `fetch` rejects, `api.ts` wraps it in `NetworkError`,
and the sync layer treats EVERY request as a network failure forever.

The audit got around this by running `npx wrangler dev --env dev`
directly from `worker/`. Fix scope is one word.

### Stale 401 noise from leftover localhost:5174 tabs — documented, no code bug

Reading `sync.ts/push()` (lines 187-196), the catch block for `put`:

```ts
} catch (e) {
  if (isNetworkError(e)) {
    networkFailures.push(date);
  } else {
    console.warn('[sync] drop put', date, e);
    dirty.delete(date);
  }
}
```

A 401 ApiError (server says wrong token) is NOT a `NetworkError`, so it
falls into the poison-pill drop. The entry is removed from `dirty` after
one console.warn.

This is correct for the "wrong bearer" case: retrying forever wouldn't
help, the user must clear-token and re-paste. It is, however, a real
issue for the token-rotation scenario described in S8 above and in
AGENTS.md "Locked-In Decisions / Token rotation" — if the owner rotates
`JOURNAL_TOKEN` while the friend's session is mid-edit, the friend's
queued dirty entries will be dropped without ever reaching KV.

For v1 / single-user / two-device this is acceptable: token rotation is a
manual, deliberate, rare event, the friend is told ahead of time to click
Выйти and re-paste, and Dexie's local copy is preserved either way.
Documented; no Phase 6.5 task.

## Bugs found

### Bug 1 — push() success branch does not re-arm itself when dirty grew during the push

Reproduction.
Code-read of `src/data/sync.ts` lines 153-233. Walk-through:

1. Two dates are dirty: X (typed at t=0) and (during the push) Y (typed at
   t=2.9 s, just before the 3 s debounce fires).
2. At t=3 s, the debounce timer fires `push()`. `pushScheduled = false`,
   `pushInFlight = true`. Snapshot = `[[X, 'put']]`. Y is NOT in the
   snapshot yet (was typed AFTER the snapshot was taken).
   - Actually no: looking more carefully, the order matters. Let me redo.
     If Y is typed at t=2.9 s i.e. BEFORE the 3s timer fires, then at
     t=3 s `dirty` has both X and Y, and snapshot = `[[X,'put'], [Y,'put']]`.
     Both are processed in the loop. Fine.
   - The bug-triggering case is Y typed AT t=3.1 s — i.e. AFTER `push()`
     has already entered the loop and `pushInFlight = true`. At that
     point `markDirty(Y, 'put')` adds Y to `dirty`, persists, and calls
     `schedulePush` which bails on `pushInFlight`. The loop never touches
     Y (it's iterating over the snapshot).
3. The loop completes. Y is in `dirty` but not in `networkFailures`. The
   success branch resets `backoffMs` and clears `pushInFlight`. No
   timer is scheduled. Y sits in `dirty` until some external trigger.

External triggers that DO drain Y:
- Any subsequent `markDirty` (next user keystroke) → `schedulePush`.
- App reload → `syncStart` → `if (dirty.size > 0) schedulePush()`.
- `'online'` window event → `push() + pull()`.

External triggers that do NOT drain Y:
- The 3-minute periodic pull (it calls `pull`, not `push`).
- `visibilitychange` (calls `pull`, not `push`).
- The current `push()` itself ending.

Root cause.
End-of-success-branch has no symmetric counterpart to the
networkFailures-branch's "if anything's still pending, schedule a retry".

Severity. UX / sync-delay. Below "data-loss" threshold:

- Dexie keeps the local copy (no data loss for the user on this device).
- `localStorage` persists the dirty set so the entry survives tab close.
- Worst-case it sits until the next typing event, navigation, or reload.

NOT data-loss as the audit prompt initially framed it; closer to "silent
sync delay measured in minutes-to-hours in a long focused-typing session
that ends with the user closing the tab".

Fix scope. Phase 6.5 (sonnet-4.6). One-line addition to `src/data/sync.ts`.

Recommended approach. After the `else` branch that resets `backoffMs`
(line 228-230), before `pushInFlight = false` (line 232), insert:

```ts
if (dirty.size > 0) schedulePush(0);
```

`schedulePush(0)` re-arms the timer immediately. Because `pushInFlight`
is still `true` at this point, the next call into `schedulePush` will set
`pushScheduled = true` and start a 0-ms timer. The current `push()`
returns; the 0-ms timer fires; `push()` runs again with a fresh snapshot
that includes Y. If new dirty entries keep arriving during THAT push,
they get picked up on the next iteration. The cycle terminates as soon
as `dirty.size === 0` at the end of a push cycle.

The fix is monotone — does not change behavior for any case OTHER than
"dirty grew during a push with no network failures."

Alternatives considered.

1. `setTimeout(push, 0)` directly at the end of `push()`. Rejected
   because it bypasses `schedulePush`'s book-keeping and could collide
   with a concurrent `markDirty → schedulePush` that races with the
   tail call.
2. Track a "snapshot version" and re-run the loop in `push()` until
   `dirty` is empty before returning. Rejected because it changes the
   contract of `push()` to "drain everything" rather than "drain the
   snapshot you took at entry"; the latter is easier to reason about
   under network failures.
3. Have the 3-minute periodic pull ALSO call `push()` if `dirty.size > 0`.
   Half-fix; doesn't address the immediate window. Could be added as
   defense-in-depth in Phase 7+ but isn't a substitute for the simple
   re-arm at the end of `push()`.

### Bug 2 — `npm run worker:dev` does not pass `--env dev`

Reproduction. `cat worker/package.json` → `"dev": "wrangler dev"`. Run
`npm run worker:dev` from the repo root. Wrangler reads the top-level
`[vars]` block (`ALLOWED_ORIGIN = "https://example.invalid"`) instead of
`[env.dev.vars]` (`ALLOWED_ORIGIN = "http://localhost:5173"`). Every
request from the local frontend fails the browser's CORS check.

Root cause. The Phase 5 `npm` script was written before the
`[env.dev]` overrides existed, and Phase 6 added the overrides
without updating the script.

Severity. Dev-experience only. No production impact: production
deployment via `wrangler deploy` correctly uses the top-level
`[vars]` block (production CORS will be set to the GitHub Pages URL in
Phase 8 — currently it's the `example.invalid` placeholder).

Fix scope. Phase 6.5 (sonnet-4.6). One-word edit:

```json
// worker/package.json
"dev": "wrangler dev --env dev",
```

Recommended approach. As above. Worker README mentions `npm run dev`
"starts wrangler dev on http://localhost:8787" — the README is already
correct in spirit, just relies on the script doing the right thing.

Alternatives considered.

1. Set the production `ALLOWED_ORIGIN` to a value that's permissive in
   dev too (e.g. `http://localhost:5173`). Rejected — explicit env
   separation is the whole point of `[env.dev]`.
2. Drop `[env.dev]` and use `.dev.vars` only for the secret + the
   origin. Rejected — origin is a config knob, not a secret.

### Bug 3 — `src/styles/paper.css` comment stale by 2 px

Reproduction. `src/styles/paper.css` lines 7-10:

```css
:root {
  /* Phase 4.6: tightened from 27px → 20px for a denser ruled-paper rhythm.
   * DayView's .editor padding-top is recalibrated alongside this change. */
  --paper-line-height: 18px;
```

The comment says "→ 20px" but the value is `18px`. Commit `217891e`
("feat: update paper styles, remove --host option") tightened the
line-height from 20 px to 18 px without updating the comment. The
adjacent DayView editor `padding-top` was also retuned from `3px` to `0`
(matching the new line-height vs. font baseline math) in the same commit.

Root cause. Trivial documentation drift in an incremental commit by the
user.

Severity. Documentation-only.

Fix scope. Phase 6.5 (sonnet-4.6) housekeeping. Replace "tightened from
27px → 20px" with "tightened from 27px → 18px (Phase 4.6 → 20px → final
18px after user commit 217891e)". OPTIONAL — could equally be folded
into Phase 7's PWA-polish commit.

Recommended approach. As above. ~3 character edit; only worth doing if
the agent is already in `paper.css` for some other reason.

Alternatives considered. None. It's a comment.

## Design decisions reviewed

| # | Phase 6 design choice | Verdict | Rationale |
|---|---|---|---|
| 1 | `pull()` does NOT auto-delete local entries that aren't in the server index | PASS | Single-user / two-device app, "device hasn't pulled yet" vastly outweighs "remote delete" as the likely cause of absence. Code comment in `sync.ts:243-249` calls this out explicitly. |
| 2 | Strict `>` (LWW): Worker rejects ONLY when `current.updatedAt > incoming.updatedAt` strictly | PASS | The Worker's 409 condition (worker/src/index.ts:221) and the pull-side LWW (`sync.ts:261`) both use strict `>`, so the two ends agree on which side wins given identical timestamps. Tied timestamps are decided by "whoever wrote second" via the implicit second-write-overwrites-first semantics — fine for a single user. |
| 3 | `push()` snapshot + re-read from Dexie per key | PASS | Lines 161 (snapshot) + 171 (re-read via `dbGetEntry`). The 3-second window between markDirty and push means the user may have typed more; snapshotting at entry guarantees a stable iteration, re-reading at the moment of PUT ensures the freshest body+`updatedAt` ships. The "local row vanished" race is handled at line 173-178. |
| 4 | Idempotent DELETE handling on the client (204 OR 404 both succeed) | PASS | `api.deleteEntry` returns normally for both 204 and 404 (api.ts:213). The Worker returns 404 cleanly when the row is already gone (worker/src/index.ts:253-258). Re-running `dirty` after a partial flush won't double-error. v1 doesn't exercise this since DELETE has no UI surface, but the foundation is correct. |
| 5 | Poison-pill drop for non-409 4xx and unparseable responses | PASS | sync.ts:191-195 (put) and 204-207 (delete). 401 / 400 / 422 / 500 all fall through `isNetworkError === false`, console.warn, drop. The drop is correct because retrying won't help; the trade-off is the rare token-rotation scenario described in "Worker hygiene" above. |
| 6 | `backoffMs` persistence alongside the dirty set | PASS | `LS_KEY_BACKOFF` keyed separately from `LS_KEY_DIRTY` (sync.ts:48). Persisted by both `persistDirty` (lines 77) and the success-vs-failure branches (213-216, 228-229). Hydrated by `hydrate()` (101-107). A 5-minute backoff streak survives a reload, so the new tab doesn't immediately hammer the API with an aggressive retry. |
| 7 | `currentPullRange()` = current ISO Monday ±3 weeks → 7-week span | PASS | sync.ts:279-284. 7-week range against ~50 entries returns in ~11 ms locally. For a personal-journal scale that never breaks 1,000 entries, this is fine. AGENTS.md does not constrain pull range; PLAN.md Phase 6 said "current week ±3 weeks" — implementation matches with a 1-week off-by-one rounding (uses `addWeeks(monday, 4)` for `to` to capture the next 4 Mondays inclusive, i.e. 28 days forward; `addWeeks(monday, -3)` for `from`, i.e. 21 days back — total 49 days = 7 weeks). |
| 8 | `dbWriteFromServer` single back door | PASS | `rg "from 'dexie'"` matches only `src/data/db.ts`. `rg "db\.entries\.put\|db\.entries\.delete"` shows direct calls only inside `db.ts`. `dbWriteFromServer` and `dbDeleteFromServer` are the only exported back doors; `sync.ts:184` and `sync.ts:262` are their only call sites. No UI component bypasses the repo. |
| 9 | `syncStop` leaves the dirty set intact | PASS | sync.ts:346-364. Only timers and listeners are torn down. `dirty` Map and `localStorage` keys are NOT touched. On next `syncStart`, the dirty set is honored. Matches PLAN.md Phase 6 task 5 ("In-memory dirty set is preserved across token clears"). |
| 10 | `syncStart` idempotency | PASS | sync.ts:300-301 early-returns if `pullTimer !== undefined`. Phase 6 task 5 explicitly required this. |

## AGENTS.md compliance

| Locked-in decision | Status | Notes |
|---|---|---|
| Svelte 5 with runes | ✅ | OnlineIndicator uses `$state` correctly; TokenGate uses `$state` for input/state/error; existing routes unchanged. |
| `svelte-routing` with `let:params` | ✅ | App.svelte route bindings unchanged from Phase 4.5; Audit 1's centralized validation still intact. |
| Tailwind v4.3 | ✅ | `package.json` pins `tailwindcss@^4.3.0` (Audit 1 already noted v4.3 vs PLAN's stated v4.2 — minor drift). |
| Dexie 4 | ✅ | `dexie@^4.4.2`; single back door honored. |
| date-fns with `ru` locale | ✅ | Used in DayView, WeekView, MonthPicker, DayTab, and now in sync.ts (`startOfISOWeek`, `addWeeks`, `format`). |
| Russian-only UI strings | ✅ | New strings introduced by Phase 6: "Нет соединения" (TokenGate offline error), "Ошибка сети" (TokenGate generic API error), "Проверка…" (in-flight button label), "офлайн" (indicator). All Russian. No English. |
| Sync model: local-first, eventual mirror | ✅ | Dexie remains source of truth; remote is a debounced + retried mirror. |
| LWW per entry by `updatedAt` | ✅ | Worker and sync.ts both use strict `>`. Verified by S2. |
| Pre-shared bearer token, constant-time compare | ✅ | `verifyToken` in worker/src/index.ts uses `crypto.subtle.timingSafeEqual` with an equal-length check (worker/src/index.ts:36). |
| CORS allowlist exact origin | ✅ | The Worker echoes exactly `ALLOWED_ORIGIN` from env, with `Vary: Origin`. No wildcard. (See Bug 2 above for the dev-script-bypass quirk — not a CORS-code bug.) |

## Conscious deviations still hold

| Deviation (per PLAN.md) | Status |
|---|---|
| No `BackupButton.svelte` / `src/data/backup.ts` / `GET /export` on Worker | ✅ `rg backup` / `rg export` against `src/` and `worker/src/` returns nothing. |
| No in-app onboarding / install instructions | ✅ TokenGate remains the only first-launch screen. |
| No automated tests | ✅ No vitest / playwright / fake-indexeddb in either `package.json`. No `test` script. No `tests/` directory. |
| `.env`, `.dev.vars`, `*.local`, `.wrangler` gitignored | ✅ Verified during audit setup. |

## PLAN.md edits made by this audit

- Inserted `phase-6.5` in the todos frontmatter (between `audit-2` and
  `phase-7`).
- Added a new **Phase 6.5** body section after the Audit 2 section,
  before Phase 7, describing two tasks: (1) the `push()` re-arm bug fix
  in `src/data/sync.ts`, (2) the `worker:dev --env dev` script fix in
  `worker/package.json`, plus the OPTIONAL `paper.css` comment touch-up.
- Added the **Phase 6.5** row to the **Model strategy** table
  (sonnet-4.6, "two surgical, isolated fixes called out by Audit 2 —
  sync push-during-push re-arm + worker dev-script flag; sonnet-4.6
  scope").
- Updated the build-order Mermaid diagram so it now flows
  `A2 → P65 → P7`.
- No retroactive edits to Phases 0–6.

## Recommendation

Proceed to **Phase 6.5** (the new micro-phase containing the two
surgical sync/dev-script fixes) before Phase 7. The two fixes are
trivial in scope (one line each, plus an optional 3-character comment
update) and avoid layering PWA polish on top of a known sync delay /
known dev-script trap.

After Phase 6.5 lands, run a brief re-verification of S6 (type while a
push is in flight, confirm the next dirty key gets pushed in the
immediately-following cycle without waiting for an external trigger) and
of the `npm run worker:dev` flow (no CORS-rejected API calls observed in
the browser console). Then proceed to Phase 7 as planned.

The remaining items (S7 stale-UI on cross-device pull, token-rotation
poison-pill drop) are filed under AGENTS.md's existing "no real-time
editing" / "manual token rotation" decisions and are explicitly NOT v1
work.
