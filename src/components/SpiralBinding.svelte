<script lang="ts">
  /** SpiralBinding v2 — the rings are gone; only the spine line remains. */
</script>

<div class="spiral" aria-hidden="true">
  <div class="rod"></div>
</div>

<style>
  .spiral {
    position: relative;
    width: 36px; /* keeps the two-page gutter geometry unchanged */
  }
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
      rgba(70, 70, 60, 0.5) 50%,
      rgba(70, 70, 60, 0) 100%
    );
    pointer-events: none;
  }
</style>
