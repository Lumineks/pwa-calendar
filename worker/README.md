# journal-calendar — Cloudflare Worker

Deployed at: **https://journal-calendar.pwacalendar.workers.dev**

---

## Auth model

Every request (except `OPTIONS` preflight) must include:

```
Authorization: Bearer <token>
```

Tokens live in a single Cloudflare secret named `JOURNAL_TOKENS` — a JSON map of `{ "<token>": "<accountId>" }`, one entry per account (see `src/tokens.ts`). The v2 worker reads **only** `JOURNAL_TOKENS`; the v1 singular `JOURNAL_TOKEN` secret is no longer read by any code path. The secret is never written to any file in this repository. The project owner generates a token with:

```bash
node -e "console.log(crypto.randomUUID())"
```

and sends it to the user once over a private channel (Signal / iMessage). The user pastes it into the TokenGate screen on each device, once per device. The matched `accountId` is what namespaces the user's KV keys (see **KV layout**), so two tokens mapped to the same accountId share one journal.

---

## CORS allowlist

| Environment | `ALLOWED_ORIGIN` | Set via |
|---|---|---|
| Production | `https://lumineks.github.io` | `wrangler.toml [vars]` |
| Dev (`wrangler dev`) | `http://localhost:5173` | `wrangler.toml [env.dev.vars]` |

Production origin is `https://lumineks.github.io`. This matches the `Authorization: Bearer` check against the `Origin` header on every non-OPTIONS request.

---

## API surface

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{"ok":true}` if the bearer token is valid. Used by TokenGate to validate on first launch. |
| `GET` | `/entries` | Returns `{"index": string[]}` — sorted list of dates that have entries. |
| `GET` | `/entries?from=YYYY-MM-DD&to=YYYY-MM-DD` | Returns `{"index": [...], "entries": { date: {body, updatedAt} }}` for the given inclusive range. Both params required together. |
| `GET` | `/entries/:date` | Returns `{body, updatedAt}` for a single date, or 404. |
| `PUT` | `/entries/:date` | Upsert an entry. Body: `{"body": string, "updatedAt": ISO string}`. LWW: returns 409 with `{"server": ...}` if the server copy is strictly newer. |
| `DELETE` | `/entries/:date` | Deletes the entry and prunes it from the index. Returns 204, or 404 if it didn't exist. |

No `GET /export` — backup via the Worker API is out of scope for v1.

---

## KV layout

Namespace binding: `JOURNAL` (`e329d26f945e46c094a7bf982d8a5895`)

Every key the v2 worker reads or writes is prefixed by the account id resolved from the bearer token (`src/index.ts` — `entryKey` / `indexKey`):

| Key | Value |
|---|---|
| `a:<account>:index` | `string[]` — JSON array of `YYYY-MM-DD` dates that have entries, kept sorted |
| `a:<account>:entries:YYYY-MM-DD` | `{"body": string, "updatedAt": ISOString, "format"?: "html"}` |

Legacy (v1) keys — `index` and `entries:YYYY-MM-DD`, with no `a:<account>:` prefix — are a **permanent archive of the pre-migration data**. The v2 worker never reads, writes, or deletes them; they were copied into `a:marina-actress:*` during migration and are kept only as a rollback/forensic copy. Do not prune them.

---

## Token rotation

Rotation means **editing one entry of the `JOURNAL_TOKENS` JSON map and re-uploading the whole map**. There is no per-account secret. (Same procedure as the root [`README.md`](../README.md) "Ротация токена" section — keep the two in sync if you change either.)

If an account's token is leaked or compromised:

1. Generate a new UUID: `node -e "console.log(crypto.randomUUID())"`
2. Take the current map (the project owner's own copy — Cloudflare will not show you a secret's value) and replace **only that account's token key**, keeping its `accountId` value and every other account's entry byte-identical:

   ```json
   {"<new-uuid>": "marina-actress", "<other-token>": "someone-else"}
   ```

3. Paste the **FULL** map — not just the changed entry — when prompted:

   ```bash
   cd worker
   npx wrangler secret put JOURNAL_TOKENS
   ```

   `wrangler secret put` overwrites the secret wholesale, so anything omitted from the pasted JSON is deleted and that account is locked out.
4. **No worker deploy is needed.** Secrets take effect immediately on the already-deployed worker (the next request in a fresh isolate re-parses the map; see the `cachedRaw` note in `src/tokens.ts`). Do **not** run `npx wrangler deploy` as part of a rotation — the worker is manual-deploy-only by design so code never lands ahead of a data migration.
5. Send the new token to the affected user over a private channel (Signal / iMessage). Other accounts are unaffected and need no action.
6. On each of that user's devices: open the app, tap "Выйти" (or clear the app's localStorage), and re-paste the new token into the TokenGate screen. The client derives its local IndexedDB name from a hash of the token, so the device starts a fresh local namespace and re-pulls that account's data from KV — it must be online at least once after rotation.

> **⚠️ The map fails CLOSED as a whole.** `parseTokenMap` (`src/tokens.ts`) rejects the *entire* secret — returning `null`, so **every account gets 401** — if the JSON is malformed, is not an object, is empty, or contains **any** invalid entry:
> - an `accountId` not matching `^[a-z0-9-]{1,32}$` (lowercase letters, digits and hyphens only — no uppercase, no underscores, no dots, 1–32 chars), or
> - a token shorter than 8 characters.
>
> A typo in one unrelated entry therefore takes down all accounts until the secret is fixed. Validate the JSON before pasting (e.g. `node -e "const m=require('fs').readFileSync(0,'utf8'); const o=JSON.parse(m); for(const [t,a] of Object.entries(o)) if(t.length<8||!/^[a-z0-9-]{1,32}$/.test(a)) throw new Error('bad entry: '+a); console.log('ok', Object.keys(o).length, 'entries')"` reading the map on stdin), and re-check `GET /health` with a known-good token right after `secret put`.

---

## Dev setup

1. Copy `.dev.vars.example` to `.dev.vars` (gitignored).
2. The dev KV namespace is separate from production — `wrangler.toml`'s `[env.dev]` block binds `JOURNAL` to its own namespace id, so local dev and migration rehearsal never touch production data.
3. The production secret is `JOURNAL_TOKENS` (a JSON map of `token -> accountId`), set via `npx wrangler secret put JOURNAL_TOKENS`. The legacy single-token `JOURNAL_TOKEN` secret is retained during the rollback window.

## Local development

```bash
nvm use 22        # wrangler 4.x requires Node >= 22
npm run dev       # starts wrangler dev on http://localhost:8787
```

The dev environment uses its own KV namespace, separate from production. To inspect KV during dev:

```bash
npx wrangler kv key list --binding=JOURNAL
npx wrangler kv key get "a:marina-actress:entries:2026-05-11" --binding=JOURNAL
```

---

## Deploy

```bash
npm run deploy    # from this directory
# or from the repo root:
npm run worker:deploy
```

---

## Eventual-consistency note

Cloudflare KV is eventually consistent. For this single-user / two-device app, LWW (last-write-wins) happens per PUT: the Worker compares `updatedAt` strings at write time and rejects the stale write with a 409. However, two near-simultaneous writes from two devices may both succeed if they arrive before either is replicated — the devices will briefly disagree and converge on the next pull. This is an acceptable trade-off for a personal journal with one writer at a time.
