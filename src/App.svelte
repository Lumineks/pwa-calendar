<script lang="ts">
  import { token, clearToken } from './state/auth.ts';
  import { Router, Route, navigate } from 'svelte-routing';
  import { parseISO, isValid, startOfISOWeek, format } from 'date-fns';
  import TokenGate from './routes/TokenGate.svelte';
  import WeekView from './routes/WeekView.svelte';
  import DayView from './routes/DayView.svelte';
  import { syncStart, syncStop, initState } from './data/sync.ts';
  import { initDb } from './data/db.ts';
  import { namespaceFor } from './data/namespace.ts';

  // Strip trailing slash from BASE_URL to get a prefix for navigate() calls and
  // the Router basepath. In dev (BASE_URL='/') this is '', in production it is
  // '/pwa-calendar'. Works with any Vite base value without hardcoding.
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  // Validate and fix the URL before the Router mounts so it always initializes
  // on a good path. Router reads history.location on creation, so mutations here
  // are visible on its first pass — unlike $effect redirects which run after
  // mount and leave the Router pinned to the old (bad) match.
  if (typeof window !== 'undefined') {
    const currentIsoMonday = format(startOfISOWeek(new Date()), 'yyyy-MM-dd');
    const SEG_RE = /^\d{4}-\d{2}-\d{2}$/;
    // Strip the base prefix so the checks below work identically in dev and prod.
    const raw = window.location.pathname;
    const pathname = base ? raw.slice(base.length) || '/' : raw;

    if (pathname === '/') {
      navigate(`${base}/week/${currentIsoMonday}`, { replace: true });
    } else {
      const dayMatch = /^\/day\/([^/]+)$/.exec(pathname);
      if (dayMatch) {
        const seg = dayMatch[1] ?? '';
        if (!SEG_RE.test(seg) || !isValid(parseISO(seg))) {
          navigate(`${base}/week/${currentIsoMonday}`, { replace: true });
        }
      } else {
        const weekMatch = /^\/week\/([^/]+)$/.exec(pathname);
        if (weekMatch) {
          const seg = weekMatch[1] ?? '';
          if (!SEG_RE.test(seg) || !isValid(parseISO(seg))) {
            navigate(`${base}/week/${currentIsoMonday}`, { replace: true });
          }
        }
      }
    }
  }

  // Sync + local DB follow the token, keyed by its account namespace.
  // syncStart(ns) is idempotent so a re-render with the same token value won't
  // double-attach listeners. On logout (clearToken), syncStop tears down timers
  // and listeners and aborts any in-flight push. The in-memory dirty set is
  // preserved across token clears — if the user re-pastes the SAME token,
  // queued edits resume; a DIFFERENT token clears it (see syncStart).
  $effect(() => {
    if ($token === null) {
      syncStop();
      return;
    }
    const ns = namespaceFor($token);
    initDb(ns); // synchronous — resolves the db ready-latch BEFORE syncStart
    syncStart(ns);
    return () => syncStop();
  });
</script>

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
    {#if $initState === 'needs-network'}
      <button type="button" class="init-logout" onclick={clearToken}>Выйти</button>
    {/if}
  </div>
{:else}
  <Router basepath={base}>
    <Route path="/week/:isoMonday" let:params>
      <WeekView isoMonday={params['isoMonday'] ?? ''} />
    </Route>
    <Route path="/day/:date" let:params>
      <DayView date={params['date'] ?? ''} />
    </Route>
  </Router>
{/if}

<style>
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
  .init-logout {
    margin-top: 8px;
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid rgba(70, 60, 35, 0.18);
    background: #fbf6e9;
    color: #2c2412;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .init-logout:hover { background: #f3ecd8; }
</style>
