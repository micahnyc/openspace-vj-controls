<script lang="ts">
  /** MIDI learn plus manual channel/CC/note entry (spec: "press Learn and move it, or pick by hand"). */
  import { onDestroy } from 'svelte';
  import { show, type LearnCapture } from '../../app/show.svelte';
  import { midiAddress } from '../../app/describe';
  import { findControl } from '../../core/profile';
  import { guessEncoderMode } from '../../core/transforms';
  import type { ControlType, EncoderMode, MidiSource } from '../../core/types';

  interface Props {
    value: MidiSource | null;
    onchange: (s: MidiSource) => void;
  }
  let { value, onchange }: Props = $props();

  let cancelLearn: (() => void) | null = null;
  let stopRaw: (() => void) | null = null;
  let guessing = $state(false);
  let manual = $state(false);

  const profile = $derived(value ? show.profileFor(value.device) : undefined);
  const control = $derived(
    value && profile
      ? findControl(profile, { kind: value.message === 'cc' ? 'cc' : 'noteon', channel: value.channel, number: value.number })
      : undefined,
  );
  const deviceOptions = $derived(Object.entries(show.file.devices));

  function learn() {
    cancel();
    cancelLearn = show.startLearn(onCapture);
  }

  function onCapture(c: LearnCapture) {
    cancelLearn = null;
    const pc = c.control;
    const src: MidiSource = {
      kind: 'midi',
      device: c.device,
      channel: c.channel,
      message: c.message,
      number: c.number,
      mode: (pc?.mode as EncoderMode | undefined) ?? 'absolute',
      control: pc?.type ?? (c.message === 'note' ? 'pad' : 'slider'),
      ...(pc?.states ? { states: pc.states.length } : {}),
    };
    onchange(src);
    // Unknown CC: watch the next values to guess absolute vs relative.
    if (!pc && c.message === 'cc') {
      const raws = [c.raw];
      guessing = true;
      stopRaw = show.listenRaw((ev) => {
        if (ev.kind === 'cc' && ev.channel === c.channel && ev.number === c.number && ev.raw !== null) raws.push(ev.raw);
      });
      setTimeout(() => {
        stopRaw?.();
        stopRaw = null;
        guessing = false;
        const mode = guessEncoderMode(raws);
        onchange({ ...src, mode, control: mode === 'absolute' ? 'slider' : 'encoder' });
      }, 700);
    }
  }

  function cancel() {
    cancelLearn?.();
    cancelLearn = null;
  }

  onDestroy(() => {
    cancel();
    stopRaw?.();
  });

  function patch(p: Partial<MidiSource>) {
    const base: MidiSource = value ?? {
      kind: 'midi',
      device: deviceOptions[0]?.[0] ?? '',
      channel: 1,
      message: 'cc',
      number: 0,
      mode: 'absolute',
      control: 'slider',
    };
    onchange({ ...base, ...p });
  }

  const CONTROL_TYPES: ControlType[] = ['slider', 'knob', 'encoder', 'pad', 'button', 'selector'];
  const MODES: { v: EncoderMode; label: string }[] = [
    { v: 'absolute', label: 'Absolute' },
    { v: 'relative-signed-bit7', label: "Relative, two's complement" },
    { v: 'relative-sign-magnitude', label: 'Relative, sign-magnitude' },
    { v: 'relative-binary-offset', label: 'Relative, binary offset' },
  ];
</script>

<div class="src">
  <span class="label">MIDI CONTROL</span>
  <div class="row">
    <button type="button" class:learning={show.learning} aria-pressed={show.learning} onclick={() => (show.learning ? cancel() : learn())}>
      {show.learning ? 'MOVE A CONTROL…' : 'LEARN'}
    </button>
    {#if value}
      <div class="current">
        <span>{control?.label ?? 'Unknown control'}</span>
        <span class="readout muted">{value.device} · {midiAddress(value)} · {value.control}{value.message === 'cc' && value.mode !== 'absolute' ? ' · relative' : ''}</span>
      </div>
    {:else}
      <span class="muted">Press Learn, then move a fader, turn a knob or hit a pad.</span>
    {/if}
    <button type="button" class="link" onclick={() => (manual = !manual)} aria-expanded={manual}>BY HAND</button>
  </div>
  {#if guessing}<p class="muted small">Keep moving it so the app can tell a knob from an endless encoder…</p>{/if}
  {#if control?.verify}<p class="small verify">Profile note: {control.verify}</p>{/if}

  {#if manual}
    <div class="grid">
      <label>
        <span class="label">DEVICE</span>
        <select value={value?.device ?? ''} onchange={(e) => patch({ device: e.currentTarget.value })}>
          {#each deviceOptions as [alias, d]}
            <option value={alias}>{alias} ({d.match})</option>
          {:else}
            <option value="">Select a device first</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="label">MESSAGE</span>
        <select value={value?.message ?? 'cc'} onchange={(e) => patch({ message: e.currentTarget.value as 'cc' | 'note' })}>
          <option value="cc">CC</option>
          <option value="note">Note</option>
        </select>
      </label>
      <label>
        <span class="label">CHANNEL</span>
        <input type="number" min="1" max="16" value={value?.channel ?? 1} onchange={(e) => patch({ channel: Math.min(16, Math.max(1, Number(e.currentTarget.value) || 1)) })} />
      </label>
      <label>
        <span class="label">{value?.message === 'note' ? 'NOTE' : 'CC'}</span>
        <input type="number" min="0" max="127" value={value?.number ?? 0} onchange={(e) => patch({ number: Math.min(127, Math.max(0, Number(e.currentTarget.value) || 0)) })} />
      </label>
      <label>
        <span class="label">CONTROL TYPE</span>
        <select value={value?.control ?? 'slider'} onchange={(e) => patch({ control: e.currentTarget.value as ControlType })}>
          {#each CONTROL_TYPES as t}<option value={t}>{t}</option>{/each}
        </select>
      </label>
      {#if (value?.message ?? 'cc') === 'cc'}
        <label>
          <span class="label">ENCODING</span>
          <select value={value?.mode ?? 'absolute'} onchange={(e) => patch({ mode: e.currentTarget.value as EncoderMode })}>
            {#each MODES as m}<option value={m.v}>{m.label}</option>{/each}
          </select>
        </label>
      {/if}
    </div>
  {/if}
</div>

<style>
  .src {
    display: grid;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .current {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .learning {
    background: var(--midi);
    color: var(--on-accent);
    border-color: var(--midi);
  }
  .link {
    background: transparent;
    border-color: transparent;
    color: var(--ink-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--space-2);
  }
  .grid label {
    display: grid;
    gap: var(--space-1);
  }
  .small {
    font-size: 13px;
    margin: 0;
  }
  .verify {
    color: var(--palette-5);
  }
</style>
