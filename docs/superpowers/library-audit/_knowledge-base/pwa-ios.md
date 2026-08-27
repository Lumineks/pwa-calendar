# iOS PWA & Web Platform Knowledge Base

Maintained by Compound V Phase 1C validator. Append at the bottom.

---

## Updated 2026-08-27 — v2 PWA polish (splash screens) + client-side crypto

Sources: `registry.npmjs.org/pwa-asset-generator`; `github.com/elegantapp/pwa-asset-generator`
commit log; project README; MDN Secure Contexts / `Crypto.subtle`.

### `apple-touch-startup-image` is still required in 2026

iOS and iPadOS still do **not** generate launch screens from the Web App Manifest. Manifest
support remains "Partially Supported" and unchanged for at least two years. Per-device
`<link rel="apple-touch-startup-image" media="...">` tags with exactly-sized images remain the
only mechanism. The image must match the PWA's opening window size, so every device class needs
its own file (~30 PNGs for full coverage).

### `pwa-asset-generator` — healthy (2026-08-27)

**Latest 8.1.5, released 2026-06-01.** Not archived, not deprecated. Recent commits:
8.1.5 `fix(puppets): update apple scraper` (2026-06-01), 8.1.4 `fix(deps): update vulnerable
packages` (2026-03-14), 8.1.3 (2026-03-12). The "apple scraper" commit is a good maintenance
signal — the maintainer is still tracking Apple's device-size list, which is what makes this tool
worth using over a hardcoded list.

**Dependency shift to know about:** 8.x depends on `puppeteer-core@^24` + `chrome-launcher@^1.2.1`,
**not** full `puppeteer`. It launches a **locally installed Chrome** rather than downloading its
own Chromium. Machines/CI without Chrome will fail. `engines: node >= 18`. `bin: pwa-asset-generator`.

Current flags: `--splash-only`, `--background`, `--index`, `--path`, `--dark-mode`.

```
npx pwa-asset-generator <source.png> <output-dir> \
  --splash-only --background "#rrggbb" --index ./index.html --path "<prefix>"
```

`--dark-mode` requires **two runs** (one with, one without) writing into the same index.html to
produce the full media-query set. Known iOS limitation from the FAQ: an already-installed PWA does
not pick up a changed system light/dark setting for its launch image — the user must re-add it.

Two recurring traps:
- **`--path` must be set for any non-root deploy** (GitHub Pages project subpaths, etc.); the
  generator emits root-relative `href`s by default.
- The full splash set is several MB. With `vite-plugin-pwa`/Workbox, per-file default
  `maximumFileSizeToCacheInBytes` is 2 MiB (individual splashes pass), but the **total precache
  manifest** grows a lot. Measure the generated precache size rather than assuming.

### `crypto.subtle` and secure contexts — the LAN-IP dev trap

`crypto.subtle` is available **only in secure contexts**. Secure: `https://`, `http://localhost`,
`http://127.0.0.1`. **Not secure: LAN IPs** — `http://192.168.x.x`, `http://10.x.x.x`. There
`crypto.subtle` is `undefined` (not "throws" — the property itself is absent).

This bites the specific, common workflow of testing a PWA on a real iPhone against a dev server
via `vite --host`: the app works on the laptop at `localhost` and dies on the phone at the LAN IP,
with a failure that looks nothing like a secure-context problem. Production on HTTPS is unaffected,
so it reads as a device-specific bug.

Mitigations, in rough order of cost: use a non-crypto synchronous digest if the hash is only a
namespace discriminator rather than a security boundary; serve dev over HTTPS
(`@vitejs/plugin-basic-ssl`); tunnel; or polyfill (`webcrypto-liner`).

Design note worth reusing: a client-side hash used to **namespace** local storage (Dexie DB name,
localStorage key prefixes) is not a security boundary — it only needs collision-resistance across
the handful of tokens in play. Reaching for `crypto.subtle` there buys nothing and imports the
secure-context constraint plus async-ness into app startup.
