<script lang="ts">
  /**
   * SpiralBinding — pure CSS column of binder rings.
   *
   * Renders a vertical stack of `count` rings that visually suggests a wire-O
   * spiral. The component owns no layout of its own (height = parent), so it
   * sits naturally between two `.spiral-page` siblings in WeekView.
   */
  let { count = 26 }: { count?: number } = $props();

  const rings = $derived(Array.from({ length: count }, (_, i) => i));
</script>

<div class="spiral" aria-hidden="true">
  <div class="rod"></div>
  {#each rings as i (i)}
    <div class="ring"></div>
  {/each}
</div>

<style>
  .spiral {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    width: 36px;
    padding: 6px 0;
    /* Centered between the two pages of the weekly spread. */
  }

  /* A subtle dark vertical bar behind the rings to suggest the wire passing
   * behind the page edges. */
  .rod {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    transform: translateX(-50%);
    background: linear-gradient(
      to right,
      rgba(70, 70, 60, 0) 0%,
      rgba(70, 70, 60, 0.35) 50%,
      rgba(70, 70, 60, 0) 100%
    );
    pointer-events: none;
  }

  .ring {
    width: 22px;
    height: 12px;
    border-radius: 50%;
    /* Olive/dark khaki binder ring color, matching the reference image. */
    background: linear-gradient(
      to bottom,
      #6f6a3a 0%,
      #4a4626 45%,
      #2a2812 100%
    );
    box-shadow:
      inset 0 1.5px 1px rgba(255, 255, 255, 0.22),
      inset 0 -1.5px 1.5px rgba(0, 0, 0, 0.55),
      0 1px 1.5px rgba(0, 0, 0, 0.35);
    flex-shrink: 0;
  }
</style>
