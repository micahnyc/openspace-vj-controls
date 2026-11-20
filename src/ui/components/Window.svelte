<script lang="ts">
  /**
   * A numbered section of the page (01-09): collapses from its header, closes
   * with ✕ (reopen from the PANELS menu on the title), outlined in the panel gray.
   */
  import type { Snippet } from 'svelte';
  import { PANELS, panels, type PanelId } from '../panels.svelte';

  interface Props {
    id: PanelId;
    children: Snippet;
    /** Optional readout shown at the right of the header (counts, status). */
    meta?: Snippet;
  }
  let { id, children, meta }: Props = $props();
  const info = $derived(PANELS.find((p) => p.id === id)!);
</script>

{#if !panels.isHidden(id)}
  <details class="window" id="panel-{id}" bind:open={panels.expanded[id]}>
    <summary class="label">
      <span class="title">{info.index} / {info.title}</span>
      {#if meta}<span class="meta">{@render meta()}</span>{/if}
      <button
        type="button"
        class="close"
        aria-label="Close {info.title} (reopen from the menu on the title)"
        title="Close (reopen from the menu on the title)"
        onclick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          panels.hide(id);
        }}>✕</button
      >
    </summary>
    <div class="content">
      {@render children()}
    </div>
  </details>
{/if}

<style>
  .window {
    background: transparent;
    border: var(--stroke-hair) solid var(--panel);
    min-width: 0;
  }
  summary {
    cursor: pointer;
    padding: var(--space-2) var(--space-3);
    min-height: var(--row-h);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::before {
    content: '+';
    font-family: var(--font-mono);
    width: 1ch;
  }
  .window[open] > summary::before {
    content: '−';
  }
  .window[open] > summary {
    border-bottom: var(--stroke-hair) solid var(--panel);
  }
  .title {
    flex: 1;
  }
  .meta {
    text-transform: none;
    letter-spacing: 0;
  }
  .close {
    height: 28px;
    padding: 0 var(--space-2);
    font-size: 12px;
    background: transparent;
    border-color: transparent;
    color: var(--ink-muted);
  }
  .close:hover {
    border-color: var(--line);
    color: var(--ink);
  }
  /* Content components keep their own padding; the window draws the only frame. */
  .content :global(.panel) {
    border: 0;
  }
  .content > :global(:not(.panel)) {
    margin: var(--space-3);
  }
</style>
