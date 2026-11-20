<script lang="ts">
  /**
   * Confirm before replacing the current mappings (spec: "replaces the current
   * mappings after a confirm"). Lists custom scripts and requires an explicit
   * OK (CLAUDE.md: scripts in a loaded file need confirmation), and asks which
   * connected device to use for any device in the file that isn't plugged in.
   */
  import { show } from '../app/show.svelte';
  import { midi } from '../inputs/midi/webmidi.svelte';
  import { allBindings, listScripts, type MappingFile } from '../presets/schema';
  import type { FsFileHandle } from '../presets/storage';
  import Dialog from './components/Dialog.svelte';

  interface Props {
    pending: { file: MappingFile; handle: FsFileHandle | null; name: string; warnings: string[] };
    onclose: () => void;
  }
  let { pending, onclose }: Props = $props();

  const scripts = $derived(listScripts(pending.file));
  const count = $derived(allBindings(pending.file).length);
  let scriptsOk = $state(false);

  const connected = $derived(midi.inputs.filter((i) => i.state === 'connected').map((i) => i.name));
  const unmatched = $derived(
    Object.entries(pending.file.devices).filter(
      ([, d]) => !connected.some((n) => n === d.match || n.toLowerCase().includes(d.match.toLowerCase())),
    ),
  );
  let remap: Record<string, string> = $state({});

  function confirm() {
    const file = pending.file;
    for (const [alias, name] of Object.entries(remap)) {
      if (name && file.devices[alias]) file.devices[alias] = { ...file.devices[alias], match: name };
    }
    show.replaceFile(file, pending.handle, pending.name, pending.warnings);
    show.note(`Loaded ${pending.name}: ${count} mapping${count === 1 ? '' : 's'}.`);
    onclose();
  }
</script>

<Dialog title="Load show" index="FILE" {onclose}>
  <p>
    <strong>{pending.file.name}</strong> from <span class="readout">{pending.name}</span>:
    {count} mapping{count === 1 ? '' : 's'}, palette {pending.file.palette.name}.
    Loading replaces the {show.bindings.length} current mapping{show.bindings.length === 1 ? '' : 's'}{show.dirty ? ', which have unsaved changes' : ''}.
  </p>

  {#if pending.warnings.length}
    <div class="box">
      <span class="label">FIXED WHILE LOADING</span>
      <ul>
        {#each pending.warnings as w}<li>{w}</li>{/each}
      </ul>
    </div>
  {/if}

  {#if unmatched.length}
    <div class="box">
      <span class="label">DEVICES NOT CONNECTED</span>
      <p class="small">This file was made for controllers that aren't plugged in. Pick a connected device for each, or keep it to use later.</p>
      {#each unmatched as [alias, d]}
        <label class="remap">
          <span><span class="readout">{alias}</span> <span class="muted">({d.match})</span></span>
          <select bind:value={remap[alias]}>
            <option value="">Keep as is</option>
            {#each connected as n}<option value={n}>{n}</option>{/each}
          </select>
        </label>
      {/each}
    </div>
  {/if}

  {#if scripts.length}
    <div class="box danger">
      <span class="stripes" aria-hidden="true"></span>
      <div>
        <span class="label warn">THIS FILE RUNS {scripts.length} CUSTOM SCRIPT{scripts.length === 1 ? '' : 'S'}</span>
        <p class="small">A shared file can run any Lua in OpenSpace. Read them before loading.</p>
        <ol class="scripts">
          {#each scripts as s}
            <li><span class="muted small">{s.binding}</span><pre class="readout">{s.script}</pre></li>
          {/each}
        </ol>
        <label class="check"><input type="checkbox" bind:checked={scriptsOk} /> I've read these scripts and want to load them.</label>
      </div>
    </div>
  {/if}

  {#snippet footer()}
    <button type="button" onclick={onclose}>CANCEL</button>
    <button type="button" class="primary" disabled={scripts.length > 0 && !scriptsOk} onclick={confirm}>LOAD AND REPLACE</button>
  {/snippet}
</Dialog>

<style>
  p {
    margin: 0;
  }
  .box {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--raised);
  }
  .box ul {
    margin: 0;
    padding-left: var(--space-3);
  }
  .box.danger {
    grid-template-columns: 8px 1fr;
    gap: var(--space-3);
    border: var(--stroke-hair) solid var(--warn);
  }
  .stripes {
    background: var(--hazard);
  }
  .warn {
    color: var(--warn);
  }
  .remap {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .scripts {
    margin: var(--space-2) 0;
    padding-left: var(--space-3);
    display: grid;
    gap: var(--space-2);
    max-height: 260px;
    overflow-y: auto;
  }
  pre {
    margin: var(--space-1) 0 0;
    padding: var(--space-2);
    background: var(--ground);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .small {
    font-size: 13px;
  }
</style>
