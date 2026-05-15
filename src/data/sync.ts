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
 *                dbWriteFromServer (NOT putEntry — see db.ts) and drop
 *       - 204/404 (delete) → drop (idempotent)
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
 * Persistence is intentionally minimal:
 *   localStorage 'journal:dirty'   → JSON map of date → 'put' | 'delete'
 *   localStorage 'journal:backoff' → numeric ms (capped)
 *
 * No schema versioning yet; the keys are small and easy to discard if the
 * format ever changes. If you add fields, also bump a version key alongside.
 */

import {
  addWeeks,
  format,
  startOfISOWeek,
} from 'date-fns';
import * as api from './api.ts';
import { isNetworkError } from './api.ts';
import {
  getEntry as dbGetEntry,
  dbWriteFromServer,
} from './db.ts';

// ── Types & constants ───────────────────────────────────────────────────

export type Action = 'put' | 'delete';

const LS_KEY_DIRTY = 'journal:dirty';
const LS_KEY_BACKOFF = 'journal:backoff';

const DEBOUNCE_MS = 3_000;
const PULL_INTERVAL_MS = 3 * 60_000;
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 5 * 60_000;

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

// ── Persistence ─────────────────────────────────────────────────────────

function persistDirty(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const obj: Record<string, Action> = {};
    for (const [k, v] of dirty) obj[k] = v;
    localStorage.setItem(LS_KEY_DIRTY, JSON.stringify(obj));
    localStorage.setItem(LS_KEY_BACKOFF, String(backoffMs));
  } catch {
    // Quota or privacy-mode failures aren't recoverable here; in-memory state
    // remains correct for this session. Audit 2 may surface this if it bites.
  }
}

function hydrate(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const rawDirty = localStorage.getItem(LS_KEY_DIRTY);
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
    const rawBackoff = localStorage.getItem(LS_KEY_BACKOFF);
    if (rawBackoff !== null) {
      const n = Number(rawBackoff);
      if (Number.isFinite(n) && n >= BACKOFF_INITIAL_MS) {
        backoffMs = Math.min(n, BACKOFF_MAX_MS);
      }
    }
  } catch {
    // Corrupt localStorage entries → start fresh.
    try {
      localStorage.removeItem(LS_KEY_DIRTY);
      localStorage.removeItem(LS_KEY_BACKOFF);
    } catch {
      // ignore
    }
  }
}

hydrate();

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

  // Snapshot the dirty set at the start of this run. Edits that arrive while
  // we're pushing add to `dirty` and will be picked up by the NEXT push (a
  // fresh schedulePush is triggered by their own markDirty call).
  const snapshot: Array<[string, Action]> = [...dirty.entries()];
  const networkFailures: string[] = [];

  for (const [date, action] of snapshot) {
    // The action could have changed (e.g. put then delete) between snapshot
    // and now. Use the current value, not the snapshot.
    const currentAction = dirty.get(date);
    if (currentAction === undefined) continue;

    if (currentAction === 'put') {
      const local = await dbGetEntry(date);
      if (!local) {
        // Local row vanished between markDirty and now (probably a delete
        // race). Drop from dirty without contacting the server; the matching
        // delete will be in the dirty set with a 'delete' action.
        dirty.delete(date);
        continue;
      }
      try {
        const result = await api.putEntry(date, local.body, local.updatedAt);
        if ('conflict' in result) {
          // Server has strictly-newer copy. LWW: take the server's version,
          // overwrite Dexie WITHOUT marking dirty (else infinite loop).
          await dbWriteFromServer(date, result.server);
        }
        dirty.delete(date);
      } catch (e) {
        if (isNetworkError(e)) {
          networkFailures.push(date);
        } else {
          // Poison pill — 4xx (other than 409), 5xx, malformed JSON, etc.
          // Drop so we don't spin forever. The local copy stays in Dexie.
          console.warn('[sync] drop put', date, e);
          dirty.delete(date);
        }
      }
    } else {
      try {
        await api.deleteEntry(date);
        dirty.delete(date);
      } catch (e) {
        if (isNetworkError(e)) {
          networkFailures.push(date);
        } else {
          console.warn('[sync] drop delete', date, e);
          dirty.delete(date);
        }
      }
    }
  }

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
  try {
    if (!range) return;
    const { entries } = await api.listEntries(range.from, range.to);
    for (const [date, server] of Object.entries(entries)) {
      if (!DATE_RE.test(date)) continue;
      const local = await dbGetEntry(date);
      // LWW: take the server's copy iff it's strictly newer. Strict > matches
      // the Worker's 409 condition exactly, so the two ends agree on which
      // value "wins" given the same pair of timestamps.
      if (!local || server.updatedAt > local.updatedAt) {
        await dbWriteFromServer(date, server);
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

/**
 * Current pull window — current ISO Monday ± 3 weeks = 7-week span. Bounded
 * payload (well under the 90-day soft cap) and lazy enough that WeekView nav
 * through nearby weeks renders without a round-trip on every step.
 */
function currentPullRange(): { from: string; to: string } {
  const monday = startOfISOWeek(new Date());
  const from = format(addWeeks(monday, -3), 'yyyy-MM-dd');
  const to = format(addWeeks(monday, 4), 'yyyy-MM-dd');
  return { from, to };
}

// ── Lifecycle: start/stop, called from App.svelte ───────────────────────

/**
 * Begin background sync. Idempotent — calling syncStart() twice is a no-op.
 * Must be called only after a valid token is in the auth store (the api
 * client reads the token on every request).
 *
 * What it does:
 *   1. Immediate range-pull so device-restore-from-KV works on launch.
 *   2. If dirty set already has entries (loaded from localStorage on a prior
 *      crash/close), schedule a push so they drain.
 *   3. Start the 3-min periodic pull (only fires when visible + online).
 *   4. Listen for 'online' (flush + pull) and 'visibilitychange' (pull).
 */
export function syncStart(): void {
  if (pullTimer !== undefined) return;

  const range = currentPullRange();
  void pull(range);

  if (dirty.size > 0) schedulePush();

  pullTimer = setInterval(() => {
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
 * Tear down listeners and timers. Called on token clear (clearToken in
 * WeekView's "Выйти" button). In-memory dirty set is left intact — if the
 * user pastes the same token back later, queued edits will eventually flush.
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
  if (onlineListener && typeof window !== 'undefined') {
    window.removeEventListener('online', onlineListener);
  }
  onlineListener = undefined;
  if (visibilityListener && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityListener);
  }
  visibilityListener = undefined;
}
