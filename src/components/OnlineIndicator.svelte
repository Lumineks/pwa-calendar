<script lang="ts">
  /**
   * Tiny header indicator. Visible only when the browser reports offline:
   * a muted gray dot + Russian "офлайн" label.
   *
   * navigator.onLine is a heuristic — a true round-trip would be more
   * accurate but is overkill for a header indicator. The sync layer makes
   * the real decision via fetch outcomes.
   */

  let online = $state(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  function syncOnline(): void {
    online = navigator.onLine;
  }
</script>

<svelte:window
  ononline={syncOnline}
  onoffline={syncOnline}
/>

{#if !online}
  <span class="offline" role="status" aria-live="polite">
    <span class="dot" aria-hidden="true"></span>
    <span class="label">офлайн</span>
  </span>
{/if}

<style>
  .offline {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(90, 74, 38, 0.08);
    color: #5a4a26;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.2px;
    line-height: 1;
    user-select: none;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #a08962;
    box-shadow: 0 0 0 1px rgba(70, 60, 35, 0.15);
  }
</style>
