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
  import { getEntry, putEntry, type Entry } from '../data/db.ts';
  import { onEntryUpdated } from '../data/sync.ts';
  import { debounce } from '../data/util.ts';
  import { toEditorHtml, isEmptyHtml } from '../data/sanitize.ts';
  import { PALETTE } from '../data/palette.ts';
  import { MAX_BODY_BYTES, utf8ByteLength } from '../data/limits.ts';
  import type RichEditor from '../components/RichEditor.svelte';

  /**
   * DayView — fullscreen editor for a single date, rendered on lined paper.
   *
   * Lifecycle / data flow:
   *   1. `date` prop comes in via svelte-routing's <Route let:params>.
   *   2. We validate the format and isValid() once per `date` change. If
   *      invalid, we redirect (replace:true) to the current ISO week and the
   *      main render short-circuits via {#if validInput}.
   *   3. On a valid `date`, we load the entry from Dexie and convert it to
   *      editor HTML via toEditorHtml() — sanitized for `format: 'html'`
   *      rows, escaped-and-wrapped for LEGACY plain-text rows. Loading never
   *      writes, so opening a legacy entry does NOT silently upgrade it.
   *   4. Every editor update schedules a 300ms-debounced
   *      putEntry(date, bodyHtml, 'html'). The debounce closure reads `date`
   *      and `bodyHtml` at flush time, which avoids util.ts/flush(...args)'s
   *      signature (which takes NEW args, not pending ones — see
   *      src/data/util.ts).
   *   5. On unmount we flush ONLY IF there's a pending edit. util.ts/flush
   *      fires fn unconditionally, so a naive flush would spam Dexie with a
   *      no-op write every time a day is opened-then-closed without editing
   *      (and Phase 6 would propagate that to KV). The pendingSave guard
   *      preserves PLAN.md's stated goal "so an in-flight debounce isn't lost"
   *      while skipping spurious writes.
   *
   * v2 note — why `bodyHtml` is the authoritative mirror and not the editor:
   *   RichEditor is lazily imported and keyed by `date`, so the tiptap
   *   instance is destroyed and rebuilt on every navigation. Anything we
   *   needed to read OUT of the editor at teardown time would already be
   *   gone. Instead the editor pushes each transaction up through
   *   `handleEditorUpdate`, which mirrors it into `bodyHtml` synchronously —
   *   so the last keystroke is always in `bodyHtml` before any teardown, and
   *   both flush paths (effect cleanup, onDestroy) persist from the mirror.
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

  /** Authoritative HTML mirror — survives editor teardown (see header note). */
  let bodyHtml = $state('');
  /** null until the entry loads; non-null mounts/keys the lazy editor. */
  let initialHtml = $state<string | null>(null);
  let richEditor = $state<RichEditor | null>(null);
  let activePen = $state<string>(PALETTE[0].css);

  type SaveState = 'saved' | 'saving' | 'error';
  let saveState = $state<SaveState>('saved');
  /** '' or 'Слишком длинная запись' — takes over the indicator when set. */
  let saveError = $state('');
  let pendingSave = $state(false);

  const SAVE_LABEL: Record<SaveState, string> = {
    saved: 'Сохранено',
    saving: 'Сохраняется…',
    error: 'Ошибка сохранения',
  };

  /**
   * Label and tone MUST derive from the same condition. Deriving the text from
   * `saveError` while the class stayed `state-${saveState}` let the indicator
   * render «Слишком длинная запись» in the *success* colour: once an armed
   * debounce committed the last within-limit content, `saveState` went back to
   * 'saved' while `saveError` was still set.
   */
  const saveTone = $derived<SaveState>(saveError !== '' ? 'error' : saveState);
  const saveLabel = $derived(saveError !== '' ? saveError : SAVE_LABEL[saveState]);

  /**
   * Debounced save. Constructed ONCE per component instance. The arrow
   * closes over the reactive `date` and `bodyHtml` runes, so each flush reads
   * the LATEST values — sidestepping util.ts/flush's (...newArgs) signature.
   *
   * The empty body deliberately gets NO format marker: an empty entry has no
   * markup to interpret, and stamping it 'html' would needlessly diverge from
   * what the worker/legacy rows look like.
   */
  const save = debounce(() => {
    pendingSave = false;
    saveState = 'saving';
    putEntry(date, bodyHtml, bodyHtml === '' ? undefined : 'html')
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
   * the previous date can't clobber the new one) AND eagerly flushes any
   * pending debounced save for the previous date.
   *
   * Audit 1 (decision 4e) flagged this cleanup as a data-loss risk once
   * Phase 6 ships: the old implementation called `save.cancel()`, which
   * silently dropped uncommitted text from the previous date. Because Dexie
   * never saw the write, markDirty was never called either, so the sync
   * layer also wouldn't carry the change to KV — local + remote loss.
   *
   * Fix: capture `target` (the OLD date) at effect setup so the cleanup
   * closure can persist it directly. We do NOT call `save.flush()` because
   * util.ts's flush takes `(...newArgs)` and our `save` closure ignores its
   * args entirely (it reads the LATEST reactive `date`/`body` — which by
   * cleanup time have already advanced to the NEW date). Direct putEntry
   * with the captured prev values is the unambiguous fix.
   */
  $effect(() => {
    if (!validInput) return;
    const target = date;
    let cancelled = false;
    // Unmount the editor for the duration of the load so the keyed {#await}
    // block can never show the PREVIOUS date's document under the new header.
    initialHtml = null;
    void getEntry(target).then((entry: Entry | undefined) => {
      if (cancelled) return;
      const html = toEditorHtml(entry);
      bodyHtml = html;
      initialHtml = html; // mounts/keys the editor
      saveState = 'saved';
      saveError = '';
      pendingSave = false;
    });
    return () => {
      cancelled = true;
      if (pendingSave) {
        // Capture the OLD date+html before the cleanup returns — by the time
        // this closure runs, `date` may already point at the NEW route, but
        // `bodyHtml` still holds what the user typed into the OLD date (we
        // have not yet awaited the new getEntry load above for the new
        // target).
        const prevDate = target;
        const prevHtml = bodyHtml;
        save.cancel();
        pendingSave = false;
        // Fire-and-forget. markDirty (inside putEntry) queues for sync.
        void putEntry(prevDate, prevHtml, prevHtml === '' ? undefined : 'html');
      }
    };
  });

  /**
   * B4 — live refresh of the open DayView when a server-originated write
   * lands for THIS date (pull() reconciliation or the 409-push LWW takeover
   * in sync.ts's applyServerEntry). Dexie writes are invisible to Svelte
   * state on their own, so without this the editor would keep showing a
   * stale local copy until the next navigation.
   *
   * Ordering matters and must NOT be reshuffled:
   *   1. Composing — never touch the DOM mid-composition (iOS Russian
   *      predictive input can be mid-IME-composition when the update
   *      arrives). Defer via onNextCompositionEnd instead of swapping now.
   *   2. Focused — the user is actively typing; their copy wins locally and
   *      LWW resolves the divergence on the next push. Do NOT swap.
   *   3. Otherwise safe to swap: cancel any queued save and clear
   *      pendingSave BEFORE writing the new content, so a navigation
   *      immediately after can't resurrect the now-stale mirror (via the
   *      load effect's cleanup flush) over the fresh server value.
   *      setContentSilently uses `{ emitUpdate: false }`, so this produces
   *      no onUpdate → no PUT echo back to the server.
   */
  async function refreshFromServerCopy(): Promise<void> {
    const ed = richEditor;
    if (!ed) return;
    if (ed.isComposing()) {
      // Never touch the DOM mid-composition (iOS Russian predictive input).
      ed.onNextCompositionEnd(() => void refreshFromServerCopy());
      return;
    }
    if (ed.isFocused()) return; // user is typing — their copy wins; next push resolves via LWW
    const entry = await getEntry(date);
    const html = toEditorHtml(entry);
    // Clear any queued save of the now-stale mirror BEFORE swapping, so a
    // navigation right after this can't resurrect the old value with a new
    // updatedAt.
    save.cancel();
    pendingSave = false;
    bodyHtml = html;
    ed.setContentSilently(html);
    saveState = 'saved';
  }

  /**
   * Subscribes to onEntryUpdated for as long as `date` is valid, re-firing
   * (and re-subscribing) whenever `date` changes. `target` is captured at
   * effect-setup time so a notification for a DIFFERENT date that arrives
   * after navigation — the callback is still the old closure until Svelte
   * reruns this effect — is compared against the date this subscription was
   * set up for, not whatever `date` happens to be when the callback fires.
   * The returned `off` unsubscribes on date change and on unmount alike,
   * since Svelte effect cleanups run for both.
   */
  $effect(() => {
    if (!validInput) return;
    const target = date;
    const off = onEntryUpdated((d) => {
      if (d === target) void refreshFromServerCopy();
    });
    return off;
  });

  /**
   * Called by RichEditor on every ProseMirror transaction.
   *
   * Byte-limit rule: an oversize document must NEVER enter the dirty set —
   * neither via the debounce nor via either flush path. So we bail BEFORE
   * touching `bodyHtml`/`pendingSave`; the mirror keeps the last
   * within-limit document, and any already-armed debounce for it still
   * commits that (correct) content. Deleting back under the limit produces a
   * fresh update and clears the error.
   *
   * HOT PATH — this runs inside ProseMirror's dispatch on every keystroke, so
   * it must stay cheap. Emptiness comes from `richEditor.isEmpty()` (tiptap's
   * O(1) check on the live doc), NOT from `isEmptyHtml(html)`, which would
   * re-run two DOMPurify passes plus a DOMParser parse over the whole
   * document on every keypress — worst exactly after a multi-megabyte paste,
   * while the user is deleting back under the limit. `isEmptyHtml` stays as
   * the fallback for the (unreachable in practice) window where the
   * `bind:this` handle isn't set yet.
   */
  function handleEditorUpdate(html: string): void {
    if (!validInput) return;
    const empty = richEditor ? richEditor.isEmpty() : isEmptyHtml(html);
    const normalized = empty ? '' : html;
    if (utf8ByteLength(normalized) > MAX_BODY_BYTES) {
      saveState = 'error';
      saveError = 'Слишком длинная запись';
      return; // do not queue — an oversize entry must never enter the dirty set
    }
    saveError = '';
    bodyHtml = normalized;
    pendingSave = true;
    saveState = 'saving';
    save();
  }

  /** Pen picking is bound to `pointerup` in the template (never `click`) —
   * see the tiptap#7514 constraint in the plan. */
  function pickPen(css: string): void {
    activePen = css;
    richEditor?.applyPen(css);
  }

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  function goBack(): void {
    navigate(`${base}/week/${isoMondayOfDate}`);
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
        class={['save-indicator', `state-${saveTone}`]}
        aria-live="polite"
        role="status"
      >
        {saveLabel}
      </span>
    </header>

    <div class="palette" role="toolbar" aria-label="Цвет текста">
      {#each PALETTE as pen (pen.id)}
        <!-- `pointerup` is the pointer path (see .palette in <style>). Enter
             and Space synthesize `click`, which nothing here handles, so the
             keyboard path is wired explicitly rather than by re-adding
             `onclick`. -->
        <button
          type="button"
          class={['pen', activePen === pen.css && 'is-active']}
          style={`--pen: ${pen.css}`}
          aria-label={pen.label}
          aria-pressed={activePen === pen.css}
          onpointerup={() => pickPen(pen.css)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pickPen(pen.css);
            }
          }}
        ></button>
      {/each}
    </div>

    <div class="paper editor-pane">
      {#if initialHtml !== null}
        {#key date}
          {#await import('../components/RichEditor.svelte') then mod}
            <mod.default
              bind:this={richEditor}
              initialHtml={initialHtml}
              onUpdate={handleEditorUpdate}
            />
          {/await}
        {/key}
      {/if}
    </div>
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

  /* Pen palette — the six colours from src/data/palette.ts.
   *
   * Every dot binds `pointerup`, NOT `click`: on the target device a
   * `click`-driven selection change races tiptap's own pointer handling
   * (tiptap#7514). The B2 spike could not reproduce the bug on 3.30.5, but
   * the plan keeps the constraint because pointerup is also what makes
   * "select a word → tap a pen" work without the selection collapsing first. */
  .palette {
    display: flex;
    gap: 10px;
    padding: 6px 14px;
    background: rgba(251, 246, 233, 0.92);
    border-bottom: 1px solid rgba(70, 60, 35, 0.12);
  }

  .pen {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid rgba(70, 60, 35, 0.18);
    background: var(--pen);
    cursor: pointer;
    padding: 0;
  }

  .pen.is-active {
    border-color: #2c2412;
    box-shadow: 0 0 0 2px rgba(44, 36, 18, 0.25);
  }

  .pen:focus-visible {
    outline: 2px solid #c43c3c;
    outline-offset: 2px;
  }

  /* Editor pane — the lined paper the tiptap surface sits on.
   *
   *   font-size: 16px  ← MUST NOT be lowered.
   *       The iOS Safari auto-zoom floor. Anything below 16px triggers a
   *       pinch-zoom on focus in mobile Safari. RichEditor's own
   *       .rich-editor-content restates 16px so neither layer can drift.
   *
   *   line-height: var(--paper-line-height)
   *       Each typed line occupies exactly one paper-line slice; RichEditor
   *       restates it on the content root and on <p> (whose margins are
   *       zeroed) so paragraphs land on the rules.
   *
   *   --editor-pad-top
   *       Baseline calibration for the system font, consumed by
   *       .rich-editor-content's padding-top. Task B7 re-measures it; 2px is
   *       the starting value.
   *
   * IMPORTANT: do not set the `background` shorthand here. The global
   * `.paper` class in src/styles/paper.css supplies both the paper-fill
   * background-color AND the repeating-linear-gradient that draws the
   * horizontal rules. Setting `background: transparent` (or any other
   * shorthand value) wipes out background-image and the lines disappear. */
  .editor-pane {
    flex: 1 1 auto;
    display: flex;
    overflow: hidden;
    width: 100%;
    box-sizing: border-box;
    --editor-pad-top: 2px;
    font-size: 16px;
    line-height: var(--paper-line-height);
    color: #2c2412;
  }
</style>
