<script lang="ts">
  /** Send mode setting and debug metrics (spec: "Send mode", "Comparing them"). */
  import { show } from '../app/show.svelte';
  import { settings } from '../settings.svelte';
  import type { SendMode } from '../core/scheduler';

  function setMode(m: SendMode) {
    settings.sendMode = m;
    show.applySendSettings();
  }
  function setMs(field: 'intervalMs' | 'throttleMs', v: number) {
    if (!Number.isFinite(v)) return;
    settings[field] = Math.min(100, Math.max(1, Math.round(v)));
    show.applySendSettings();
  }
  const m = $derived(show.metrics);
  const f = (n: number | undefined) => (n === undefined ? '–' : n < 10 ? n.toFixed(1) : String(Math.round(n)));
</script>

<div class="send">
  <div class="controls">
    <fieldset class="inline">
      <legend class="label">SEND MODE</legend>
      <button type="button" aria-pressed={settings.sendMode === 'queue'} onclick={() => setMode('queue')}>MESSAGE QUEUE</button>
      <button type="button" aria-pressed={settings.sendMode === 'direct'} onclick={() => setMode('direct')}>DIRECT + THROTTLE</button>
    </fieldset>
    {#if settings.sendMode === 'queue'}
      <label class="field">
        <span class="label">TICK, MS</span>
        <input type="number" min="1" max="100" value={settings.intervalMs} onchange={(e) => setMs('intervalMs', Number(e.currentTarget.value))} />
      </label>
    {:else}
      <label class="field">
        <span class="label">THROTTLE, MS</span>
        <input type="number" min="1" max="100" value={settings.throttleMs} onchange={(e) => setMs('throttleMs', Number(e.currentTarget.value))} />
      </label>
    {/if}
  </div>
  <p class="muted small">
    {settings.sendMode === 'queue'
      ? 'Every tick sends queued presses in order, then the latest value of each changed target.'
      : 'Each target sends at once unless it sent in the last window; the newest value then goes out when the window ends. Presses go out immediately.'}
    Switching flushes anything pending first.
  </p>

  <dl class="metrics readout">
    <div><dt class="label">MSG/S</dt><dd>{m?.sentPerSec ?? 0}</dd></div>
    <div><dt class="label">COALESCED/S</dt><dd>{m?.coalescedPerSec ?? 0}</dd></div>
    <div><dt class="label">UNCHANGED/S</dt><dd>{m?.unchangedPerSec ?? 0}</dd></div>
    <div><dt class="label">DELAY MED / MAX</dt><dd>{f(m?.delayMedianMs)} / {f(m?.delayWorstMs)} ms</dd></div>
    <div><dt class="label">ROUND TRIP MED / MAX</dt><dd>{show.rtt.samples ? `${f(show.rtt.median)} / ${f(show.rtt.worst)} ms` : '–'}</dd></div>
    <div><dt class="label">SKIPPED TICKS/S</dt><dd class:warn={(m?.skippedTicksPerSec ?? 0) > 0}>{m?.skippedTicksPerSec ?? 0}</dd></div>
    <div><dt class="label">PENDING</dt><dd>{m?.pendingValues ?? 0} val · {m?.pendingEvents ?? 0} evt</dd></div>
  </dl>
  <p class="muted small">Delay is from the MIDI message to the send. Round trip is from a send to OpenSpace echoing the value back on a subscribed property. Skipped ticks mean the socket was backing up.</p>
</div>

<style>
  .send {
    display: grid;
    gap: var(--space-2);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: flex-end;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  .inline {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .inline legend {
    margin-bottom: var(--space-1);
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .field input {
    width: 96px;
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-2);
    margin: 0;
  }
  .metrics div {
    background: var(--raised);
    padding: var(--space-2);
  }
  dd {
    margin: var(--space-1) 0 0;
    font-size: 16px;
  }
  dd.warn {
    color: var(--warn);
  }
  .small {
    font-size: 13px;
    margin: 0;
  }
</style>
