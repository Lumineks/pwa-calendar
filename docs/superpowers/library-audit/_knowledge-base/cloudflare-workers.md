# Cloudflare Workers Library Knowledge Base

Maintained by Compound V Phase 1C validator. Append at the bottom.

---

## Updated 2026-08-27 — v2 multi-account worker + worker tests

Sources: `registry.npmjs.org`; `developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/`;
`developers.cloudflare.com/workers/testing/vitest-integration/{get-started,configuration}`;
`developers.cloudflare.com/workers/runtime-apis/web-crypto/`;
`developers.cloudflare.com/workers/examples/protect-against-timing-attacks/`.

### Testing: the package was renamed on 2026-08-19

**`@cloudflare/vitest-pool-workers` → `@cloudflare/vitest-plugin`.**
`@cloudflare/vitest-plugin@1.1.0` (2026-08-25) is v1 of what shipped as
`@cloudflare/vitest-pool-workers@0.22.0` (2026-08-18). The old package is **not npm-`deprecated`**
as of 2026-08-27 but is superseded — do not start new work on the old name.

Codemod: `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`
(updates dependency, imports, and test tsconfig).

API changes that came with it:

- `defineWorkersConfig` / `defineWorkersProject` from `@cloudflare/vitest-pool-workers/config`
  → **`cloudflareTest()` Vite plugin** from `@cloudflare/vitest-plugin`.
- `env` moved from `cloudflare:test` → **`cloudflare:workers`**.
  `createExecutionContext` / `waitOnExecutionContext` **stay** in `cloudflare:test`.
- Integration tests use `exports.default.fetch()` (from `cloudflare:workers`) in place of `SELF`.

Current config shape:

```ts
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
});
```

`configPath` accepts **both `.toml` and `.json`/`.jsonc`** — no conversion needed for existing
`wrangler.toml` projects. If no `compatibility_date` is present, tests use the latest locally
available date.

Versions (2026-08-27): `@cloudflare/vitest-plugin@1.1.0` peers `vitest ^4.1.0`,
`@vitest/runner ^4.1.0`, `@vitest/snapshot ^4.1.0`; **bundles** `wrangler 4.126.0` +
`miniflare 5.20260825.0-alpha` as direct deps. Current `vitest` latest is 4.1.11 (2026-08-18);
`wrangler` latest 4.126.0 (2026-08-25). Any project on `wrangler ^4.9x` resolves compatibly.

**Decision rule — pool/plugin vs. plain vitest with hand-mocked bindings:** the deciding question
is not test-suite size, it is *whether the code under test touches workerd-only surface*.
`crypto.subtle.timingSafeEqual` is a **workerd-only non-standard extension that does not exist in
Node** — code using it cannot be executed at all under plain vitest, only stubbed. Same for real
KV `list({prefix})` semantics. A hand-mocked `KVNamespace` tests the mock. If the worker's whole
contract is KV semantics plus workerd crypto, use the plugin even for a tiny worker; it also
subsumes any separate "run against local miniflare KV" step.

### `crypto.subtle.timingSafeEqual`

Still supported (2026-08-27). Documented as **"a non-standard extension to the Web Crypto API"**.

Signature: `timingSafeEqual(a, b) : bool`, where `a`/`b` are `ArrayBuffer | TypedArray`.

**It throws when the two buffers differ in byte length.** This is the trap: the obvious guard
`if (a.byteLength !== b.byteLength) return false;` is an early return that leaks the secret's
length through response timing — exactly what the function exists to prevent.

Cloudflare's documented decoy pattern:

```ts
const lengthsMatch = userValue.byteLength === secretValue.byteLength;
const isEqual = lengthsMatch
  ? crypto.subtle.timingSafeEqual(userValue, secretValue)
  : !crypto.subtle.timingSafeEqual(userValue, userValue);  // always false, constant time
```

Docs are explicit: "Do not return early when the input and secret have different lengths."

For comparing an incoming token against **N** candidate secrets of differing lengths (multi-account
token maps), the branchless alternative is to SHA-256 both sides and `timingSafeEqual` the two
fixed 32-byte digests — lengths are then always equal, the throw is unreachable, and the
length-match branch disappears entirely. Historical note: `crypto.timingSafeEqual` (Node-style,
not under `.subtle`) was `undefined` in workerd — see workerd#2172. Use `crypto.subtle.timingSafeEqual`.
