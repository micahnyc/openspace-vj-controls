<script lang="ts">
  import { discovery } from '../../openspace/discovery.svelte';
  import DiscoveryStatus from './DiscoveryStatus.svelte';
  import { matchesQuery, type ActionEntry } from '../../core/discovery';

  interface Props {
    /** Already chosen action ids (shown above the search). */
    chosen: string[];
    onpick: (a: ActionEntry) => void;
    onremove?: (index: number) => void;
    onmove?: (index: number, dir: -1 | 1) => void;
    multiple?: boolean;
  }
  let { chosen, onpick, onremove, onmove, multiple = false }: Props = $props();

  let query = $state('');
  const matches = $derived(
    query.trim()
      ? discovery.actions.filter((a) => matchesQuery(`${a.name} ${a.identifier} ${a.guiPath}`, query)).slice(0, 80)
      : [],
  );
  const byId = $derived(new Map(discovery.actions.map((a) => [a.identifier, a])));
</script>

<div class="picker">
  <span class="label">{multiple ? 'ACTIONS, IN ORDER' : 'ACTION'}</span>
  {#if chosen.length}
    <ol class="chosen">
      {#each chosen as id, i (i)}
        {@const a = byId.get(id)}
        <li class:missing={discovery.actionsState === 'ready' && !a}>
          <span class="readout idx">{String(i + 1).padStart(2, '0')}</span>
          <span class="grow">
            <span>{a?.name ?? id}</span>
            <span class="readout muted">{id}</span>
          </span>
          {#if multiple && onmove}
            <button type="button" class="mini" onclick={() => onmove(i, -1)} disabled={i === 0} aria-label="Move up">UP</button>
            <button type="button" class="mini" onclick={() => onmove(i, 1)} disabled={i === chosen.length - 1} aria-label="Move down">DN</button>
          {/if}
          {#if onremove}
            <button type="button" class="mini" onclick={() => onremove(i)} aria-label="Remove">✕</button>
          {/if}
        </li>
      {/each}
    </ol>
    {#if discovery.actionsState === 'ready' && chosen.some((id) => !byId.has(id))}
      <p class="warn-text">Some actions aren't in this scene. The mapping turns on when they load.</p>
    {/if}
  {/if}
  {#if multiple || chosen.length === 0}
    <input
      type="search"
      placeholder="Search actions: fly to saturn"
      bind:value={query}
      disabled={discovery.actions.length === 0}
      aria-label="Search actions"
    />
    <DiscoveryStatus what="actions" />
  {:else}
    <input type="search" placeholder="Search to replace" bind:value={query} aria-label="Search actions" />
  {/if}
  {#if query.trim()}
    <ul class="results">
      {#each matches as a (a.identifier)}
        <li>
          <button
            type="button"
            class="row"
            title={a.documentation}
            onclick={() => {
              onpick(a);
              query = '';
            }}
          >
            <span>{a.name}</span>
            <span class="readout muted">{a.guiPath} · {a.identifier}</span>
          </button>
        </li>
      {:else}
        <li class="muted empty">No actions match.</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker {
    display: grid;
    gap: var(--space-2);
  }
  .chosen {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .chosen li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--raised);
    border: var(--stroke-hair) solid var(--midi);
  }
  .chosen li.missing {
    border-style: dashed;
    border-color: var(--warn);
  }
  .idx {
    color: var(--ink-muted);
  }
  .grow {
    flex: 1;
    display: grid;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .mini {
    height: 28px;
    padding: 0 var(--space-2);
    font-size: 12px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 240px;
    overflow-y: auto;
    border: var(--stroke-hair) solid var(--rule);
  }
  .row {
    display: grid;
    gap: 2px;
    width: 100%;
    height: auto;
    text-align: left;
    padding: var(--space-2);
    font-family: var(--font-sans);
    font-weight: 400;
    font-size: 15px;
    letter-spacing: 0;
    text-transform: none;
    border: 0;
    border-bottom: var(--stroke-hair) solid var(--rule);
  }
  .row:hover,
  .row:focus-visible {
    background: var(--panel);
  }
  .empty {
    padding: var(--space-2);
  }
  .warn-text {
    color: var(--warn);
    margin: 0;
    font-size: 13px;
  }
</style>
