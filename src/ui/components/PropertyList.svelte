<script lang="ts">
  import { discovery } from '../../openspace/discovery.svelte';
  import { matchesQuery } from '../../core/discovery';

  const LIMIT = 300;
  let query = $state('');
  let writableOnly = $state(true);

  const filtered = $derived.by(() => {
    const q = query.trim();
    return discovery.properties.filter(
      (p) =>
        (!writableOnly || (!p.readOnly && p.visibility !== 'Hidden')) &&
        matchesQuery(`${p.uri} ${p.name} ${p.ownerPath} ${p.type}`, q),
    );
  });
  const shown = $derived(filtered.slice(0, LIMIT));

  function fmtRange(min: number | number[] | undefined, max: number | number[] | undefined): string {
    if (typeof min === 'number' && typeof max === 'number') return `${min} – ${max}`;
    return '';
  }
</script>

<section class="panel" aria-labelledby="props-title">
  <div class="head">
    <span class="label" id="props-title">SCENE PROPERTIES</span>
    <span class="readout muted">
      {#if discovery.propertiesState === 'loading'}LOADING…{:else}{filtered.length} / {discovery.properties.length}{/if}
    </span>
  </div>

  <div class="tools">
    <input type="search" placeholder="Search: saturn opacity" bind:value={query} aria-label="Search properties" />
    <button type="button" aria-pressed={writableOnly} onclick={() => (writableOnly = !writableOnly)}>
      WRITABLE ONLY
    </button>
  </div>

  {#if discovery.propertiesState === 'error'}
    <p class="error"><strong class="label">ERROR</strong> {discovery.propertiesError}</p>
  {:else if discovery.propertiesState === 'empty'}
    <p class="muted">Connect to OpenSpace to list its Scene properties.</p>
  {/if}

  <ul class="list">
    {#each shown as p (p.uri)}
      <li class="row">
        <div class="main">
          <span class="name">{p.name}</span>
          <span class="type label">{p.type}</span>
          {#if p.readOnly}<span class="label">READ-ONLY</span>{/if}
        </div>
        <div class="readout uri" title={p.ownerPath}>{p.uri}</div>
        {#if fmtRange(p.min, p.max)}
          <div class="readout muted">{fmtRange(p.min, p.max)}</div>
        {/if}
      </li>
    {/each}
  </ul>
  {#if filtered.length > LIMIT}
    <p class="muted more">Showing {LIMIT} of {filtered.length}. Type more of the name to narrow it down.</p>
  {/if}
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }
  .tools {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .tools input {
    flex: 1;
    min-width: 0;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 520px;
    overflow-y: auto;
  }
  .row {
    padding: var(--space-2);
    border-bottom: var(--stroke-hair) solid var(--rule);
    background: var(--raised);
  }
  .main {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
  }
  .type {
    color: var(--midi);
  }
  .uri {
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }
  .error {
    border-left: var(--stroke-bold) solid var(--warn);
    padding-left: var(--space-2);
  }
  .error .label {
    color: var(--warn);
  }
  .more {
    font-size: 13px;
    margin: var(--space-2) 0 0;
  }
</style>
