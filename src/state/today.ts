import { readable } from 'svelte/store';

/**
 * "Today" that stays correct across midnight and backgrounding.
 * One clock for the whole app — WeekView/WeekSpread and MonthPicker must
 * not compute their own `new Date()` at mount time (v1 bug: stale highlight).
 */
export const today = readable(new Date(), (set) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    const now = new Date();
    set(now);
    const next = new Date(now);
    next.setHours(24, 0, 5, 0); // 5s past local midnight
    timer = setTimeout(arm, next.getTime() - now.getTime());
  };
  arm();

  const onVis = (): void => {
    if (document.visibilityState === 'visible') arm();
  };
  document.addEventListener('visibilitychange', onVis);

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
  };
});
