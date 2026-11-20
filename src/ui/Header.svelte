<script lang="ts">
  import { show } from '../app/show.svelte';
  import { connection } from '../openspace/connection.svelte';
  import { midi } from '../inputs/midi/webmidi.svelte';
  import { audio } from '../inputs/audio/audio.svelte';
  import { settings } from '../settings.svelte';
  import { PANELS, panels } from './panels.svelte';
  import NewMappingButton from './NewMappingButton.svelte';

  interface Props {
    onnew: (kind: 'midi' | 'bpm' | 'eq') => void;
  }
  let { onnew }: Props = $props();

  /** Menu opens on hover, keyboard focus, or a click (touch). */
  let menuOpen = $state(false);
  const hiddenCount = $derived(settings.hiddenPanels.length);

  const os = $derived(
    connection.state === 'connected'
      ? show.syncing
        ? { light: 'on-warn', text: 'SYNCING' }
        : { light: 'on-midi', text: 'CONNECTED' }
      : connection.state === 'idle'
        ? { light: '', text: 'OFF' }
        : { light: 'on-warn', text: connection.attempt > 0 ? 'RECONNECTING' : 'CONNECTING' },
  );
  const activeDevices = $derived(show.devices.filter((d) => d.active && d.known && d.connected).length);
</script>

<header class="header">
  <div
    class="logo"
    role="presentation"
    onmouseleave={() => (menuOpen = false)}
    onfocusout={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) menuOpen = false;
    }}
  >
    <h1 class="display-m">
      <button
        type="button"
        class="logo-btn"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onmouseenter={() => (menuOpen = true)}
        onclick={() => (menuOpen = !menuOpen)}
      >
        OpenSpace VJ{#if hiddenCount}<span class="readout badge" title="{hiddenCount} panel(s) closed">{hiddenCount}</span>{/if}
      </button>
    </h1>
    {#if menuOpen}
      <div class="menu" role="menu" aria-label="Panels">
        <span class="label menu-title">PANELS</span>
        {#each PANELS as p}
          {@const shown = !panels.isHidden(p.id)}
          <button type="button" role="menuitemcheckbox" aria-checked={shown} class="mitem" onclick={() => panels.toggle(p.id)}>
            <span class="box" class:on={shown} aria-hidden="true"></span>
            <span class="readout idx">{p.index}</span>
            <span>{p.title}</span>
          </button>
        {/each}
        {#if hiddenCount}
          <button type="button" role="menuitem" class="mitem all" onclick={() => panels.showAll()}>SHOW ALL</button>
        {/if}
      </div>
    {/if}
  </div>
  <div class="status">
    <span class="item" title="ws://{connection.host}:{connection.port}">
      <span class="light {os.light}" aria-hidden="true"></span>
      <span class="label">OPENSPACE</span><span class="readout">{os.text}</span>
    </span>
    <span class="item">
      <span class="light {midi.status === 'denied' ? 'on-warn' : activeDevices ? 'on-midi' : ''}" aria-hidden="true"></span>
      <span class="label">MIDI</span><span class="readout">{midi.status === 'ready' ? `${activeDevices} ACTIVE` : midi.status.toUpperCase()}</span>
    </span>
    <span class="item">
      <span class="light {audio.running ? 'on-audio' : audio.error ? 'on-warn' : ''}" aria-hidden="true"></span>
      <span class="label">AUDIO</span><span class="readout">{audio.running ? 'ON' : 'OFF'}</span>
    </span>
    <span class="item">
      <span class="label">SEND</span>
      <span class="readout">{settings.sendMode === 'queue' ? `QUEUE ${settings.intervalMs} MS` : `DIRECT ${settings.throttleMs} MS`} · {show.metrics?.sentPerSec ?? 0}/S</span>
    </span>
  </div>
  <div class="panic-wrap">
    <NewMappingButton {onnew} />
    {#if show.hold}
      <button type="button" class="release" onclick={() => show.releaseHold()}>RELEASE HOLD</button>
    {/if}
    <button type="button" class="panic" onclick={() => show.panic()} title="Clear the send queue, set real time, hold BPM and EQ mappings">
      <span>PANIC</span>
    </button>
  </div>
</header>
{#if show.hold}
  <div class="holdbar" role="status">
    <span class="stripes" aria-hidden="true"></span>
    <span><strong class="label warn">HOLD</strong> BPM and EQ mappings are paused after PANIC. MIDI controls still work. Press RELEASE HOLD to resume.</span>
  </div>
{/if}

<style>
  .header {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--stroke-hair) solid var(--rule);
  }
  .logo {
    position: relative;
  }
  .logo h1 {
    margin: 0;
  }
  .logo-btn {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .logo-btn:focus-visible {
    outline: var(--stroke-bold) solid var(--midi);
    outline-offset: 2px;
  }
  .badge {
    font-size: 12px;
    line-height: 18px;
    min-width: 18px;
    text-align: center;
    background: var(--raised);
    border: var(--stroke-hair) solid var(--line);
    color: var(--ink-muted);
  }
  .menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 20;
    display: grid;
    min-width: 240px;
    padding-top: var(--space-2);
    background: var(--panel);
    border: var(--stroke-hair) solid var(--line);
  }
  .menu-title {
    padding: 0 var(--space-3) var(--space-1);
  }
  .mitem {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-align: left;
    border: 0;
    border-top: var(--stroke-hair) solid var(--rule);
    background: var(--panel);
  }
  .mitem:hover,
  .mitem:focus-visible {
    background: var(--raised);
  }
  .box {
    width: 12px;
    height: 12px;
    border: var(--stroke-hair) solid var(--line);
    flex: none;
  }
  .box.on {
    background: var(--midi);
    border-color: var(--midi);
  }
  .idx {
    color: var(--ink-muted);
  }
  .all {
    color: var(--midi);
  }
  .status {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    flex: 1;
  }
  .item {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
  }
  .panic-wrap {
    display: flex;
    gap: var(--space-2);
  }
  .panic {
    height: 44px;
    padding: 0 var(--space-4);
    background: var(--hazard);
    border: var(--stroke-bold) solid var(--warn);
    color: var(--on-accent);
  }
  .panic span {
    background: var(--warn);
    padding: 2px var(--space-2);
    font-size: 18px;
  }
  .release {
    height: 44px;
    border-color: var(--warn);
  }
  .holdbar {
    display: flex;
    gap: var(--space-3);
    align-items: stretch;
    background: var(--raised);
    border-bottom: var(--stroke-hair) solid var(--warn);
  }
  .holdbar > span:last-child {
    padding: var(--space-2) 0;
  }
  .stripes {
    width: 24px;
    background: var(--hazard);
  }
  .warn {
    color: var(--warn);
    margin-right: var(--space-2);
  }
  @media (max-width: 600px) {
    .header {
      padding: var(--space-3);
    }
  }
</style>
