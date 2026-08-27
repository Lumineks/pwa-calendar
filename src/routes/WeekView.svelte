<script lang="ts">
  import { navigate } from 'svelte-routing';
  import { parseISO, isValid, format, addDays, startOfISOWeek } from 'date-fns';
  import { ru } from 'date-fns/locale';
  import { clearToken } from '../state/auth.ts';
  import { listEntries, type Entry } from '../data/db.ts';
  import MonthPicker from '../components/MonthPicker.svelte';
  import WeekSpread from '../components/WeekSpread.svelte';
  import OnlineIndicator from '../components/OnlineIndicator.svelte';
  import { setViewAnchor } from '../data/sync.ts';
  import { sanitizeHtml, plainToHtml } from '../data/sanitize.ts';
  import { base } from '../lib/base.ts';

  interface Props {
    isoMonday: string;
  }

  let { isoMonday }: Props = $props();

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const today = new Date();

  function previewHtmlFor(entry: Entry): string {
    if (entry.format === 'html') return sanitizeHtml(entry.body);
    // legacy plain text: escape + preserve line breaks
    return plainToHtml(entry.body);
  }

  // Body preview HTML (already sanitized) keyed by YYYY-MM-DD. Refetched
  // whenever the visible week changes. Initial value is an empty map so the
  // layout renders even before Dexie returns.
  let previews = $state<Record<string, string>>({});

  $effect(() => {
    const from = mondayStr;
    const to = sundayStr;
    let cancelled = false;
    void listEntries(from, to).then((entries: Entry[]) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const e of entries) next[e.date] = previewHtmlFor(e);
      previews = next;
    });
    return () => {
      cancelled = true;
    };
  });

  // Pull window follows the viewed week (audit E3 — neighbours must fill).
  $effect(() => {
    setViewAnchor(mondayStr);
  });

  // Prefetch the editor chunk during idle so opening a day is instant.
  let prefetched = false;
  $effect(() => {
    if (prefetched) return;
    prefetched = true;
    const idle: (cb: () => void) => unknown =
      'requestIdleCallback' in window
        ? (cb) => (window as Window & { requestIdleCallback: (c: () => void) => number }).requestIdleCallback(cb)
        : (cb) => setTimeout(cb, 1500);
    idle(() => { void import('../components/RichEditor.svelte'); });
  });

  function handleMonthChange(newIsoMonday: string): void {
    navigate(`${base}/week/${newIsoMonday}`);
  }

  function openDay(date: string): void {
    navigate(`${base}/day/${date}`);
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
      <OnlineIndicator />
      <button type="button" class="dev-exit" onclick={clearToken}>Выйти</button>
    </header>

    <WeekSpread monday={monday} {previews} onOpenDay={openDay} {today} />
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
    padding: 14px 0 14px;
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
</style>
