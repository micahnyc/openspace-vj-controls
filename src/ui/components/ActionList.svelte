<script lang="ts">
  import { discovery } from '../../openspace/discovery.svelte';
  import { matchesQuery } from '../../core/discovery';

  let query = $state('');
  const filtered = $derived(
    discovery.actions.filter((a) => matchesQuery(`${a.name} ${a.identifier} ${a.guiPath}`, query.trim())),
  );
</script>

<section class="panel" aria-labelledby="actions-title">
  <div class="head">
    <span class="label" id="actions-title">ACTIONS</span>
    <span class="readout muted">
      {#if discovery.actionsState === 'loading'}LOADING…{:else}{filtered.length} / {discovery.actions.length}{/if}
    </span>
  </div>

  <input type="search" placeholder="Search: fly to" bind:value={query} aria-label="Search actions" />

  {#if discovery.actionsState === 'error'}
    <p class="error"><strong class="label">ERROR</strong> {discovery.actionsError}</p>
  {:else if discovery.actionsState === 'empty'}
    <p class="muted">Connect to OpenSpace to list its actions.</p>
  {/if}

  <ul class="list">
    {#each filtered as a (a.identifier)}
      <li class="row" title={a.documentation}>
        <div class="name">{a.name}</div>
        <div class="readout muted">{a.guiPath}</div>
        <div class="readout id">{a.identifier}</div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }
  input {
    width: 100%;
    margin-bottom: var(--space-2);
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
  .id {
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
</style>
