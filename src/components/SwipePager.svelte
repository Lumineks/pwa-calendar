<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    prev?: Snippet;
    current: Snippet;
    next?: Snippet;
    onNavigate: (dir: -1 | 1) => void;
    onBeforeSettle?: () => Promise<void>;
  }
  let { prev, current, next, onNavigate, onBeforeSettle }: Props = $props();

  const EDGE_GUARD_PX = 28;
  const LOCK_DX = 8;
  const LOCK_RATIO = 1.7;
  const NAV_FRACTION = 0.35;
  const NAV_VELOCITY = 0.5; // px/ms

  let viewport: HTMLDivElement;
  let offset = $state(0);        // px, finger-follow
  let animating = $state(false); // CSS transition on when true

  let tracking = false;
  let locked: 'h' | 'v' | null = null;
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let settled = true;

  function width(): number {
    return viewport?.clientWidth ?? window.innerWidth;
  }

  async function onTouchStart(e: TouchEvent): Promise<void> {
    if (animating || e.touches.length !== 1) return;
    const t = e.touches[0]!;
    // Suppress the OS edge-swipe (back/forward) for touches starting at the
    // screen edges. Requires {passive:false} — Safari defaults touchstart to
    // passive and silently ignores preventDefault otherwise.
    if (t.clientX < EDGE_GUARD_PX || t.clientX > window.innerWidth - EDGE_GUARD_PX) {
      e.preventDefault();
    }
    tracking = true;
    locked = null;
    startX = t.clientX;
    startY = t.clientY;
    startT = e.timeStamp;
    settled = onBeforeSettle === undefined;
  }

  function onTouchMove(e: TouchEvent): void {
    if (!tracking) return;
    const t = e.touches[0]!;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (locked === null) {
      if (Math.abs(dx) > LOCK_DX && Math.abs(dx) > LOCK_RATIO * Math.abs(dy)) {
        locked = 'h';
        if (!settled && onBeforeSettle) {
          // Blur/keyboard settle runs once per gesture; finger keeps tracking.
          settled = true;
          void onBeforeSettle();
        }
      } else if (Math.abs(dy) > LOCK_DX) {
        locked = 'v';
      }
    }
    if (locked !== 'h') return;
    e.preventDefault();
    // Rubber-band when there's no panel in that direction.
    const hasTarget = dx > 0 ? prev !== undefined : next !== undefined;
    offset = hasTarget ? dx : dx * 0.25;
  }

  function onTouchEnd(e: TouchEvent): void {
    if (!tracking) return;
    tracking = false;
    if (locked !== 'h') {
      offset = 0;
      return;
    }
    const dx = offset;
    const dt = Math.max(1, e.timeStamp - startT);
    const velocity = Math.abs(dx) / dt;
    const dir: -1 | 1 = dx > 0 ? -1 : 1; // drag right → previous
    const hasTarget = dx > 0 ? prev !== undefined : next !== undefined;
    const commit =
      hasTarget && (Math.abs(dx) > width() * NAV_FRACTION || velocity > NAV_VELOCITY);

    animating = true;
    if (commit) {
      offset = dx > 0 ? width() : -width();
      const done = (): void => {
        animating = false;
        offset = 0;
        onNavigate(dir);
      };
      setTimeout(done, 220); // matches the CSS transition duration
    } else {
      offset = 0;
      setTimeout(() => { animating = false; }, 220);
    }
  }

  // Svelte 5's inline ontouch* attributes cannot guarantee {passive:false} —
  // touchstart/touchmove must be non-passive so preventDefault() actually
  // suppresses the OS edge-swipe and vertical scroll during a locked drag.
  // addEventListener with an explicit passive:false is the only reliable way.
  $effect(() => {
    const el = viewport;
    const ts = (e: TouchEvent) => void onTouchStart(e);
    const tm = (e: TouchEvent) => onTouchMove(e);
    const te = (e: TouchEvent) => onTouchEnd(e);
    el.addEventListener('touchstart', ts, { passive: false });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
    };
  });
</script>

<div bind:this={viewport} class="pager">
  <div
    class={['track', animating && 'is-animating']}
    style={`transform: translateX(calc(-100% + ${offset}px))`}
  >
    <div class="panel">{#if prev}{@render prev()}{/if}</div>
    <div class="panel">{@render current()}</div>
    <div class="panel">{#if next}{@render next()}{/if}</div>
  </div>
</div>

<style>
  .pager {
    overflow: hidden;
    width: 100%;
    height: 100%;
    touch-action: pan-y; /* we handle horizontal; vertical stays native */
  }
  .track {
    display: flex;
    width: 300%;
    height: 100%;
  }
  .track.is-animating {
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .panel {
    width: calc(100% / 3);
    flex: 0 0 calc(100% / 3);
    height: 100%;
    overflow: hidden;
  }
</style>
