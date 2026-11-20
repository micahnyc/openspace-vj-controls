<script lang="ts">
  /** Everything that isn't the show itself: connection, sending, look, logs, debugging tools. */
  import { show } from '../app/show.svelte';
  import { BUILT_IN_PALETTES } from '../presets/palettes';
  import ConnectionPanel from './components/ConnectionPanel.svelte';
  import SendPanel from './SendPanel.svelte';
  import MidiMonitor from './components/MidiMonitor.svelte';
  import PropertyList from './components/PropertyList.svelte';
  import ActionList from './components/ActionList.svelte';

  import { panels, type PanelId } from './panels.svelte';

  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
</script>

{#snippet close(id: PanelId)}
  <button
    type="button"
    class="close"
    aria-label="Close panel (reopen from the menu on the title)"
    title="Close (reopen from the menu on the title)"
    onclick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      panels.hide(id);
    }}>✕</button
  >
{/snippet}

<section class="system" aria-label="System">
  {#if !panels.isHidden('openspace')}
  <details id="panel-openspace" bind:open={panels.expanded.openspace}>
    <summary class="label"><span class="title">04 / OPENSPACE</span>{@render close('openspace')}</summary>
    <ConnectionPanel />
  </details>
  {/if}

  {#if !panels.isHidden('sending')}
  <details id="panel-sending" bind:open={panels.expanded.sending}>
    <summary class="label"><span class="title">05 / SENDING &amp; DEBUG</span>{@render close('sending')}</summary>
    <div class="panel"><SendPanel /></div>
  </details>
  {/if}

  {#if !panels.isHidden('palette')}
  <details id="panel-palette" bind:open={panels.expanded.palette}>
    <summary class="label"><span class="title">06 / PALETTE</span>{@render close('palette')}</summary>
    <div class="panel palette">
      {#each BUILT_IN_PALETTES as p}
        <button type="button" class="pal" aria-pressed={show.file.palette.name === p.name} onclick={() => show.setPalette(p)}>
          <span>{p.name.toUpperCase()}</span>
          <span class="sw">
            {#each p.colors as c}<span style:background={c}></span>{/each}
          </span>
        </button>
      {/each}
      <p class="muted small">Saved in the show file. Slots 1–3 color MIDI, BPM and audio; the rest are quick picks for color properties.</p>
    </div>
  </details>
  {/if}

  {#if !panels.isHidden('log')}
  <details id="panel-log" bind:open={panels.expanded.log}>
    <summary class="label"><span class="title">07 / LOG <span class="readout">{show.log.length}</span></span>{@render close('log')}</summary>
    <div class="panel">
      {#if show.loadWarnings.length}
        <p class="small warn-text">Last load: {show.loadWarnings.join(' ')}</p>
      {/if}
      <ul class="log">
        {#each show.log as l}
          <li class:warn-text={l.warn}><span class="readout muted">{time(l.t)}</span> {l.text}</li>
        {:else}
          <li class="muted">Nothing yet.</li>
        {/each}
      </ul>
    </div>
  </details>
  {/if}

  {#if !panels.isHidden('monitor')}
  <details id="panel-monitor" bind:open={panels.expanded.monitor}>
    <summary class="label"><span class="title">08 / MIDI MONITOR</span>{@render close('monitor')}</summary>
    {#if panels.expanded.monitor}<MidiMonitor />{/if}
  </details>
  {/if}

  {#if !panels.isHidden('browser')}
  <details id="panel-browser" bind:open={panels.expanded.browser}>
    <summary class="label"><span class="title">09 / SCENE BROWSER</span>{@render close('browser')}</summary>
    {#if panels.expanded.browser}
      <div class="browser">
        <PropertyList />
        <ActionList />
      </div>
    {/if}
  </details>
  {/if}
</section>

<style>
  .system {
    display: grid;
    gap: var(--space-2);
  }
  details {
    background: var(--panel);
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
  summary::before {
    content: '+';
    font-family: var(--font-mono);
    width: 1ch;
  }
  details[open] > summary::before {
    content: '−';
  }
  .title {
    flex: 1;
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
  details[open] > summary {
    border-bottom: var(--stroke-hair) solid var(--rule);
  }
  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .pal {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .pal[aria-pressed='true'] {
    background: var(--raised);
    color: var(--ink);
    border: var(--stroke-bold) solid var(--midi);
  }
  .sw {
    display: inline-flex;
    gap: 2px;
  }
  .sw span {
    width: 10px;
    height: 16px;
    border-radius: var(--radius-1);
  }
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
    max-height: 240px;
    overflow-y: auto;
    font-size: 14px;
  }
  .browser {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: var(--space-2);
  }
  .small {
    font-size: 13px;
    margin: 0;
    width: 100%;
  }
  .warn-text {
    color: var(--warn);
  }
  @media (max-width: 900px) {
    .browser {
      grid-template-columns: 1fr;
    }
  }
</style>
