<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    index?: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    wide?: boolean;
  }
  let { title, index = '', onclose, children, footer, wide = false }: Props = $props();
  let el: HTMLDialogElement;

  $effect(() => {
    el.showModal();
    return () => el.close();
  });
</script>

<dialog
  bind:this={el}
  class:wide
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
  aria-labelledby="dlg-title"
>
  <header>
    {#if index}<span class="label">{index}</span>{/if}
    <h2 class="display-m" id="dlg-title">{title}</h2>
  </header>
  <div class="body">
    {@render children()}
  </div>
  {#if footer}
    <footer>{@render footer()}</footer>
  {/if}
</dialog>

<style>
  dialog {
    background: var(--panel);
    color: var(--ink);
    border: var(--stroke-hair) solid var(--line);
    padding: 0;
    width: min(640px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
  }
  dialog.wide {
    width: min(860px, calc(100vw - 32px));
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--ground) 85%, transparent);
  }
  header {
    padding: var(--space-3) var(--space-3) var(--space-2);
    border-bottom: var(--stroke-hair) solid var(--rule);
  }
  h2 {
    margin-top: var(--space-1);
  }
  .body {
    padding: var(--space-3);
    display: grid;
    gap: var(--space-3);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-3);
    border-top: var(--stroke-hair) solid var(--rule);
    position: sticky;
    bottom: 0;
    background: var(--panel);
  }
</style>
