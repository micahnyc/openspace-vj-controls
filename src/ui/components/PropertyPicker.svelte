<script lang="ts">
  import { discovery } from '../../openspace/discovery.svelte';
  import DiscoveryStatus from './DiscoveryStatus.svelte';
  import { matchesQuery, type PropertyEntry } from '../../core/discovery';
  import { valueKind, type PropertyRef, type ValueKind } from '../../core/types';

  interface Props {
    value: PropertyRef | null;
    kinds: ValueKind[];
    onpick: (p: PropertyEntry) => void;
  }
  let { value, kinds, onpick }: Props = $props();

  const LIMIT = 80;
  let query = $state('');
  const allowed = $derived(
    discovery.properties.filter((p) => !p.readOnly && p.visibility !== 'Hidden' && kinds.includes(valueKind(p.type))),
  );
  const matches = $derived(
    query.trim() ? allowed.filter((p) => matchesQuery(`${p.uri} ${p.name} ${p.ownerPath}`, query)) : [],
  );
  const selected = $derived(value ? discovery.properties.find((p) => p.uri === value!.uri) : undefined);
  const range = (p: PropertyEntry) =>
    typeof p.min === 'number' && typeof p.max === 'number' ? `${p.min} – ${p.max}` : '';
</script>

<div class="picker">
  <span class="label">PROPERTY</span>
  {#if value}
    <div class="chosen" class:missing={discovery.propertiesState === 'ready' && !selected}>
      <div>
        <div>{selected?.name ?? value.uri.split('.').pop()}</div>
        <div class="readout muted uri">{value.uri}</div>
      </div>
      <span class="label type">{value.type}</span>
    </div>
    {#if discovery.propertiesState === 'ready' && !selected}
      <p class="warn-text">This property isn't in the current scene. The mapping turns on when the asset loads.</p>
    {/if}
  {/if}
  <input
    type="search"
    placeholder="Search properties: saturn opacity"
    bind:value={query}
    disabled={discovery.properties.length === 0}
    aria-label="Search properties"
  />
  <DiscoveryStatus what="properties" />
  {#if query.trim()}
    <ul class="results">
      {#each matches.slice(0, LIMIT) as p (p.uri)}
        <li>
          <button
            type="button"
            class="row"
            onclick={() => {
              onpick(p);
              query = '';
            }}
          >
            <span class="name">{p.name} <span class="label type">{p.type}</span></span>
            <span class="readout muted uri">{p.uri}</span>
            {#if range(p)}<span class="readout muted">{range(p)}</span>{/if}
          </button>
        </li>
      {:else}
        <li class="muted empty">No {kinds.join('/')} properties match.</li>
      {/each}
    </ul>
    {#if matches.length > LIMIT}<p class="muted small">{matches.length - LIMIT} more; type more to narrow it down.</p>{/if}
  {/if}
</div>

<style>
  .picker {
    display: grid;
    gap: var(--space-2);
  }
  .chosen {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--raised);
    border: var(--stroke-hair) solid var(--midi);
  }
  .chosen.missing {
    border: var(--stroke-hair) dashed var(--warn);
  }
  .type {
    color: var(--midi);
  }
  .uri {
    overflow-wrap: anywhere;
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
  .small {
    font-size: 13px;
    margin: 0;
  }
  .warn-text {
    color: var(--warn);
    margin: 0;
    font-size: 13px;
  }
</style>
