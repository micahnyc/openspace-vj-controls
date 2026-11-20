<script lang="ts">
  /** Everything that isn't the show itself: connection, sending, look, logs, debugging tools. */
  import { show } from '../app/show.svelte';
  import { BUILT_IN_PALETTES, neutralsOf } from '../presets/palettes';
  import ConnectionPanel from './components/ConnectionPanel.svelte';
  import SendPanel from './SendPanel.svelte';
  import MidiMonitor from './components/MidiMonitor.svelte';
  import PropertyList from './components/PropertyList.svelte';
  import ActionList from './components/ActionList.svelte';

  import { panels } from './panels.svelte';
  import Window from './components/Window.svelte';

  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
</script>

<section class="system" aria-label="System">
  <Window id="openspace">
    <ConnectionPanel />
  </Window>

  <Window id="sending">
    <div class="panel"><SendPanel /></div>
  </Window>

  <Window id="palette">
    <div class="panel palette">
      {#each BUILT_IN_PALETTES as p}
        {@const n = neutralsOf(p)}
        <button
          type="button"
          class="pal"
          aria-pressed={show.file.palette.name === p.name}
          onclick={() => show.setPalette(p)}
          style:background={n.ground}
          style:color={n.ink}
          style:border-color={show.file.palette.name === p.name ? p.colors[0] : n.line}
        >
          <span>{p.name.toUpperCase()}</span>
          <span class="sw">
            <span class="panel-sw" style:background={n.panel} title="Panel {n.panel}"></span>
            <span class="panel-sw" style:background={n.raised} title="Raised {n.raised}"></span>
            {#each p.colors as c}<span style:background={c}></span>{/each}
          </span>
        </button>
      {/each}
      <p class="muted small">Saved in the show file. Slots 1–3 color MIDI, BPM and audio; the rest are quick picks for color properties. Each palette also sets the page: background, text and every gray. The two wider swatches are its panel and raised grays.</p>
    </div>
  </Window>

  <Window id="log">
    {#snippet meta()}<span class="readout muted">{show.log.length}</span>{/snippet}
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
  </Window>

  <Window id="monitor">
    {#if panels.expanded.monitor}<MidiMonitor />{/if}
  </Window>

  <Window id="browser">
    {#if panels.expanded.browser}
      <div class="browser">
        <PropertyList />
        <ActionList />
      </div>
    {/if}
  </Window>
</section>

<style>
  .system {
    display: grid;
    gap: var(--space-2);
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
  .sw .panel-sw {
    width: 18px;
    outline: var(--stroke-hair) solid var(--line);
    outline-offset: -1px;
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
