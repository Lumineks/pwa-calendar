# v2 Implementation Plan — journal-calendar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v2: multi-account tokens with a safe migration of the friend's data, a lazily-loaded Tiptap color editor, finger-following swipe navigation, visual polish, and worker tests — per the approved spec `docs/superpowers/specs/2026-08-27-v2-design.md` (rev 2.1).

**Architecture:** Cloudflare Worker gains a token→account map and per-account KV prefixes (`a:<id>:...`); the client namespaces all local state by a synchronous FNV-1a hash of the token, with a new `src/data/namespace.ts` module breaking the `db.ts ⇄ sync.ts` import cycle. The DayView textarea is replaced by a lazily-imported Tiptap editor storing sanitized HTML in the existing opaque `body` string (with an explicit `format: 'html'` marker). A reusable `SwipePager` wraps both views.

**Tech Stack:** Svelte 5 (runes) + Vite 8 + TS, Dexie 4, date-fns 4, Tiptap 3 (exact-pinned), DOMPurify, Cloudflare Workers + KV, `@cloudflare/vitest-plugin`, vitest 4, GitHub Pages + GH Actions.

**Constraint sources (read before implementing a task that cites them):**
- Spec: `docs/superpowers/specs/2026-08-27-v2-design.md`
- Domain audit (34 MUSTs): `docs/superpowers/expert/2026-08-27-v2-design.md`
- Library audit: `docs/superpowers/library-audit/2026-08-27-v2-design.md`

## Global Constraints

- Account ids: `marina-actress` (friend, existing data), `test` (new). Pattern `[a-z0-9-]{1,32}`.
- KV layout v2: `a:<accountId>:entries:<YYYY-MM-DD>`, `a:<accountId>:index`. Legacy keys `entries:*`, `index` are a permanent archive — the v2 worker never reads or writes them; nothing ever deletes them.
- Token compare: SHA-256 digest both sides, `crypto.subtle.timingSafeEqual` on 32-byte digests, iterate ALL map entries, no early exit. Never call `timingSafeEqual` on raw token bytes (it throws on unequal lengths).
- `JOURNAL_TOKEN` secret stays provisioned until ≥2 weeks after Phase A acceptance (`wrangler rollback` does not restore deleted secrets). Deleting it is out of scope for this plan.
- Body limit: 65536 UTF-8 **bytes** (not chars) on both sides; worker replies **413**; client must never let an oversize entry pin the dirty queue.
- All `@tiptap/*` packages pinned to ONE identical exact version (peer deps are exact-pinned). `@tiptap/pm` is a required explicit dep. `UndoRedo` comes from `@tiptap/extensions`; `TextStyle`+`Color` from `@tiptap/extension-text-style`. No `svelte-tiptap`, no starter-kit.
- Editor computed font-size ≥ 16px (iOS zoom floor). Palette dots and DayView controls bind `pointerup`, never `click` (tiptap#7514).
- All programmatic editor content writes: `setContent(html, { emitUpdate: false })`, and only when `editor.view.composing === false` (defer to `compositionend` otherwise).
- Entry format marker: `format?: 'html'` field on the entry value. Absent = legacy plain text. No prefix-sniffing heuristics.
- Sanitizer: DOMPurify, ALLOWED_TAGS `p,br,span`, span attrs rebuilt from scratch, colors validated via CSSOM round-trip against the palette, sanitize-twice stability check, depth bound.
- SwipePager: `touchstart` listener registered `{ passive: false }`; horizontal lock at |dx|>8 && |dx|>1.7·|dy|; history semantics = **push**.
- `BASE_URL` prefix logic lives in ONE module (`src/lib/base.ts`) after Task B6.
- All user-visible strings in Russian. UI copy given verbatim in tasks below.
- Node ≥ 22 for build/test (`.nvmrc` already says 22; `engines` added in Task B1).
- Worker deploys are MANUAL (`workflow_dispatch`) from Task A1 onward. Never auto-deploy the worker by pushing to main.
- The uncommitted edit in `worker/src/index.ts` (dead `JOURNAL_TOKENS` field + unused `tokens` var) is absorbed by Task A3 — do not commit it standalone, do not revert it separately.
- Migration backup snapshots are written OUTSIDE the repo working tree (`~/journal-kv-backups/`).
- Commit after every task (steps say when). Run `npm run check` before each frontend commit.

---

# Phase A — Accounts & migration

### Task A1: CI — gate the worker deploy, add a test job

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: CI contract for all later tasks — `test` job runs `npm run check` + `npm test --if-present` (root) and `npm test --if-present` (worker); `deploy-worker` runs only on manual `workflow_dispatch`.

- [x] **Step 1: Rewrite the workflow**

Replace the `jobs:` section of `.github/workflows/deploy.yml` with:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm test --if-present
      - run: npm ci
        working-directory: worker
      - run: npm test --if-present
        working-directory: worker

  build-pages:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run build
        env:
          VITE_WORKER_URL: ${{ secrets.VITE_WORKER_URL }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy-pages:
    needs: build-pages
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment

  # MANUAL ONLY. Auto-deploying the worker would break the migration protocol
  # (new prefix-reading code live before data is copied). Trigger from the
  # Actions tab → Deploy → Run workflow.
  deploy-worker:
    needs: test
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
          cache-dependency-path: worker/package-lock.json
      - run: npm ci
        working-directory: worker
      - run: npm test --if-present
        working-directory: worker
      - run: npx wrangler deploy
        working-directory: worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Keep the existing `on:`, `permissions:`, `concurrency:` blocks unchanged (`workflow_dispatch: {}` is already present in `on:`).

- [x] **Step 2: Validate YAML locally**

Run: `npx --yes yaml-lint .github/workflows/deploy.yml || node -e "require('js-yaml')"` — if neither tool is available, visually verify indentation and run `git diff` to review.

- [x] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: gate worker deploy behind workflow_dispatch, add test job"
```

Note: pushing this commit to `main` triggers a Pages deploy of the unchanged frontend — harmless.

---

### Task A2: Dev KV namespace + dev secrets

**Files:**
- Modify: `worker/wrangler.toml`
- Create: `worker/.dev.vars.example` (committed), `worker/.dev.vars` (NOT committed — `.dev.vars` is already gitignored)
- Modify: `worker/README.md`

**Interfaces:**
- Produces: `[env.dev]` bound to a NON-production KV namespace; local dev + migration rehearsal never touch production data.

- [x] **Step 1: Create the dev KV namespace** (id: `6e25ab0cda1344f793f2c7872e54a19b`)

Run (from `worker/`):

```bash
npx wrangler kv namespace create JOURNAL_DEV
```

Expected output contains a new namespace id (32-hex). Record it as `<DEV_KV_ID>`.

- [x] **Step 2: Point env.dev at it**

In `worker/wrangler.toml`, replace the `[env.dev]` KV block (which currently reuses the production id `e329d26f945e46c094a7bf982d8a5895`) with:

```toml
[env.dev]
[env.dev.vars]
ALLOWED_ORIGIN = "http://localhost:5173"

[[env.dev.kv_namespaces]]
binding = "JOURNAL"
id = "<DEV_KV_ID>"
```

Delete the old comment block about sharing the production namespace.

- [x] **Step 3: Dev token map**

Create `worker/.dev.vars.example` (committed template):

```ini
# Copy to worker/.dev.vars (gitignored). Map: token -> accountId.
JOURNAL_TOKENS = {"dev-token-marina":"marina-actress","dev-token-test":"test"}
```

Create `worker/.dev.vars` with the same content (real local values are fine to equal the example in dev).

- [x] **Step 4: Verify dev worker boots**

Run: `npm --prefix worker run dev` — expect wrangler to start without binding errors; Ctrl-C. (Auth will 401 until Task A3/A4 land — that's fine; we only verify bindings resolve.)

- [x] **Step 5: Document in worker/README.md**

Add a short section "Dev setup": copy `.dev.vars.example` → `.dev.vars`; dev KV namespace is separate from production; production secret is `JOURNAL_TOKENS` (JSON map), legacy `JOURNAL_TOKEN` retained during the rollback window.

- [x] **Step 6: Commit**

```bash
git add worker/wrangler.toml worker/.dev.vars.example worker/README.md
git commit -m "chore(worker): separate dev KV namespace + JOURNAL_TOKENS dev vars"
```

---

### Task A3: Worker test harness + token verification module (TDD)

**Files:**
- Modify: `worker/package.json` (+ lockfile)
- Create: `worker/vitest.config.ts`
- Create: `worker/src/tokens.ts`
- Create: `worker/test/tokens.spec.ts`
- Modify: `worker/src/index.ts` (absorb the uncommitted dead-code edit; wire `verifyToken`)

**Interfaces:**
- Produces: `parseTokenMap(raw: string | undefined): Map<string, { account: string; digest: ArrayBuffer }> | null` (async variant below), and `verifyToken(request: Request, env: { JOURNAL_TOKENS?: string }): Promise<string | null>` returning the accountId or null. `Env` interface: `{ JOURNAL: KVNamespace; JOURNAL_TOKENS: string; ALLOWED_ORIGIN: string }` (drop `JOURNAL_TOKEN` from the type; the secret itself stays provisioned).

- [x] **Step 1: Install the test stack**

Run from `worker/`:

```bash
npm i -D vitest@^4.1.0 @cloudflare/vitest-plugin@^1.1.0
```

Add to `worker/package.json` scripts: `"test": "vitest run"`.

- [x] **Step 2: Vitest config**

Create `worker/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        kvNamespaces: ['JOURNAL'],
        bindings: {
          ALLOWED_ORIGIN: 'http://localhost:5173',
          JOURNAL_TOKENS: JSON.stringify({
            'marina-token-aaaaaaaaaaaaaaaaaaaaaaaa': 'marina-actress',
            'test-token-bb': 'test',
          }),
        },
      },
    }),
  ],
});
```

NOTE for implementer: the plugin was renamed from `@cloudflare/vitest-pool-workers` on 2026-08-19; if the `cloudflareTest` option shape differs in the installed version, follow the package README — the fixed points are: `configPath` accepts our `.toml`; tests import `env` from `cloudflare:workers` and `createExecutionContext`/`waitOnExecutionContext` from `cloudflare:test`. Deliberately different token lengths above — they exercise the no-throw guarantee.

- [x] **Step 3: Write failing tests**

Create `worker/test/tokens.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { verifyBearer, parseTokenMap } from '../src/tokens';

const MAP = JSON.stringify({
  'marina-token-aaaaaaaaaaaaaaaaaaaaaaaa': 'marina-actress',
  'test-token-bb': 'test',
});

function req(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set('Authorization', auth);
  return new Request('https://x/health', { headers });
}

describe('parseTokenMap', () => {
  it('parses a valid map', async () => {
    const m = await parseTokenMap(MAP);
    expect(m).not.toBeNull();
    expect([...m!.values()].map((v) => v.account).sort()).toEqual(['marina-actress', 'test']);
  });
  it('fails closed on malformed JSON', async () => {
    expect(await parseTokenMap('{oops')).toBeNull();
  });
  it('fails closed on invalid accountId', async () => {
    expect(await parseTokenMap(JSON.stringify({ tok: 'Bad_Id!' }))).toBeNull();
  });
  it('fails closed on undefined', async () => {
    expect(await parseTokenMap(undefined)).toBeNull();
  });
});

describe('verifyBearer', () => {
  it('maps marina token to her account', async () => {
    expect(await verifyBearer(req('Bearer marina-token-aaaaaaaaaaaaaaaaaaaaaaaa'), MAP)).toBe('marina-actress');
  });
  it('maps test token to test account', async () => {
    expect(await verifyBearer(req('Bearer test-token-bb'), MAP)).toBe('test');
  });
  it('rejects an unknown token (different length from every map key — must not throw)', async () => {
    expect(await verifyBearer(req('Bearer nope'), MAP)).toBeNull();
  });
  it('rejects same-length wrong token', async () => {
    expect(await verifyBearer(req('Bearer test-token-bc'), MAP)).toBeNull();
  });
  it('rejects missing/malformed header', async () => {
    expect(await verifyBearer(req(), MAP)).toBeNull();
    expect(await verifyBearer(req('Basic zzz'), MAP)).toBeNull();
  });
  it('rejects everything when the map is malformed (fail closed)', async () => {
    expect(await verifyBearer(req('Bearer test-token-bb'), '{broken')).toBeNull();
  });
});
```

- [x] **Step 4: Run tests — expect FAIL**

Run: `npm --prefix worker test` — expected: cannot resolve `../src/tokens`.

- [x] **Step 5: Implement `worker/src/tokens.ts`**

```ts
/**
 * Token-map auth for the multi-account worker.
 *
 * JOURNAL_TOKENS secret = JSON map { "<token>": "<accountId>" }.
 * Comparison strategy: SHA-256 both the incoming token and each map key,
 * then timingSafeEqual the two fixed 32-byte digests. Lengths always match,
 * so the runtime's throw-on-unequal-length can never fire, and no
 * length-dependent branch exists. We iterate EVERY map entry without early
 * exit and accumulate the match.
 */

const ACCOUNT_RE = /^[a-z0-9-]{1,32}$/;
const MIN_TOKEN_LENGTH = 8;

export interface TokenEntry {
  account: string;
  digest: ArrayBuffer;
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
}

// Cache keyed by the raw secret string: parse+digest once per isolate,
// not per request. A changed secret (new deploy) changes `raw` identity.
let cachedRaw: string | undefined;
let cachedMap: Map<string, TokenEntry> | null = null;

export async function parseTokenMap(
  raw: string | undefined,
): Promise<Map<string, TokenEntry> | null> {
  if (raw === cachedRaw) return cachedMap;

  cachedRaw = raw;
  cachedMap = null;
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('JOURNAL_TOKENS: malformed JSON — failing closed (all requests 401)');
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('JOURNAL_TOKENS: not an object — failing closed');
    return null;
  }

  const map = new Map<string, TokenEntry>();
  for (const [token, account] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof account !== 'string' || !ACCOUNT_RE.test(account) || token.length < MIN_TOKEN_LENGTH) {
      console.error('JOURNAL_TOKENS: invalid entry — failing closed');
      return null;
    }
    map.set(token, { account, digest: await sha256(token) });
  }
  if (map.size === 0) return null;

  cachedMap = map;
  return map;
}

/** Returns the matched accountId, or null. Never throws on bad input. */
export async function verifyBearer(
  request: Request,
  tokensRaw: string | undefined,
): Promise<string | null> {
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const incoming = authHeader.slice('Bearer '.length);
  if (incoming.length === 0) return null;

  const map = await parseTokenMap(tokensRaw);
  if (map === null) return null;

  const incomingDigest = await sha256(incoming);

  let matched: string | null = null;
  for (const entry of map.values()) {
    // 32-byte vs 32-byte — timingSafeEqual cannot throw here.
    const eq = crypto.subtle.timingSafeEqual(incomingDigest, entry.digest);
    if (eq && matched === null) matched = entry.account;
    // no break — every entry is compared on every request
  }
  return matched;
}
```

- [x] **Step 6: Run tests — expect PASS**

Run: `npm --prefix worker test` — all tokens.spec tests green.

- [x] **Step 7: Wire into `worker/src/index.ts` (absorbs the uncommitted edit)**

Replace the `Env` interface and delete the old `verifyToken` function entirely (including the dead `const tokens = env.JOURNAL_TOKENS;` line from the uncommitted working-tree state):

```ts
import { verifyBearer } from './tokens';

export interface Env {
  JOURNAL: KVNamespace;
  JOURNAL_TOKENS: string;
  ALLOWED_ORIGIN: string;
}
```

In the main `fetch` handler, replace:

```ts
      const authorized = await verifyToken(request, env);
      if (!authorized) {
        return jsonResponse({ error: "Unauthorized" }, 401, allowedOrigin);
      }
```

with:

```ts
      const account = await verifyBearer(request, env.JOURNAL_TOKENS);
      if (account === null) {
        return jsonResponse({ error: "Unauthorized" }, 401, allowedOrigin);
      }
```

(`account` is threaded into handlers in Task A4 — for this commit it may be unused except in the null check; add `void account;` if TS complains, removed next task.)

- [x] **Step 8: Typecheck + test + commit**

Run: `npx --prefix worker tsc --noEmit -p worker/tsconfig.json` (or `cd worker && npx tsc --noEmit`), then `npm --prefix worker test`.

```bash
git add worker/
git commit -m "feat(worker): multi-token auth via JOURNAL_TOKENS map (sha256 + timingSafeEqual, fail closed)"
```

---

### Task A4: Worker — per-account KV prefixes, /health account, 413 limit, format field (TDD)

**Files:**
- Modify: `worker/src/index.ts`
- Create: `worker/src/limits.ts`
- Create: `worker/test/routes.spec.ts`

**Interfaces:**
- Consumes: `verifyBearer` from Task A3.
- Produces (HTTP contract for the client):
  - `GET /health` → `{ ok: true, account: string }`
  - Entry value shape: `{ body: string, updatedAt: string, format?: 'html' }` (format passthrough, optional, only literal `'html'` allowed)
  - `PUT /entries/:date` → 413 `{ error: 'Body too large' }` when `body` exceeds 65536 UTF-8 bytes
  - All KV keys account-prefixed: `a:<account>:entries:<date>`, `a:<account>:index`
- Produces (module): `MAX_BODY_BYTES = 65536`, `utf8ByteLength(s: string): number` in `worker/src/limits.ts`.

- [ ] **Step 1: Write failing route tests**

Create `worker/test/routes.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';

const MARINA = 'Bearer marina-token-aaaaaaaaaaaaaaaaaaaaaaaa';
const TEST = 'Bearer test-token-bb';

async function call(
  path: string,
  init: RequestInit = {},
  auth: string = TEST,
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', auth);
  if (init.body) headers.set('Content-Type', 'application/json');
  const req = new Request(`https://x${path}`, { ...init, headers });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('multi-account routes', () => {
  it('health returns the account of the token', async () => {
    const res = await call('/health', {}, MARINA);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, account: 'marina-actress' });
  });

  it('PUT stores under the account prefix and updates the account index', async () => {
    const put = await call('/entries/2026-08-01', {
      method: 'PUT',
      body: JSON.stringify({ body: 'привет', updatedAt: '2026-08-01T10:00:00.000Z' }),
    });
    expect(put.status).toBe(200);
    const raw = await env.JOURNAL.get('a:test:entries:2026-08-01');
    expect(raw).not.toBeNull();
    expect(await env.JOURNAL.get('entries:2026-08-01')).toBeNull(); // legacy untouched
    const index = JSON.parse((await env.JOURNAL.get('a:test:index')) ?? '[]');
    expect(index).toContain('2026-08-01');
  });

  it('accounts are isolated: marina cannot see test entries', async () => {
    await call('/entries/2026-08-02', {
      method: 'PUT',
      body: JSON.stringify({ body: 'секрет', updatedAt: '2026-08-02T10:00:00.000Z' }),
    });
    const get = await call('/entries/2026-08-02', {}, MARINA);
    expect(get.status).toBe(404);
    const list = await call('/entries', {}, MARINA);
    const data = (await list.json()) as { index: string[] };
    expect(data.index).not.toContain('2026-08-02');
  });

  it('format field round-trips; invalid format is 400', async () => {
    const ok = await call('/entries/2026-08-03', {
      method: 'PUT',
      body: JSON.stringify({ body: '<p>x</p>', updatedAt: '2026-08-03T10:00:00.000Z', format: 'html' }),
    });
    expect(ok.status).toBe(200);
    const got = await call('/entries/2026-08-03');
    expect(((await got.json()) as { format?: string }).format).toBe('html');
    const bad = await call('/entries/2026-08-04', {
      method: 'PUT',
      body: JSON.stringify({ body: 'x', updatedAt: '2026-08-04T10:00:00.000Z', format: 'md' }),
    });
    expect(bad.status).toBe(400);
  });

  it('LWW: older PUT gets 409 with server copy', async () => {
    await call('/entries/2026-08-05', {
      method: 'PUT',
      body: JSON.stringify({ body: 'new', updatedAt: '2026-08-05T12:00:00.000Z' }),
    });
    const stale = await call('/entries/2026-08-05', {
      method: 'PUT',
      body: JSON.stringify({ body: 'old', updatedAt: '2026-08-05T09:00:00.000Z' }),
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { server: { body: string } }).server.body).toBe('new');
  });

  it('413 on body over 65536 UTF-8 bytes (Cyrillic = 2 bytes/char)', async () => {
    const body = 'ы'.repeat(33000); // 66000 bytes > 65536, but only 33000 chars
    const res = await call('/entries/2026-08-06', {
      method: 'PUT',
      body: JSON.stringify({ body, updatedAt: '2026-08-06T10:00:00.000Z' }),
    });
    expect(res.status).toBe(413);
  });

  it('DELETE prunes the account index', async () => {
    await call('/entries/2026-08-07', {
      method: 'PUT',
      body: JSON.stringify({ body: 'x', updatedAt: '2026-08-07T10:00:00.000Z' }),
    });
    const del = await call('/entries/2026-08-07', { method: 'DELETE' });
    expect(del.status).toBe(204);
    const index = JSON.parse((await env.JOURNAL.get('a:test:index')) ?? '[]');
    expect(index).not.toContain('2026-08-07');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`health` lacks `account`, keys unprefixed, no 413/format).

Run: `npm --prefix worker test`

- [ ] **Step 3: Implement**

Create `worker/src/limits.ts`:

```ts
// Keep in sync with src/data/limits.ts (client). Self-imposed product limit;
// KV's own value ceiling is 25 MiB.
export const MAX_BODY_BYTES = 65536;

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}
```

In `worker/src/index.ts`:

1. Extend the value type and add key helpers:

```ts
import { MAX_BODY_BYTES, utf8ByteLength } from './limits';

interface EntryValue {
  body: string;
  updatedAt: string;
  format?: 'html';
}

const entryKey = (account: string, date: string): string => `a:${account}:entries:${date}`;
const indexKey = (account: string): string => `a:${account}:index`;
```

2. Thread `account: string` as the first parameter through `getIndex`, `putIndex`, `getEntry`, `handleHealth`, `handleGetEntries`, `handleGetEntry`, `handlePutEntry`, `handleDeleteEntry`, replacing every literal `"index"` with `indexKey(account)` and every `` `entries:${date}` `` with `entryKey(account, date)`.

3. `handleHealth` becomes:

```ts
async function handleHealth(account: string, allowedOrigin: string): Promise<Response> {
  return jsonResponse({ ok: true, account }, 200, allowedOrigin);
}
```

4. In `handlePutEntry`, after the existing shape validation, add format + size checks:

```ts
  const rec = body as Record<string, unknown>;
  if ('format' in rec && rec['format'] !== 'html') {
    return jsonResponse({ error: "format must be 'html' when present" }, 400, allowedOrigin);
  }
  if (utf8ByteLength((rec['body'] as string)) > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Body too large' }, 413, allowedOrigin);
  }
```

5. In the dispatch section of `fetch`, pass `account` into every handler call.

- [ ] **Step 4: Run — expect PASS**

Run: `npm --prefix worker test` — both spec files green.

- [ ] **Step 5: Typecheck + commit**

```bash
git add worker/
git commit -m "feat(worker): per-account KV prefixes, /health account, 413 byte limit, format passthrough"
```

Do NOT deploy. The worker goes live only via the Task A9 runbook.

---

### Task A5: Migration script

**Files:**
- Create: `worker/scripts/migrate-accounts.mjs`

**Interfaces:**
- Produces a CLI: `node scripts/migrate-accounts.mjs <backup|copy|verify|diff|reverse> [--apply] [--env dev]`
  - `backup` — dump every KV key/value to `~/journal-kv-backups/kv-backup-<ISO date>.json`
  - `copy` — legacy `entries:*` + `index` → `a:marina-actress:*` (report-only without `--apply`; index MERGED, never overwritten)
  - `verify` — independent key set from legacy `index` ∪ paginated `list()`; byte-compare legacy vs copy with retries; asserts counts match
  - `diff` — post-deploy delta: recopy legacy entries newer than their `a:marina-actress` counterpart (report-only without `--apply`); HARD-STOPS if any destination value is newer than its source
  - `reverse` — rollback aid: copy `a:marina-actress:*` entries newer than legacy back into legacy keys (report-only without `--apply`)
- All KV access shells out to `npx wrangler kv key ...` (already authenticated). `--env dev` targets the dev namespace for rehearsal; default is production (`--remote`).

- [ ] **Step 1: Write the script**

Create `worker/scripts/migrate-accounts.mjs`:

```js
#!/usr/bin/env node
/**
 * One-shot account migration: legacy keys -> a:marina-actress:* (copy, never move).
 * Legacy keys are a permanent archive. Every mode is idempotent.
 * Report-only by default; --apply performs writes. --env dev rehearses on the
 * dev namespace (wrangler env dev), otherwise production --remote.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCOUNT = 'marina-actress';
const mode = process.argv[2];
const APPLY = process.argv.includes('--apply');
const DEV = process.argv.includes('--env') && process.argv[process.argv.indexOf('--env') + 1] === 'dev';

const envArgs = DEV ? ['--env', 'dev'] : ['--remote'];

function wrangler(args) {
  return execFileSync('npx', ['wrangler', 'kv', 'key', ...args, '--binding=JOURNAL', ...envArgs], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function listAllKeys() {
  // wrangler paginates internally and returns the full JSON array, but we
  // guard anyway: parse, and if the output ever gains a cursor envelope, fail loudly.
  const out = wrangler(['list']);
  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed)) throw new Error('unexpected list output — update script for pagination');
  return parsed.map((k) => k.name);
}

const getValue = (key) => wrangler(['get', key]);
const putValue = (key, value) => wrangler(['put', key, value]);

function legacyIndex() {
  try { return JSON.parse(getValue('index')); } catch { return []; }
}
function accountIndex() {
  try { return JSON.parse(getValue(`a:${ACCOUNT}:index`)); } catch { return []; }
}
const upd = (raw) => { try { return JSON.parse(raw).updatedAt ?? ''; } catch { return ''; } };

async function retryGet(key, attempts = 4, delayMs = 5000) {
  for (let i = 0; i < attempts; i++) {
    try { return getValue(key); } catch (e) {
      if (i === attempts - 1) throw e;
      console.log(`  retry ${key} in ${delayMs}ms (KV eventual consistency)`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

if (mode === 'backup') {
  const keys = listAllKeys();
  const dump = {};
  for (const k of keys) dump[k] = getValue(k);
  const dir = join(homedir(), 'journal-kv-backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `kv-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`Backed up ${keys.length} keys to ${file}`);
  console.log('>>> Copy this file to a second safe location NOW, before proceeding.');
} else if (mode === 'copy') {
  const idx = legacyIndex();
  const listed = listAllKeys().filter((k) => k.startsWith('entries:')).map((k) => k.slice('entries:'.length));
  const dates = [...new Set([...idx, ...listed])].sort();
  if (idx.length !== listed.length) {
    console.warn(`WARNING: legacy index has ${idx.length} dates, list() found ${listed.length} entry keys — union used (${dates.length}).`);
  }
  console.log(`${APPLY ? 'Copying' : 'Would copy'} ${dates.length} entries -> a:${ACCOUNT}:*`);
  for (const d of dates) {
    const v = getValue(`entries:${d}`);
    if (APPLY) putValue(`a:${ACCOUNT}:entries:${d}`, v);
    console.log(`  ${d}`);
  }
  const merged = [...new Set([...accountIndex(), ...dates])].sort();
  if (APPLY) putValue(`a:${ACCOUNT}:index`, JSON.stringify(merged));
  console.log(`${APPLY ? 'Wrote' : 'Would write'} merged index (${merged.length} dates).`);
} else if (mode === 'verify') {
  const idx = legacyIndex();
  const listed = listAllKeys().filter((k) => k.startsWith('entries:')).map((k) => k.slice('entries:'.length));
  const expected = [...new Set([...idx, ...listed])].sort();
  let ok = 0;
  const bad = [];
  for (const d of expected) {
    const src = getValue(`entries:${d}`);
    const dst = await retryGet(`a:${ACCOUNT}:entries:${d}`);
    if (src === dst) ok++;
    else bad.push(d);
  }
  const dstIdx = accountIndex();
  const idxOk = expected.every((d) => dstIdx.includes(d));
  console.log(`Verified ${ok}/${expected.length} entries byte-identical. Index covers all: ${idxOk}.`);
  if (bad.length || !idxOk) {
    console.error('MISMATCH:', bad);
    process.exit(1);
  }
  console.log(`ASSERT: index(${idx.length}) list(${listed.length}) union(${expected.length}) verified(${ok}) — all consistent.`);
} else if (mode === 'diff' || mode === 'reverse') {
  const fwd = mode === 'diff';
  const idx = legacyIndex();
  const dstIdx = accountIndex();
  const dates = [...new Set([...idx, ...dstIdx])].sort();
  let pending = 0;
  for (const d of dates) {
    let src = null; let dst = null;
    try { src = getValue(fwd ? `entries:${d}` : `a:${ACCOUNT}:entries:${d}`); } catch { /* absent */ }
    try { dst = getValue(fwd ? `a:${ACCOUNT}:entries:${d}` : `entries:${d}`); } catch { /* absent */ }
    if (src === null) continue;
    if (dst !== null && upd(dst) > upd(src)) {
      if (fwd) {
        console.error(`HARD STOP: destination a:${ACCOUNT}:entries:${d} is NEWER than legacy — direction assumption wrong. No writes performed.`);
        process.exit(1);
      }
      continue; // reverse mode: legacy newer -> nothing to do
    }
    if (dst === null || upd(src) > upd(dst)) {
      pending++;
      console.log(`  ${APPLY ? 'copying' : 'would copy'} ${d} (${upd(src)} > ${dst === null ? 'absent' : upd(dst)})`);
      if (APPLY) {
        putValue(fwd ? `a:${ACCOUNT}:entries:${d}` : `entries:${d}`, src);
        if (fwd) {
          const merged = [...new Set([...accountIndex(), d])].sort();
          putValue(`a:${ACCOUNT}:index`, JSON.stringify(merged));
        }
      }
    }
  }
  console.log(`${mode}: ${pending} entries ${APPLY ? 'copied' : 'pending (run with --apply)'}.`);
} else {
  console.log('Usage: node scripts/migrate-accounts.mjs <backup|copy|verify|diff|reverse> [--apply] [--env dev]');
  process.exit(2);
}
```

- [ ] **Step 2: Rehearse on the dev namespace**

Seed dev KV with fake legacy data and run the full cycle:

```bash
cd worker
npx wrangler kv key put index '["2026-08-01","2026-08-02"]' --binding=JOURNAL --env dev
npx wrangler kv key put entries:2026-08-01 '{"body":"тест один","updatedAt":"2026-08-01T10:00:00.000Z"}' --binding=JOURNAL --env dev
npx wrangler kv key put entries:2026-08-02 '{"body":"тест два","updatedAt":"2026-08-02T10:00:00.000Z"}' --binding=JOURNAL --env dev
node scripts/migrate-accounts.mjs backup --env dev
node scripts/migrate-accounts.mjs copy --env dev          # report-only
node scripts/migrate-accounts.mjs copy --env dev --apply
node scripts/migrate-accounts.mjs verify --env dev        # expect 2/2, exit 0
node scripts/migrate-accounts.mjs diff --env dev          # expect 0 pending
```

Expected: verify prints `Verified 2/2` and exits 0.

- [ ] **Step 3: Commit**

```bash
git add worker/scripts/migrate-accounts.mjs
git commit -m "feat(worker): account migration script (backup/copy/verify/diff/reverse, report-only by default)"
```

---

### Task A6: Client — namespace module + shared limits (TDD, sets up root vitest)

**Files:**
- Modify: `package.json` (+ lockfile) — add vitest, jsdom; add `engines`
- Create: `vitest.config.ts`
- Create: `src/data/namespace.ts`, `src/data/namespace.test.ts`
- Create: `src/data/limits.ts`

**Interfaces:**
- Produces: `namespaceFor(token: string): string` — synchronous, 8-hex FNV-1a; `nsKey(ns: string, suffix: string): string` → `journal:<ns>:<suffix>`; `dbNameFor(ns: string): string` → `journal-<ns>`. Also `MAX_BODY_BYTES`, `utf8ByteLength` (client copies, values identical to worker's).
- NOT `crypto.subtle` — must work synchronously and over LAN-IP dev (non-secure context). This hash is a namespace discriminator, not a security boundary (isolation is enforced by the worker).

- [ ] **Step 1: Install test stack + engines**

```bash
npm i -D vitest@^4.1.0 jsdom
```

In root `package.json` add `"test": "vitest run"` to scripts and top-level `"engines": { "node": ">=22" }`.

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Failing test**

Create `src/data/namespace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { namespaceFor, nsKey, dbNameFor } from './namespace';

describe('namespaceFor', () => {
  it('is deterministic and 8 hex chars', () => {
    const a = namespaceFor('some-token-value');
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(namespaceFor('some-token-value')).toBe(a);
  });
  it('distinguishes different tokens', () => {
    expect(namespaceFor('token-a')).not.toBe(namespaceFor('token-b'));
  });
});

describe('key builders', () => {
  it('builds localStorage keys and db name', () => {
    expect(nsKey('deadbeef', 'dirty')).toBe('journal:deadbeef:dirty');
    expect(dbNameFor('deadbeef')).toBe('journal-deadbeef');
  });
});
```

Run: `npm test` — expect FAIL (module missing).

- [ ] **Step 3: Implement `src/data/namespace.ts`**

```ts
/**
 * Local-state namespacing by token.
 *
 * FNV-1a 32-bit, synchronous, dependency-free. Deliberately NOT crypto:
 * this hash only discriminates known tokens on one device (Dexie DB name +
 * localStorage key prefix). The actual isolation boundary is the worker's
 * token map and per-account KV prefixes. crypto.subtle was rejected because
 * it is async and undefined in non-secure contexts (LAN-IP dev server).
 */
export function namespaceFor(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function nsKey(ns: string, suffix: string): string {
  return `journal:${ns}:${suffix}`;
}

export function dbNameFor(ns: string): string {
  return `journal-${ns}`;
}
```

Create `src/data/limits.ts`:

```ts
// Keep in sync with worker/src/limits.ts.
export const MAX_BODY_BYTES = 65536;

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}
```

- [ ] **Step 4: Run — expect PASS**, then `npm run check`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/data/namespace.ts src/data/namespace.test.ts src/data/limits.ts
git commit -m "feat(client): token namespace module (fnv1a) + shared body limits; root vitest"
```

---

### Task A7: Client — lazy per-namespace Dexie + namespaced sync lifecycle

**Files:**
- Modify: `src/data/db.ts`
- Modify: `src/data/sync.ts`
- Modify: `src/data/api.ts`
- Modify: `src/App.svelte`

This is the load-bearing refactor. Sub-goals, all in this task because they change one interlocked lifecycle: (a) db lazy init keyed by namespace; (b) sync state namespaced + reset on namespace change; (c) push abort on logout + 401 retryable; (d) `onEntryUpdated` registry fired from BOTH pull and 409 paths; (e) pull window follows the viewed week.

**Interfaces:**
- Consumes: `namespaceFor/nsKey/dbNameFor` (Task A6).
- Produces:
  - `db.ts`: `initDb(ns: string): void` (closes previous handle if ns changed), `closeDb(): void`; all existing accessors (`getEntry`, `putEntry`, `listEntries`, `deleteEntry`, `dbWriteFromServer`, `dbDeleteFromServer`) become namespace-safe by awaiting an internal ready-latch; `putEntry(date, body, format?: 'html')` gains the format param; `Entry` gains `format?: 'html'`.
  - `sync.ts`: `syncStart(ns: string): void`, `syncStop(): void`, `setViewAnchor(isoMonday: string): void`, `onEntryUpdated(cb: (date: string) => void): () => void`, `initState` — a `writable<'idle'|'initializing'|'ready'|'needs-network'>` store. (`ensureInitialized` internals come in Task A8; this task stubs it as `initState.set('ready')`.)
  - `api.ts`: `health()` returns `{ ok: true; account: string }`; `putEntry(date, body, updatedAt, format?)` sends format.

- [ ] **Step 1: Rewrite `src/data/db.ts`**

```ts
import Dexie, { type Table } from 'dexie';
import { markDirty } from './sync.ts';
import { dbNameFor } from './namespace.ts';

export interface Entry {
  date: string;
  body: string;
  updatedAt: string;
  format?: 'html';
}

class JournalDatabase extends Dexie {
  entries!: Table<Entry, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      entries: 'date, updatedAt',
    });
  }
}

/**
 * Lazy, namespace-keyed singleton. Route components call the accessors from
 * $effects that can run before App.svelte's init effect — Svelte effect
 * ordering is NOT guaranteed — so every accessor awaits a ready-latch that
 * resolves when initDb() is called. initDb is synchronous from the caller's
 * point of view and idempotent per namespace.
 */
let current: { ns: string; db: JournalDatabase } | null = null;
let resolveReady: ((db: JournalDatabase) => void) | null = null;
let ready: Promise<JournalDatabase> = new Promise((res) => {
  resolveReady = res;
});

export function initDb(ns: string): void {
  if (current?.ns === ns) return;
  if (current) {
    // Close the old handle so a late pull/push tail can't write into the
    // previous account's DB (cross-account leak guard).
    current.db.close();
    ready = new Promise((res) => {
      resolveReady = res;
    });
  }
  const db = new JournalDatabase(dbNameFor(ns));
  current = { ns, db };
  resolveReady?.(db);
  resolveReady = null;
}

export function closeDb(): void {
  if (!current) return;
  current.db.close();
  current = null;
  ready = new Promise((res) => {
    resolveReady = res;
  });
}

async function requireDb(): Promise<JournalDatabase> {
  return ready;
}

export async function getEntry(date: string): Promise<Entry | undefined> {
  const db = await requireDb();
  return db.entries.get(date);
}

export async function putEntry(
  date: string,
  body: string,
  format?: 'html',
): Promise<Entry> {
  const db = await requireDb();
  const entry: Entry = {
    date,
    body,
    updatedAt: new Date().toISOString(),
    ...(format ? { format } : {}),
  };
  await db.entries.put(entry);
  markDirty(date, 'put');
  return entry;
}

export async function deleteEntry(date: string): Promise<void> {
  const db = await requireDb();
  await db.entries.delete(date);
  markDirty(date, 'delete');
}

export async function listEntries(from: string, to: string): Promise<Entry[]> {
  const db = await requireDb();
  return db.entries.where('date').between(from, to, true, true).toArray();
}

export async function countEntries(): Promise<number> {
  const db = await requireDb();
  return db.entries.count();
}

/** Server-originated write — NEVER marks dirty. See v1 comment block. */
export async function dbWriteFromServer(
  date: string,
  value: { body: string; updatedAt: string; format?: 'html' },
): Promise<void> {
  const db = await requireDb();
  const entry: Entry = {
    date,
    body: value.body,
    updatedAt: value.updatedAt,
    ...(value.format ? { format: value.format } : {}),
  };
  await db.entries.put(entry);
}

export async function dbDeleteFromServer(date: string): Promise<void> {
  const db = await requireDb();
  await db.entries.delete(date);
}
```

(Preserve the v1 doc comments about the back-door semantics of `dbWriteFromServer` — copy them over.)

- [ ] **Step 2: Rework `src/data/sync.ts` lifecycle**

Changes to make (the file keeps its overall shape; unchanged parts not repeated):

1. Delete the top-level `hydrate();` call and the `LS_KEY_DIRTY`/`LS_KEY_BACKOFF` constants. Add:

```ts
import { writable } from 'svelte/store';
import { nsKey } from './namespace.ts';
import { isApiError } from './api.ts';

let namespace: string | null = null;
let runToken = 0; // bumped by syncStop/namespace change; aborts in-flight pushes

export type InitState = 'idle' | 'initializing' | 'ready' | 'needs-network';
export const initState = writable<InitState>('idle');

const lsDirtyKey = (): string => nsKey(namespace ?? '?', 'dirty');
const lsBackoffKey = (): string => nsKey(namespace ?? '?', 'backoff');
```

2. `persistDirty()` and `hydrate()` become no-ops while `namespace === null` (guard at the top: `if (namespace === null) return;`) and use `lsDirtyKey()`/`lsBackoffKey()`.

3. `syncStart` gains the namespace and the reset-on-change rule:

```ts
export function syncStart(ns: string): void {
  if (pullTimer !== undefined && namespace === ns) return; // already running

  if (namespace !== null && namespace !== ns) {
    // Namespace CHANGE: never let one account's queued edits push into
    // another account. In-memory state is dropped; the old account's dirty
    // set stays persisted under its own namespaced key and will resume when
    // that token is used again.
    dirty.clear();
    backoffMs = BACKOFF_INITIAL_MS;
    runToken++;
  }
  namespace = ns;
  hydrate();

  void ensureInitialized(); // Task A8; stub for now (sets 'ready')

  // ...existing v1 body: initial pull, schedulePush if dirty, timers, listeners
}
```

4. `syncStop()` additionally bumps `runToken++` and resets `pushInFlight = false` (aborting the in-flight loop at its next check). Keep the v1 behavior of preserving the persisted dirty set.

5. In `push()`: capture `const myRun = runToken;` at entry; inside the `for` loop's first line add `if (myRun !== runToken) return;` and repeat the check right after each `await api...` call before mutating `dirty`. In the catch branch, make 401 retryable:

```ts
      } catch (e) {
        if (isNetworkError(e) || (isApiError(e) && e.status === 401)) {
          // 401 during logout/token-swap races must NOT poison-pill the
          // entry (Audit-2 S8) — the write is retried under the right token.
          networkFailures.push(date);
        } else {
          console.warn('[sync] drop put', date, e);
          dirty.delete(date);
        }
      }
```

(Same change in the delete branch.)

6. `onEntryUpdated` registry + server-write wrapper; replace BOTH direct `dbWriteFromServer` call sites (`push()` 409 branch and `pull()`):

```ts
const entryListeners = new Set<(date: string) => void>();

export function onEntryUpdated(cb: (date: string) => void): () => void {
  entryListeners.add(cb);
  return () => entryListeners.delete(cb);
}

async function applyServerEntry(
  date: string,
  value: { body: string; updatedAt: string; format?: 'html' },
): Promise<void> {
  await dbWriteFromServer(date, value);
  for (const cb of entryListeners) cb(date);
}
```

7. View anchor:

```ts
let viewAnchor: string | null = null;

export function setViewAnchor(isoMonday: string): void {
  viewAnchor = isoMonday;
}

function currentPullRange(): { from: string; to: string } {
  const anchorDate = viewAnchor ? parseISO(viewAnchor) : new Date();
  const monday = startOfISOWeek(anchorDate);
  const from = format(addWeeks(monday, -3), 'yyyy-MM-dd');
  const to = format(addWeeks(monday, 4), 'yyyy-MM-dd');
  return { from, to };
}
```

(Add `parseISO` to the date-fns import.)

8. Temporary stub (replaced in Task A8):

```ts
async function ensureInitialized(): Promise<void> {
  initState.set('ready');
}
```

- [ ] **Step 3: `src/data/api.ts` — health account + format passthrough**

```ts
export async function health(tokenOverride?: string): Promise<{ ok: true; account: string }> {
  // body unchanged, only the cast:
  return data as { ok: true; account: string };
}
```

`EntryValue` gains `format?: 'html'`. `putEntry` becomes:

```ts
export async function putEntry(
  date: string,
  body: string,
  updatedAt: string,
  format?: 'html',
): Promise<PutEntryResult> {
  const res = await apiFetch(`/entries/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ body, updatedAt, ...(format ? { format } : {}) }),
  });
  // rest unchanged
```

In `sync.ts` `push()`, the put call becomes `api.putEntry(date, local.body, local.updatedAt, local.format)`.

- [ ] **Step 4: `src/App.svelte` — wire namespace init**

Replace the sync `$effect` with:

```svelte
  import { syncStart, syncStop, initState } from './data/sync.ts';
  import { initDb } from './data/db.ts';
  import { namespaceFor } from './data/namespace.ts';

  $effect(() => {
    if ($token === null) {
      syncStop();
      return;
    }
    const ns = namespaceFor($token);
    initDb(ns);      // synchronous — resolves the db ready-latch BEFORE syncStart
    syncStart(ns);
    return () => syncStop();
  });
```

- [ ] **Step 5: Verify**

Run: `npm run check` — 0 errors. Run `npm test` (namespace tests still green).

Manual dev smoke: `npm run dev` + `npm --prefix worker run dev`; log in with `dev-token-test` from `.dev.vars`; type an entry; reload; entry persists; IndexedDB shows a DB named `journal-<hex>` (browser devtools). Log out, log in with `dev-token-marina`; the test entry must NOT appear; IndexedDB shows a second DB.

- [ ] **Step 6: Commit**

```bash
git add src/ package.json
git commit -m "feat(client): per-namespace dexie + namespaced sync lifecycle, push abort, 401 retryable, onEntryUpdated"
```

---

### Task A8: Client — first-run initialization: chunked full pull, legacy drain, needs-network state

**Files:**
- Modify: `src/data/sync.ts`
- Modify: `src/App.svelte`

**Interfaces:**
- Consumes: `initState` store, `applyServerEntry`, `countEntries` (A7), `api.health/listIndex/listEntries`.
- Produces: real `ensureInitialized()`; localStorage flags `journal:<ns>:initialized` = `'1'`, `journal:<ns>:account` = accountId. App renders a blocking overlay while `initializing`/`needs-network` — copy given below.

- [ ] **Step 1: Implement `ensureInitialized` in `sync.ts`** (replacing the A7 stub)

```ts
import Dexie from 'dexie';
import { countEntries } from './db.ts';

const PULL_CHUNK = 40; // worker does 1 KV subrequest per date; free-plan cap is 50/invocation

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
```

Also: in the `'online'` listener inside `syncStart`, prepend `void ensureInitialized();` so recovery is automatic, and add the same call at the start of the periodic pull tick when `get(initState) !== 'ready'` — simplest: keep a module flag and re-call `ensureInitialized()` from the interval when not ready (it early-returns once the flag is set). Import `get` from `svelte/store` if needed.

- [ ] **Step 2: App overlay**

In `src/App.svelte`, inside the `{:else}` branch (token present), wrap the Router:

```svelte
{#if $token === null}
  <TokenGate />
{:else if $initState === 'initializing' || $initState === 'needs-network'}
  <div class="init-screen">
    <p class="init-title">
      {$initState === 'initializing' ? 'Загрузка данных…' : 'Нужно подключение к интернету'}
    </p>
    <p class="init-hint">
      {$initState === 'initializing'
        ? 'Первый запуск: журнал загружается с сервера.'
        : 'Для первой загрузки журнала подключитесь к сети — записи появятся автоматически.'}
    </p>
  </div>
{:else}
  <Router basepath={base}> ... (unchanged) ... </Router>
{/if}
```

With scoped styles:

```css
.init-screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #fbf6e9;
  color: #2c2412;
  font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
  padding: 24px;
  text-align: center;
}
.init-title { font-size: 17px; font-weight: 700; }
.init-hint { font-size: 14px; color: #5a4a26; max-width: 320px; }
```

- [ ] **Step 3: Verify**

`npm run check` → 0 errors. Dev smoke: clear site data, log in with `dev-token-test` while the dev worker is STOPPED → expect the «Нужно подключение к интернету» screen; start the worker, toggle DevTools offline off / fire `window.dispatchEvent(new Event('online'))` → app proceeds to WeekView.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat(client): first-run init — chunked full pull, legacy dirty drain, needs-network state"
```

---

### Task A9: MIGRATION RUNBOOK (human-in-the-loop — do NOT automate the production steps)

**Files:** none (operational task; check off steps as performed). Prereqs: Tasks A1–A8 merged to `main`, test job green.

- [ ] **Step 1: Rollback rehearsal on dev** — deploy the v2 worker to a TEMPORARY dev-named worker or use `wrangler versions`; verify `wrangler rollback` restores the previous version and that auth works both ways. Minimum: `cd worker && npx wrangler deploy --dry-run` sanity + read `wrangler deployments list` to confirm the current production version id is recorded for rollback.
- [ ] **Step 2: Record current state** — `npx wrangler deployments list` → note the live version id (rollback target). Confirm secret `JOURNAL_TOKEN` still exists (`npx wrangler secret list`) — it must NOT be deleted.
- [ ] **Step 3: Generate tokens** — create the production token map: marina's EXISTING token + a new `crypto.randomUUID()` for `test`. Set it: `npx wrangler secret put JOURNAL_TOKENS` (paste `{"<marina-token>":"marina-actress","<new-uuid>":"test"}`). Setting a secret does NOT deploy new code.
- [ ] **Step 4: Backup** — during the agreed quiet window (~15 min, user confirms marina is not writing): `node scripts/migrate-accounts.mjs backup`. Copy the file from `~/journal-kv-backups/` to a second safe location. Do not proceed until copied.
- [ ] **Step 5: Copy** — `node scripts/migrate-accounts.mjs copy` (review report) then `node scripts/migrate-accounts.mjs copy --apply`.
- [ ] **Step 6: Wait ≥60 s** (KV propagation), then `node scripts/migrate-accounts.mjs verify` — must print all-consistent and exit 0. Any persistent mismatch → STOP, investigate; nothing has been deployed yet.
- [ ] **Step 7: Deploy the worker** — GitHub → Actions → Deploy → Run workflow (the manual `deploy-worker` job). Wait for green.
- [ ] **Step 8: Verify through production** — `curl -s -H "Authorization: Bearer <test-token>" https://journal-calendar.pwacalendar.workers.dev/health` → `{"ok":true,"account":"test"}`; same with marina's token → `marina-actress`; `curl .../entries` with marina's token → index lists her dates; with test token → `{"index":[]}`.
- [ ] **Step 9: Delta** — `node scripts/migrate-accounts.mjs diff` → expect 0 pending (quiet window held). If >0: review report, run with `--apply`.
- [ ] **Step 10: Client smoke** — the frontend (already deployed via Pages on merge) on YOUR phone/browser: log in with the test token → empty journal, write an entry, verify KV key `a:test:entries:<date>` appears and NO legacy key changes. Then confirm with marina (when she next opens the app, online): her journal is intact. Keep the rollback recipe at hand: `npx wrangler rollback` to the version id from Step 2 + `node scripts/migrate-accounts.mjs reverse --apply` if she wrote anything post-cutover.

---

# Phase B — Features (developed against the `test` account)

### Task B1: Editor dependencies + palette + sanitizer (TDD)

**Files:**
- Modify: `package.json` (+ lockfile)
- Create: `src/data/palette.ts`
- Create: `src/data/sanitize.ts`, `src/data/sanitize.test.ts`

**Interfaces:**
- Produces:
  - `PALETTE: readonly { id: string; css: string; label: string }[]` — 6 pens, first is default ink `#2c2412`.
  - `sanitizeHtml(html: string): string` — DOMPurify allowlist + palette validation + double-pass stability; safe for `{@html}` and `setContent`.
  - `plainToHtml(text: string): string` — legacy plain text → `<p>` per line (escaped).
  - `isEmptyHtml(html: string): boolean` — true for `''`, `<p></p>`, whitespace-only docs.
  - `toEditorHtml(entry: { body: string; format?: 'html' } | undefined): string` — dispatch on the format marker (NO prefix sniffing).

- [ ] **Step 1: Install**

```bash
npm i @tiptap/core@3.30.5 @tiptap/pm@3.30.5 @tiptap/extension-document@3.30.5 @tiptap/extension-paragraph@3.30.5 @tiptap/extension-text@3.30.5 @tiptap/extension-text-style@3.30.5 @tiptap/extensions@3.30.5 dompurify
```

EXACT pins for all `@tiptap/*` (no `^`) — verify `package.json` shows bare `"3.30.5"`; edit if npm added carets. If 3.30.5 is no longer the latest, pick ONE current exact version for all seven packages.

- [ ] **Step 2: Palette**

Create `src/data/palette.ts`:

```ts
/** The six "pens". First entry is the default ink (matches v1 text color). */
export const PALETTE = [
  { id: 'ink', css: '#2c2412', label: 'Чернильный' },
  { id: 'red', css: '#c43c3c', label: 'Красный' },
  { id: 'blue', css: '#2e5aac', label: 'Синий' },
  { id: 'green', css: '#3a7d44', label: 'Зелёный' },
  { id: 'purple', css: '#7b4fa6', label: 'Фиолетовый' },
  { id: 'orange', css: '#d07a2e', label: 'Оранжевый' },
] as const;

export type PenId = (typeof PALETTE)[number]['id'];
export const DEFAULT_PEN: PenId = 'ink';
```

- [ ] **Step 3: Failing sanitizer tests**

Create `src/data/sanitize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, plainToHtml, isEmptyHtml, toEditorHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('keeps allowed markup with palette colors', () => {
    const input = '<p>привет <span style="color: #c43c3c">красным</span></p>';
    const out = sanitizeHtml(input);
    expect(out).toContain('привет');
    expect(out).toMatch(/<span style="color: (rgb\(196, 60, 60\)|#c43c3c)/);
  });
  it('strips scripts, handlers and unknown tags but keeps text', () => {
    const out = sanitizeHtml('<p onclick="x()">a<script>bad()</script><img src=x onerror=y>b</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('img');
    expect(out).toContain('a');
    expect(out).toContain('b');
  });
  it('removes colors outside the palette', () => {
    const out = sanitizeHtml('<p><span style="color: #ff0000">x</span></p>');
    expect(out).not.toContain('ff0000');
    expect(out).not.toContain('rgb(255, 0, 0)');
    expect(out).toContain('x');
  });
  it('rebuilds span style from scratch (extra declarations dropped)', () => {
    const out = sanitizeHtml(
      '<p><span style="color: #2e5aac; background-image: url(https://evil/x)">x</span></p>',
    );
    expect(out).not.toContain('background');
    expect(out).not.toContain('url');
  });
  it('drops non-XHTML namespaces / templates / comments', () => {
    const out = sanitizeHtml('<p><math><mglyph></mglyph></math><template>t</template><!-- c -->ok</p>');
    expect(out).not.toContain('math');
    expect(out).not.toContain('template');
    expect(out).toContain('ok');
  });
  it('bounds pathological nesting', () => {
    const deep = '<span>'.repeat(200) + 'x' + '</span>'.repeat(200);
    const out = sanitizeHtml(`<p>${deep}</p>`);
    expect(out).toContain('x');
    expect((out.match(/<span/g) ?? []).length).toBeLessThan(50);
  });
});

describe('plainToHtml / isEmptyHtml / toEditorHtml', () => {
  it('escapes and wraps lines', () => {
    expect(plainToHtml('a<b\nc')).toBe('<p>a&lt;b</p><p>c</p>');
  });
  it('detects empty documents', () => {
    expect(isEmptyHtml('')).toBe(true);
    expect(isEmptyHtml('<p></p>')).toBe(true);
    expect(isEmptyHtml('<p>  </p><p></p>')).toBe(true);
    expect(isEmptyHtml('<p>x</p>')).toBe(false);
  });
  it('dispatches on the explicit format marker only', () => {
    expect(toEditorHtml({ body: '<p>x</p>', format: 'html' })).toContain('<p>x</p>');
    // legacy plain text that LOOKS like html stays text:
    expect(toEditorHtml({ body: '<p>не разметка' })).toContain('&lt;p&gt;не разметка');
    expect(toEditorHtml(undefined)).toBe('');
  });
});
```

Run: `npm test` — expect FAIL (module missing).

- [ ] **Step 4: Implement `src/data/sanitize.ts`**

```ts
/**
 * HTML sanitizer for entry bodies. Security-critical: v2 renders
 * user-authored HTML next to a bearer token in localStorage.
 *
 * Strategy: DOMPurify with a tight allowlist (p, br, span), span attributes
 * rebuilt from scratch, colors validated via CSSOM round-trip against the
 * palette, nesting depth bounded, and a sanitize-twice stability check
 * (mXSS guard for the string→{@html} sink).
 */
import DOMPurify from 'dompurify';
import { PALETTE } from './palette.ts';

const MAX_DEPTH = 20;

let allowedColors: Set<string> | null = null;

function normalizeColor(css: string): string | null {
  const probe = document.createElement('span');
  probe.style.color = '';
  probe.style.color = css;
  return probe.style.color !== '' ? probe.style.color : null;
}

function allowed(): Set<string> {
  if (allowedColors) return allowedColors;
  allowedColors = new Set<string>();
  for (const pen of PALETTE) {
    const n = normalizeColor(pen.css);
    if (n) allowedColors.add(n);
  }
  return allowedColors;
}

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    if (node.tagName !== 'SPAN') {
      node.removeAttribute('style');
      return;
    }
    // Rebuild span attrs from scratch: only a validated color survives.
    const el = node as HTMLElement;
    const candidate = el.style.color; // CSSOM-parsed, ignores junk declarations
    while (el.attributes.length > 0) el.removeAttribute(el.attributes[0]!.name);
    const n = candidate ? normalizeColor(candidate) : null;
    if (n && allowed().has(n)) {
      el.setAttribute('style', `color: ${n}`);
    }
  });

  DOMPurify.addHook('afterSanitizeElements', (node) => {
    if (!(node instanceof Element)) return;
    let depth = 0;
    let p: Node | null = node;
    while (p) {
      depth++;
      p = p.parentNode;
    }
    if (depth > MAX_DEPTH && node.parentNode) {
      // Flatten: replace the element with its children (keeps text).
      while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
      node.parentNode.removeChild(node);
    }
  });
}

function purifyOnce(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'span'],
    ALLOWED_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
  });
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function sanitizeHtml(html: string): string {
  const once = purifyOnce(html);
  const twice = purifyOnce(once);
  if (twice !== once) {
    // Unstable under re-parse → potential mXSS. Degrade to escaped text.
    const div = document.createElement('div');
    div.innerHTML = once;
    return `<p>${escapeHtml(div.textContent ?? '')}</p>`;
  }
  return once;
}

export function plainToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

export function isEmptyHtml(html: string): boolean {
  if (html.trim() === '') return true;
  const div = document.createElement('div');
  div.innerHTML = purifyOnce(html);
  return (div.textContent ?? '').trim() === '';
}

export function toEditorHtml(
  entry: { body: string; format?: 'html' } | undefined,
): string {
  if (!entry || entry.body === '') return '';
  if (entry.format === 'html') return sanitizeHtml(entry.body);
  return plainToHtml(entry.body); // legacy plain text — format marker absent
}
```

- [ ] **Step 5: Run — expect PASS** (`npm test`). Adjust the color-normalization expectation if jsdom normalizes to `rgb()` — the test accepts both.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/data/palette.ts src/data/sanitize.ts src/data/sanitize.test.ts
git commit -m "feat(client): tiptap deps (exact-pinned) + palette + dompurify sanitizer with mXSS guards"
```

---

### Task B2: SPIKE — tiptap#7514 on the target iPhone (decision gate)

**Files:** none committed (throwaway page allowed under scratchpad).

- [ ] **Step 1:** Build a minimal page with a Tiptap 3 editor (the deps from B1) served over HTTPS (deploy to the existing Pages site under a scratch route, or use `npx vite --host` + a tunnel). On the ACTUAL target iPhone (iOS version recorded): select text in the editor → tap a button OUTSIDE the editor bound to `click` → repeat 10×.
- [ ] **Step 2:** Record: does the page stop responding to clicks (tiptap#7514)? Does a `pointerup`-bound button keep working when `click` ones die?
- [ ] **Step 3:** Decision rule (pre-agreed with user): if `pointerup` bindings survive → proceed (all our controls use `pointerup`). If interaction dies entirely → STOP, report to user; fallback is pen-only mode (no selection painting) — user decides.
- [ ] **Step 4:** Write the outcome (device, iOS version, result) into `docs/superpowers/plans/2026-08-27-v2-implementation.md` as a note under this task, commit.

---

### Task B3: RichEditor component + DayView integration

**Files:**
- Create: `src/components/RichEditor.svelte`
- Modify: `src/routes/DayView.svelte`

**Interfaces:**
- Consumes: `sanitizeHtml/toEditorHtml/isEmptyHtml` (B1), `PALETTE` (B1), `putEntry(date, body, 'html')` (A7), `MAX_BODY_BYTES/utf8ByteLength` (A6).
- Produces: `RichEditor.svelte` with props `{ initialHtml: string; onUpdate: (html: string) => void }` and exported methods (via `bind:this`): `setContentSilently(html: string): void`, `applyPen(css: string): void`, `isComposing(): boolean`, `isFocused(): boolean`, `blurEditor(): void`, `onNextCompositionEnd(cb: () => void): void`.
- DayView save contract preserved: 300ms debounce, `pendingSave` flag, flush-on-date-change and on `onDestroy`, save indicator strings unchanged + new oversize error «Слишком длинная запись».

- [ ] **Step 1: Create `src/components/RichEditor.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import Document from '@tiptap/extension-document';
  import Paragraph from '@tiptap/extension-paragraph';
  import Text from '@tiptap/extension-text';
  import { TextStyle, Color } from '@tiptap/extension-text-style';
  import { UndoRedo } from '@tiptap/extensions';
  import { sanitizeHtml } from '../data/sanitize.ts';

  interface Props {
    initialHtml: string;
    onUpdate: (html: string) => void;
  }
  let { initialHtml, onUpdate }: Props = $props();

  let host: HTMLDivElement;
  let editor: Editor | null = null;

  onMount(() => {
    editor = new Editor({
      element: host,
      extensions: [Document, Paragraph, Text, TextStyle, Color, UndoRedo],
      content: initialHtml,
      editorProps: {
        attributes: { class: 'rich-editor-content', lang: 'ru', 'aria-label': 'Запись на день' },
        transformPastedHTML: (html: string) => sanitizeHtml(html),
      },
      onUpdate: ({ editor: e }) => {
        onUpdate(e.getHTML());
      },
    });
    return () => {
      editor?.destroy();
      editor = null;
    };
  });

  export function setContentSilently(html: string): void {
    editor?.commands.setContent(html, { emitUpdate: false });
  }
  export function applyPen(css: string): void {
    // Works for both cases: with a selection → colors it; collapsed caret →
    // sets the stored mark so subsequent typing uses the pen.
    editor?.chain().focus().setColor(css).run();
  }
  export function isComposing(): boolean {
    return editor?.view.composing ?? false;
  }
  export function isFocused(): boolean {
    return editor?.isFocused ?? false;
  }
  export function blurEditor(): void {
    editor?.commands.blur();
  }
  export function onNextCompositionEnd(cb: () => void): void {
    const dom = editor?.view.dom;
    if (!dom) return;
    dom.addEventListener('compositionend', () => cb(), { once: true });
  }
</script>

<div bind:this={host} class="rich-editor-host"></div>

<style>
  .rich-editor-host {
    flex: 1 1 auto;
    width: 100%;
    overflow-y: auto;
  }
  /* ProseMirror content — must keep the 16px iOS zoom floor and sit on the
   * ruled lines (line-height = --paper-line-height, margins zero). */
  .rich-editor-host :global(.rich-editor-content) {
    outline: 0;
    min-height: 100%;
    padding: var(--editor-pad-top, 2px) 18px 24px 18px;
    font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
    font-size: 16px;
    line-height: var(--paper-line-height);
    color: #2c2412;
    caret-color: #2c2412;
  }
  .rich-editor-host :global(.rich-editor-content p) {
    margin: 0;
    line-height: var(--paper-line-height);
    min-height: var(--paper-line-height);
  }
</style>
```

- [ ] **Step 2: Rework `src/routes/DayView.svelte`**

Key changes (the file keeps validation/derivations/header; the textarea block is replaced):

```svelte
  import { getEntry, putEntry, type Entry } from '../data/db.ts';
  import { toEditorHtml, isEmptyHtml } from '../data/sanitize.ts';
  import { PALETTE } from '../data/palette.ts';
  import { MAX_BODY_BYTES, utf8ByteLength } from '../data/limits.ts';
  import type RichEditor from '../components/RichEditor.svelte';

  let bodyHtml = $state('');           // authoritative HTML mirror (survives editor teardown)
  let initialHtml = $state<string | null>(null); // null until the entry loads
  let richEditor = $state<RichEditor | null>(null);
  let activePen = $state<string>(PALETTE[0].css);
  type SaveState = 'saved' | 'saving' | 'error';
  let saveState = $state<SaveState>('saved');
  let saveError = $state('');          // '' or 'Слишком длинная запись'
  let pendingSave = $state(false);

  const save = debounce(() => {
    pendingSave = false;
    saveState = 'saving';
    putEntry(date, bodyHtml, bodyHtml === '' ? undefined : 'html')
      .then(() => { saveState = 'saved'; })
      .catch(() => { saveState = 'error'; });
  }, 300);

  function handleEditorUpdate(html: string): void {
    if (!validInput) return;
    const normalized = isEmptyHtml(html) ? '' : html;
    if (utf8ByteLength(normalized) > MAX_BODY_BYTES) {
      saveState = 'error';
      saveError = 'Слишком длинная запись';
      return; // do not queue — an oversize entry must never enter the dirty set
    }
    saveError = '';
    bodyHtml = normalized;
    pendingSave = true;
    saveState = 'saving';
    save();
  }

  function pickPen(css: string): void {
    activePen = css;
    richEditor?.applyPen(css);
  }
```

Load `$effect` (replaces the v1 body-load effect — same flush-on-cleanup invariant, HTML mirror instead of `body`):

```svelte
  $effect(() => {
    if (!validInput) return;
    const target = date;
    let cancelled = false;
    initialHtml = null;
    void getEntry(target).then((entry: Entry | undefined) => {
      if (cancelled) return;
      const html = toEditorHtml(entry);
      bodyHtml = html;
      initialHtml = html;   // mounts/keys the editor
      saveState = 'saved';
      pendingSave = false;
    });
    return () => {
      cancelled = true;
      if (pendingSave) {
        const prevDate = target;
        const prevHtml = bodyHtml; // mirror still holds the OLD date's html
        save.cancel();
        pendingSave = false;
        void putEntry(prevDate, prevHtml, prevHtml === '' ? undefined : 'html');
      }
    };
  });

  onDestroy(() => {
    if (pendingSave) save.flush();
  });
```

Template — replace the `<textarea>` with palette + lazy editor (keyed so a new date remounts with fresh content):

```svelte
    <div class="palette" role="toolbar" aria-label="Цвет текста">
      {#each PALETTE as pen (pen.id)}
        <button
          type="button"
          class={['pen', activePen === pen.css && 'is-active']}
          style={`--pen: ${pen.css}`}
          aria-label={pen.label}
          onpointerup={() => pickPen(pen.css)}
        ></button>
      {/each}
    </div>

    {#if initialHtml !== null}
      {#key date}
        {#await import('../components/RichEditor.svelte') then mod}
          <mod.default
            bind:this={richEditor}
            initialHtml={initialHtml}
            onUpdate={handleEditorUpdate}
          />
        {/await}
      {/key}
    {/if}
```

The editor pane keeps the `.paper` lined background: wrap in `<div class="paper editor-pane">` with `flex: 1 1 auto; display: flex; overflow: hidden;`. Save indicator shows `saveError !== '' ? saveError : SAVE_LABEL[saveState]`.

Palette styles:

```css
  .palette {
    display: flex;
    gap: 10px;
    padding: 6px 14px;
    background: rgba(251, 246, 233, 0.92);
    border-bottom: 1px solid rgba(70, 60, 35, 0.12);
  }
  .pen {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid rgba(70, 60, 35, 0.18);
    background: var(--pen);
    cursor: pointer;
    padding: 0;
  }
  .pen.is-active {
    border-color: #2c2412;
    box-shadow: 0 0 0 2px rgba(44, 36, 18, 0.25);
  }
```

IMPORTANT details to preserve: `.editor-pane` computed font-size stays 16px (zoom floor); the `--editor-pad-top` custom property is calibrated in Task B7 for the system font (start with `2px`); `onpointerup` everywhere, no `onclick`, per tiptap#7514.

- [ ] **Step 3: Verify**

`npm run check` → 0. Dev smoke (test account): open a day → type multi-line Russian → indicator cycles «Сохраняется… → Сохранено»; pick red pen → type → red text; select a word → tap blue → word turns blue; reload → colors persist; open a LEGACY plain-text entry (seed one via curl without format) → renders as text, escaped, and does NOT get re-saved just by opening (check: no PUT fires in the network tab until you type).

- [ ] **Step 4: Commit**

```bash
git add src/components/RichEditor.svelte src/routes/DayView.svelte
git commit -m "feat(editor): tiptap color editor in DayView — palette, byte limit, legacy display-only, flush invariants"
```

---

### Task B4: B1 fix — live refresh of the open DayView on server updates

**Files:**
- Modify: `src/routes/DayView.svelte`

**Interfaces:**
- Consumes: `onEntryUpdated` (A7 — fires from BOTH `pull()` and the 409 push path via `applyServerEntry`), `RichEditor.isComposing/isFocused/setContentSilently/onNextCompositionEnd` (B3).

- [ ] **Step 1: Add the subscription effect to DayView**

```svelte
  import { onEntryUpdated } from '../data/sync.ts';

  async function refreshFromServerCopy(): Promise<void> {
    const ed = richEditor;
    if (!ed) return;
    if (ed.isComposing()) {
      // Never touch the DOM mid-composition (iOS Russian predictive input).
      ed.onNextCompositionEnd(() => void refreshFromServerCopy());
      return;
    }
    if (ed.isFocused()) return; // user is typing — their copy wins; next push resolves via LWW
    const entry = await getEntry(date);
    const html = toEditorHtml(entry);
    // Clear any queued save of the now-stale mirror BEFORE swapping, so a
    // navigation right after this can't resurrect the old value with a new
    // updatedAt.
    save.cancel();
    pendingSave = false;
    bodyHtml = html;
    ed.setContentSilently(html);
    saveState = 'saved';
  }

  $effect(() => {
    if (!validInput) return;
    const target = date;
    const off = onEntryUpdated((d) => {
      if (d === target) void refreshFromServerCopy();
    });
    return off;
  });
```

- [ ] **Step 2: Verify**

Dev smoke (two clients on the test account — browser + curl): open day X in the app, leave editor UNfocused; `curl -X PUT .../entries/<X>` with a newer `updatedAt` and different body via the dev worker; wait for the next pull (or fire `window.dispatchEvent(new Event('online'))`) → editor content swaps, no PUT echo in the network tab (setContent is silent). Then repeat with the editor focused → content does NOT swap.

- [ ] **Step 3: Commit**

```bash
git add src/routes/DayView.svelte
git commit -m "fix(sync): refresh open DayView on remote update (composition-safe, no echo) — closes v1 backlog B1"
```

---

### Task B5: WeekView — WeekSpread extraction, HTML previews, clamp/scrollbar CSS, editor prefetch

**Files:**
- Create: `src/components/WeekSpread.svelte`
- Modify: `src/routes/WeekView.svelte`

**Interfaces:**
- Produces: `WeekSpread.svelte` props `{ monday: Date; previews: Record<string, string>; onOpenDay: (date: string) => void; today: Date }` — renders the two-page spread (markup moved verbatim from v1 WeekView, including SpiralBinding and DayTab slots) with `{@html previews[key]}` in the `.preview` divs. `previews` values are ALREADY-SANITIZED HTML strings (WeekView sanitizes; WeekSpread trusts its prop).
- WeekView produces `previewHtmlFor(entry: Entry): string` and passes `setViewAnchor` (A7).

- [ ] **Step 1: Extract `WeekSpread.svelte`**

Move the `.spread` section (both `page` sections + `<SpiralBinding/>` + all day-row buttons) and its styles from `WeekView.svelte` into the new component. Replace `{bodies[key] ?? ''}` text interpolation with:

```svelte
<div class="preview" lang="ru">
  <div class="paper">{@html previews[key] ?? ''}</div>
</div>
```

CSS changes inside WeekSpread (replacing v1 `.preview` rules — B7 + block-children clamp):

```css
  .preview {
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    width: 100%;
  }
  .preview::-webkit-scrollbar { display: none; }

  .preview .paper {
    min-height: 100%;
    width: 100%;
    padding-left: 6px;
    line-height: var(--paper-line-height);
    font-size: 12px;
    color: #2c2412;
    font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
  }
  /* Injected sanitized <p> children must sit on the ruled lines. */
  .preview .paper :global(p) {
    margin: 0;
    line-height: var(--paper-line-height);
    min-height: var(--paper-line-height);
  }
  /* -webkit-line-clamp does not clamp block children — the Sat/Sun halves
   * clamp by height instead. */
  .preview-half {
    max-height: calc(var(--paper-line-height) * 2);
    overflow: hidden;
  }
```

(Delete the v1 `white-space: pre-line`, `display: -webkit-box`, and `-webkit-line-clamp` rules.)

`today` comes in as a prop (prep for B8's shared store; for now WeekView passes its existing `today`).

- [ ] **Step 2: WeekView — previews + anchor + prefetch**

In `WeekView.svelte`:

```ts
  import WeekSpread from '../components/WeekSpread.svelte';
  import { setViewAnchor } from '../data/sync.ts';
  import { sanitizeHtml, plainToHtml } from '../data/sanitize.ts';
  import type { Entry } from '../data/db.ts';

  function previewHtmlFor(entry: Entry): string {
    if (entry.format === 'html') return sanitizeHtml(entry.body);
    // legacy plain text: escape + preserve line breaks
    return plainToHtml(entry.body);
  }

  let previews = $state<Record<string, string>>({});

  $effect(() => {
    const from = mondayStr;
    const to = sundayStr;
    let cancelled = false;
    void listEntries(from, to).then((entries: Entry[]) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const e of entries) next[e.date] = previewHtmlFor(e);
      previews = next;
    });
    return () => { cancelled = true; };
  });

  // Pull window follows the viewed week (audit E3 — neighbours must fill).
  $effect(() => {
    setViewAnchor(mondayStr);
  });

  // Prefetch the editor chunk during idle so opening a day is instant.
  let prefetched = false;
  $effect(() => {
    if (prefetched) return;
    prefetched = true;
    const idle: (cb: () => void) => unknown =
      'requestIdleCallback' in window
        ? (cb) => (window as Window & { requestIdleCallback: (c: () => void) => number }).requestIdleCallback(cb)
        : (cb) => setTimeout(cb, 1500);
    idle(() => { void import('../components/RichEditor.svelte'); });
  });
```

Template: replace the whole `.spread` block with:

```svelte
    <WeekSpread monday={monday} {previews} onOpenDay={openDay} {today} />
```

- [ ] **Step 3: Verify**

`npm run check`; `npm test` (sanitize suite still green). Dev smoke: colored entry from B3 shows colored in the week preview; a legacy plain entry shows with line breaks; Sat/Sun cards clamp at 2 lines; no visible scrollbar gutter. Network tab: `RichEditor` chunk loads a moment after WeekView renders; opening a day does not re-download it.

- [ ] **Step 4: Commit**

```bash
git add src/components/WeekSpread.svelte src/routes/WeekView.svelte
git commit -m "feat(week): WeekSpread extraction, sanitized HTML previews, height clamp, hidden scrollbars, editor prefetch"
```

---

### Task B6: base module + SwipePager component

**Files:**
- Create: `src/lib/base.ts`
- Create: `src/components/SwipePager.svelte`
- Modify: `src/App.svelte`, `src/routes/WeekView.svelte`, `src/routes/DayView.svelte` (import `base` from the module — remove the three duplicated `import.meta.env.BASE_URL` lines)

**Interfaces:**
- Produces: `base: string` (`''` in dev, `'/pwa-calendar'` in prod) from `src/lib/base.ts`.
- Produces `SwipePager.svelte`:
  - Props: `{ prev?: Snippet; current: Snippet; next?: Snippet; onNavigate: (dir: -1 | 1) => void; onBeforeSettle?: () => Promise<void> }`
  - Behavior: 3-panel track; follows the finger; on release navigates when |dx| > 35% width OR velocity > 0.5 px/ms; `onNavigate` fires AFTER the slide-out animation completes; `onBeforeSettle` (if provided) is awaited at gesture START (used by DayView to blur + let the viewport settle). Panels without a `prev`/`next` snippet rubber-band (no navigation in that direction).
  - Gesture rules: `touchstart` registered `{ passive: false }`; `preventDefault()` on touchstart only when the touch begins within 28px of either screen edge (suppresses the system back/forward gesture); horizontal lock when `|dx| > 8 && |dx| > 1.7 * |dy|`, after which `touchmove` calls `preventDefault()`; before the lock, vertical scrolling proceeds untouched.

- [ ] **Step 1: `src/lib/base.ts`**

```ts
/**
 * Single source of the GitHub Pages base prefix for navigate() calls.
 * Commit 0a3dc1c exists because an unprefixed navigate() broke subpath
 * routing — never call navigate() with a path that doesn't start with this.
 */
export const base = import.meta.env.BASE_URL.replace(/\/$/, '');
```

Update `App.svelte`, `WeekView.svelte`, `DayView.svelte` to `import { base } from '../lib/base.ts';` (path adjusted per file) and delete their local `const base = ...` lines.

- [ ] **Step 2: `src/components/SwipePager.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    prev?: Snippet;
    current: Snippet;
    next?: Snippet;
    onNavigate: (dir: -1 | 1) => void;
    onBeforeSettle?: () => Promise<void>;
  }
  let { prev, current, next, onNavigate, onBeforeSettle }: Props = $props();

  const EDGE_GUARD_PX = 28;
  const LOCK_DX = 8;
  const LOCK_RATIO = 1.7;
  const NAV_FRACTION = 0.35;
  const NAV_VELOCITY = 0.5; // px/ms

  let viewport: HTMLDivElement;
  let offset = $state(0);        // px, finger-follow
  let animating = $state(false); // CSS transition on when true

  let tracking = false;
  let locked: 'h' | 'v' | null = null;
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let settled = true;

  function width(): number {
    return viewport?.clientWidth ?? window.innerWidth;
  }

  async function onTouchStart(e: TouchEvent): Promise<void> {
    if (animating || e.touches.length !== 1) return;
    const t = e.touches[0]!;
    // Suppress the OS edge-swipe (back/forward) for touches starting at the
    // screen edges. Requires {passive:false} — Safari defaults touchstart to
    // passive and silently ignores preventDefault otherwise.
    if (t.clientX < EDGE_GUARD_PX || t.clientX > window.innerWidth - EDGE_GUARD_PX) {
      e.preventDefault();
    }
    tracking = true;
    locked = null;
    startX = t.clientX;
    startY = t.clientY;
    startT = e.timeStamp;
    settled = onBeforeSettle === undefined;
  }

  function onTouchMove(e: TouchEvent): void {
    if (!tracking) return;
    const t = e.touches[0]!;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (locked === null) {
      if (Math.abs(dx) > LOCK_DX && Math.abs(dx) > LOCK_RATIO * Math.abs(dy)) {
        locked = 'h';
        if (!settled && onBeforeSettle) {
          // Blur/keyboard settle runs once per gesture; finger keeps tracking.
          settled = true;
          void onBeforeSettle();
        }
      } else if (Math.abs(dy) > LOCK_DX) {
        locked = 'v';
      }
    }
    if (locked !== 'h') return;
    e.preventDefault();
    // Rubber-band when there's no panel in that direction.
    const hasTarget = dx > 0 ? prev !== undefined : next !== undefined;
    offset = hasTarget ? dx : dx * 0.25;
  }

  function onTouchEnd(e: TouchEvent): void {
    if (!tracking) return;
    tracking = false;
    if (locked !== 'h') {
      offset = 0;
      return;
    }
    const dx = offset;
    const dt = Math.max(1, e.timeStamp - startT);
    const velocity = Math.abs(dx) / dt;
    const dir: -1 | 1 = dx > 0 ? -1 : 1; // drag right → previous
    const hasTarget = dx > 0 ? prev !== undefined : next !== undefined;
    const commit =
      hasTarget && (Math.abs(dx) > width() * NAV_FRACTION || velocity > NAV_VELOCITY);

    animating = true;
    if (commit) {
      offset = dx > 0 ? width() : -width();
      const done = (): void => {
        animating = false;
        offset = 0;
        onNavigate(dir);
      };
      setTimeout(done, 220); // matches the CSS transition duration
    } else {
      offset = 0;
      setTimeout(() => { animating = false; }, 220);
    }
  }
</script>

<div
  bind:this={viewport}
  class="pager"
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
  ontouchcancel={onTouchEnd}
>
  <div
    class={['track', animating && 'is-animating']}
    style={`transform: translateX(calc(-100% + ${offset}px))`}
  >
    <div class="panel">{#if prev}{@render prev()}{/if}</div>
    <div class="panel">{@render current()}</div>
    <div class="panel">{#if next}{@render next()}{/if}</div>
  </div>
</div>

<style>
  .pager {
    overflow: hidden;
    width: 100%;
    height: 100%;
    touch-action: pan-y; /* we handle horizontal; vertical stays native */
  }
  .track {
    display: flex;
    width: 300%;
    height: 100%;
  }
  .track.is-animating {
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .panel {
    width: calc(100% / 3);
    flex: 0 0 calc(100% / 3);
    height: 100%;
    overflow: hidden;
  }
</style>
```

Svelte NOTE: `ontouchstart`/`ontouchmove` attributes in Svelte 5 are passive by spec for some events; the `{passive:false}` requirement means the implementer MUST attach these via an action or `addEventListener` in `$effect` if `e.preventDefault()` warns at runtime:

```ts
  $effect(() => {
    const el = viewport;
    const ts = (e: TouchEvent) => void onTouchStart(e);
    const tm = (e: TouchEvent) => onTouchMove(e);
    const te = (e: TouchEvent) => onTouchEnd(e);
    el.addEventListener('touchstart', ts, { passive: false });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
    };
  });
```

Use the `$effect` form and DELETE the inline `ontouch*` attributes — this is the required implementation, the inline form above is illustrative only.

- [ ] **Step 3: Verify** — `npm run check`; commit.

```bash
git add src/lib/base.ts src/components/SwipePager.svelte src/App.svelte src/routes/WeekView.svelte src/routes/DayView.svelte
git commit -m "feat(nav): shared base module + SwipePager (finger-follow, edge-guard, passive:false)"
```

---

### Task B7: Wire SwipePager into WeekView and DayView (+ DayView layout un-fix)

**Files:**
- Modify: `src/routes/WeekView.svelte`
- Modify: `src/routes/DayView.svelte`

**Interfaces:**
- Consumes: `SwipePager` (B6), `WeekSpread` (B5), `setViewAnchor` (A7).
- WeekView: three WeekSpread panels (monday −7 / monday / monday +7); entry load widened to `[monday−7, sunday+7]`; previews map covers all three weeks; navigation = `navigate(`${base}/week/<newMonday>`)` (history PUSH — default `navigate` behavior).
- DayView: pager with static paper previews for date±1; `onBeforeSettle` blurs the editor and waits for the visual viewport to settle; DayView drops `position: fixed` (audit E1) and the v1 `transition:fly` (audit E2).

- [ ] **Step 1: WeekView panels**

```svelte
  const prevMondayStr = $derived(format(addDays(monday, -7), 'yyyy-MM-dd'));
  const nextMondayStr = $derived(format(addDays(monday, 7), 'yyyy-MM-dd'));
  const prevMonday = $derived(addDays(monday, -7));
  const nextMonday = $derived(addDays(monday, 7));
```

Widen the load effect range: `listEntries(prevMondayStr, format(addDays(monday, 13), 'yyyy-MM-dd'))` — one query, previews map then covers all three weeks.

Template:

```svelte
    <SwipePager onNavigate={(dir) => handleMonthChange(dir === -1 ? prevMondayStr : nextMondayStr)}>
      {#snippet prev()}
        <WeekSpread monday={prevMonday} {previews} onOpenDay={openDay} {today} />
      {/snippet}
      {#snippet current()}
        <WeekSpread monday={monday} {previews} onOpenDay={openDay} {today} />
      {/snippet}
      {#snippet next()}
        <WeekSpread monday={nextMonday} {previews} onOpenDay={openDay} {today} />
      {/snippet}
    </SwipePager>
```

The pager needs a height: wrap in a container with `min-height: calc(100vh - 90px)` (the v1 `.spread` min-height moves here).

- [ ] **Step 2: DayView layout restructure**

CSS: `.day-view` changes from `position: fixed; inset: 0;` to:

```css
  .day-view {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--paper-fill, #fbf6e9);
    font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
    color: #2c2412;
  }
```

Remove `transition:fly` (and its imports) from the root element — the pager animates navigation now. The header keeps its grid layout but is now a normal flow child (audit MUST 26: no fixed/100vh reliance for the header — `100dvh` on the column + flow header satisfies this).

Neighbor day panels — static previews, NOT editors:

```svelte
  const prevDateStr = $derived(format(addDays(parsed, -1), 'yyyy-MM-dd'));
  const nextDateStr = $derived(format(addDays(parsed, 1), 'yyyy-MM-dd'));
  let neighborHtml = $state<Record<string, string>>({});

  $effect(() => {
    if (!validInput) return;
    let cancelled = false;
    void Promise.all([getEntry(prevDateStr), getEntry(nextDateStr)]).then(([p, n]) => {
      if (cancelled) return;
      neighborHtml = {
        [prevDateStr]: toEditorHtml(p),
        [nextDateStr]: toEditorHtml(n),
      };
    });
    return () => { cancelled = true; };
  });

  async function settleKeyboard(): Promise<void> {
    if (!richEditor?.isFocused()) return;
    richEditor.blurEditor();
    // Wait for the visual viewport to settle after keyboard dismissal —
    // animating concurrently triggers the iOS standalone offsetTop bug.
    await new Promise<void>((resolve) => {
      const vv = window.visualViewport;
      if (!vv) { setTimeout(resolve, 120); return; }
      let timer = setTimeout(finish, 400); // hard cap
      function finish(): void { vv?.removeEventListener('resize', onResize); resolve(); }
      function onResize(): void { clearTimeout(timer); timer = setTimeout(finish, 120); }
      vv.addEventListener('resize', onResize);
    });
  }

  function swipeDay(dir: -1 | 1): void {
    navigate(`${base}/day/${dir === -1 ? prevDateStr : nextDateStr}`);
  }
```

Template — wrap the day content:

```svelte
<SwipePager onNavigate={swipeDay} onBeforeSettle={settleKeyboard}>
  {#snippet prev()}
    <div class="day-view day-static">
      <div class="paper static-paper">{@html neighborHtml[prevDateStr] ?? ''}</div>
    </div>
  {/snippet}
  {#snippet current()}
    <div class="day-view"> ... existing header + palette + editor ... </div>
  {/snippet}
  {#snippet next()}
    <div class="day-view day-static">
      <div class="paper static-paper">{@html neighborHtml[nextDateStr] ?? ''}</div>
    </div>
  {/snippet}
</SwipePager>
```

```css
  .static-paper {
    flex: 1 1 auto;
    padding: 48px 18px 0;
    font-size: 16px;
    line-height: var(--paper-line-height);
    overflow: hidden;
  }
  .static-paper :global(p) { margin: 0; line-height: var(--paper-line-height); }
```

(`neighborHtml` values are produced by `toEditorHtml`, which sanitizes — safe for `{@html}`.)

- [ ] **Step 3: Verify**

`npm run check`. Dev smoke (desktop devtools touch emulation + phone if reachable): drag WeekView left/right — page follows finger, releases snap; day previews still scroll vertically; swipe in DayView moves between days; typed text flushes before the switch (check Dexie); with keyboard open, swiping blurs first, then animates.

- [ ] **Step 4: Commit**

```bash
git add src/routes/
git commit -m "feat(nav): swipe weeks and days — finger-follow pager wired into both views"
```

---

### Task B8: Visual polish — spiral line, fonts + calibration, midnight today store, scaffold cleanup

**Files:**
- Modify: `src/components/SpiralBinding.svelte`, `src/routes/WeekView.svelte` (prop), `src/components/MonthPicker.svelte`, `src/components/WeekSpread.svelte`, `src/routes/DayView.svelte` (font calibration)
- Create: `src/state/today.ts`
- Delete: `src/lib/Counter.svelte`, `src/assets/hero.png`, `src/assets/svelte.svg`, `src/assets/vite.svg`

- [ ] **Step 1: SpiralBinding — rings out, line stays**

Replace the component body/styles:

```svelte
<script lang="ts">
  /** SpiralBinding v2 — the rings are gone; only the spine line remains. */
</script>

<div class="spiral" aria-hidden="true">
  <div class="rod"></div>
</div>

<style>
  .spiral {
    position: relative;
    width: 36px; /* keeps the two-page gutter geometry unchanged */
  }
  .rod {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    transform: translateX(-50%);
    background: linear-gradient(
      to right,
      rgba(70, 70, 60, 0) 0%,
      rgba(70, 70, 60, 0.5) 50%,
      rgba(70, 70, 60, 0) 100%
    );
    pointer-events: none;
  }
</style>
```

In `WeekSpread.svelte` change `<SpiralBinding count={26} />` to `<SpiralBinding />`.

- [ ] **Step 2: Shared midnight-aware `today` store (B2)**

Create `src/state/today.ts`:

```ts
import { readable } from 'svelte/store';

/**
 * "Today" that stays correct across midnight and backgrounding.
 * One clock for the whole app — WeekView/WeekSpread and MonthPicker must
 * not compute their own `new Date()` at mount time (v1 bug: stale highlight).
 */
export const today = readable(new Date(), (set) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    const now = new Date();
    set(now);
    const next = new Date(now);
    next.setHours(24, 0, 5, 0); // 5s past local midnight
    timer = setTimeout(arm, next.getTime() - now.getTime());
  };
  arm();

  const onVis = (): void => {
    if (document.visibilityState === 'visible') arm();
  };
  document.addEventListener('visibilitychange', onVis);

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
  };
});
```

WeekView: delete `const today = new Date();`, add `import { today } from '../state/today.ts';`, pass `today={$today}` to the three WeekSpread panels. MonthPicker: replace `const todayIsoMonday = $derived(format(startOfISOWeek(new Date()), 'yyyy-MM-dd'));` with:

```ts
  import { today } from '../state/today.ts';
  const todayIsoMonday = $derived(format(startOfISOWeek($today), 'yyyy-MM-dd'));
```

- [ ] **Step 3: Font calibration**

The system-font swap already happened in B3 (editor) and B5 (preview). Calibrate the baseline now: in `RichEditor.svelte`, the paper rule sits at y = 17px of each 18px tile (`--paper-line-height: 18px`). For `-apple-system` 16px in an 18px line box, start from `--editor-pad-top: 2px` and verify visually in the browser: type 6 lines of Russian; each line's baseline must sit ON a rule. Adjust `--editor-pad-top` (defined on `.day-view` or `.editor-pane`) by ±1px until it does, on BOTH desktop Safari/Chrome and (in Phase C) the actual iPhone. Record the final value in a comment mirroring v1's calculation comment (and note v1's comment claimed 20px line-height while paper.css says 18px — fix the stale number in the new comment).

- [ ] **Step 4: Scaffold cleanup (B10)**

```bash
git rm src/lib/Counter.svelte src/assets/hero.png src/assets/svelte.svg src/assets/vite.svg
```

(References verified absent by the pre-flight audit.)

- [ ] **Step 5: Verify + commit**

`npm run check`; `npm run build` succeeds; dev smoke: spiral shows a clean line, no rings; «Сегодня» tab highlight correct.

```bash
git add -A src/
git commit -m "feat(ui): spiral line without rings, system font calibration, shared midnight today store, scaffold cleanup"
```

---

### Task B9: Splash screens + index.html absolute hrefs + CSP

**Files:**
- Modify: `index.html`, `vite.config.ts`
- Create: `public/apple-splash-*.png` (generated)

- [ ] **Step 1: Absolute hrefs first (fixes the existing 404.html icon bug)**

In `index.html`, change:

```html
    <link rel="apple-touch-icon" sizes="192x192" href="/pwa-calendar/icon-192.png" />
    <link rel="icon" type="image/svg+xml" href="/pwa-calendar/favicon.svg" />
```

(Root-relative WITH the Pages base. Rationale: `dist/404.html` is served for deep routes like `/pwa-calendar/week/…`, where relative hrefs resolve wrongly. Dev note: with Vite `base: '/pwa-calendar/'` the dev server also serves under that prefix, so these work in dev too.)

- [ ] **Step 2: Generate splash screens (requires local Chrome)**

```bash
npx pwa-asset-generator public/icon-512.png ./public \
  --splash-only --background "#fbf6e9" \
  --index ./index.html --path "/pwa-calendar"
```

Verify the tool inserted `<link rel="apple-touch-startup-image" media="..." href="/pwa-calendar/apple-splash-....png">` tags into `index.html` and PNGs into `public/`.

- [ ] **Step 3: Dark-scheme variants (same light image — a dark-mode device must match SOMETHING or it gets a white splash)**

Run this once to duplicate each splash link with a dark media query pointing at the same file:

```bash
node -e "
const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(/<link rel=\"apple-touch-startup-image\" media=\"([^\"]*)\" href=\"([^\"]*)\">/g,
  (m, media, href) => media.includes('prefers-color-scheme') ? m :
    m + '\n    ' + m.replace(media, '(prefers-color-scheme: dark) and ' + media));
fs.writeFileSync('index.html', html);
"
```

- [ ] **Step 4: Exclude splash images from the SW precache**

Splash images are fetched by the OS at install/launch, never through the service worker — precaching ~15 PNGs would bloat every client. In `vite.config.ts` workbox config add:

```ts
          globIgnores: ['**/apple-splash*'],
```

- [ ] **Step 5: CSP meta (defence in depth for the new HTML sink)**

Add to `index.html` `<head>` (before the icon links):

```html
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://journal-calendar.pwacalendar.workers.dev http://localhost:8787; object-src 'none'; base-uri 'none'"
    />
```

(`style-src 'unsafe-inline'` is required by Svelte transitions and the sanitized `style="color: …"` spans; the CSP's job here is blocking script execution and exfiltration origins.)

- [ ] **Step 6: Verify**

`npm run build` — succeeds; `dist/` contains splash PNGs; `dist/sw.js` precache manifest does NOT list `apple-splash*`; app runs in dev with no CSP violations in the console (check for blocked requests — if the dev worker origin differs, add it to connect-src).

- [ ] **Step 7: Commit**

```bash
git add index.html vite.config.ts public/
git commit -m "feat(pwa): apple splash screens (light+dark), absolute asset hrefs, CSP, precache excludes"
```

---

### Task B10: InstallHint — install-before-token onboarding

**Files:**
- Create: `src/components/InstallHint.svelte`
- Modify: `src/App.svelte`

**Interfaces:**
- Produces: `InstallHint.svelte`, props `{ onContinue: () => void }` — fires when the user taps «Продолжить в браузере».
- App gating (order matters — Safari and standalone storage are SEPARATE, so the token must be entered in the installed app): `if (isIOSSafariNotInstalled && !dismissed) → InstallHint`, else the v1 flow.

- [ ] **Step 1: Component**

```svelte
<script lang="ts">
  interface Props {
    onContinue: () => void;
  }
  let { onContinue }: Props = $props();
</script>

<div class="install-hint">
  <h1>Установите приложение</h1>
  <ol>
    <li><span class="num">1</span> Нажмите <strong>Поделиться</strong> <span class="share-icon" aria-hidden="true">&#x2BAD;</span> внизу экрана</li>
    <li><span class="num">2</span> Выберите <strong>«На экран „Домой“»</strong></li>
    <li><span class="num">3</span> Нажмите <strong>«Добавить»</strong> и откройте приложение с домашнего экрана</li>
  </ol>
  <p class="note">Код доступа нужно будет ввести уже внутри установленного приложения.</p>
  <button type="button" class="continue" onpointerup={onContinue}>Продолжить в браузере</button>
</div>

<style>
  .install-hint {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 18px;
    padding: 32px 24px;
    background: #fbf6e9;
    color: #2c2412;
    font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
  }
  h1 { font-size: 22px; font-weight: 700; margin: 0; }
  ol { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none; font-size: 16px; }
  .num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; margin-right: 8px;
    border-radius: 50%; background: #2c2412; color: #fbf6e9;
    font-size: 13px; font-weight: 700;
  }
  .note { font-size: 14px; color: #5a4a26; margin: 0; }
  .continue {
    align-self: flex-start;
    padding: 10px 16px;
    border: 1px solid rgba(70, 60, 35, 0.25);
    border-radius: 10px;
    background: transparent;
    color: #2c2412;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
```

- [ ] **Step 2: App gating**

In `App.svelte`:

```ts
  import InstallHint from './components/InstallHint.svelte';

  const HINT_LS = 'journal:install-hint-dismissed'; // device property — deliberately NOT namespaced

  function isStandalone(): boolean {
    return (
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    );
  }
  function isIOS(): boolean {
    return (
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS reports as macOS
    );
  }

  let hintDismissed = $state(false);
  try {
    hintDismissed = localStorage.getItem(HINT_LS) === '1';
  } catch { hintDismissed = true; }
  const showInstallHint = $derived(isIOS() && !isStandalone() && !hintDismissed && $token === null);

  function dismissHint(): void {
    try { localStorage.setItem(HINT_LS, '1'); } catch { /* ignore */ }
    hintDismissed = true;
  }
```

Template — the hint takes precedence over TokenGate:

```svelte
{#if showInstallHint}
  <InstallHint onContinue={dismissHint} />
{:else if $token === null}
  <TokenGate />
{:else if ...}
```

- [ ] **Step 3: Verify** — `npm run check`; dev smoke with devtools iPhone UA emulation: hint shows before the token form; «Продолжить в браузере» reveals TokenGate; reload keeps it dismissed.

- [ ] **Step 4: Commit**

```bash
git add src/components/InstallHint.svelte src/App.svelte
git commit -m "feat(pwa): install-before-token onboarding hint for iOS Safari"
```

---

# Phase C — Acceptance

### Task C1: Bundle + full test + build gate

- [ ] **Step 1:** `npm test` and `npm --prefix worker test` — all green. `npm run check` — 0 errors.
- [ ] **Step 2:** `npm run build`; record gzip sizes of every chunk (`ls -la dist/assets/` + `gzip -9 -c <chunk> | wc -c`). Expectations: main chunk ≈ v1 (≤ ~80 KB gzip), separate RichEditor chunk ≈ 95–105 KB gzip. If the editor code landed in the MAIN chunk, the lazy import leaked a static import somewhere — find and fix (only `import type` from RichEditor is allowed statically).
- [ ] **Step 3:** Update `README.md`: token rotation section now edits the `JOURNAL_TOKENS` JSON map (`wrangler secret put JOURNAL_TOKENS`); note the manual worker deploy (Actions → Run workflow). Commit: `docs: v2 readme — token map rotation, manual worker deploy`.

### Task C2: On-device acceptance (real iPhone, test account) — manual checklist

Record the device's iOS version first. Then:

- [ ] A–L checklist from `audits/audit-3.md` Step 2 (install via Share Sheet, standalone launch, typing, force-quit persistence, second device, airplane mode, week nav, «Сегодня») — run on the TEST account.
- [ ] InstallHint appears in Safari before install; token entered inside the installed app.
- [ ] Splash screen appears on cold launch (light AND dark appearance) — no white flash of a 404'd image.
- [ ] Editor: Russian typing with predictive text; select word → `pointerup` color dot → colored; taps outside the editor still respond afterwards (tiptap#7514 exercise, 10 repetitions); type near the bottom of a long entry — caret stays visible above the keyboard.
- [ ] Swipes: week swipe follows finger and snaps; day swipe; system edge-swipe-back does NOT double-navigate with the pager (start mid-screen); with keyboard open, day-swipe blurs first, header stays aligned after (visualViewport bug check).
- [ ] Oversize entry: paste >64 KB of text → «Слишком длинная запись», sync of OTHER entries continues.
- [ ] Legacy check with marina's account (read-only pass, coordinate with user): her entries open, colored editing works, nothing lost.
- [ ] File any failures as tasks; the release is done when this list passes.

---

## Self-review notes (spec coverage)

- Spec §1 worker/migration/client → A1–A9. §2 editor/sanitize/B1-fix → B1–B4. §3 swipe → B6–B7. §4 visuals → B5 (B7 scrollbar/clamp), B8. §5 PWA → B9–B10. §6 tests → A3/A4/B1 (+ CI in A1). §7 phases → task ordering + A9/C2. Prefetch (rev 2.1) → B5.
- Deliberately deferred beyond v2: deleting `JOURNAL_TOKEN` secret and legacy-archive destruction date (user decides later, per domain audit Q6).
