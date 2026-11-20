<script lang="ts">
  import { untrack } from 'svelte';
  import { show } from '../app/show.svelte';
  import { actionLabel, fmtNum, sourceLabel } from '../app/describe';
  import { connection } from '../openspace/connection.svelte';
  import { discovery } from '../openspace/discovery.svelte';
  import { runScriptChecked } from '../openspace/sender';
  import type { PropertyEntry } from '../core/discovery';
  import { TIME_UNITS, bestUnit, toSeconds, type TimeUnit } from '../core/timeunits';
  import {
    BEAT_INTERVALS,
    LUA_DELTA_TIME,
    GLIDE_BEATS,
    glideBeatsOf,
    EASING_FAMILIES,
    validEasing,
    type GlideTime,
    beatsLabel,
    everyLabel,
    valueKind,
    vectorSize,
    type BeatInterval,
    type Binding,
    type Curve,
    type EqBand,
    type EqBinding,
    type MidiSource,
    type CycleValue,
    type PropertyRef,
    type ValueKind,
  } from '../core/types';
  import Dialog from './components/Dialog.svelte';
  import PropertyPicker from './components/PropertyPicker.svelte';
  import ActionPicker from './components/ActionPicker.svelte';
  import MidiSourcePicker from './components/MidiSourcePicker.svelte';

  type MappingKind = 'midi' | 'bpm' | 'eq';
  type MidiType = 'direct' | 'cycle' | 'affect' | 'action' | 'script' | 'delta' | 'app';

  interface Props {
    kind: MappingKind;
    editing?: Binding | null;
    onclose: () => void;
  }
  let { kind, editing = null, onclose }: Props = $props();

  // ---------- draft state ----------
  let name = $state('');
  let midiType: MidiType | null = $state(null);
  let source: MidiSource | null = $state(null);
  let prop: PropertyRef | null = $state(null);
  let minText = $state('0');
  let maxText = $state('1');
  let curve: Curve = $state('linear');
  let invert = $state(false);
  let interpolate = $state(false);
  let behavior: 'instant' | 'toggle' = $state('instant');
  let affectBinding = $state('');
  let affectAdjust: 'mute' | 'range' | 'interval' = $state('mute');
  let actions: string[] = $state([]);
  let scripts: string[] = $state(['']);
  // Delta time: a number plus a unit for each end; stored in seconds.
  let deltaMin = $state('-1');
  let deltaMinUnit: TimeUnit = $state('days');
  let deltaMax = $state('1');
  let deltaMaxUnit: TimeUnit = $state('days');
  let appCommand: 'panic' | 'resync' | 'tap' = $state('panic');
  let every: BeatInterval = $state(4);
  let phaseOffset = $state(0);
  let bpmDrive: 'property' | 'cycle' | 'actions' | 'scripts' = $state('property');
  // Cycle lists: text for numbers/strings/selections/vectors, swatches for colors.
  let cycleText = $state('');
  let cycleColors: string[] = $state([]);
  let addColor = $state('#ffffff');
  let pingpong = $state(true);
  /** Glide length in beats; null = the whole interval (follows EVERY). */
  let glideBeats: number | null = $state(null);
  let easing = $state('Linear');
  let band: EqBand = $state('level');
  let gain = $state(1);
  let attackMs = $state(10);
  let releaseMs = $state(200);
  let threshold = $state(0.5);
  let testResult: { ok: boolean; text: string } | null = $state(null);
  let testing = $state(false);

  // ---------- cycle lists ----------
  const isColorRef = (p: PropertyRef | null) =>
    !!p && valueKind(p.type) === 'vector' && vectorSize(p.type) >= 3 && /colou?r/i.test(p.uri);
  const toHex = (v: number[]) =>
    `#${v.slice(0, 3).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`;

  /** Fill the list editor from saved values (edit). Runs before `prop` is reactive-derived, so it checks the value shapes. */
  function loadCycle(values: CycleValue[]) {
    if (values.every((v) => Array.isArray(v) && v.every((x) => typeof x === 'string'))) {
      cycleText = values.map((v) => (v as string[]).join(' + ')).join(', ');
    } else if (values.every((v) => Array.isArray(v))) {
      cycleColors = values.map((v) => toHex(v as number[]));
      cycleText = values.map((v) => (v as number[]).join(', ')).join('; ');
    } else {
      cycleText = values.map(String).join(', ');
    }
  }

  /** Parse the list editor into values for the chosen property. Null when something doesn't parse. */
  function parseCycle(): { values: CycleValue[] } | { error: string } {
    if (!prop) return { error: 'Pick a property.' };
    const k = valueKind(prop.type);
    const n = vectorSize(prop.type);
    if (k === 'vector' && isColorRef(prop)) {
      if (cycleColors.length < 2) return { error: 'Add at least two colors.' };
      return {
        values: cycleColors.map((hex) => {
          const v = [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000);
          if (n === 4) v.push(1);
          return v;
        }),
      };
    }
    if (k === 'vector') {
      const items = cycleText.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
      const vals = items.map((it) => it.split(',').map((x) => Number(x.trim())));
      if (vals.length < 2) return { error: `List at least two values, each ${n} numbers, separated by semicolons.` };
      if (vals.some((v) => v.length !== n || v.some((x) => !Number.isFinite(x)))) return { error: `Each value needs ${n} numbers.` };
      return { values: vals };
    }
    const items = cycleText.split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length < 2) return { error: 'List at least two values, separated by commas.' };
    if (k === 'string') return { values: items };
    if (k === 'list') {
      // Match names to the property's allowed options, case-insensitively ("orion" -> "Orion").
      const options = discovery.properties.find((p) => p.uri === prop!.uri)?.options;
      const unknown: string[] = [];
      const values = items.map((it) =>
        it
          .split('+')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => {
            if (!options) return name;
            const hit = options.find((o) => o.toLowerCase() === name.toLowerCase());
            if (!hit) unknown.push(name);
            return hit ?? name;
          }),
      );
      if (unknown.length) return { error: `Not an option for this property: ${unknown.join(', ')}.` };
      return { values };
    }
    const vals = items.map(Number);
    if (vals.some((x) => !Number.isFinite(x))) return { error: 'Every value must be a number.' };
    return { values: k === 'int' || k === 'option' ? vals.map(Math.round) : vals };
  }

  // ---------- load existing ----------
  const nums = (v: number | number[]) => (Array.isArray(v) ? v.join(', ') : String(v));
  const initial = untrack(() => editing);
  if (initial) {
    const b = initial;
    name = b.name;
    const a = b.action;
    if (b.source.kind === 'midi') {
      source = { ...b.source };
      midiType =
        a.type === 'property.set' || a.type === 'property.bool'
          ? 'direct'
          : a.type === 'property.cycle'
            ? 'cycle'
            : a.type === 'bpm.affect'
            ? 'affect'
            : a.type === 'action.trigger'
              ? 'action'
              : a.type === 'lua.script'
                ? 'script'
                : a.type === 'lua.value'
                  ? 'delta'
                  : 'app';
    } else if (b.source.kind === 'beat') {
      every = b.source.every;
      phaseOffset = b.source.phaseOffset;
    } else {
      band = b.source.band;
      const tf = (b as EqBinding).transform;
      gain = tf.gain;
      attackMs = tf.attackMs;
      releaseMs = tf.releaseMs;
    }
    switch (a.type) {
      case 'property.set':
        prop = { ...a.target };
        minText = nums(a.min);
        maxText = nums(a.max);
        curve = a.curve;
        invert = a.invert;
        interpolate = a.interpolate;
        break;
      case 'property.bool':
        prop = { ...a.target };
        behavior = a.behavior;
        break;
      case 'property.threshold':
        prop = { ...a.target };
        threshold = a.threshold;
        break;
      case 'bpm.affect':
        affectBinding = a.binding;
        affectAdjust = a.adjust;
        behavior = a.behavior;
        break;
      case 'action.trigger':
        actions = [a.action];
        break;
      case 'lua.script':
        scripts = [a.script];
        break;
      case 'lua.value':
        {
          const lo = asText(bestUnit(a.min));
          const hi = asText(bestUnit(a.max));
          deltaMin = lo.amount;
          deltaMinUnit = lo.unit;
          deltaMax = hi.amount;
          deltaMaxUnit = hi.unit;
        }
        curve = a.curve;
        break;
      case 'app':
        appCommand = a.command;
        break;
      case 'beat.toggle':
        bpmDrive = 'property';
        prop = { ...a.target };
        break;
      case 'beat.value':
        bpmDrive = 'property';
        prop = { ...a.target };
        minText = nums(a.min);
        maxText = nums(a.max);
        pingpong = a.shape === 'pingpong';
        glideBeats = a.glideBeats ?? (a.glide && a.glide !== 'full' ? glideBeatsOf(a, (b.source as { every: number }).every) : null);
        easing = validEasing(a.easing);
        break;
      case 'property.cycle':
      case 'beat.cycle':
        if (a.type === 'beat.cycle') bpmDrive = 'cycle';
        prop = { ...a.target };
        loadCycle(a.values);
        break;
      case 'beat.actions':
        bpmDrive = 'actions';
        actions = [...a.actions];
        break;
      case 'beat.scripts':
        bpmDrive = 'scripts';
        scripts = [...a.scripts];
        break;
    }
  }

  // ---------- derived ----------
  const pkind = $derived(prop ? valueKind(prop.type) : null);
  const isVector = $derived(pkind === 'vector');
  const isBool = $derived(pkind === 'bool');
  const size = $derived(prop ? vectorSize(prop.type) : 1);
  const isColor = $derived(!!prop && isVector && size >= 3 && /colou?r/i.test(prop.uri));
  const isCc = $derived(source?.message === 'cc');
  const isSelector = $derived(source?.control === 'selector');
  const continuousControl = $derived(!!source && isCc && source.control !== 'button');
  const bpmBindings = $derived(show.bindings.filter((b) => b.source.kind === 'beat'));
  const CYCLE_KINDS: ValueKind[] = ['number', 'int', 'option', 'vector', 'string', 'list'];
  const midiTypes: { v: MidiType; label: string; help: string }[] = [
    { v: 'direct', label: 'Direct property control', help: 'A fader or knob sets a number; a pad sets a bool.' },
    { v: 'cycle', label: 'Cycle values', help: 'Each press sets the next value from your list: colors, numbers, names.' },
    { v: 'affect', label: 'Affect BPM mapping', help: 'Mute, range or beat interval of an existing BPM mapping.' },
    { v: 'action', label: 'Trigger action', help: 'A pad fires an OpenSpace action once.' },
    { v: 'script', label: 'Custom script', help: 'A pad runs a Lua script once.' },
    { v: 'delta', label: 'Delta time', help: 'A knob or slider sets simulation speed.' },
    { v: 'app', label: 'App control', help: 'Panic, resync to downbeat or tap tempo from the controller.' },
  ];

  function parseVals(text: string): number[] | null {
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
    if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null;
    return parts;
  }
  function minMax(): { min: number | number[]; max: number | number[] } | null {
    const lo = parseVals(minText);
    const hi = parseVals(maxText);
    if (!lo || !hi) return null;
    if (isVector) {
      if (lo.length !== size || hi.length !== size) return null;
      return { min: lo, max: hi };
    }
    return { min: lo[0]!, max: hi[0]! };
  }

  /** Switching an existing glide to steps: start the list from its min and max. */
  function setDrive(d: 'cycle') {
    if (bpmDrive === 'property' && prop && !cycleText.trim() && cycleColors.length === 0) {
      if (isColorRef(prop)) {
        const lo = parseVals(minText);
        const hi = parseVals(maxText);
        if (lo && hi) cycleColors = [toHex(lo), toHex(hi)];
      } else if (valueKind(prop.type) === 'vector') {
        cycleText = `${minText}; ${maxText}`;
      } else if (valueKind(prop.type) !== 'bool') {
        cycleText = `${minText}, ${maxText}`;
      }
    }
    bpmDrive = d;
  }

  /** Glide shown in the dialog: the chosen beats, capped at EVERY. */
  const glideNow = $derived(glideBeats === null ? every : Math.min(glideBeats, every));

  function asText(r: { amount: number; unit: TimeUnit }): { amount: string; unit: TimeUnit } {
    return { amount: String(r.amount), unit: r.unit };
  }

  function setRange(n: number, unit: TimeUnit, c: Curve) {
    deltaMin = String(-n);
    deltaMax = String(n);
    deltaMinUnit = unit;
    deltaMaxUnit = unit;
    curve = c;
  }

  function pickProperty(p: PropertyEntry) {
    prop = { uri: p.uri, type: p.type };
    const k = valueKind(p.type);
    if (k === 'vector') {
      const n = vectorSize(p.type);
      const lo = Array.isArray(p.min) ? p.min : Array(n).fill(0);
      const hi = Array.isArray(p.max) ? p.max : Array(n).fill(1);
      minText = lo.slice(0, n).join(', ');
      maxText = hi.slice(0, n).join(', ');
    } else if (k === 'number' || k === 'int' || k === 'option') {
      minText = typeof p.min === 'number' && Number.isFinite(p.min) ? String(p.min) : '0';
      maxText = typeof p.max === 'number' && Number.isFinite(p.max) ? String(p.max) : k === 'option' ? '2' : '1';
    }
    if (!name) name = p.name;
  }

  // Colors: convert between hex and 0..1 components.
  function hexToVec(hex: string, n: number): string {
    const v = [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000);
    if (n === 4) v.push(1);
    return v.join(', ');
  }
  function vecToHex(text: string): string {
    const v = parseVals(text);
    if (!v || v.length < 3) return '#000000';
    return `#${v.slice(0, 3).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`;
  }

  // Affect BPM: pick a sensible default when the control changes (profile defaults).
  $effect(() => {
    if (kind !== 'midi' || midiType !== 'affect' || !source) return;
    if (source.message === 'note' && affectAdjust !== 'mute') affectAdjust = 'mute';
    if (source.message === 'cc' && affectAdjust === 'mute') {
      affectAdjust = source.control === 'slider' ? 'range' : 'interval';
    }
  });

  const warnings = $derived.by(() => {
    const w: string[] = [];
    if (kind === 'midi' && source) {
      if (midiType === 'direct' && prop) {
        if (isBool && continuousControl) w.push('A fader or knob on an on/off property: it switches on above the middle of its travel.');
        if (!isBool && !isCc && !isSelector) w.push('A pad on a number property jumps between min (released) and max (pressed).');
      }
      if ((midiType === 'action' || midiType === 'script' || midiType === 'app') && continuousControl) {
        w.push('This is meant for pads and buttons. A fader or knob fires each time it passes the middle.');
      }
      if (midiType === 'delta' && !isCc) w.push('Delta time needs a knob, slider or encoder.');
    }
    if (kind === 'bpm' && bpmDrive === 'actions') {
      const secs = (60 / show.bpm) * every;
      const names = actions.map((id) => discovery.actions.find((a) => a.identifier === id)?.name ?? id);
      if (names.some((n) => /fly|path|travel/i.test(n))) {
        w.push(`Fly-tos take several seconds. At ${fmtNum(show.bpm)} BPM this fires every ${fmtNum(secs)} s; make sure the flight is shorter than that.`);
      }
    }
    return w;
  });

  // ---------- build ----------
  const built = $derived.by((): { binding: Binding | null; problem: string | null } => {
    const id = editing?.id ?? '';
    const base = { id, name: name.trim(), muted: editing?.muted ?? false };
    if (kind === 'midi') {
      if (!midiType) return { binding: null, problem: 'Choose what the control does.' };
      if (!source) return { binding: null, problem: 'Learn or pick a MIDI control.' };
      switch (midiType) {
        case 'direct': {
          if (!prop) return { binding: null, problem: 'Pick a property.' };
          if (isBool) return { binding: { ...base, source, action: { type: 'property.bool', target: prop, behavior } }, problem: null };
          const mm = minMax();
          if (!mm) return { binding: null, problem: isVector ? `Min and max need ${size} numbers each.` : 'Min and max must be numbers.' };
          return { binding: { ...base, source, action: { type: 'property.set', target: prop, ...mm, curve, invert, interpolate } }, problem: null };
        }
        case 'cycle': {
          const c = parseCycle();
          if ('error' in c) return { binding: null, problem: c.error };
          return { binding: { ...base, source, action: { type: 'property.cycle', target: prop!, values: c.values } }, problem: null };
        }
        case 'affect':
          if (!affectBinding) return { binding: null, problem: 'Pick a BPM mapping to affect.' };
          return { binding: { ...base, source, action: { type: 'bpm.affect', binding: affectBinding, adjust: affectAdjust, behavior } }, problem: null };
        case 'action':
          if (!actions[0]) return { binding: null, problem: 'Pick an action.' };
          return { binding: { ...base, source, action: { type: 'action.trigger', action: actions[0] } }, problem: null };
        case 'script':
          if (!scripts[0]?.trim()) return { binding: null, problem: 'Paste a Lua script.' };
          return { binding: { ...base, source, action: { type: 'lua.script', script: scripts[0] } }, problem: null };
        case 'delta': {
          const lo = toSeconds(Number(deltaMin), deltaMinUnit);
          const hi = toSeconds(Number(deltaMax), deltaMaxUnit);
          if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return { binding: null, problem: 'Min must be a number below max.' };
          return { binding: { ...base, source, action: { type: 'lua.value', fn: LUA_DELTA_TIME, min: lo, max: hi, curve } }, problem: null };
        }
        case 'app':
          return { binding: { ...base, source, action: { type: 'app', command: appCommand } }, problem: null };
      }
    }
    if (kind === 'bpm') {
      const src = { kind: 'beat' as const, every, phaseOffset };
      if (bpmDrive === 'property') {
        if (!prop) return { binding: null, problem: 'Pick a property.' };
        if (isBool) return { binding: { ...base, source: src, action: { type: 'beat.toggle', target: prop } }, problem: null };
        const mm = minMax();
        if (!mm) return { binding: null, problem: isVector ? `Min and max need ${size} numbers each.` : 'Min and max must be numbers.' };
        return { binding: { ...base, source: src, action: { type: 'beat.value', target: prop, ...mm, shape: pingpong ? 'pingpong' : 'ramp', ...(glideBeats !== null && glideBeats < every ? { glideBeats } : {}), easing } }, problem: null };
      }
      if (bpmDrive === 'cycle') {
        const c = parseCycle();
        if ('error' in c) return { binding: null, problem: c.error };
        return { binding: { ...base, source: src, action: { type: 'beat.cycle', target: prop!, values: c.values } }, problem: null };
      }
      if (bpmDrive === 'actions') {
        if (actions.length === 0) return { binding: null, problem: 'Pick at least one action.' };
        return { binding: { ...base, source: src, action: { type: 'beat.actions', actions: [...actions] } }, problem: null };
      }
      const list = scripts.filter((s) => s.trim());
      if (list.length === 0) return { binding: null, problem: 'Paste at least one Lua script.' };
      return { binding: { ...base, source: src, action: { type: 'beat.scripts', scripts: list } }, problem: null };
    }
    // eq
    if (!prop) return { binding: null, problem: 'Pick a property.' };
    const transform = { gain, attackMs, releaseMs };
    const src = { kind: 'eq' as const, band };
    if (isBool) return { binding: { ...base, source: src, transform, action: { type: 'property.threshold', target: prop, threshold } }, problem: null };
    const mm = minMax();
    if (!mm) return { binding: null, problem: isVector ? `Min and max need ${size} numbers each.` : 'Min and max must be numbers.' };
    return { binding: { ...base, source: src, transform, action: { type: 'property.set', target: prop, ...mm, curve, invert, interpolate: false } }, problem: null };
  });

  function save() {
    const b = built.binding;
    if (!b) return;
    const final = { ...b, id: editing?.id ?? show.newId() } as Binding;
    if (editing) show.updateBinding(final);
    else show.addBinding(final);
    onclose();
  }

  async function test(i: number) {
    const api = connection.api;
    const script = scripts[i] ?? '';
    if (!api) {
      testResult = { ok: false, text: 'Not connected to OpenSpace.' };
      return;
    }
    testing = true;
    testResult = null;
    try {
      const r = await runScriptChecked(api, script);
      testResult = r.ok ? { ok: true, text: 'Ran without errors.' } : { ok: false, text: r.error };
    } catch (e) {
      testResult = { ok: false, text: e instanceof Error ? e.message : String(e) };
    } finally {
      testing = false;
    }
  }

  const title = $derived(
    (editing ? 'Edit ' : 'New ') + (kind === 'midi' ? 'MIDI mapping' : kind === 'bpm' ? 'BPM mapping' : 'EQ mapping'),
  );
  const bindingName = (id: string) => {
    const b = show.bindings.find((x) => x.id === id);
    return b ? b.name || actionLabel(b, () => '') : id;
  };
</script>

{#snippet minMaxFields(labelMin: string, labelMax: string)}
  <div class="pair">
    <label>
      <span class="label">{labelMin}</span>
      {#if isColor}
        <span class="color-row">
          <input type="color" value={vecToHex(minText)} oninput={(e) => (minText = hexToVec(e.currentTarget.value, size))} aria-label="Min color" />
          <input type="text" bind:value={minText} />
        </span>
      {:else}
        <input type="text" bind:value={minText} inputmode="decimal" />
      {/if}
    </label>
    <label>
      <span class="label">{labelMax}</span>
      {#if isColor}
        <span class="color-row">
          <input type="color" value={vecToHex(maxText)} oninput={(e) => (maxText = hexToVec(e.currentTarget.value, size))} aria-label="Max color" />
          <input type="text" bind:value={maxText} />
        </span>
      {:else}
        <input type="text" bind:value={maxText} inputmode="decimal" />
      {/if}
    </label>
  </div>
  {#if isColor}
    <div class="swatches">
      <span class="label">PALETTE</span>
      {#each show.file.palette.colors as c}
        <span class="swatch-pair">
          <button type="button" class="swatch" style:background={c} title="Set min to {c}" aria-label="Set min to {c}" onclick={() => (minText = hexToVec(c, size))}></button>
          <button type="button" class="swatch" style:background={c} title="Set max to {c}" aria-label="Set max to {c}" onclick={() => (maxText = hexToVec(c, size))}></button>
        </span>
      {/each}
      <span class="muted small">left = min, right = max</span>
    </div>
  {/if}
  {#if isVector && !isColor}<p class="muted small">{size} numbers each, comma separated.</p>{/if}
{/snippet}

{#snippet cycleEditor()}
  {#if isColorRef(prop)}
    <div class="cycle">
      <span class="label">COLORS, IN ORDER</span>
      <ol class="colors">
        {#each cycleColors as c, i (i)}
          <li>
            <input type="color" value={c} oninput={(e) => (cycleColors[i] = e.currentTarget.value)} aria-label="Color {i + 1}" />
            <span class="readout">{c.toUpperCase()}</span>
            <button type="button" class="mini" disabled={i === 0} aria-label="Move up" onclick={() => ([cycleColors[i - 1], cycleColors[i]] = [cycleColors[i]!, cycleColors[i - 1]!])}>UP</button>
            <button type="button" class="mini" aria-label="Remove" onclick={() => cycleColors.splice(i, 1)}>✕</button>
          </li>
        {/each}
      </ol>
      <div class="swatches">
        <input type="color" bind:value={addColor} aria-label="Color to add" />
        <button type="button" onclick={() => cycleColors.push(addColor)}>+ ADD</button>
        <span class="label">PALETTE</span>
        {#each show.file.palette.colors as c}
          <button type="button" class="swatch" style:background={c} title="Add {c}" aria-label="Add {c}" onclick={() => cycleColors.push(c.toLowerCase())}></button>
        {/each}
      </div>
    </div>
  {:else}
    {@const k = prop ? valueKind(prop.type) : 'number'}
    <label class="field">
      <span class="label">VALUES, IN ORDER</span>
      <input
        type="text"
        bind:value={cycleText}
        spellcheck="false"
        placeholder={k === 'vector'
          ? '0, 0, 1; 0.5, 0.5, 1; 1, 1, 1'
          : k === 'string' || k === 'list'
            ? 'Orion, Virgo, Aries'
            : '1, 20, 100'}
      />
    </label>
    <p class="muted small">
      {k === 'vector'
        ? `Separate values with semicolons; each value is ${size} numbers.`
        : k === 'list'
          ? 'Separate entries with commas. Each entry is selected on its own; join names with + to select several at once (Orion + Virgo).'
          : k === 'option'
            ? 'Option index numbers, separated by commas.'
            : 'Separate values with commas.'}
    </p>
    {#if cycleText.trim()}
      {@const parsed = parseCycle()}
      {#if 'values' in parsed}
        <div class="chips">
          {#each parsed.values as v, i}
            <span class="chip readout"><span class="muted">{i + 1}</span> {Array.isArray(v) ? (v.every((x) => typeof x === 'string') ? v.join(' + ') : `(${v.join(', ')})`) : String(v)}</span>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
{/snippet}

{#snippet rate(label: string, get: () => string, set: (v: string) => void, getUnit: () => TimeUnit, setUnit: (u: TimeUnit) => void)}
  <label>
    <span class="label">{label}</span>
    <span class="rate">
      <input type="text" inputmode="decimal" value={get()} oninput={(e) => set(e.currentTarget.value)} aria-label="{label} amount" />
      <select value={getUnit()} onchange={(e) => setUnit(e.currentTarget.value as TimeUnit)} aria-label="{label} unit">
        {#each TIME_UNITS as u}<option value={u.unit}>{u.label}</option>{/each}
      </select>
    </span>
  </label>
{/snippet}

{#snippet scriptEditor(i: number)}
  <div class="script">
    <textarea
      rows="4"
      spellcheck="false"
      bind:value={scripts[i]}
      placeholder={'openspace.setPropertyValueSingle("Scene.Earth.Renderable.Enabled", false)'}
    ></textarea>
    <div class="row">
      <button type="button" onclick={() => test(i)} disabled={testing || !scripts[i]?.trim()}>{testing ? 'RUNNING…' : 'TEST'}</button>
      {#if kind === 'bpm' && scripts.length > 1}
        <button type="button" onclick={() => scripts.splice(i, 1)}>REMOVE</button>
      {/if}
    </div>
  </div>
{/snippet}

<Dialog {title} index={kind === 'midi' ? '03 / MIDI' : kind === 'bpm' ? '02 / TEMPO' : '02 / EQ'} {onclose} wide>
  {#if kind === 'midi'}
    <fieldset>
      <legend class="label">WHAT IT DOES</legend>
      <div class="types">
        {#each midiTypes as t}
          <button type="button" class="type" aria-pressed={midiType === t.v} onclick={() => (midiType = t.v)}>
            <span>{t.label}</span>
            <span class="help">{t.help}</span>
          </button>
        {/each}
      </div>
    </fieldset>

    {#if midiType}
      <MidiSourcePicker value={source} onchange={(s) => (source = s)} />

      {#if midiType === 'direct'}
        <PropertyPicker value={prop} kinds={['number', 'int', 'bool', 'vector', 'option']} onpick={pickProperty} />
        {#if prop && isBool}
          <fieldset class="inline">
            <legend class="label">BEHAVIOR</legend>
            <button type="button" aria-pressed={behavior === 'instant'} onclick={() => (behavior = 'instant')}>INSTANT</button>
            <button type="button" aria-pressed={behavior === 'toggle'} onclick={() => (behavior = 'toggle')}>TOGGLE</button>
            <span class="muted small">{behavior === 'instant' ? 'On while held, off on release.' : 'Each press flips it.'}</span>
          </fieldset>
        {:else if prop}
          {@render minMaxFields('MIN (CC 0)', 'MAX (CC 127)')}
          <div class="inline">
            <label class="check"><input type="checkbox" checked={curve === 'exp'} onchange={(e) => (curve = e.currentTarget.checked ? 'exp' : 'linear')} /> Exponential curve</label>
            <label class="check"><input type="checkbox" bind:checked={invert} /> Invert</label>
            <label class="check" title="Asks OpenSpace to glide over one send interval. Costs a Lua call per message.">
              <input type="checkbox" bind:checked={interpolate} /> OpenSpace smoothing
            </label>
          </div>
        {/if}
      {:else if midiType === 'cycle'}
        <PropertyPicker value={prop} kinds={CYCLE_KINDS} onpick={pickProperty} />
        {#if prop}
          {@render cycleEditor()}
          <p class="muted small">
            {isSelector
              ? 'This is a selector: off, A and B each pick their own entry (1st, 2nd, 3rd).'
              : 'Each press sets the next value and loops. It starts after the current value when that is in the list.'}
          </p>
        {/if}
      {:else if midiType === 'affect'}
        <label class="field">
          <span class="label">BPM MAPPING</span>
          <select bind:value={affectBinding}>
            <option value="" disabled>Pick one</option>
            {#each bpmBindings as b}
              <option value={b.id}>{b.name || actionLabel(b, bindingName)} ({sourceLabel(b, undefined)})</option>
            {:else}
              <option value="" disabled>No BPM mappings yet. Make one first.</option>
            {/each}
          </select>
        </label>
        {#if source}
          {#if source.message === 'note'}
            <fieldset class="inline">
              <legend class="label">MUTE</legend>
              <button type="button" aria-pressed={behavior === 'instant'} onclick={() => (behavior = 'instant')}>INSTANT</button>
              <button type="button" aria-pressed={behavior === 'toggle'} onclick={() => (behavior = 'toggle')}>TOGGLE</button>
              <span class="muted small">{behavior === 'instant' ? 'Muted while held.' : 'Each press flips mute.'} A muted mapping holds its last value.</span>
            </fieldset>
          {:else}
            <fieldset class="inline">
              <legend class="label">ADJUSTS</legend>
              <button type="button" aria-pressed={affectAdjust === 'range'} onclick={() => (affectAdjust = 'range')}>RANGE</button>
              <button type="button" aria-pressed={affectAdjust === 'interval'} onclick={() => (affectAdjust = 'interval')}>BEAT INTERVAL</button>
              <span class="muted small">
                {affectAdjust === 'range'
                  ? 'Bottom collapses min/max to the midpoint; top is the full range.'
                  : 'Steps through every ½, 1, 2, 4, 8, 16 beats across the travel.'}
              </span>
            </fieldset>
          {/if}
        {/if}
      {:else if midiType === 'action'}
        <ActionPicker chosen={actions} onpick={(a) => (actions = [a.identifier])} onremove={() => (actions = [])} />
        <p class="muted small">Note on fires it once; note off does nothing. The pad LED flashes.</p>
      {:else if midiType === 'script'}
        <span class="label">LUA SCRIPT</span>
        {@render scriptEditor(0)}
        <p class="muted small">Note on runs it once. Scripts are saved in the mapping file, and loading a file with scripts asks first.</p>
      {:else if midiType === 'delta'}
        <div class="pair">
          {@render rate('MIN, PER SECOND', () => deltaMin, (v) => (deltaMin = v), () => deltaMinUnit, (u) => (deltaMinUnit = u))}
          {@render rate('MAX, PER SECOND', () => deltaMax, (v) => (deltaMax = v), () => deltaMaxUnit, (u) => (deltaMaxUnit = u))}
        </div>
        <div class="inline">
          <label class="check"><input type="checkbox" checked={curve === 'exp'} onchange={(e) => (curve = e.currentTarget.checked ? 'exp' : 'linear')} /> Exponential (more travel near zero)</label>
          <button type="button" onclick={() => setRange(1, 'days', 'linear')}>±1 DAY/S</button>
          <button type="button" onclick={() => setRange(1, 'years', 'exp')}>±1 YEAR/S</button>
        </div>
        <p class="muted small">Simulated seconds per real second; negatives run time backwards. Endless encoders step from the current value.</p>
      {:else if midiType === 'app'}
        <fieldset class="inline">
          <legend class="label">COMMAND</legend>
          <button type="button" aria-pressed={appCommand === 'panic'} onclick={() => (appCommand = 'panic')}>PANIC</button>
          <button type="button" aria-pressed={appCommand === 'resync'} onclick={() => (appCommand = 'resync')}>RESYNC</button>
          <button type="button" aria-pressed={appCommand === 'tap'} onclick={() => (appCommand = 'tap')}>TAP TEMPO</button>
        </fieldset>
      {/if}
    {/if}
  {:else if kind === 'bpm'}
    <fieldset class="inline">
      <legend class="label">EVERY</legend>
      {#each BEAT_INTERVALS as n}
        <button type="button" class="num" aria-pressed={every === n} onclick={() => (every = n)}>{beatsLabel(n)}</button>
      {/each}
      <span class="muted small">beats, counted from the downbeat</span>
    </fieldset>
    <fieldset class="inline">
      <legend class="label">DRIVES</legend>
      <button type="button" aria-pressed={bpmDrive === 'property'} onclick={() => (bpmDrive = 'property')}>GLIDE MIN ↔ MAX</button>
      <button type="button" aria-pressed={bpmDrive === 'cycle'} onclick={() => setDrive('cycle')}>STEP THROUGH VALUES</button>
      <button type="button" aria-pressed={bpmDrive === 'actions'} onclick={() => (bpmDrive = 'actions')}>ACTIONS</button>
      <button type="button" aria-pressed={bpmDrive === 'scripts'} onclick={() => (bpmDrive = 'scripts')}>SCRIPTS</button>
      <p class="muted small drive-help">
        {bpmDrive === 'property'
          ? 'Moves smoothly between min and max over the beats (on/off properties flip instead).'
          : bpmDrive === 'cycle'
            ? 'Sets the next value from your list at each beat boundary. No blending in between.'
            : bpmDrive === 'actions'
              ? 'Fires OpenSpace actions, one per beat boundary.'
              : 'Runs Lua scripts, one per beat boundary.'}
      </p>
    </fieldset>
    {#if bpmDrive === 'property'}
      <PropertyPicker value={prop} kinds={['bool', 'number', 'int', 'vector']} onpick={pickProperty} />
      {#if prop && isBool}
        <p class="muted small">Flips on and off every {everyLabel(every)}.</p>
      {:else if prop}
        {@render minMaxFields('MIN', 'MAX')}
        <fieldset class="inline">
          <legend class="label">GLIDE TIME</legend>
          <select
            value={String(glideNow)}
            onchange={(e) => {
              const n = Number(e.currentTarget.value);
              glideBeats = n >= every ? null : n;
            }}
            aria-label="Glide time in beats"
          >
            {#each GLIDE_BEATS.filter((n) => n <= every) as n}
              <option value={String(n)}>{everyLabel(n)}{n === every ? ' (whole interval)' : ''}</option>
            {/each}
          </select>
          <span class="muted small">
            {fmtNum((60 / show.bpm) * glideNow)} s at {fmtNum(show.bpm)} BPM{glideNow < every ? `, then holds for ${everyLabel(every - glideNow)}` : ''}
          </span>
        </fieldset>
        <label class="field narrow">
          <span class="label">EASING</span>
          <select bind:value={easing}>
            <option value="Linear">Linear (constant speed)</option>
            {#each EASING_FAMILIES as fam}
              <optgroup label={fam}>
                <option value="{fam}EaseIn">{fam} in (slow start)</option>
                <option value="{fam}EaseOut">{fam} out (slow finish)</option>
                <option value="{fam}EaseInOut">{fam} in-out (slow start and finish)</option>
              </optgroup>
            {/each}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={pingpong} />
          Up and down: glide to max, next time back to min. Off: snap to min, then glide to max.
        </label>
        <p class="muted small">Fires every {everyLabel(every)}; OpenSpace animates each glide, so it stays smooth at any tempo.</p>
      {/if}
    {:else if bpmDrive === 'cycle'}
      <PropertyPicker value={prop} kinds={CYCLE_KINDS} onpick={pickProperty} />
      {#if prop}
        {@render cycleEditor()}
        <p class="muted small">Steps to the next value every {everyLabel(every)}, looping.</p>
      {/if}
    {:else if bpmDrive === 'actions'}
      <ActionPicker
        multiple
        chosen={actions}
        onpick={(a) => (actions = [...actions, a.identifier])}
        onremove={(i) => (actions = actions.filter((_, j) => j !== i))}
        onmove={(i, d) => {
          const next = [...actions];
          [next[i], next[i + d]] = [next[i + d]!, next[i]!];
          actions = next;
        }}
      />
      <p class="muted small">One action fires the same one each time; a list advances one step per firing and loops.</p>
    {:else}
      <span class="label">LUA SCRIPTS, IN ORDER</span>
      {#each scripts as _, i (i)}
        {@render scriptEditor(i)}
      {/each}
      <button type="button" onclick={() => scripts.push('')}>+ ADD SCRIPT</button>
    {/if}
    <label class="field narrow">
      <span class="label">PHASE OFFSET (BEATS)</span>
      <input type="number" step="0.25" bind:value={phaseOffset} />
    </label>
  {:else}
    <fieldset class="inline">
      <legend class="label">SOURCE</legend>
      {#each ['level', 'low', 'mid', 'high'] as const as b}
        <button type="button" aria-pressed={band === b} onclick={() => (band = b)}>{b.toUpperCase()}</button>
      {/each}
    </fieldset>
    <PropertyPicker value={prop} kinds={['bool', 'number', 'int', 'vector']} onpick={pickProperty} />
    {#if prop && isBool}
      <label class="field narrow">
        <span class="label">ON ABOVE ({fmtNum(threshold)})</span>
        <input type="range" min="0" max="1" step="0.01" bind:value={threshold} />
      </label>
    {:else if prop}
      {@render minMaxFields('MIN (SILENCE)', 'MAX (FULL)')}
      <div class="inline">
        <label class="check"><input type="checkbox" checked={curve === 'exp'} onchange={(e) => (curve = e.currentTarget.checked ? 'exp' : 'linear')} /> Exponential</label>
        <label class="check"><input type="checkbox" bind:checked={invert} /> Invert</label>
      </div>
    {/if}
    <div class="pair three">
      <label><span class="label">GAIN ×{fmtNum(gain)}</span><input type="range" min="0.25" max="8" step="0.05" bind:value={gain} /></label>
      <label><span class="label">ATTACK {attackMs} MS</span><input type="range" min="0" max="500" step="5" bind:value={attackMs} /></label>
      <label><span class="label">RELEASE {releaseMs} MS</span><input type="range" min="0" max="2000" step="10" bind:value={releaseMs} /></label>
    </div>
  {/if}

  {#if kind !== 'midi' || midiType}
    <label class="field">
      <span class="label">NAME (OPTIONAL)</span>
      <input type="text" bind:value={name} placeholder="Saturn rings fade" />
    </label>
  {/if}

  {#each warnings as w}
    <p class="warning"><strong class="label">CHECK</strong> {w}</p>
  {/each}
  {#if testResult}
    <p class={testResult.ok ? 'ok' : 'warning'}>
      <strong class="label">{testResult.ok ? 'TEST OK' : 'LUA ERROR'}</strong>
      <span class="readout">{testResult.text}</span>
    </p>
  {/if}

  {#snippet footer()}
    {#if built.problem}<span class="muted problem">{built.problem}</span>{/if}
    <button type="button" onclick={onclose}>CANCEL</button>
    <button type="button" class="primary" disabled={!built.binding} onclick={save}>SAVE</button>
  {/snippet}
</Dialog>

<style>
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--space-2);
  }
  .types {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-2);
  }
  .type {
    height: auto;
    min-height: 64px;
    display: grid;
    gap: var(--space-1);
    text-align: left;
    padding: var(--space-2) var(--space-3);
  }
  .type .help {
    font-family: var(--font-sans);
    font-weight: 400;
    font-size: 13px;
    line-height: 18px;
    letter-spacing: 0;
    text-transform: none;
  }
  .inline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .inline legend {
    width: 100%;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .pair.three {
    grid-template-columns: repeat(3, 1fr);
  }
  .pair label,
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .field.narrow {
    max-width: 260px;
  }
  .rate {
    display: flex;
    gap: var(--space-2);
  }
  .rate input {
    flex: 1;
    min-width: 0;
  }
  .color-row {
    display: flex;
    gap: var(--space-2);
  }
  .color-row input[type='text'] {
    flex: 1;
    min-width: 0;
  }
  input[type='color'] {
    width: 44px;
    height: var(--button-h);
    padding: 2px;
    background: var(--raised);
    border: var(--stroke-hair) solid var(--line);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .swatch-pair {
    display: inline-flex;
    gap: 1px;
  }
  .cycle {
    display: grid;
    gap: var(--space-2);
  }
  .colors {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .colors li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--raised);
  }
  .colors li .readout {
    flex: 1;
  }
  .mini {
    height: 28px;
    padding: 0 var(--space-2);
    font-size: 12px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .chip {
    padding: 2px var(--space-2);
    background: var(--raised);
    border: var(--stroke-hair) solid var(--line);
  }
  .swatch {
    width: 22px;
    height: 22px;
    padding: 0;
    border: var(--stroke-hair) solid var(--line);
    border-radius: var(--radius-1);
  }
  .check {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
  }
  .num {
    min-width: 44px;
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
  }
  textarea {
    width: 100%;
    background: var(--raised);
    color: var(--ink);
    border: var(--stroke-hair) solid var(--line);
    font-family: var(--font-mono);
    font-size: 13px;
    padding: var(--space-2);
    resize: vertical;
  }
  .script {
    display: grid;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  .small {
    font-size: 13px;
    margin: 0;
  }
  .warning,
  .ok {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--raised);
    border-left: var(--stroke-bold) solid var(--warn);
    overflow-wrap: anywhere;
  }
  .warning .label {
    color: var(--warn);
    margin-right: var(--space-2);
  }
  .ok {
    border-left-color: var(--midi);
  }
  .ok .label {
    color: var(--midi);
    margin-right: var(--space-2);
  }
  .drive-help {
    width: 100%;
  }
  .problem {
    margin-right: auto;
    align-self: center;
    font-size: 13px;
  }
  @media (max-width: 600px) {
    .pair,
    .pair.three {
      grid-template-columns: 1fr;
    }
  }
</style>
