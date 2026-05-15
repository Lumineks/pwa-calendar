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

If the access token is compromised or needs to be changed:

```bash
cd worker
npx wrangler secret put JOURNAL_TOKEN
# paste the new UUID when prompted
```

Send the new token to the user over Signal or iMessage. On each device: tap **"Выйти"** in the app, then re-paste the new token into the TokenGate screen.

---

## Развёртывание вручную / Manual deploy

```bash
# Frontend — produces dist/ including the SPA 404 fallback
npm run build

# Worker
npm run worker:deploy
```

CI auto-deploys both on every push to `main` via `.github/workflows/deploy.yml`.

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
