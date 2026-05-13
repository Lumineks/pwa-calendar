/**
 * Typed Cloudflare Worker client.
 *
 * Auth: pulls the bearer token from the auth store on every call. TokenGate
 * passes an explicit `tokenOverride` to `health()` because it validates the
 * value BEFORE storing it.
 *
 * Errors are split into two typed classes:
 *   - NetworkError — couldn't reach the server (fetch threw, abort, CORS).
 *     The sync layer treats this as a transient failure and retries with
 *     backoff; the TokenGate uses it to render "Нет соединения".
 *   - ApiError    — the server responded but with a non-2xx status (401,
 *     409, 4xx, 5xx). The sync layer treats most ApiErrors as poison pills
 *     and drops the dirty key; 409 is special-cased to surface the server's
 *     copy for LWW merge.
 *
 * Response shapes mirror worker/src/index.ts. Worker contracts:
 *   - GET    /health              → 200 { ok: true } | 401
 *   - GET    /entries             → 200 { index: string[] }
 *   - GET    /entries?from&to     → 200 { index: string[], entries: {...} }
 *   - GET    /entries/:date       → 200 { body, updatedAt } | 404
 *   - PUT    /entries/:date       → 200 { ok: true }
 *                                 | 409 { server: { body, updatedAt } }  (LWW)
 *   - DELETE /entries/:date       → 204 | 404 (both treated as success)
 */

import { get } from 'svelte/store';
import { token } from '../state/auth.ts';

export interface EntryValue {
  body: string;
  updatedAt: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;
  constructor(status: number, payload: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export class NetworkError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError;
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

interface FetchOptions {
  tokenOverride?: string;
  signal?: AbortSignal;
}

async function apiFetch(
  path: string,
  init: RequestInit = {},
  options: FetchOptions = {},
): Promise<Response> {
  const base = import.meta.env.VITE_WORKER_URL;
  if (!base) {
    throw new Error('VITE_WORKER_URL is not configured');
  }

  const tokenValue = options.tokenOverride ?? get(token);
  const headers = new Headers(init.headers ?? {});
  if (tokenValue !== null && tokenValue !== undefined) {
    headers.set('Authorization', `Bearer ${tokenValue}`);
  }
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    // `fetch` rejects on network errors, aborts, and CORS preflight failures.
    // All of these are "couldn't reach server" from the sync layer's POV.
    throw new NetworkError('network request failed', err);
  }
}

/**
 * Parse a JSON response body. If the body isn't valid JSON, throw an ApiError
 * carrying the raw text so the caller can log it (rather than silently
 * returning undefined and confusing the sync logic).
 */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(res.status, text, 'invalid json');
  }
}

async function readJsonOrThrow(res: Response): Promise<unknown> {
  const data = await readJson(res);
  if (!res.ok) {
    throw new ApiError(res.status, data, `http ${res.status}`);
  }
  return data;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Validate that a bearer token works. Accepts an optional override so
 * TokenGate can validate BEFORE calling setToken() — the auth store is still
 * null at that point.
 *
 * Throws ApiError(401) on bad token, NetworkError on connectivity failure.
 */
export async function health(tokenOverride?: string): Promise<{ ok: true }> {
  const res = await apiFetch(
    '/health',
    { method: 'GET' },
    tokenOverride !== undefined ? { tokenOverride } : {},
  );
  const data = await readJsonOrThrow(res);
  return data as { ok: true };
}

export async function listIndex(): Promise<{ index: string[] }> {
  const res = await apiFetch('/entries', { method: 'GET' });
  const data = await readJsonOrThrow(res);
  return data as { index: string[] };
}

export async function listEntries(
  from: string,
  to: string,
): Promise<{ index: string[]; entries: Record<string, EntryValue> }> {
  const qs = new URLSearchParams({ from, to }).toString();
  const res = await apiFetch(`/entries?${qs}`, { method: 'GET' });
  const data = await readJsonOrThrow(res);
  return data as { index: string[]; entries: Record<string, EntryValue> };
}

/**
 * Fetch a single entry. 404 → null (the caller decides whether the local copy
 * should also be removed; v1 sync does not auto-delete on absence).
 */
export async function getEntry(date: string): Promise<EntryValue | null> {
  const res = await apiFetch(`/entries/${date}`, { method: 'GET' });
  if (res.status === 404) {
    // Drain the body so the connection can be reused.
    await res.text();
    return null;
  }
  const data = await readJsonOrThrow(res);
  return data as EntryValue;
}

export type PutEntryResult =
  | { ok: true }
  | { conflict: true; server: EntryValue };

/**
 * Upsert a single entry.
 *
 *   200 → { ok: true }
 *   409 → { conflict: true, server } — the server's copy is strictly newer.
 *         The sync layer overwrites Dexie via dbWriteFromServer() and drops
 *         the date from the dirty set.
 *
 * Any other non-2xx throws ApiError; network failures throw NetworkError.
 */
export async function putEntry(
  date: string,
  body: string,
  updatedAt: string,
): Promise<PutEntryResult> {
  const res = await apiFetch(`/entries/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ body, updatedAt }),
  });
  if (res.status === 409) {
    const payload = (await readJson(res)) as { server: EntryValue } | null;
    if (!payload || typeof payload !== 'object' || !('server' in payload)) {
      throw new ApiError(409, payload, '409 missing server payload');
    }
    return { conflict: true, server: payload.server };
  }
  const data = await readJsonOrThrow(res);
  return data as { ok: true };
}

/**
 * Delete a single entry. Idempotent from the client's POV: 204 and 404 both
 * resolve normally (the entry is gone either way). Other non-2xx throw.
 */
export async function deleteEntry(date: string): Promise<void> {
  const res = await apiFetch(`/entries/${date}`, { method: 'DELETE' });
  if (res.status === 204 || res.status === 404) {
    await res.text();
    return;
  }
  const data = await readJson(res);
  throw new ApiError(res.status, data, `http ${res.status}`);
}
