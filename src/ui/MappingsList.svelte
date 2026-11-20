<script lang="ts">
  /** Mappings list: one tab per device plus BPM & EQ (spec: "Multiple devices"). */
  import { show } from '../app/show.svelte';
  import { actionLabel, fmtNum, sourceLabel, midiAddress } from '../app/describe';
  import { beatsLabel, targetKey, type Binding, type BeatBinding } from '../core/types';

  interface Props {
    onedit: (b: Binding) => void;
  }
  let { onedit }: Props = $props();

  const BEAT_TAB = '__beat';
  let tab = $state('');
  let confirmDelete: string | null = $state(null);

  const deviceTabs = $derived.by(() => {
    const aliases = new Set<string>();
    for (const d of show.devices) if (d.alias && (d.active || show.bindings.some((b) => b.source.kind === 'midi' && b.source.device === d.alias))) aliases.add(d.alias);
    for (const b of show.bindings) if (b.source.kind === 'midi') aliases.add(b.source.device);
    return [...aliases].map((alias) => ({
      alias,
      connected: show.devices.some((d) => d.alias === alias && d.connected),
      count: show.bindings.filter((b) => b.source.kind === 'midi' && b.source.device === alias).length,
    }));
  });
  const beatCount = $derived(show.bindings.filter((b) => b.source.kind !== 'midi').length);

  // Keep a valid tab selected.
  $effect(() => {
    if (tab === BEAT_TAB) return;
    if (!deviceTabs.some((t) => t.alias === tab)) tab = deviceTabs[0]?.alias ?? BEAT_TAB;
  });

  const rows = $derived(
    show.bindings.filter((b) => (tab === BEAT_TAB ? b.source.kind !== 'midi' : b.source.kind === 'midi' && b.source.device === tab)),
  );
  const counts = $derived(show.targetCounts);
  const bindingName = (id: string) => {
    const b = show.bindings.find((x) => x.id === id);
    return b ? b.name || actionLabel(b, () => '') : '(deleted)';
  };

  /** Live readout for a row; re-read on every UI clock tick. */
  function live(b: Binding): { value: string; muted: boolean; extra: string; pickup: boolean } {
    void show.uiClock;
    const r = show.runtime(b.id);
    const isBeat = b.source.kind === 'beat';
    const muted = isBeat ? show.engine.isBeatMuted(b) : b.muted;
    let extra = '';
    if (isBeat) {
      const every = show.engine.effectiveInterval(b as BeatBinding);
      if (every !== (b as BeatBinding).source.every) extra += `every ${beatsLabel(every)} `;
      if (r.range !== undefined && r.range < 0.999) extra += `range ${Math.round(r.range * 100)}%`;
    }
    if (b.source.kind === 'eq') extra = `in ${fmtNum(r.env ?? 0)}`;
    return { value: r.last === undefined ? '' : fmtNum(r.last), muted, extra, pickup: r.pickup !== undefined };
  }
</script>

<section class="panel" aria-label="Mappings">

  <div class="tabs" role="tablist">
    {#each deviceTabs as t (t.alias)}
      <button type="button" role="tab" class="tab" aria-selected={tab === t.alias} onclick={() => (tab = t.alias)}>
        <span class="light {t.connected ? 'on-midi' : ''}" aria-hidden="true"></span>
        {t.alias.toUpperCase()} <span class="readout count">{t.count}</span>
        {#if !t.connected}<span class="sr">(not connected)</span>{/if}
      </button>
    {/each}
    <button type="button" role="tab" class="tab" aria-selected={tab === BEAT_TAB} onclick={() => (tab = BEAT_TAB)}>
      BPM &amp; EQ <span class="readout count">{beatCount}</span>
    </button>
  </div>

  {#if rows.length === 0}
    <p class="muted empty">
      {tab === BEAT_TAB
        ? 'No BPM or EQ mappings yet. Press + NEW MAPPING and choose BPM or EQ.'
        : deviceTabs.length === 0
          ? 'Select a MIDI device in 01 / SYSTEM, then press + NEW MAPPING.'
          : 'No mappings on this device yet. Press + NEW MAPPING.'}
    </p>
  {:else}
    <ul class="list">
      {#each rows as b (b.id)}
        {@const missing = show.missingTargets(b)}
        {@const key = targetKey(b)}
        {@const shared = key ? (counts.get(key) ?? 0) > 1 : false}
        {@const l = live(b)}
        <li class="row" class:missing={missing.length > 0} class:muted-row={l.muted}>
          {#if missing.length > 0}<span class="stripes" aria-hidden="true"></span>{/if}
          <div class="src">
            <span class="srcname">{sourceLabel(b, b.source.kind === 'midi' ? show.profileFor(b.source.device) : undefined)}</span>
            <span class="readout muted">
              {#if b.source.kind === 'midi'}{midiAddress(b.source)}{:else if b.source.kind === 'beat'}BPM{:else}AUDIO{/if}
            </span>
          </div>
          <div class="what">
            {#if b.name}<span class="name">{b.name}</span>{/if}
            <span class="action">{actionLabel(b, bindingName)}</span>
            {#if missing.length}
              <span class="warn-text small">Not in this scene: {missing.join(', ')}. Turns on when it loads.</span>
            {/if}
          </div>
          <div class="tags">
            {#if shared}<span class="tag" title="Another mapping drives the same target; the last value sent wins.">SHARED</span>{/if}
            {#if l.pickup}<span class="tag pickup" title="Move the fader through the current value to take over.">PICKUP</span>{/if}
            {#if l.extra}<span class="readout muted">{l.extra}</span>{/if}
            <span class="readout value">{l.value}</span>
          </div>
          <div class="actions">
            <button type="button" class="mini" aria-pressed={b.muted} onclick={() => show.setMuted(b.id, !b.muted)}>MUTE</button>
            <button type="button" class="mini" onclick={() => onedit(b)}>EDIT</button>
            {#if confirmDelete === b.id}
              <button type="button" class="mini danger" onclick={() => { show.removeBinding(b.id); confirmDelete = null; }}>DELETE?</button>
            {:else}
              <button type="button" class="mini" onclick={() => (confirmDelete = b.id)} aria-label="Delete mapping">✕</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    border-bottom: var(--stroke-hair) solid var(--rule);
    margin-bottom: var(--space-2);
  }
  .tab {
    background: transparent;
    border: 0;
    border-bottom: var(--stroke-bold) solid transparent;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--ink-muted);
  }
  .tab[aria-selected='true'] {
    color: var(--ink);
    border-bottom-color: var(--midi);
  }
  .count {
    color: var(--ink-muted);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .empty {
    padding: var(--space-3) 0;
    margin: 0;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(140px, 1.1fr) minmax(0, 2.4fr) auto auto;
    gap: var(--space-3);
    align-items: center;
    min-height: var(--row-h);
    padding: var(--space-2) var(--space-3);
    background: var(--raised);
    border: var(--stroke-hair) solid transparent;
  }
  .row.missing {
    border: var(--stroke-hair) dashed var(--warn);
    padding-left: calc(var(--space-3) + 8px);
  }
  .row.muted-row .src,
  .row.muted-row .what {
    opacity: 0.55;
  }
  .stripes {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 8px;
    background: var(--hazard);
  }
  .src,
  .what {
    display: grid;
    min-width: 0;
  }
  .srcname {
    font-family: var(--font-condensed);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .name {
    font-weight: 400;
  }
  .action {
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }
  .tags {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    justify-content: flex-end;
  }
  .tag {
    font-family: var(--font-condensed);
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.12em;
    padding: 0 var(--space-1);
    border: var(--stroke-hair) solid var(--line);
  }
  .tag.pickup {
    border-color: var(--palette-5);
    color: var(--palette-5);
  }
  .value {
    min-width: 72px;
    text-align: right;
    color: var(--midi);
  }
  .actions {
    display: flex;
    gap: var(--space-1);
  }
  .mini {
    height: 28px;
    padding: 0 var(--space-2);
    font-size: 12px;
  }
  .danger {
    background: var(--warn);
    color: var(--on-accent);
    border-color: var(--warn);
  }
  .warn-text {
    color: var(--warn);
  }
  .small {
    font-size: 13px;
  }
  @media (max-width: 900px) {
    .row {
      grid-template-columns: 1fr auto;
    }
    .what {
      grid-column: 1 / -1;
      order: 3;
    }
  }
</style>
