<script lang="ts">
  import { token } from './state/auth.ts';
  import { Router, Route, navigate } from 'svelte-routing';
  import { parseISO, isValid, startOfISOWeek, format } from 'date-fns';
  import TokenGate from './routes/TokenGate.svelte';
  import WeekView from './routes/WeekView.svelte';
  import DayView from './routes/DayView.svelte';
  import { syncStart, syncStop } from './data/sync.ts';

  // Validate and fix the URL before the Router mounts so it always initializes
  // on a good path. Router reads history.location on creation, so mutations here
  // are visible on its first pass — unlike $effect redirects which run after
  // mount and leave the Router pinned to the old (bad) match.
  if (typeof window !== 'undefined') {
    const currentIsoMonday = format(startOfISOWeek(new Date()), 'yyyy-MM-dd');
    const SEG_RE = /^\d{4}-\d{2}-\d{2}$/;
    const pathname = window.location.pathname;

    if (pathname === '/') {
      navigate(`/week/${currentIsoMonday}`, { replace: true });
    } else {
      const dayMatch = /^\/day\/([^/]+)$/.exec(pathname);
      if (dayMatch) {
        const seg = dayMatch[1] ?? '';
        if (!SEG_RE.test(seg) || !isValid(parseISO(seg))) {
          navigate(`/week/${currentIsoMonday}`, { replace: true });
        }
      } else {
        const weekMatch = /^\/week\/([^/]+)$/.exec(pathname);
        if (weekMatch) {
          const seg = weekMatch[1] ?? '';
          if (!SEG_RE.test(seg) || !isValid(parseISO(seg))) {
            navigate(`/week/${currentIsoMonday}`, { replace: true });
          }
        }
      }
    }
  }

  // Phase 6: sync triggers follow the token. syncStart() is idempotent so a
  // re-render with the same token value won't double-attach listeners. On
  // logout (clearToken), syncStop tears down timers and listeners. The
  // in-memory dirty set is preserved across token clears — if the user
  // re-pastes the same token, queued edits resume.
  $effect(() => {
    if ($token === null) {
      syncStop();
      return;
    }
    syncStart();
    return () => syncStop();
  });
</script>

{#if $token === null}
  <TokenGate />
{:else}
  <Router>
    <Route path="/week/:isoMonday" let:params>
      <WeekView isoMonday={params['isoMonday'] ?? ''} />
    </Route>
    <Route path="/day/:date" let:params>
      <DayView date={params['date'] ?? ''} />
    </Route>
  </Router>
{/if}
