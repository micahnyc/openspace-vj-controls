<script lang="ts">
  import { onDestroy } from 'svelte';
  import { connection } from '../../openspace/connection.svelte';
  import { discovery } from '../../openspace/discovery.svelte';
  import { settings, saveSettings, isValidPort } from '../../settings.svelte';

  let host = $state(settings.host);
  let port = $state(String(settings.port));
  const portNum = $derived(Number(port));
  const valid = $derived(host.trim().length > 0 && isValidPort(portNum));

  // Countdown readout while waiting to retry.
  let now = $state(Date.now());
  const tick = setInterval(() => (now = Date.now()), 100);
  onDestroy(() => clearInterval(tick));
  const retryIn = $derived(
    connection.retryAt === null ? null : Math.max(0, (connection.retryAt - now) / 1000),
  );

  function apply(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    settings.host = host.trim();
    settings.port = portNum;
    saveSettings();
    connection.start(settings.host, settings.port);
  }

  function refresh() {
    const api = connection.api;
    if (api) void discovery.refresh(api);
  }
</script>

<section class="panel active" aria-labelledby="conn-title">
  <div class="head">
    <span class="label" id="conn-title">CONNECTION</span>
    <span class="readout addr">ws://{connection.host}:{connection.port}</span>
  </div>

  <form class="row" onsubmit={apply}>
    <label class="field">
      <span class="label">HOST</span>
      <input type="text" bind:value={host} spellcheck="false" autocomplete="off" size="16" />
    </label>
    <label class="field">
      <span class="label">PORT</span>
      <input type="number" bind:value={port} min="1" max="65535" style="width: 96px" />
    </label>
    <button type="submit" class="primary" disabled={!valid}>CONNECT</button>
    {#if connection.state === 'waiting'}
      <button type="button" onclick={() => connection.retryNow()}>RETRY NOW</button>
    {/if}
    {#if connection.state === 'idle'}
      <span class="readout muted">STOPPED</span>
    {:else}
      <button type="button" onclick={() => connection.stop()}>STOP</button>
    {/if}
    <button type="button" onclick={refresh} disabled={!connection.api}>REFRESH LISTS</button>
  </form>

  {#if connection.state !== 'connected' && connection.lastError}
    <div class="warning" role="status">
      <div class="stripes" aria-hidden="true"></div>
      <p>
        <strong class="label warn-label">OFFLINE</strong>
        {connection.lastError}
        {#if retryIn !== null}
          Retrying in <span class="readout">{retryIn.toFixed(1)} s</span>
          (attempt <span class="readout">{connection.attempt}</span>).
        {/if}
      </p>
    </div>
  {/if}
  <p class="help muted">
    If the UI runs on another computer, add its IP to <code class="readout">Server.AllowAddresses</code> in
    openspace.cfg.
  </p>
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
  }
  .addr {
    color: var(--ink-muted);
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .warning {
    display: flex;
    margin-top: var(--space-3);
    background: var(--raised);
    border: var(--stroke-hair) solid var(--warn);
  }
  .stripes {
    width: 16px;
    flex: none;
    background: var(--hazard);
  }
  .warning p {
    margin: 0;
    padding: var(--space-2) var(--space-3);
  }
  .warn-label {
    color: var(--warn);
    margin-right: var(--space-2);
  }
  .help {
    margin: var(--space-3) 0 0;
    font-size: 13px;
  }
</style>
