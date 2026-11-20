<script lang="ts">
  import { show } from './app/show.svelte';
  import type { Binding } from './core/types';
  import type { MappingFile } from './presets/schema';
  import type { FsFileHandle } from './presets/storage';
  import Header from './ui/Header.svelte';
  import TopBar from './ui/TopBar.svelte';
  import TempoPanel from './ui/TempoPanel.svelte';
  import MappingsList from './ui/MappingsList.svelte';
  import MappingDialog from './ui/MappingDialog.svelte';
  import LoadDialog from './ui/LoadDialog.svelte';
  import SystemPanel from './ui/SystemPanel.svelte';
  import Window from './ui/components/Window.svelte';

  show.init();

  let dialog: { kind: 'midi' | 'bpm' | 'eq'; editing: Binding | null } | null = $state(null);
  let pendingLoad: { file: MappingFile; handle: FsFileHandle | null; name: string; warnings: string[] } | null = $state(null);

  function edit(b: Binding) {
    const kind = b.source.kind === 'midi' ? 'midi' : b.source.kind === 'beat' ? 'bpm' : 'eq';
    dialog = { kind, editing: $state.snapshot(b) as Binding };
  }
</script>

<Header onnew={(kind) => (dialog = { kind, editing: null })} />

<main class="layout">
  <Window id="system">
    <TopBar onload={(p) => (pendingLoad = p)} />
  </Window>
  <Window id="tempo">
    {#snippet meta()}<span class="readout muted">{show.tempoSource.toUpperCase()}</span>{/snippet}
    <TempoPanel />
  </Window>
  <Window id="mappings">
    {#snippet meta()}<span class="readout muted">{show.bindings.length} TOTAL</span>{/snippet}
    <MappingsList onedit={edit} />
  </Window>
  <SystemPanel />
</main>

{#if dialog}
  {#key dialog}
    <MappingDialog kind={dialog.kind} editing={dialog.editing} onclose={() => (dialog = null)} />
  {/key}
{/if}
{#if pendingLoad}
  <LoadDialog pending={pendingLoad} onclose={() => (pendingLoad = null)} />
{/if}

<style>
  .layout {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
    max-width: 1600px;
  }
  @media (max-width: 600px) {
    .layout {
      padding: var(--space-3);
      gap: var(--space-3);
    }
  }
</style>
