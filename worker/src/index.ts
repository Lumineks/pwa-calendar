import { verifyBearer } from './tokens';

export interface Env {
  JOURNAL: KVNamespace;
  JOURNAL_TOKENS: string;
  ALLOWED_ORIGIN: string;
}

interface EntryValue {
  body: string;
  updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Month: 01–12, Day: 01–31 (calendar-range validation; not per-month leap checks)
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UPDATED_AT_RE = /^\d{4}-\d{2}-\d{2}T/;

function isValidDate(s: string): boolean {
  return DATE_RE.test(s);
}

/** Build a JSON response with CORS headers always attached. */
function jsonResponse(
  body: unknown,
  status: number,
  allowedOrigin: string,
  extra?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(allowedOrigin),
      ...(extra ?? {}),
    },
  });
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// ── KV helpers ────────────────────────────────────────────────────────────────

async function getIndex(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get("index");
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function putIndex(kv: KVNamespace, index: string[]): Promise<void> {
  await kv.put("index", JSON.stringify(index));
}

/** Insert date into a sorted, deduplicated index array. */
function insertSorted(index: string[], date: string): string[] {
  if (index.includes(date)) return index;
  return [...index, date].sort();
}

/** Remove date from index array. */
function removeFromIndex(index: string[], date: string): string[] {
  return index.filter((d) => d !== date);
}

async function getEntry(
  kv: KVNamespace,
  date: string,
): Promise<EntryValue | null> {
  const raw = await kv.get(`entries:${date}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EntryValue;
  } catch {
    return null;
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleHealth(allowedOrigin: string): Promise<Response> {
  return jsonResponse({ ok: true }, 200, allowedOrigin);
}

async function handleGetEntries(
  url: URL,
  env: Env,
  allowedOrigin: string,
): Promise<Response> {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Exactly one of from/to provided → 400
  if ((from === null) !== (to === null)) {
    return jsonResponse(
      { error: "Provide both 'from' and 'to', or neither" },
      400,
      allowedOrigin,
    );
  }

  // Validate date params if provided
  if (from !== null && !isValidDate(from)) {
    return jsonResponse({ error: "Invalid 'from' date" }, 400, allowedOrigin);
  }
  if (to !== null && !isValidDate(to)) {
    return jsonResponse({ error: "Invalid 'to' date" }, 400, allowedOrigin);
  }

  const index = await getIndex(env.JOURNAL);

  if (from === null || to === null) {
    return jsonResponse({ index }, 200, allowedOrigin);
  }

  // Range query: filter index, fetch all entries in parallel
  const inRange = index.filter((d) => d >= from && d <= to);
  const fetched = await Promise.all(
    inRange.map((d) => getEntry(env.JOURNAL, d)),
  );

  const entries: Record<string, EntryValue> = {};
  for (let i = 0; i < inRange.length; i++) {
    const date = inRange[i];
    const entry = fetched[i];
    if (date !== undefined && entry !== null && entry !== undefined) {
      entries[date] = entry;
    }
  }

  return jsonResponse({ index, entries }, 200, allowedOrigin);
}

async function handleGetEntry(
  date: string,
  env: Env,
  allowedOrigin: string,
): Promise<Response> {
  if (!isValidDate(date)) {
    return jsonResponse({ error: "Invalid date format" }, 400, allowedOrigin);
  }
  const entry = await getEntry(env.JOURNAL, date);
  if (!entry) {
    return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
  }
  return jsonResponse(entry, 200, allowedOrigin);
}

async function handlePutEntry(
  date: string,
  request: Request,
  env: Env,
  allowedOrigin: string,
): Promise<Response> {
  if (!isValidDate(date)) {
    return jsonResponse({ error: "Invalid date format" }, 400, allowedOrigin);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, allowedOrigin);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>)["body"] !== "string" ||
    typeof (body as Record<string, unknown>)["updatedAt"] !== "string"
  ) {
    return jsonResponse(
      { error: "Body must be { body: string, updatedAt: string }" },
      400,
      allowedOrigin,
    );
  }

  const incoming = body as EntryValue;

  if (!UPDATED_AT_RE.test(incoming.updatedAt)) {
    return jsonResponse(
      { error: "updatedAt must be an ISO 8601 timestamp" },
      400,
      allowedOrigin,
    );
  }

  // LWW: if server copy is strictly newer, reject with 409
  const current = await getEntry(env.JOURNAL, date);
  if (current !== null && current.updatedAt > incoming.updatedAt) {
    return jsonResponse({ server: current }, 409, allowedOrigin);
  }

  // Write entry and update index atomically (best-effort; KV has eventual consistency)
  const [index] = await Promise.all([getIndex(env.JOURNAL)]);
  await Promise.all([
    env.JOURNAL.put(`entries:${date}`, JSON.stringify(incoming)),
    putIndex(env.JOURNAL, insertSorted(index, date)),
  ]);

  return jsonResponse({ ok: true }, 200, allowedOrigin);
}

async function handleDeleteEntry(
  date: string,
  env: Env,
  allowedOrigin: string,
): Promise<Response> {
  if (!isValidDate(date)) {
    return jsonResponse({ error: "Invalid date format" }, 400, allowedOrigin);
  }

  const current = await getEntry(env.JOURNAL, date);

  // Always prune index (defensive), even if the entry didn't exist
  const index = await getIndex(env.JOURNAL);
  await Promise.all([
    env.JOURNAL.delete(`entries:${date}`),
    putIndex(env.JOURNAL, removeFromIndex(index, date)),
  ]);

  if (!current) {
    return new Response(null, {
      status: 404,
      headers: corsHeaders(allowedOrigin),
    });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(allowedOrigin),
  });
}

// ── Main fetch handler ────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowedOrigin = env.ALLOWED_ORIGIN;
    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    const path = url.pathname;

    // OPTIONS preflight — no auth required
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin),
      });
    }

    try {
      // Auth check for all non-OPTIONS requests
      const account = await verifyBearer(request, env.JOURNAL_TOKENS);
      if (account === null) {
        return jsonResponse({ error: "Unauthorized" }, 401, allowedOrigin);
      }
      void account; // threaded into handlers in Task A4

      // ── Route dispatch ──────────────────────────────────────────────────────

      // GET /health
      if (path === "/health" && method === "GET") {
        return handleHealth(allowedOrigin);
      }

      // /entries (no date segment)
      if (path === "/entries") {
        if (method === "GET") {
          return handleGetEntries(url, env, allowedOrigin);
        }
        return jsonResponse({ error: "Method not allowed" }, 405, allowedOrigin, {
          Allow: "GET",
        });
      }

      // /entries/:date
      const entriesDateMatch = path.match(/^\/entries\/([^/]+)$/);
      if (entriesDateMatch) {
        const date = entriesDateMatch[1] ?? "";
        if (method === "GET") return handleGetEntry(date, env, allowedOrigin);
        if (method === "PUT") return handlePutEntry(date, request, env, allowedOrigin);
        if (method === "DELETE") return handleDeleteEntry(date, env, allowedOrigin);
        return jsonResponse({ error: "Method not allowed" }, 405, allowedOrigin, {
          Allow: "GET, PUT, DELETE",
        });
      }

      return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
    } catch (err) {
      console.error("Unhandled error:", err);
      return jsonResponse({ error: "internal" }, 500, allowedOrigin);
    }
  },
};
