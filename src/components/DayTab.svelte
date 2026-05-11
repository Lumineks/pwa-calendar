<script lang="ts">
  import { parseISO, format } from 'date-fns';
  import { ru } from 'date-fns/locale';

  /**
   * DayTab — small rectangular tab sticking out the outer edge of a page.
   *
   * `side` controls which corner gets the notch so left-page tabs notch on
   * their right (page-facing) edge and right-page tabs mirror that.
   * Adding `side` is a small deviation from PLAN.md's prop list (which lists
   * only date/isToday/isWeekend) — the reference image requires this
   * asymmetry, so the tab carries it rather than the parent.
   */
  interface Props {
    date: string;
    isToday: boolean;
    isWeekend: boolean;
    side?: 'left' | 'right';
  }

  let { date, isToday, isWeekend, side = 'left' }: Props = $props();

  const parsed = $derived(parseISO(date));

  /**
   * Russian narrow weekday name (e.g. "пн", "вт"). date-fns's ru locale
   * returns these lowercased, so we capitalize the first letter to match the
   * reference image's "Пн", "Вт", … look.
   */
  const weekdayShort = $derived.by(() => {
    const raw = format(parsed, 'EEEEEE', { locale: ru });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  });

  const dayOfMonth = $derived(format(parsed, 'd'));
</script>

<div
  class={[
    'day-tab',
    `side-${side}`,
    isToday && 'is-today',
    isWeekend && !isToday && 'is-weekend',
  ]}
>
  <span class="weekday">{weekdayShort}</span>
  <span class="day-num">{dayOfMonth}</span>
  <span class="expand-hint" aria-hidden="true">↗</span>
</div>

<style>
  .day-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    width: 38px;
    padding: 8px 4px 6px;
    background: #f3ecd8;
    color: #3a3322;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-weight: 600;
    line-height: 1.05;
    user-select: none;
    /* Subtle "torn paper" shadow + 1px border so the tab reads as a separate
     * piece of card stock sitting on top of the page edge. */
    box-shadow:
      0 1px 1px rgba(70, 60, 35, 0.12),
      0 4px 8px rgba(70, 60, 35, 0.08);
    border: 1px solid rgba(70, 60, 35, 0.16);
    cursor: pointer;
    transition: background 120ms ease, transform 120ms ease;
  }

  .day-tab:hover {
    background: #ece4ce;
  }

  /* Left-page tabs: rounded on the OUTER (left) edge, notch on the bottom of
   * the INNER (right) edge so they read like a tab "torn" from the page. */
  .side-left {
    border-top-left-radius: 8px;
    border-bottom-left-radius: 8px;
    clip-path: polygon(0 0, 100% 0, 100% 78%, 78% 100%, 0 100%);
  }

  /* Right-page tabs: mirrored. */
  .side-right {
    border-top-right-radius: 8px;
    border-bottom-right-radius: 8px;
    clip-path: polygon(0 0, 100% 0, 100% 100%, 22% 100%, 0 78%);
  }

  .weekday {
    font-size: 11px;
    letter-spacing: 0.5px;
  }

  .day-num {
    font-size: 22px;
    font-weight: 700;
    margin: 2px 0;
  }

  .expand-hint {
    font-size: 11px;
    opacity: 0.55;
  }

  /* Weekend: a touch warmer than weekday tabs but still soft. */
  .is-weekend {
    background: #efe5c8;
    color: #2c2412;
  }

  .is-weekend:hover {
    background: #e8debe;
  }

  /* Today: deep red like the reference image, white text. */
  .is-today {
    background: linear-gradient(180deg, #c43c3c 0%, #a82e2e 100%);
    color: #fff;
    border-color: rgba(120, 30, 30, 0.4);
    box-shadow:
      0 1px 1px rgba(120, 30, 30, 0.35),
      0 4px 10px rgba(120, 30, 30, 0.25);
  }

  .is-today:hover {
    background: linear-gradient(180deg, #b73535 0%, #9a2727 100%);
  }

  .is-today .expand-hint {
    opacity: 0.8;
  }
</style>
