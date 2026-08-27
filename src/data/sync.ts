/**
 * Sync layer — wires Dexie (per-device source of truth) to the deployed
 * Cloudflare Worker.
 *
 *   • markDirty(date, action) is called by db.ts on every user-originated
 *     write/delete and queues the date for the next push.
 *   • schedulePush() debounces ~3s after the last edit.
 *   • push() drains the dirty set; per-key result is one of:
 *       - 200  → drop from dirty
 *       - 409  → server has a newer copy; overwrite Dexie via
 *                applyServerEntry → dbWriteFromServer (NOT putEntry — see
 *                db.ts) and drop
 *       - 204/404 (delete) → drop (idempotent)
 *       - 401  → retryable (logout / token-swap race), NOT a poison pill
 *       - 4xx (other) → poison pill; log and drop so we don't loop forever
 *       - NetworkError → leave in dirty; retry with exponential backoff
 *   • pull(range) reconciles a date range from the server into Dexie via
 *     LWW. Pull never marks dirty.
 *   • Triggers (started by App.svelte when token transitions null → set):
 *       - mount         → one immediate pull(currentRange)
 *       - every 3 min   → pull(currentRange) if visible AND online
 *       - 'online'      → push() + pull()
 *       - 'visibility'  → pull() if visible AND online
 *
 * Everything persisted is namespaced by account (see ./namespace.ts), so two
 * accounts on one device never share a queue:
 *   localStorage 'journal:<ns>:dirty'   → JSON map of date → 'put' | 'delete'
 *   localStorage 'journal:<ns>:backoff' → numeric ms (capped)
 *
 * No schema versioning yet; the keys are small and easy to discard if the
 * format ever changes. If you add fields, also bump a version key alongside.
 */

import Dexie from 'dexie';
import {
  addWeeks,
  format,
  parseISO,
  startOfISOWeek,
} from 'date-fns';
import { get, writable } from 'svelte/store';
import * as api from './api.ts';
import { isApiError, isNetworkError, NetworkError } from './api.ts';
import {
  countEntries,
  getEntry as dbGetEntry,
  dbWriteFromServer,
} from './db.ts';
import { nsKey } from './namespace.ts';

// ── Types & constants ───────────────────────────────────────────────────

export type Action = 'put' | 'delete';

const DEBOUNCE_MS = 3_000;
const PULL_INTERVAL_MS = 3 * 60_000;
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const PULL_CHUNK = 40; // worker does 1 KV subrequest per date; free-plan cap is 50/invocation

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Module-singleton state ──────────────────────────────────────────────

const dirty = new Map<string, Action>();
let pushScheduled = false;
let pushInFlight = false;
let backoffMs = BACKOFF_INITIAL_MS;

let scheduledTimer: ReturnType<typeof setTimeout> | undefined;
let pullTimer: ReturnType<typeof setInterval> | undefined;
let onlineListener: (() => void) | undefined;
let visibilityListener: (() => void) | undefined;

let namespace: string | null = null;
let runToken = 0; // bumped by syncStop/namespace change; aborts in-flight pushes

export type InitState = 'idle' | 'initializing' | 'ready' | 'needs-network';
export const initState = writable<InitState>('idle');

const lsDirtyKey = (): string => nsKey(namespace ?? '?', 'dirty');
const lsBackoffKey = (): string => nsKey(namespace ?? '?', 'backoff');

// ── Persistence ─────────────────────────────────────────────────────────

function persistDirty(): void {
  // Before syncStart() hands us a namespace there is no correct key to write
  // under — writing to a placeholder would leak one account's queue into a
  // key the next account could hydrate from.
  if (namespace === null) return;
  if (typeof localStorage === 'undefined') return;
  try {
    const obj: Record<string, Action> = {};
    for (const [k, v] of dirty) obj[k] = v;
    localStorage.setItem(lsDirtyKey(), JSON.stringify(obj));
    localStorage.setItem(lsBackoffKey(), String(backoffMs));
  } catch {
    // Quota or privacy-mode failures aren't recoverable here; in-memory state
    // remains correct for this session. Audit 2 may surface this if it bites.
  }
}

function hydrate(): void {
  if (namespace === null) return;
  if (typeof localStorage === 'undefined') return;
  try {
    const rawDirty = localStorage.getItem(lsDirtyKey());
    if (rawDirty !== null) {
      const parsed: unknown = JSON.parse(rawDirty);
      if (parsed !== null && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (
            DATE_RE.test(k) &&
            (v === 'put' || v === 'delete')
          ) {
            dirty.set(k, v);
          }
        }
      }
    }
    const rawBackoff = localStorage.getItem(lsBackoffKey());
    if (rawBackoff !== null) {
      const n = Number(rawBackoff);
      if (Number.isFinite(n) && n >= BACKOFF_INITIAL_MS) {
        backoffMs = Math.min(n, BACKOFF_MAX_MS);
      }
    }
  } catch {
    // Corrupt localStorage entries → start fresh.
    try {
      localStorage.removeItem(lsDirtyKey());
      localStorage.removeItem(lsBackoffKey());
    } catch {
      // ignore
    }
  }
}

// ── Server-originated entry writes + listener registry ──────────────────

const entryListeners = new Set<(date: string) => void>();

/**
 * Subscribe to server-originated entry writes (pull reconciliation and 409
 * LWW takeovers). Views use this to refresh a body they are already showing —
 * Dexie writes are invisible to Svelte state on their own.
 *
 * Returns an unsubscribe function.
 */
export function onEntryUpdated(cb: (date: string) => void): () => void {
  entryListeners.add(cb);
  return () => entryListeners.delete(cb);
}

/**
 * The ONLY path from a server value into Dexie. Wraps db.ts's back door so
 * every server write — from pull() and from push()'s 409 branch alike —
 * notifies the listener registry exactly once.
 *
 * Listener exceptions are isolated: an unguarded throw here would escape into
 * pull()'s catch (silently skipping every remaining date in the 7-week range)
 * and, from push()'s 409 branch, into the per-entry catch — where it is
 * neither NetworkError nor 401 and would take the poison-pill path, dropping
 * the date from the dirty set over a subscriber bug.
 */
async function applyServerEntry(
  date: string,
  value: { body: string; updatedAt: string; format?: 'html' },
): Promise<void> {
  await dbWriteFromServer(date, value);
  for (const cb of entryListeners) {
    try {
      cb(date);
    } catch (e) {
      console.warn('[sync] entry listener threw', date, e);
    }
  }
}

// ── Public: markDirty ───────────────────────────────────────────────────

/**
 * Queue a date for the next push. Called by src/data/db.ts on every user
 * write/delete.
 *
 * Action collapse rules (later wins):
 *   put → delete  ⇒ delete
 *   delete → put  ⇒ put
 *   put → put     ⇒ put
 *   delete → delete ⇒ delete
 */
export function markDirty(date: string, action: Action): void {
  if (!DATE_RE.test(date)) return;
  dirty.set(date, action);
  persistDirty();
  schedulePush();
}

// ── Push scheduling ─────────────────────────────────────────────────────

function schedulePush(delayMs: number = DEBOUNCE_MS): void {
  if (pushScheduled || pushInFlight) return;
  pushScheduled = true;
  if (scheduledTimer !== undefined) clearTimeout(scheduledTimer);
  scheduledTimer = setTimeout(() => {
    pushScheduled = false;
    scheduledTimer = undefined;
    void push();
  }, delayMs);
}

async function push(): Promise<void> {
  if (pushInFlight) return;
  if (dirty.size === 0) return;
  pushInFlight = true;

  // Abort guard: syncStop() and every namespace change bump runToken. Any
  // await below can resume AFTER a logout or an account switch, at which
  // point `dirty` belongs to a different account (or was cleared) — mutating
  // or persisting it would cross the account boundary.
  const myRun = runToken;

  // Snapshot the dirty set at the start of this run. Edits that arrive while
  // we're pushing add to `dirty` and will be picked up by the NEXT push (a
  // fresh schedulePush is triggered by their own markDirty call).
  const snapshot: Array<[string, Action]> = [...dirty.entries()];
  const networkFailures: string[] = [];

  for (const [date, action] of snapshot) {
    if (myRun !== runToken) return;
    // The action could have changed (e.g. put then delete) between snapshot
    // and now. Use the current value, not the snapshot.
    const currentAction = dirty.get(date);
    if (currentAction === undefined) continue;

    if (currentAction === 'put') {
      const local = await dbGetEntry(date);
      if (myRun !== runToken) return;
      if (!local) {
        // Local row vanished between markDirty and now (probably a delete
        // race). Drop from dirty without contacting the server; the matching
        // delete will be in the dirty set with a 'delete' action.
        dirty.delete(date);
        continue;
      }
      try {
        const result = await api.putEntry(
          date,
          local.body,
          local.updatedAt,
          local.format,
        );
        if (myRun !== runToken) return;
        if ('conflict' in result) {
          // Server has strictly-newer copy. LWW: take the server's version,
          // overwrite Dexie WITHOUT marking dirty (else infinite loop).
          await applyServerEntry(date, result.server);
          if (myRun !== runToken) return;
        }
        dirty.delete(date);
      } catch (e) {
        if (myRun !== runToken) return;
        if (isNetworkError(e) || (isApiError(e) && e.status === 401)) {
          // 401 during logout/token-swap races must NOT poison-pill the
          // entry (Audit-2 S8) — the write is retried under the right token.
          networkFailures.push(date);
        } else {
          // Poison pill — 4xx (other than 409/401), 5xx, malformed JSON, etc.
          // Drop so we don't spin forever. The local copy stays in Dexie.
          console.warn('[sync] drop put', date, e);
          dirty.delete(date);
        }
      }
    } else {
      try {
        await api.deleteEntry(date);
        if (myRun !== runToken) return;
        dirty.delete(date);
      } catch (e) {
        if (myRun !== runToken) return;
        if (isNetworkError(e) || (isApiError(e) && e.status === 401)) {
          // Same 401 rule as the put branch above.
          networkFailures.push(date);
        } else {
          console.warn('[sync] drop delete', date, e);
          dirty.delete(date);
        }
      }
    }
  }

  if (myRun !== runToken) return;

  persistDirty();

  if (networkFailures.length > 0) {
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    persistDirty();
    // Schedule next retry; bypass the 3s debounce, use backoff directly.
    // We mark pushScheduled true so concurrent markDirty calls don't try to
    // schedule a duplicate fast retry.
    pushScheduled = true;
    if (scheduledTimer !== undefined) clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(() => {
      pushScheduled = false;
      scheduledTimer = undefined;
      void push();
    }, backoffMs);
  } else {
    backoffMs = BACKOFF_INITIAL_MS;
    persistDirty();
  }

  pushInFlight = false;
  // If new dirty entries arrived during the push (markDirty's
  // schedulePush bailed because pushInFlight was true), re-arm now.
  if (dirty.size > 0) schedulePush(0);
}

// ── Pull ────────────────────────────────────────────────────────────────

/**
 * Fetch a date range from the server and merge into Dexie via LWW.
 *
 * Conservative v1 behavior — DOES NOT auto-delete local entries that appear
 * missing from the server's index. Rationale: at this scale (one user, two
 * devices) a missing entry is far more likely to be "this device just hasn't
 * synced yet" than "the server deleted it." When the user does delete on
 * device A, that delete propagates explicitly through the dirty-set push path
 * and the Worker returns 204; convergence happens that way, not via pull.
 *
 * If we ever want true delete-convergence (out of scope for v1), we'd
 * (a) track per-date tombstones with timestamps in the index, and
 * (b) call dbDeleteFromServer when a tombstone is newer than the local copy.
 */
export async function pull(range?: { from: string; to: string }): Promise<void> {
  // Same abort guard as push(): a pull started under account A must not write
  // A's server payload into B's Dexie handle after a logout / account switch.
  const myRun = runToken;
  try {
    if (!range) return;
    const { entries } = await api.listEntries(range.from, range.to);
    if (myRun !== runToken) return;
    for (const [date, server] of Object.entries(entries)) {
      if (myRun !== runToken) return;
      if (!DATE_RE.test(date)) continue;
      const local = await dbGetEntry(date);
      if (myRun !== runToken) return;
      // LWW: take the server's copy iff it's strictly newer. Strict > matches
      // the Worker's 409 condition exactly, so the two ends agree on which
      // value "wins" given the same pair of timestamps.
      if (!local || server.updatedAt > local.updatedAt) {
        await applyServerEntry(date, server);
      }
    }
  } catch (e) {
    if (!isNetworkError(e)) {
      console.warn('[sync] pull failed', e);
    }
    // NetworkError on pull is silent — the next periodic pull or the
    // 'online' listener will re-trigger.
  }
}

// ── View anchor ─────────────────────────────────────────────────────────

let viewAnchor: string | null = null;

/**
 * Tell the sync layer which ISO Monday the user is currently looking at, so
 * the pull window follows navigation instead of staying pinned to "today".
 */
export function setViewAnchor(isoMonday: string): void {
  viewAnchor = isoMonday;
}

/**
 * Current pull window — the viewed ISO Monday −3/+4 weeks = 7-week span.
 * Bounded payload (well under the 90-day soft cap) and lazy enough that
 * WeekView nav through nearby weeks renders without a round-trip on every
 * step.
 */
function currentPullRange(): { from: string; to: string } {
  const anchorDate = viewAnchor ? parseISO(viewAnchor) : new Date();
  const monday = startOfISOWeek(anchorDate);
  const from = format(addWeeks(monday, -3), 'yyyy-MM-dd');
  const to = format(addWeeks(monday, 4), 'yyyy-MM-dd');
  return { from, to };
}

// ── First-run initialization ─────────────────────────────────────────────

/**
 * Pull the FULL server index in chunks (bounded by the worker's free-plan KV
 * subrequest cap) and reconcile each chunk into Dexie via LWW, same rule as
 * pull(): take the server's copy iff it's strictly newer.
 */
async function fullPullFromIndex(index: string[]): Promise<void> {
  for (let i = 0; i < index.length; i += PULL_CHUNK) {
    const chunk = index.slice(i, i + PULL_CHUNK);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (first === undefined || last === undefined) continue;
    const { entries } = await api.listEntries(first, last);
    for (const [date, server] of Object.entries(entries)) {
      if (!DATE_RE.test(date)) continue;
      const local = await dbGetEntry(date);
      if (!local || server.updatedAt > local.updatedAt) {
        await applyServerEntry(date, server);
      }
    }
  }
}

/**
 * Drain v1's UN-namespaced dirty set into the new namespace so offline edits
 * made before the app update are not orphaned. Guarded on the account: the
 * legacy DB on any device holds marina's data, so draining under any other
 * account would leak it cross-account.
 */
async function drainLegacyDirty(account: string): Promise<void> {
  if (account !== 'marina-actress') return;
  let rawDirty: string | null = null;
  try {
    rawDirty = localStorage.getItem('journal:dirty'); // v1 legacy key (no ns)
  } catch {
    return;
  }
  if (rawDirty === null) return;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawDirty) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const hasLegacyDb = await Dexie.exists('journal');
  if (hasLegacyDb) {
    const legacy = new Dexie('journal');
    legacy.version(1).stores({ entries: 'date, updatedAt' });
    for (const [date, action] of Object.entries(parsed)) {
      if (!DATE_RE.test(date)) continue;
      if (action === 'put') {
        const row = (await legacy.table('entries').get(date)) as
          | { body: string; updatedAt: string }
          | undefined;
        if (row) {
          // Preserve the original updatedAt (LWW correctness), then queue.
          await dbWriteFromServer(date, { body: row.body, updatedAt: row.updatedAt });
          markDirty(date, 'put');
        }
      } else if (action === 'delete') {
        markDirty(date, 'delete');
      }
    }
    legacy.close();
  }
  try {
    localStorage.removeItem('journal:dirty');
    localStorage.removeItem('journal:backoff');
  } catch {
    /* ignore */
  }
}

async function ensureInitialized(): Promise<void> {
  const ns = namespace;
  if (ns === null) return;
  try {
    if (localStorage.getItem(nsKey(ns, 'initialized')) === '1') {
      initState.set('ready');
      return;
    }
  } catch {
    /* ignore — treat as uninitialized */
  }

  initState.set('initializing');
  try {
    const { account } = await api.health();
    localStorage.setItem(nsKey(ns, 'account'), account);

    await drainLegacyDirty(account);

    const { index } = await api.listIndex();
    const legacyDbExists = await Dexie.exists('journal');
    if (index.length === 0 && legacyDbExists && account === 'marina-actress') {
      // Post-migration KV eventual consistency can serve a stale-empty index
      // for up to ~60s. An empty journal for an account with local history is
      // NOT a valid completed init — retry later instead of presenting it.
      throw new NetworkError('suspicious empty index for account with legacy data');
    }

    await fullPullFromIndex(index);
    localStorage.setItem(nsKey(ns, 'initialized'), '1');
    initState.set('ready');
  } catch (e) {
    // Any failure: not initialized. If we already have local data (previous
    // partial pull), the app is usable; the overlay only blocks when empty.
    const have = await countEntries().catch(() => 0);
    initState.set(have > 0 ? 'ready' : 'needs-network');
    if (!isNetworkError(e)) console.warn('[sync] init failed', e);
  }
}

// ── Lifecycle: start/stop, called from App.svelte ───────────────────────

/**
 * Begin background sync for account namespace `ns`. Idempotent — calling
 * syncStart(ns) twice with the same namespace while running is a no-op. Must
 * be called only after a valid token is in the auth store (the api client
 * reads the token on every request) and after initDb(ns).
 *
 * What it does:
 *   1. On a namespace CHANGE, drop all in-memory queue state first (see the
 *      comment inline) so no edit crosses accounts.
 *   2. Hydrate the dirty set / backoff from this namespace's own keys.
 *   3. Kick first-run initialization (Task A8).
 *   4. Immediate range-pull so device-restore-from-KV works on launch.
 *   5. If the dirty set has entries (loaded from localStorage on a prior
 *      crash/close), schedule a push so they drain.
 *   6. Start the 3-min periodic pull (only fires when visible + online).
 *   7. Listen for 'online' (flush + pull) and 'visibilitychange' (pull).
 */
export function syncStart(ns: string): void {
  if (pullTimer !== undefined && namespace === ns) return; // already running

  if (namespace !== null && namespace !== ns) {
    // Namespace CHANGE: never let one account's queued edits push into
    // another account. In-memory state is dropped; the old account's dirty
    // set stays persisted under its own namespaced key and will resume when
    // that token is used again.
    syncStop(); // tear down the previous account's timers/listeners first
    dirty.clear();
    backoffMs = BACKOFF_INITIAL_MS;
    runToken++;
    initState.set('idle');
  }
  namespace = ns;
  hydrate();

  void ensureInitialized();

  const range = currentPullRange();
  void pull(range);

  if (dirty.size > 0) schedulePush();

  pullTimer = setInterval(() => {
    if (get(initState) !== 'ready') {
      // First-run init hasn't completed (e.g. it failed with 'needs-network'
      // and no local data yet) — re-attempt it. ensureInitialized() itself
      // early-returns once the 'initialized' localStorage flag is set.
      void ensureInitialized();
    }
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      typeof navigator !== 'undefined' &&
      navigator.onLine
    ) {
      void pull(currentPullRange());
    }
  }, PULL_INTERVAL_MS);

  if (typeof window !== 'undefined') {
    onlineListener = () => {
      void ensureInitialized();
      void push();
      void pull(currentPullRange());
    };
    window.addEventListener('online', onlineListener);
  }

  if (typeof document !== 'undefined') {
    visibilityListener = () => {
      if (
        document.visibilityState === 'visible' &&
        typeof navigator !== 'undefined' &&
        navigator.onLine
      ) {
        void pull(currentPullRange());
      }
    };
    document.addEventListener('visibilitychange', visibilityListener);
  }
}

/**
 * Tear down listeners and timers, and abort any in-flight push at its next
 * checkpoint (runToken bump). Called on token clear (logout) and on the
 * namespace-change path in syncStart.
 *
 * The in-memory dirty set is left intact — if the user pastes the SAME token
 * back later, queued edits resume; if a different token arrives, syncStart's
 * namespace-change branch clears it before anything can push.
 */
export function syncStop(): void {
  if (pullTimer !== undefined) {
    clearInterval(pullTimer);
    pullTimer = undefined;
  }
  if (scheduledTimer !== undefined) {
    clearTimeout(scheduledTimer);
    scheduledTimer = undefined;
  }
  pushScheduled = false;
  // Bump BEFORE clearing pushInFlight: an in-flight push sees the mismatch at
  // its next checkpoint and returns without touching `dirty` or localStorage.
  runToken++;
  pushInFlight = false;
  if (onlineListener && typeof window !== 'undefined') {
    window.removeEventListener('online', onlineListener);
  }
  onlineListener = undefined;
  if (visibilityListener && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityListener);
  }
  visibilityListener = undefined;
}
