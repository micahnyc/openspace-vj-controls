<script lang="ts">
  /** v1 screen parts 1, 2 and 4: MIDI device selector, Save/Load, New mapping. */
  import { show } from '../app/show.svelte';
  import { midi } from '../inputs/midi/webmidi.svelte';
  import { migrateWithWarnings, type MappingFile } from '../presets/schema';
  import { canOverwrite, openFile, saveFile, type FsFileHandle } from '../presets/storage';

  interface Props {
    onnew: (kind: 'midi' | 'bpm' | 'eq') => void;
    onload: (pending: { file: MappingFile; handle: FsFileHandle | null; name: string; warnings: string[] }) => void;
  }
  let { onnew, onload }: Props = $props();

  let menu = $state(false);
  let error: string | null = $state(null);

  async function save(saveAs: boolean) {
    error = null;
    try {
      const snapshot = $state.snapshot(show.file) as MappingFile;
      const r = await saveFile(snapshot, show.fileHandle, saveAs);
      if (!r) return;
      show.fileHandle = r.handle;
      show.fileName = r.name;
      show.dirty = false;
      show.note(r.handle ? `Saved ${r.name}.` : `Downloaded ${r.name}.`);
    } catch (e) {
      error = `Couldn't save: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function load() {
    error = null;
    try {
      const picked = await openFile();
      if (!picked) return;
      let json: unknown;
      try {
        json = JSON.parse(picked.text);
      } catch {
        error = `${picked.name} isn't valid JSON.`;
        return;
      }
      const { file, warnings } = migrateWithWarnings(json);
      onload({ file, handle: picked.handle, name: picked.name, warnings });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function pick(kind: 'midi' | 'bpm' | 'eq') {
    menu = false;
    onnew(kind);
  }
</script>

<section class="bar" aria-label="Devices and file">
  <div class="devices">
    <span class="label">01 / MIDI DEVICES</span>
    <div class="chips">
      {#if midi.status === 'unsupported'}
        <span class="warn-text">This browser has no Web MIDI. Use Chrome.</span>
      {:else if midi.status !== 'ready'}
        <button type="button" class="primary" onclick={() => midi.request()} disabled={midi.status === 'requesting'}>ENABLE MIDI</button>
        {#if midi.error}<span class="warn-text small">{midi.error}</span>{/if}
      {:else}
        {#each show.devices as d (d.name + d.alias)}
          <button
            type="button"
            class="chip"
            aria-pressed={d.active && d.known}
            disabled={!d.connected && !d.known}
            onclick={() => show.setDeviceActive(d, !(d.active && d.known))}
            title={d.connected ? d.name : `${d.name} is not connected`}
          >
            <span class="light {d.connected ? (d.active && d.known ? 'on-dark' : 'on-midi') : 'on-warn'}" aria-hidden="true"></span>
            {d.alias ? d.alias.toUpperCase() : d.name}
            {#if !d.connected}<span class="small">OFFLINE</span>{/if}
          </button>
        {:else}
          <span class="muted">No MIDI devices. Plug one in; it appears here.</span>
        {/each}
        {#if show.devices.some((d) => d.active && d.known && d.connected)}
          <button type="button" onclick={() => show.reinitDevices()} title="Switch to Mode 2, clear every LED, then relight the ones your mappings say are on">RE-INIT</button>
        {/if}
      {/if}
    </div>
  </div>

  <div class="file">
    <span class="label">SHOW FILE</span>
    <div class="chips">
      <span class="readout fname" title={show.fileName ?? 'Not saved to a file yet'}>
        {show.fileName ?? 'UNSAVED'}{show.dirty ? ' •' : ''}
      </span>
      <button type="button" onclick={() => save(false)}>SAVE</button>
      {#if canOverwrite}<button type="button" onclick={() => save(true)}>SAVE AS</button>{/if}
      <button type="button" onclick={load}>LOAD</button>
    </div>
  </div>

  <div class="new">
    <button type="button" class="primary" aria-expanded={menu} onclick={() => (menu = !menu)}>+ NEW MAPPING</button>
    {#if menu}
      <div class="menu" role="menu">
        <button type="button" role="menuitem" onclick={() => pick('midi')}>MIDI MAPPING</button>
        <button type="button" role="menuitem" onclick={() => pick('bpm')}>BPM MAPPING</button>
        <button type="button" role="menuitem" onclick={() => pick('eq')}>EQ MAPPING</button>
      </div>
    {/if}
  </div>
</section>
{#if error}
  <p class="error" role="alert"><strong class="label">FILE</strong> {error}</p>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: flex-end;
  }
  .devices {
    flex: 1;
    min-width: 260px;
  }
  .devices,
  .file {
    display: grid;
    gap: var(--space-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* Selected chip is a full midi fill; its light goes dark so it still reads. */
  .light.on-dark {
    background: var(--on-accent);
    border-color: var(--on-accent);
  }
  .fname {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-muted);
  }
  .new {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 10;
    display: grid;
    min-width: 200px;
    background: var(--panel);
    border: var(--stroke-hair) solid var(--line);
  }
  .menu button {
    border: 0;
    border-bottom: var(--stroke-hair) solid var(--rule);
    text-align: left;
    background: var(--panel);
  }
  .menu button:hover {
    background: var(--raised);
  }
  .small {
    font-size: 11px;
  }
  .warn-text {
    color: var(--warn);
  }
  .error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--raised);
    border-left: var(--stroke-bold) solid var(--warn);
  }
  .error .label {
    color: var(--warn);
    margin-right: var(--space-2);
  }
</style>
