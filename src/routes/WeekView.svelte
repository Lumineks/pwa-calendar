<script lang="ts">
  import { navigate } from 'svelte-routing';
  import {
    parseISO,
    isValid,
    format,
    addDays,
    eachDayOfInterval,
    startOfISOWeek,
    isSameDay,
  } from 'date-fns';
  import { ru } from 'date-fns/locale';
  import { clearToken } from '../state/auth.ts';
  import { listEntries, type Entry } from '../data/db.ts';
  import MonthPicker from '../components/MonthPicker.svelte';
  import SpiralBinding from '../components/SpiralBinding.svelte';
  import DayTab from '../components/DayTab.svelte';

  interface Props {
    isoMonday: string;
  }

  let { isoMonday }: Props = $props();

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function todayIsoMonday(): string {
    return format(startOfISOWeek(new Date()), 'yyyy-MM-dd');
  }

  /**
   * Per PLAN.md: "If isoMonday is missing or doesn't parse, navigate to
   * /week/<current-iso-monday> with replace:true and return." We honor that
   * literally by running the check in an effect that fires on every prop
   * change, then guarding the main render below.
   */
  $effect(() => {
    if (!isoMonday || !DATE_RE.test(isoMonday) || !isValid(parseISO(isoMonday))) {
      navigate(`/week/${todayIsoMonday()}`, { replace: true });
    }
  });

  const validInput = $derived(
    !!isoMonday && DATE_RE.test(isoMonday) && isValid(parseISO(isoMonday)),
  );

  // We canonicalize whatever Monday-ish date came in to the actual ISO Monday
  // of its week. Bad input is short-circuited above; for "valid but not a
  // Monday" input we just quietly use the right Monday rather than redirect,
  // since the user's URL still semantically points at the right week.
  const monday = $derived.by(() =>
    validInput ? startOfISOWeek(parseISO(isoMonday)) : new Date(),
  );
  const mondayStr = $derived(format(monday, 'yyyy-MM-dd'));
  const sundayStr = $derived(format(addDays(monday, 6), 'yyyy-MM-dd'));

  const days = $derived(eachDayOfInterval({ start: monday, end: addDays(monday, 6) }));

  const today = new Date();

  // Body preview text keyed by YYYY-MM-DD. Refetched whenever the visible
  // week changes. Initial value is an empty map so the layout renders even
  // before Dexie returns.
  let bodies = $state<Record<string, string>>({});

  $effect(() => {
    const from = mondayStr;
    const to = sundayStr;
    let cancelled = false;
    void listEntries(from, to).then((entries: Entry[]) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const e of entries) next[e.date] = e.body;
      bodies = next;
    });
    return () => {
      cancelled = true;
    };
  });

  function handleMonthChange(newIsoMonday: string): void {
    navigate(`/week/${newIsoMonday}`);
  }

  function openDay(date: string): void {
    navigate(`/day/${date}`);
  }

  function isWeekend(d: Date): boolean {
    const dow = d.getDay();
    return dow === 0 || dow === 6;
  }

  function dateKey(d: Date): string {
    return format(d, 'yyyy-MM-dd');
  }

  // Russian header label (e.g. "Неделя 19, 2026") — small caption next to the
  // month name, mirroring the reference image's "Тиждень 19".
  const weekCaption = $derived(format(monday, "'Неделя' I, yyyy", { locale: ru }));
</script>

{#if validInput}
  <div class="week-view">
    <header class="topbar">
      <MonthPicker monday={mondayStr} onChange={handleMonthChange} />
      <span class="week-caption">{weekCaption}</span>
      <button type="button" class="dev-exit" onclick={clearToken}>Выйти</button>
    </header>

    <div class="spread">
      <!-- LEFT PAGE: Mon, Tue, Wed -->
      <section class="page page-left spiral-page paper">
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
            onclick={() => openDay(key)}
            aria-label={`Открыть день ${key}`}
          >
            <div class="tab-slot tab-slot-left">
              <DayTab date={key} isToday={today_} isWeekend={weekend_} side="left" />
            </div>
            <div class="preview" lang="ru">{bodies[key] ?? ''}</div>
          </button>
        {/each}
      </section>

      <SpiralBinding count={26} />

      <!-- RIGHT PAGE: Thu, Fri, then split row of Sat + Sun -->
      <section class="page page-right spiral-page paper">
        <button
          class="day-row side-right"
          type="button"
          onclick={() => openDay(dateKey(days[3]!))}
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
          <div class="preview" lang="ru">{bodies[dateKey(days[3]!)] ?? ''}</div>
        </button>

        <button
          class="day-row side-right"
          type="button"
          onclick={() => openDay(dateKey(days[4]!))}
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
          <div class="preview" lang="ru">{bodies[dateKey(days[4]!)] ?? ''}</div>
        </button>

        <!-- Bottom row, split into Sat (top half) and Sun (bottom half) -->
        <div class="day-row split-row is-last">
          <button
            class="day-half side-right"
            type="button"
            onclick={() => openDay(dateKey(days[5]!))}
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
            <div class="preview preview-half" lang="ru">{bodies[dateKey(days[5]!)] ?? ''}</div>
          </button>
          <button
            class="day-half side-right"
            type="button"
            onclick={() => openDay(dateKey(days[6]!))}
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
            <div class="preview preview-half" lang="ru">{bodies[dateKey(days[6]!)] ?? ''}</div>
          </button>
        </div>
      </section>
    </div>
  </div>
{/if}

<style>
  .week-view {
    min-height: 100vh;
    /* Soft warm gradient — keeps the reference image's "watercolor" feel
     * without committing to actual seasonal imagery (out of scope for v1). */
    background: linear-gradient(
      180deg,
      #f7efd9 0%,
      #f1e6c6 60%,
      #ead9b0 100%
    );
    padding: 14px 14px env(safe-area-inset-bottom, 16px);
    box-sizing: border-box;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 4px 4px 14px;
  }

  .week-caption {
    margin-left: auto;
    color: #5a4a26;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }

  .dev-exit {
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid rgba(70, 60, 35, 0.18);
    background: #fbf6e9;
    color: #2c2412;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .dev-exit:hover {
    background: #f3ecd8;
  }

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
  .day-row {
    position: relative;
    flex: 1 1 0;
    display: block;
    width: 100%;
    min-height: calc(var(--paper-line-height) * 3 + 12px);
    background: transparent;
    border: none;
    border-top: 1px dashed rgba(70, 60, 35, 0.12);
    padding: 10px 14px 10px 14px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    box-sizing: border-box;
    overflow: visible;
  }

  .day-row:first-child {
    border-top: none;
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

  /* Body preview, clipped to ~3 lines so longer notes don't blow up the
   * card. The serif-y voice is meant to feel like handwriting compared to
   * the sans-serif chrome. */
  .preview {
    margin-left: 6px;
    margin-right: 6px;
    padding-top: 2px;
    line-height: var(--paper-line-height);
    font-size: 14.5px;
    color: #2c2412;
    font-family: 'Georgia', 'Times New Roman', ui-serif, serif;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .preview-half {
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  /* The split row containing Sat (top half) + Sun (bottom half). Inherits
   * flex:1 from .day-row so it occupies the same vertical space as a full
   * row on the left page, then splits it in two. */
  .split-row {
    display: flex;
    flex-direction: column;
    padding: 0;
    min-height: 0;
  }

  .day-half {
    position: relative;
    flex: 1 1 0;
    width: 100%;
    background: transparent;
    border: none;
    border-top: 1px dashed rgba(70, 60, 35, 0.12);
    padding: 10px 14px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    box-sizing: border-box;
    overflow: visible;
  }

  .day-half:first-child {
    border-top: none;
  }

  @media (min-width: 700px) {
    .preview {
      font-size: 15px;
    }
  }
</style>
