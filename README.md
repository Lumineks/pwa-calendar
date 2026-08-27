# Plan of the Week — Ежедневник

A personal weekly journal PWA for a single user, styled as a paper school journal (lined pages, spiral binding, day tabs). Modeled after the "План недели — Ежедневник" iOS app. Data lives locally in IndexedDB and syncs in the background to a Cloudflare Worker + KV store. Two devices sharing the same access code share the same journal.

**Live:** https://lumineks.github.io/pwa-calendar/

---

## Stack

- **Svelte 5** + Vite + TypeScript
- **Tailwind v4** — utility CSS
- **Dexie** (IndexedDB) — local-first storage, source of truth per device
- **date-fns** + `date-fns/locale/ru` — date math and Russian weekday/month names
- **vite-plugin-pwa** (Workbox) — service worker + installable manifest
- **Cloudflare Worker + KV** — remote sync backend with bearer-token auth
- **GitHub Pages** — static hosting, auto-deployed on push to `main`

---

## Как установить на iOS / Install on iOS

1. Open **Safari** and go to `https://lumineks.github.io/pwa-calendar/`
2. Tap the **Share** button (box with an arrow pointing up)
3. Tap **"На экран «Домой»"** (Add to Home Screen)
4. Tap **"Добавить"** (Add)
5. Launch the app from the home screen — it opens in standalone mode with no browser chrome

On first launch, paste the access code (provided by the project owner over a private channel) and tap **"Сохранить"**.

---

## Ротация токена / Token rotation

v2 supports multiple accounts sharing one worker. Auth is a single `JOURNAL_TOKENS` secret holding a JSON map of `{ "<token>": "<accountId>" }` — one entry per account. Rotating one account's token means replacing that account's entry in the map; the other entries (other accounts) are untouched.

```bash
cd worker
npx wrangler secret put JOURNAL_TOKENS
# paste the FULL JSON map when prompted, e.g.:
# {"c1c3...uuid": "michael", "9f2a...uuid": "someone-else"}
```

Send the new token to the affected user over Signal or iMessage. On each of their devices: tap **"Выйти"** in the app, then re-paste the new token into the TokenGate screen.

Client-side effect of a token change: the app derives its local IndexedDB name and localStorage key prefix from a hash of the token (see `src/data/namespace.ts`), so a new token means a new local namespace on that device. The old namespace's data is left in place (untouched, not deleted) but is no longer read. The first run on the new token re-pulls that account's data fresh from the worker — sync, not migration, so a device that goes through rotation needs to be online at least once afterward to get its data back.

---

## Развёртывание вручную / Manual deploy

```bash
# Frontend — produces dist/ including the SPA 404 fallback
npm run build

# Worker
npm run worker:deploy
```

The frontend auto-deploys to GitHub Pages on every push to `main` via `.github/workflows/deploy.yml`. The worker does **not** auto-deploy — it's manual-only by design, so a code deploy never lands ahead of an intentional data migration (see the `deploy-worker` job comment in `.github/workflows/deploy.yml`). Trigger it from the GitHub UI: **Actions → Deploy → Run workflow**, which runs the `deploy-worker` job (or run `npm run worker:deploy` locally with Cloudflare credentials configured).

---

## Восстановление данных / Data restore

Cloudflare KV is the durable source of truth. To read entries out-of-band:

```bash
cd worker
npx wrangler kv key list --binding=JOURNAL
npx wrangler kv key get "entries:2026-05-11" --binding=JOURNAL
```

There is no user-facing restore UI in v1. The project owner restores data by reading KV entries directly.

---

## Project docs

- [`PLAN.md`](PLAN.md) — phased build plan with architecture decisions and model assignments
- [`AGENTS.md`](AGENTS.md) — full project context for AI agents and the project owner

---

v1 build is feature-complete; no further development planned unless requested.
