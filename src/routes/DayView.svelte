<script lang="ts">
  import { onDestroy } from 'svelte';
  import { navigate } from 'svelte-routing';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import {
    parseISO,
    isValid,
    format,
    startOfISOWeek,
    getISODay,
  } from 'date-fns';
  import { ru } from 'date-fns/locale';
  import { getEntry, putEntry } from '../data/db.ts';
  import { debounce } from '../data/util.ts';

  /**
   * DayView — fullscreen editor for a single date, rendered on lined paper.
   *
   * Lifecycle / data flow:
   *   1. `date` prop comes in via svelte-routing's <Route let:params>.
   *   2. We validate the format and isValid() once per `date` change. If
   *      invalid, we redirect (replace:true) to the current ISO week and the
   *      main render short-circuits via {#if validInput}.
   *   3. On a valid `date`, we load the body from Dexie via the repo.
   *   4. Every input schedules a 300ms-debounced putEntry(date, body). The
   *      debounce closure reads `date` and `body` at flush time, which avoids
   *      util.ts/flush(...args)'s signature (which takes NEW args, not pending
   *      ones — see src/data/util.ts).
   *   5. On unmount we flush ONLY IF there's a pending edit. util.ts/flush
   *      fires fn unconditionally, so a naive flush would spam Dexie with a
   *      no-op write every time a day is opened-then-closed without editing
   *      (and Phase 6 would propagate that to KV). The pendingSave guard
   *      preserves PLAN.md's stated goal "so an in-flight debounce isn't lost"
   *      while skipping spurious writes.
   */

  interface Props {
    date: string;
  }

  let { date }: Props = $props();

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const validInput = $derived(
    !!date && DATE_RE.test(date) && isValid(parseISO(date)),
  );

  // Derivations that depend on a (validated) date.
  const parsed = $derived(validInput ? parseISO(date) : new Date());
  const isoMondayOfDate = $derived(
    format(startOfISOWeek(parsed), 'yyyy-MM-dd'),
  );

  /**
   * Russian-formatted date header, e.g. "Понедельник, 11 мая".
   * date-fns/ru returns lowercase weekday names ("понедельник"), so we
   * capitalize the first character to match journal-header convention.
   */
  const russianDate = $derived.by(() => {
    if (!validInput) return '';
    const formatted = format(parsed, 'EEEE, d MMMM', { locale: ru });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  });

  /**
   * Transition direction inferred from the day-of-week's column in WeekView:
   *   Mon/Tue/Wed (ISO day 1-3, left page)   → fly in from x:-40
   *   Thu/Fri/Sat/Sun (ISO day 4-7, right)   → fly in from x:+40
   * This approximates "tab expands to full page" without a true FLIP morph.
   */
  const flyX = $derived(validInput && getISODay(parsed) <= 3 ? -40 : 40);

  // ---- Editor state ----

  let body = $state('');
  type SaveState = 'saved' | 'saving' | 'error';
  let saveState = $state<SaveState>('saved');
  let pendingSave = $state(false);

  const SAVE_LABEL: Record<SaveState, string> = {
    saved: 'Сохранено',
    saving: 'Сохраняется…',
    error: 'Ошибка сохранения',
  };

  /**
   * Debounced save. Constructed ONCE per component instance. The arrow
   * closes over the reactive `date` and `body` runes, so each flush reads
   * the LATEST values — sidestepping util.ts/flush's (...newArgs) signature.
   */
  const save = debounce(() => {
    pendingSave = false;
    saveState = 'saving';
    putEntry(date, body)
      .then(() => {
        saveState = 'saved';
      })
      .catch(() => {
        saveState = 'error';
      });
  }, 300);

  /**
   * Load the body from Dexie whenever `date` changes (including initial
   * mount). Cleanup cancels any in-flight load (so a slow Dexie response for
   * the previous date can't clobber the new one) and cancels any pending
   * debounced save for the previous date.
   */
  $effect(() => {
    if (!validInput) return;
    const target = date;
    let cancelled = false;
    void getEntry(target).then((entry) => {
      if (cancelled) return;
      body = entry?.body ?? '';
      saveState = 'saved';
      pendingSave = false;
    });
    return () => {
      cancelled = true;
      save.cancel();
      pendingSave = false;
    };
  });

  function onInput(): void {
    if (!validInput) return;
    pendingSave = true;
    saveState = 'saving';
    save();
  }

  function goBack(): void {
    navigate(`/week/${isoMondayOfDate}`);
  }

  onDestroy(() => {
    if (pendingSave) save.flush();
  });
</script>

{#if validInput}
  <div
    class="day-view"
    transition:fly={{ x: flyX, duration: 220, easing: quintOut }}
  >
    <header class="header">
      <button type="button" class="back" onclick={goBack} aria-label="Назад">
        <span aria-hidden="true">←</span>
        <span>Назад</span>
      </button>
      <h1 class="date" lang="ru">{russianDate}</h1>
      <span
        class={['save-indicator', `state-${saveState}`]}
        aria-live="polite"
        role="status"
      >
        {SAVE_LABEL[saveState]}
      </span>
    </header>

    <textarea
      class="paper editor"
      lang="ru"
      bind:value={body}
      oninput={onInput}
      aria-label="Запись на день"
      placeholder=""
    ></textarea>
  </div>
{/if}

<style>
  /* Root fills the viewport so the textarea below can grow to fill the
   * remaining height. flex column = header band + flexible editor pane. */
  .day-view {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--paper-fill, #fbf6e9);
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #2c2412;
  }

  /* Header band: three-column grid keeps the date perfectly centered even
   * when the right-side save indicator label changes width. */
  .header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
    padding:
      calc(env(safe-area-inset-top, 0px) + 10px)
      14px
      10px
      14px;
    background: rgba(251, 246, 233, 0.92);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    border-bottom: 1px solid rgba(70, 60, 35, 0.12);
    box-shadow: 0 1px 0 rgba(70, 60, 35, 0.04);
    z-index: 2;
  }

  .back {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 1px solid rgba(70, 60, 35, 0.18);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 14px;
    font-weight: 600;
    color: #2c2412;
    cursor: pointer;
    transition: background 120ms ease;
  }

  .back:hover {
    background: rgba(70, 60, 35, 0.06);
  }

  .back:focus-visible {
    outline: 2px solid #c43c3c;
    outline-offset: 2px;
  }

  .date {
    justify-self: center;
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.2px;
    color: #2c2412;
    /* The grid centers it; truncate gracefully on narrow phones. */
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .save-indicator {
    justify-self: end;
    font-size: 12px;
    font-weight: 600;
    color: #5a4a26;
    /* Reserve some right-side width so the layout doesn't jiggle as the
     * label switches between "Сохранено" and "Сохраняется…". */
    min-width: 84px;
    text-align: right;
    transition: color 120ms ease;
  }

  .state-saving {
    color: #8a6b1e;
  }

  .state-error {
    color: #b73535;
  }

  /* Textarea — the heart of Phase 4.
   *
   *   line-height: var(--paper-line-height)
   *       Each typed line occupies exactly one paper-line slice (28px by
   *       default), so subsequent lines stay aligned to the rules.
   *
   *   font-size: 16px
   *       The iOS Safari auto-zoom floor. Anything smaller triggers a zoom
   *       on focus on mobile Safari. 16px also pairs visually with 28px
   *       (1.75 line-height ratio).
   *
   *   padding-top: 9px
   *       Calibrated so the first text baseline sits on the first paper
   *       rule. The paper background paints the rule at y=27 of each 28px
   *       slice; with line-height: 28px and a 16px system-ui font the
   *       baseline sits ~18px from the line-box top, so a 9px push aligns
   *       it with the rule.
   */
  .editor {
    flex: 1 1 auto;
    width: 100%;
    box-sizing: border-box;
    margin: 0;
    padding:
      9px
      18px
      calc(env(safe-area-inset-bottom, 0px) + 16px)
      18px;
    border: 0;
    outline: 0;
    color: #2c2412;
    font-family: 'Georgia', 'Times New Roman', ui-serif, serif;
    font-size: 16px;
    line-height: var(--paper-line-height);
    resize: none;
    /* IMPORTANT: do not set the `background` shorthand here. The global
     * `.paper` class in src/styles/paper.css supplies both the paper-fill
     * background-color AND the repeating-linear-gradient that draws the
     * horizontal rules. Setting `background: transparent` (or any other
     * shorthand value) on .editor wipes out background-image and the lines
     * disappear. */
  }

  .editor:focus-visible {
    /* Inset focus ring — keeps the lined background visible underneath
     * while still announcing keyboard focus. */
    outline: 2px solid rgba(196, 60, 60, 0.6);
    outline-offset: -2px;
  }

  /* Empty-state placeholder color (browsers vary; keep it subtle). */
  .editor::placeholder {
    color: rgba(70, 60, 35, 0.3);
  }
</style>
