<script lang="ts">
  import { startOfISOWeek, format } from 'date-fns';

  let { date }: { date: string } = $props();

  const isoMonday = $derived(format(startOfISOWeek(new Date(date)), 'yyyy-MM-dd'));
</script>

<p>DayView — {date}</p>
<a href="/week/{isoMonday}">← Назад</a>
