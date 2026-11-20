<script lang="ts">
  /** Why a property/action search box is unavailable, with a retry. */
  import { connection } from '../../openspace/connection.svelte';
  import { discovery } from '../../openspace/discovery.svelte';

  interface Props {
    what: 'properties' | 'actions';
  }
  let { what }: Props = $props();

  const state = $derived(what === 'properties' ? discovery.propertiesState : discovery.actionsState);
  const error = $derived(what === 'properties' ? discovery.propertiesError : discovery.actionsError);
  const count = $derived(what === 'properties' ? discovery.properties.length : discovery.actions.length);

  function retry() {
    const api = connection.api;
    if (api) void discovery.refresh(api);
  }
</script>

{#if state === 'loading' && count === 0}
  <p class="status muted">Loading {what} from OpenSpace…</p>
{:else if state === 'error'}
  <p class="status warn">
    <strong class="label">ERROR</strong> Couldn't read {what}: {error}
    <button type="button" class="mini" onclick={retry} disabled={!connection.api}>RETRY</button>
  </p>
{:else if count === 0 && !connection.api}
  <p class="status muted">Not connected to OpenSpace. The {what} list loads when it connects.</p>
{:else if count === 0 && state !== 'loading'}
  <p class="status muted">
    No {what} loaded yet.
    <button type="button" class="mini" onclick={retry} disabled={!connection.api}>LOAD NOW</button>
  </p>
{/if}

<style>
  .status {
    margin: 0;
    font-size: 13px;
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .warn {
    color: var(--warn);
  }
  .warn .label {
    color: var(--warn);
  }
  .mini {
    height: 28px;
    padding: 0 var(--space-2);
    font-size: 12px;
  }
</style>
