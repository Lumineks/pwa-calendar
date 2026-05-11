<script lang="ts">
  import { clearToken } from '../state/auth.ts';

  let { isoMonday }: { isoMonday: string } = $props();
</script>

<p>WeekView — неделя с {isoMonday}</p>
<button onclick={clearToken}>Выйти</button>
