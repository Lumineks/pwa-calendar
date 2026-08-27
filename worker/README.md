# journal-calendar — Cloudflare Worker

Deployed at: **https://journal-calendar.pwacalendar.workers.dev**

---

## Auth model

Every request (except `OPTIONS` preflight) must include:

```
Authorization: Bearer <token>
```

The token is stored as a Cloudflare secret named `JOURNAL_TOKEN`. It is never written to any file in this repository. The project owner generates it with:

```bash
node -e "console.log(crypto.randomUUID())"
```

and sends it to the user once over a private channel (Signal / iMessage). The user pastes it into the TokenGate screen on each device, once per device.

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

## KV shape

Namespace binding: `JOURNAL` (`e329d26f945e46c094a7bf982d8a5895`)

| Key | Value |
|---|---|
| `index` | `string[]` — JSON array of `YYYY-MM-DD` dates that have entries, kept sorted |
| `entries:YYYY-MM-DD` | `{"body": string, "updatedAt": ISOString}` |

---

## Token rotation

If the token is ever leaked or compromised:

1. Generate a new UUID: `node -e "console.log(crypto.randomUUID())"`
2. Update the Cloudflare secret: `npx wrangler secret put JOURNAL_TOKEN` (paste the new value when prompted)
3. Send the new token to the user over a private channel
4. The user opens the app, taps "Выйти" (or clears the app's localStorage), and re-pastes the new token into the TokenGate screen on each device

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
npx wrangler kv key get "entries:2026-05-11" --binding=JOURNAL
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
