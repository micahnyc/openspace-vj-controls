<script lang="ts">
  /** Segmented LED meter (Neon Flat motif): raised blocks, lit in the role color. */
  interface Props {
    value: number;
    segments?: number;
    role?: 'audio' | 'bpm' | 'midi';
    label?: string;
    /** Optional marker (e.g. EQ threshold) 0..1. */
    marker?: number;
  }
  let { value, segments = 16, role = 'audio', label = '', marker }: Props = $props();
  const lit = $derived(Math.round(Math.max(0, Math.min(1, value)) * segments));
  const markAt = $derived(marker === undefined ? -1 : Math.round(marker * segments) - 1);
</script>

<div class="meter" role="meter" aria-label={label} aria-valuemin="0" aria-valuemax="1" aria-valuenow={value}>
  {#each Array(segments) as _, i}
    <span class="seg" class:lit={i < lit} class:mark={i === markAt} style:--c="var(--{role})"></span>
  {/each}
</div>

<style>
  .meter {
    display: flex;
    flex-direction: column-reverse;
    gap: 2px;
    height: 100%;
    min-height: 64px;
    width: 14px;
  }
  .seg {
    flex: 1;
    background: var(--raised);
    border-radius: var(--radius-1);
  }
  .seg.lit {
    background: var(--c);
  }
  .seg.mark {
    outline: var(--stroke-hair) solid var(--ink);
  }
</style>
