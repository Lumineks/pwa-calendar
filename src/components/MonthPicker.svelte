<script lang="ts">
  import { parseISO, format, addDays, startOfISOWeek } from 'date-fns';
  import { ru } from 'date-fns/locale';
  import { today } from '../state/today.ts';

  /**
   * MonthPicker — week navigation header.
   *
   * The label shows the month/year of `monday` in Russian (capitalized).
   * The chevrons step the displayed ISO Monday one week back/forward.
   * The "Сегодня" pill jumps to the ISO Monday of the current week.
   *
   * In Svelte 5 we use a callback prop instead of `createEventDispatcher` —
   * `onChange` carries the new isoMonday string. (PLAN.md's wording of
   * "emit change events" maps directly to this in runes mode.)
   */
  interface Props {
    monday: string;
    onChange: (newIsoMonday: string) => void;
  }

  let { monday, onChange }: Props = $props();

  const parsed = $derived(parseISO(monday));

  const label = $derived.by(() => {
    const raw = format(parsed, 'LLLL yyyy', { locale: ru });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  });

  const todayIsoMonday = $derived(format(startOfISOWeek($today), 'yyyy-MM-dd'));
  const isOnCurrentWeek = $derived(monday === todayIsoMonday);

  function step(deltaDays: number): void {
    onChange(format(addDays(parsed, deltaDays), 'yyyy-MM-dd'));
  }

  function goToday(): void {
    onChange(todayIsoMonday);
  }
</script>

<div class="month-picker">
  <button
    type="button"
    class="chev"
    aria-label="Предыдущая неделя"
    onclick={() => step(-7)}
  >
    ←
  </button>
  <span class="label">{label}</span>
  <button
    type="button"
    class="chev"
    aria-label="Следующая неделя"
    onclick={() => step(7)}
  >
    →
  </button>
  <button
    type="button"
    class={['today-pill', isOnCurrentWeek && 'is-current']}
    onclick={goToday}
    disabled={isOnCurrentWeek}
  >
    Сегодня
  </button>
</div>

<style>
  .month-picker {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #2c2412;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  }

  .label {
    font-size: 15px;
    font-weight: 600;
    min-width: 140px;
    text-align: center;
    letter-spacing: 0.2px;
  }

  .chev {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid rgba(70, 60, 35, 0.18);
    background: #fbf6e9;
    color: #2c2412;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    transition: background 120ms ease;
  }

  .chev:hover {
    background: #f3ecd8;
  }

  .today-pill {
    margin-left: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid rgba(70, 60, 35, 0.18);
    background: #fbf6e9;
    color: #2c2412;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 120ms ease, opacity 120ms ease;
  }

  .today-pill:hover:not(:disabled) {
    background: #f3ecd8;
  }

  .today-pill.is-current {
    opacity: 0.45;
    cursor: default;
  }
</style>
