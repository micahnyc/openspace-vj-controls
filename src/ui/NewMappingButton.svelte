<script lang="ts">
  /** + NEW MAPPING with its MIDI / BPM / EQ menu (lives in the header). */
  interface Props {
    onnew: (kind: 'midi' | 'bpm' | 'eq') => void;
  }
  let { onnew }: Props = $props();
  let open = $state(false);

  function pick(kind: 'midi' | 'bpm' | 'eq') {
    open = false;
    onnew(kind);
  }
</script>

<div
  class="new"
  role="presentation"
  onfocusout={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) open = false;
  }}
>
  <button type="button" class="primary" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>+ NEW MAPPING</button>
  {#if open}
    <div class="menu" role="menu">
      <button type="button" role="menuitem" onclick={() => pick('midi')}>MIDI MAPPING</button>
      <button type="button" role="menuitem" onclick={() => pick('bpm')}>BPM MAPPING</button>
      <button type="button" role="menuitem" onclick={() => pick('eq')}>EQ MAPPING</button>
    </div>
  {/if}
</div>

<style>
  .new {
    position: relative;
  }
  .new > button {
    height: 44px;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 20;
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
  .menu button:hover,
  .menu button:focus-visible {
    background: var(--raised);
  }
</style>
