<script lang="ts">
  import { isSameDay, addDays, eachDayOfInterval, format } from 'date-fns';
  import SpiralBinding from './SpiralBinding.svelte';
  import DayTab from './DayTab.svelte';

  interface Props {
    monday: Date;
    // Already-sanitized HTML strings keyed by YYYY-MM-DD (WeekView sanitizes
    // via previewHtmlFor; WeekSpread trusts this prop and renders it with
    // {@html} as-is — never pass raw/unsanitized entry bodies here).
    previews: Record<string, string>;
    onOpenDay: (date: string) => void;
    today: Date;
  }

  let { monday, previews, onOpenDay, today }: Props = $props();

  const days = $derived(eachDayOfInterval({ start: monday, end: addDays(monday, 6) }));

  function isWeekend(d: Date): boolean {
    const dow = d.getDay();
    return dow === 0 || dow === 6;
  }

  function dateKey(d: Date): string {
    return format(d, 'yyyy-MM-dd');
  }
</script>

<div class="spread">
  <!-- LEFT PAGE: Mon, Tue, Wed -->
  <section class="page page-left spiral-page">
    {#each [days[0], days[1], days[2]] as d, idx (dateKey(d!))}
      {@const key = dateKey(d!)}
      {@const today_ = isSameDay(d!, today)}
      {@const weekend_ = isWeekend(d!)}
      <button
        class={[
          'day-row',
          'side-left',
          idx === 2 && 'is-last',
        ]}
        type="button"
        onclick={() => onOpenDay(key)}
        aria-label={`Открыть день ${key}`}
      >
        <div class="tab-slot tab-slot-left">
          <DayTab date={key} isToday={today_} isWeekend={weekend_} side="left" />
        </div>
        <div class="preview" lang="ru">
          <div class="paper">{@html previews[key] ?? ''}</div>
        </div>
      </button>
    {/each}
  </section>

  <SpiralBinding />

  <!-- RIGHT PAGE: Thu, Fri, then split row of Sat + Sun -->
  <section class="page page-right spiral-page">
    <button
      class="day-row paper side-right"
      type="button"
      onclick={() => onOpenDay(dateKey(days[3]!))}
      aria-label={`Открыть день ${dateKey(days[3]!)}`}
    >
      <div class="tab-slot tab-slot-right">
        <DayTab
          date={dateKey(days[3]!)}
          isToday={isSameDay(days[3]!, today)}
          isWeekend={isWeekend(days[3]!)}
          side="right"
        />
      </div>
      <div class="preview" lang="ru">
        <div class="paper">{@html previews[dateKey(days[3]!)] ?? ''}</div>
      </div>
    </button>

    <button
      class="day-row paper side-right"
      type="button"
      onclick={() => onOpenDay(dateKey(days[4]!))}
      aria-label={`Открыть день ${dateKey(days[4]!)}`}
    >
      <div class="tab-slot tab-slot-right">
        <DayTab
          date={dateKey(days[4]!)}
          isToday={isSameDay(days[4]!, today)}
          isWeekend={isWeekend(days[4]!)}
          side="right"
        />
      </div>
      <div class="preview" lang="ru">
        <div class="paper">{@html previews[dateKey(days[4]!)] ?? ''}</div>
      </div>
    </button>

    <!-- Bottom row, split into Sat (top half) and Sun (bottom half) -->
    <div class="day-row split-row is-last">
      <button
        class="day-half paper side-right"
        type="button"
        onclick={() => onOpenDay(dateKey(days[5]!))}
        aria-label={`Открыть день ${dateKey(days[5]!)}`}
      >
        <div class="tab-slot tab-slot-right">
          <DayTab
            date={dateKey(days[5]!)}
            isToday={isSameDay(days[5]!, today)}
            isWeekend={true}
            side="right"
          />
        </div>
        <div class="preview preview-half" lang="ru">
          <div class="paper">{@html previews[dateKey(days[5]!)] ?? ''}</div>
        </div>
      </button>
      <button
        class="day-half paper side-right"
        type="button"
        onclick={() => onOpenDay(dateKey(days[6]!))}
        aria-label={`Открыть день ${dateKey(days[6]!)}`}
      >
        <div class="tab-slot tab-slot-right">
          <DayTab
            date={dateKey(days[6]!)}
            isToday={isSameDay(days[6]!, today)}
            isWeekend={true}
            side="right"
          />
        </div>
        <div class="preview preview-half" lang="ru">
          <div class="paper">{@html previews[dateKey(days[6]!)] ?? ''}</div>
        </div>
      </button>
    </div>
  </section>
</div>

<style>
  /* Two-page spread with a fixed-width spiral binding between them. The
   * pages keep symmetric widths via flex:1; the binding doesn't grow. */
  .spread {
    display: flex;
    align-items: stretch;
    justify-content: center;
    gap: 0;
    padding: 0 38px; /* room for the tab strips outside the pages */
    min-height: calc(100vh - 90px);
  }

  .page {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    gap: 8px; /* visible warm-gradient gutter between day cards */
    min-height: 100%;
    border-radius: 4px;
    overflow: visible; /* tabs need to stick out */
  }

  .page-left {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: none;
  }

  .page-right {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left: none;
  }

  /* Each weekday occupies one row. The row is a button so the whole
   * card-area is clickable. overflow is left visible so the absolutely-
   * positioned tab can extend past the page edge; preview text is clamped
   * separately via -webkit-line-clamp. */
  /* Phase 4.6: each row is now its own paper card. background comes from the
   * global .paper class; the dashed border-top is replaced by the flex gap on
   * .page. A barely-perceptible shadow suggests individual sheets without
   * turning the spread into a floating-cards-on-a-desk look. */
  .day-row {
    background-color: var(--paper-fill);
    position: relative;
    flex: 1 1 0;
    display: flex;
    width: 100%;
    min-height: calc(var(--paper-line-height) * 3 + 12px);
    border: none;
    border-radius: 3px;
    box-shadow: 0 1px 3px rgba(70, 60, 35, 0.08);
    padding: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    box-sizing: border-box;
    overflow: visible;
  }

  /* Slots position the tab outside the page rectangle. The tab extends 38px
   * past the page edge — the .spread container reserves that gutter via its
   * horizontal padding. */
  .tab-slot {
    position: absolute;
    top: 14px;
    pointer-events: auto;
  }
  .tab-slot-left {
    left: -38px;
  }
  .tab-slot-right {
    right: -38px;
  }

  .preview {
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    width: 100%;
  }
  .preview::-webkit-scrollbar {
    display: none;
  }

  .preview .paper {
    min-height: 100%;
    width: 100%;
    padding-left: 6px;
    line-height: var(--paper-line-height);
    font-size: 12px;
    color: #2c2412;
    font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
  }
  /* Injected sanitized <p> children must sit on the ruled lines. */
  .preview .paper :global(p) {
    margin: 0;
    line-height: var(--paper-line-height);
    min-height: var(--paper-line-height);
  }
  /* -webkit-line-clamp does not clamp block children — the Sat/Sun halves
   * clamp by height instead. */
  .preview-half {
    max-height: calc(var(--paper-line-height) * 2);
    overflow: hidden;
  }

  /* The split row containing Sat (top half) + Sun (bottom half). Inherits
   * flex:1 from .day-row so it occupies the same vertical space as a full
   * row on the left page, then splits it in two. */
  .split-row {
    display: flex;
    flex-direction: column;
    gap: 8px; /* same gutter as between full rows */
    padding: 0;
    min-height: 0;
    box-shadow: none; /* layout-only container, individual halves carry shadow */
  }

  /* Phase 4.6: each half is a separate paper card (background from .paper).
   * Dashed border-top replaced by gap on .split-row. */
  .day-half {
    position: relative;
    flex: 1 1 0;
    width: 100%;
    border: none;
    border-radius: 3px;
    box-shadow: 0 1px 3px rgba(70, 60, 35, 0.08);
    padding: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    box-sizing: border-box;
    overflow: visible;
  }

  @media (min-width: 700px) {
    .preview {
      font-size: 12px;
    }
  }
</style>
