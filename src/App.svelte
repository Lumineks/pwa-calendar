<script lang="ts">
  import { token } from './state/auth.ts';
  import { Router, Route, navigate } from 'svelte-routing';
  import { startOfISOWeek, format } from 'date-fns';
  import TokenGate from './routes/TokenGate.svelte';
  import WeekView from './routes/WeekView.svelte';
  import DayView from './routes/DayView.svelte';

  // If loading at root path, update history.location before Router mounts so it
  // initializes at the correct week URL (Router reads history.location on creation).
  if (typeof window !== 'undefined' && window.location.pathname === '/') {
    navigate(`/week/${format(startOfISOWeek(new Date()), 'yyyy-MM-dd')}`, { replace: true });
  }
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
