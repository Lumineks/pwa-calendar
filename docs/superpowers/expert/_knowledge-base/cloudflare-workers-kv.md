# Cloudflare Workers / KV Knowledge Base

Maintained by Compound V Phase 1B advisor. Append at the bottom on each pass.

---

## Updated 2026-08-27 — KV consistency, list pagination, versioned deploys, timing-safe auth

### `crypto.subtle.timingSafeEqual` — the length trap

Cloudflare's **non-standard** `crypto.subtle.timingSafeEqual(a, b)` requires equal-length `ArrayBuffer`/`TypedArray` and **throws** otherwise. It is a `crypto.subtle` extension, not the Node `crypto.timingSafeEqual` ([workerd#2172](https://github.com/cloudflare/workerd/issues/2172) — `crypto.timingSafeEqual` is `undefined`).

Correct pattern ([Cloudflare docs](https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks)):
```ts
const lengthsMatch = userValue.byteLength === secretValue.byteLength;
const isEqual = lengthsMatch
  ? crypto.subtle.timingSafeEqual(userValue, secretValue)
  : !crypto.subtle.timingSafeEqual(userValue, userValue);
```
Doc quote: "Do not return early when the input and secret have different lengths. An early return leaks the length of the secret through response timing."

History: the docs previously showed an early-return on length mismatch. [cloudflare-docs#23623](https://github.com/cloudflare/cloudflare-docs/issues/23623) (opened 2025-07-12) flagged it — "The purpose of timing safety is defeated by returning earlier on two different lengths" — fixed via PR #28135.

**Both failure directions are common in the wild:** early-return (leaks length, safe to run) and no-guard-at-all (constant-time, but throws). The pattern above is the only one that is both.

**Comparing against N secrets** (multi-tenant token maps): iterate all N and accumulate, never break on match. Cost is O(N) buffer compares — negligible for small N.

### KV consistency

- **Eventually consistent, up to 60 s or more** for changes to become visible at other network locations. Usually immediate at the location that made the write. [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/).
- **Negative lookups are cached too** — a freshly written key can read as *absent* elsewhere for the same window. This is the one most people miss.
- `list()` is also eventually consistent; recently deleted/expired keys leave tombstones, recently written keys may not appear.
- **No compare-and-swap.** Read-modify-write on a shared key (an index, a counter, a set) silently loses concurrent writes. If you need write-after-write consistency, funnel writes for a key through a Durable Object and read from KV elsewhere.

**Reusable rules:**
1. In an offline-first client, **never conflate "empty response" with "failed response"** — cached negative lookups make an empty read a routine outcome, and clients that treat it as authoritative wipe or mis-initialise local state.
2. A KV "index"/manifest key is the most dangerous object in a KV-backed app: losing it orphans every data key even though the data keys survive. Make index mutations additive per-item server-side; never let a client PUT a whole index.
3. Any migration/deploy sequence needs an explicit ≥ 60 s settle before verifying, and verification must read **through the deployed Worker**, not the REST API (different cache path).
4. Prefer a maintenance flag returning 503 over letting clients observe a half-migrated, eventually-consistent key space.

### KV limits

| Thing | Limit |
|---|---|
| Value size | 25 MiB |
| `list()` page | default 1000, **max 1000**; requires `cursor` **and the same `prefix`** on each successive call; terminate on `list_complete` |
| Worker request body | 100 MB free/pro, 200 MB business, 500 MB enterprise |

Sources: [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [community: list with prefix, pagination mismatches](https://community.cloudflare.com/t/kv-list-with-prefix-includes-mismatches-when-paginating/516969).

Note: local/miniflare KV has historically silently diverged from production (e.g. [workers-sdk#4037](https://github.com/cloudflare/workers-sdk/issues/4037), local KV capping values at 4 KB). Miniflare rehearsal is necessary but not sufficient.

### Versioned deploys, rollback, secrets

- **`wrangler rollback` restores code only. It does NOT roll back secret values, and does NOT restore deleted secrets.** The rolled-back version runs against the *current* secret configuration. [Rollback docs](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks), [command reference](https://www.mintlify.com/cloudflare/workers-sdk/commands/rollback).
- Wrangler prompts for extra confirmation when the target version's secrets differ from current ([workers-sdk#5950](https://github.com/cloudflare/workers-sdk/commit/007562109b583adb6ae15bba5f50029735af24e5)); secret behaviour changed breakingly with versions ([#6763](https://github.com/cloudflare/workers-sdk/issues/6763)); `wrangler versions upload` still lacks env/secret support ([#10068](https://github.com/cloudflare/workers-sdk/issues/10068)).
- Rollback does **not** affect bound resources (KV, R2, D1, DO) — data written under the new schema stays written.

**Reusable rule:** never delete or rename a secret in the same release that introduces its replacement. Keep the old secret provisioned for the entire rollback window, and remove it in a later, separate change. Otherwise "we can just roll back" is false.

**Reusable rule:** rehearse deploy → rollback → re-deploy on a throwaway account/namespace before running a data migration in production.

### JSON-in-a-secret configuration

A JSON blob stored as a Worker secret (token maps, feature config) has three sharp edges:
1. A malformed value (trailing comma, smart quote from a chat client) breaks **every** request, and there is no secret rollback.
2. Updating it means retyping the whole blob via `wrangler secret put`; a fat-finger locks everyone out.
3. `JSON.parse` per request is wasted work and turns a config error into a 500 rather than a controlled auth failure.

Mitigations: parse once, validate the shape, **fail closed with 401 rather than 500**, provide a break-glass second credential, and write the secret via a read-modify-write script with validation rather than by hand.

### Byte-length limits with non-Latin content

Any size limit expressed in "characters" is wrong for non-Latin text. Cyrillic is 2 bytes/char in UTF-8; CJK is 3; emoji 4. Measure with `new TextEncoder().encode(s).byteLength` on **both** client and server, from one shared helper. A client/server mismatch produces the classic silent failure: the client queues content the server permanently rejects, and a retrying dirty-queue then blocks all subsequent syncs. A rejected item must leave the queue and surface an error.
