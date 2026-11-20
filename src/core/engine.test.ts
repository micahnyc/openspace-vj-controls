import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { parseMidi } from './midi/parse';
import type { OutMsg } from './scheduler';
import type { BeatBinding, Binding, EqBinding, MidiBinding, MidiSource } from './types';

function setup(bindings: Binding[], opts: { missing?: string[] } = {}) {
  const values: { key: string; msg: OutMsg }[] = [];
  const events: OutMsg[] = [];
  const leds: string[] = [];
  const apps: string[] = [];
  const engine = new Engine(
    {
      value: (key, msg) => values.push({ key, msg }),
      event: (msg) => events.push(msg),
      led: (_d, ch, n, s) => leds.push(`${ch}:${n}:${s}`),
      app: (c) => apps.push(c),
    },
    {
      available: (b) => !('target' in b.action && opts.missing?.includes(b.action.target.uri)),
      limits: (uri) => (uri.endsWith('Opacity') ? { min: 0, max: 1 } : undefined),
    },
  );
  engine.setBindings(bindings);
  const midi = (bytes: number[], t = 0) => engine.handleMidi('apc', parseMidi(bytes, 'APC40 mkII', t)!);
  return { engine, values, events, leds, apps, midi };
}

const cc = (number: number, extra: Partial<MidiSource> = {}): MidiSource => ({
  kind: 'midi',
  device: 'apc',
  channel: 1,
  message: 'cc',
  number,
  mode: 'absolute',
  control: 'slider',
  ...extra,
});
const note = (number: number): MidiSource => ({ ...cc(number), message: 'note', control: 'pad' });
const opacity = { uri: 'Scene.SaturnRings.Renderable.Opacity', type: 'Float' };
const enabled = { uri: 'Scene.EarthTrail.Renderable.Enabled', type: 'Bool' };

const fader: MidiBinding = {
  id: 'f',
  name: '',
  muted: false,
  source: cc(48),
  action: { type: 'property.set', target: opacity, min: 0.2, max: 1, curve: 'linear', invert: false, interpolate: false },
};

describe('direct property control', () => {
  it('maps CC 0..127 across min..max', () => {
    const { values, midi } = setup([fader]);
    midi([0xb0, 48, 127]);
    midi([0xb0, 48, 0]);
    expect(values.map((v) => (v.msg as { value: number }).value)).toEqual([1, 0.2]);
    expect(values[0]!.key).toBe('prop:Scene.SaturnRings.Renderable.Opacity');
  });

  it('ignores other devices, channels and numbers', () => {
    const { values, engine } = setup([fader]);
    engine.handleMidi('other', parseMidi([0xb0, 48, 127], 'x', 0)!);
    engine.handleMidi('apc', parseMidi([0xb1, 48, 127], 'x', 0)!);
    engine.handleMidi('apc', parseMidi([0xb0, 49, 127], 'x', 0)!);
    expect(values).toHaveLength(0);
  });

  it('skips muted bindings and bindings with a missing target', () => {
    const a = setup([{ ...fader, muted: true }]);
    a.midi([0xb0, 48, 127]);
    expect(a.values).toHaveLength(0);
    const b = setup([fader], { missing: [opacity.uri] });
    b.midi([0xb0, 48, 127]);
    expect(b.values).toHaveLength(0);
  });

  it('clamps to property limits', () => {
    const { values, midi } = setup([
      { ...fader, action: { ...fader.action, min: -1, max: 2 } as MidiBinding['action'] },
    ]);
    midi([0xb0, 48, 127]);
    expect((values[0]!.msg as { value: number }).value).toBe(1);
  });

  it('bool instant: note on sets true, note off false', () => {
    const { events, midi, leds } = setup([
      { id: 'b', name: '', muted: false, source: note(5), action: { type: 'property.bool', target: enabled, behavior: 'instant' } },
    ]);
    midi([0x90, 5, 127]);
    midi([0x80, 5, 0]);
    expect(events.map((e) => (e as { value: boolean }).value)).toEqual([true, false]);
    expect(leds).toEqual(['1:5:on', '1:5:off']);
  });

  it('bool toggle flips from the observed value on each press', () => {
    const { events, midi, engine } = setup([
      { id: 'b', name: '', muted: false, source: note(5), action: { type: 'property.bool', target: enabled, behavior: 'toggle' } },
    ]);
    engine.observe(enabled.uri, true, -1000);
    midi([0x90, 5, 127]);
    midi([0x80, 5, 0]);
    midi([0x90, 5, 127]);
    expect(events.map((e) => (e as { value: boolean }).value)).toEqual([false, true]);
  });

  it('CC buttons count as on above 63', () => {
    const { events, midi } = setup([
      { id: 'b', name: '', muted: false, source: { ...cc(7), control: 'button' }, action: { type: 'property.bool', target: enabled, behavior: 'instant' } },
    ]);
    midi([0xb0, 7, 64]);
    midi([0xb0, 7, 100]); // still on: no repeat
    midi([0xb0, 7, 63]);
    expect(events.map((e) => (e as { value: boolean }).value)).toEqual([true, false]);
  });
});

describe('pickup after reconnect', () => {
  it('ignores the fader until it crosses the current value', () => {
    const { values, midi, engine } = setup([{ ...fader, action: { ...fader.action, min: 0, max: 1 } as MidiBinding['action'] }]);
    engine.beginSync();
    midi([0xb0, 48, 10]);
    expect(values).toHaveLength(0); // gated while syncing
    engine.endSync(new Map([[opacity.uri, 0.5]]), 0);
    midi([0xb0, 48, 10]);
    midi([0xb0, 48, 40]);
    expect(values).toHaveLength(0);
    midi([0xb0, 48, 70]); // crossed 0.5
    expect(values).toHaveLength(1);
    midi([0xb0, 48, 80]);
    expect(values).toHaveLength(2);
  });
});

describe('triggers and scripts', () => {
  it('fires an action once on note on and flashes the pad', () => {
    const { events, midi, leds } = setup([
      { id: 'a', name: '', muted: false, source: note(0), action: { type: 'action.trigger', action: 'os.flyToSaturn' } },
    ]);
    midi([0x90, 0, 127]);
    midi([0x80, 0, 0]);
    expect(events).toEqual([{ kind: 'action', id: 'os.flyToSaturn' }]);
    expect(leds).toEqual(['1:0:flash']);
  });

  it('runs a script on note on', () => {
    const { events, midi } = setup([
      { id: 's', name: '', muted: false, source: note(1), action: { type: 'lua.script', script: 'openspace.printInfo("hi")' } },
    ]);
    midi([0x90, 1, 127]);
    expect(events).toEqual([{ kind: 'lua', script: 'openspace.printInfo("hi")' }]);
  });

  it('app commands reach the app', () => {
    const { apps, midi } = setup([{ id: 'p', name: '', muted: false, source: note(2), action: { type: 'app', command: 'panic' } }]);
    midi([0x90, 2, 127]);
    expect(apps).toEqual(['panic']);
  });
});

describe('delta time', () => {
  const dt: MidiBinding = {
    id: 'd',
    name: '',
    muted: false,
    source: cc(13, { mode: 'relative-signed-bit7', control: 'encoder' }),
    action: { type: 'lua.value', fn: 'openspace.time.setDeltaTime', min: -100, max: 100, curve: 'linear' },
  };

  it('absolute CC maps across min..max', () => {
    const { values, midi } = setup([{ ...dt, source: cc(48) }]);
    midi([0xb0, 48, 127]);
    expect(values[0]!.msg).toEqual({ kind: 'luaValue', fn: 'openspace.time.setDeltaTime', value: 100 });
    expect(values[0]!.key).toBe('lua:openspace.time.setDeltaTime');
  });

  it('encoder steps from the current value and clamps to the range', () => {
    const { values, midi, engine } = setup([dt]);
    engine.setLuaValue('openspace.time.setDeltaTime', 0);
    midi([0xb0, 13, 1]);
    midi([0xb0, 13, 127]);
    midi([0xb0, 13, 127]);
    const v = values.map((x) => (x.msg as { value: number }).value);
    expect(v[0]).toBeGreaterThan(0);
    expect(v[2]).toBeLessThan(0);
    for (let i = 0; i < 200; i++) midi([0xb0, 13, 63]);
    expect((values[values.length - 1]!.msg as { value: number }).value).toBe(100);
  });
});

describe('BPM bindings', () => {
  const toggle: BeatBinding = {
    id: 't',
    name: '',
    muted: false,
    source: { kind: 'beat', every: 4, phaseOffset: 0 },
    action: { type: 'beat.toggle', target: enabled },
  };
  const ramp: BeatBinding = {
    id: 'r',
    name: '',
    muted: false,
    source: { kind: 'beat', every: 2, phaseOffset: 0 },
    action: { type: 'beat.value', target: opacity, min: 0.2, max: 1, shape: 'pingpong' },
  };

  it('bool flips every N beats from the downbeat', () => {
    const { events, engine } = setup([toggle]);
    engine.tempo.setBpm(120, 0);
    engine.tempo.resync(0);
    for (let t = 0; t <= 8000; t += 10) engine.tick(t);
    // 120 BPM, every 4 beats = every 2 s: initial state then flips at 2, 4, 6, 8 s
    expect(events.map((e) => (e as { value: boolean }).value)).toEqual([true, false, true, false, true]);
  });

  type Set = { value: number; interpolateSeconds?: number };

  it('glides up and down: one interpolated set per firing, alternating max and min', () => {
    const { events, engine } = setup([ramp]);
    engine.tempo.setBpm(120, 0);
    engine.tempo.resync(0);
    for (let t = 0; t <= 2000; t += 10) engine.tick(t); // every 2 beats at 120 BPM = every 1 s
    const sets = events as unknown as Set[];
    expect(sets.map((e) => e.value)).toEqual([1, 0.2, 1]);
    expect(sets[0]!.interpolateSeconds).toBeCloseTo(1); // full interval
  });

  it('glide time is a fraction of the interval (every 16 beats, quarter = 4 beats)', () => {
    const moon = { ...ramp, source: { kind: 'beat' as const, every: 16 as const, phaseOffset: 0 }, action: { ...ramp.action, glide: 'quarter' } } as BeatBinding;
    const { events, engine } = setup([moon]);
    engine.tempo.setBpm(120, 0);
    engine.tempo.resync(0);
    engine.tick(0);
    expect((events[0] as unknown as Set).interpolateSeconds).toBeCloseTo(2); // 4 beats at 120 BPM
  });

  it('ramp snaps to min, then glides to max', () => {
    const { events, engine } = setup([{ ...ramp, action: { ...ramp.action, shape: 'ramp' } } as BeatBinding]);
    engine.tempo.setBpm(120, 0);
    engine.tempo.resync(0);
    engine.tick(0);
    expect(events as unknown as Set[]).toEqual([
      { kind: 'set', uri: opacity.uri, value: 0.2 },
      { kind: 'set', uri: opacity.uri, value: 1, interpolateSeconds: 1, easing: 'Linear' },
    ]);
  });

  it('MIDI mute (instant) holds the property while the pad is down', () => {
    const { events, engine, midi } = setup([
      ramp,
      { id: 'm', name: '', muted: false, source: note(9), action: { type: 'bpm.affect', binding: 'r', adjust: 'mute', behavior: 'instant' } },
    ]);
    engine.tempo.setBpm(120, 0);
    engine.tempo.resync(0);
    engine.tick(0);
    midi([0x90, 9, 127]);
    engine.tick(1000); // boundary while muted: nothing
    expect(events).toHaveLength(1);
    midi([0x80, 9, 0]);
    engine.tick(2000); // next boundary after unmute
    expect(events).toHaveLength(2);
  });

  it('range slider narrows around the midpoint; interval knob changes N', () => {
    const { events, engine, midi } = setup([
      ramp,
      { id: 'g', name: '', muted: false, source: cc(7), action: { type: 'bpm.affect', binding: 'r', adjust: 'range', behavior: 'instant' } },
      { id: 'i', name: '', muted: false, source: cc(48, { control: 'knob' }), action: { type: 'bpm.affect', binding: 'r', adjust: 'interval', behavior: 'instant' } },
    ]);
    engine.tempo.setBpm(120, 0);
    engine.tempo.resync(0);
    midi([0xb0, 7, 0]);
    engine.tick(0);
    expect((events[0] as unknown as { value: number }).value).toBeCloseTo(0.6);
    midi([0xb0, 48, 127]);
    expect(engine.effectiveInterval(ramp)).toBe(16);
  });

  it('action lists advance one step per firing and loop', () => {
    const { events, engine } = setup([
      { id: 'a', name: '', muted: false, source: { kind: 'beat', every: 1, phaseOffset: 0 }, action: { type: 'beat.actions', actions: ['e', 'm', 's'] } },
    ]);
    engine.tempo.setBpm(60, 0);
    engine.tempo.resync(0);
    for (let t = 0; t <= 4000; t += 50) engine.tick(t);
    expect(events.map((e) => (e as { id: string }).id)).toEqual(['e', 'm', 's', 'e']);
  });

  it('panic hold stops BPM output', () => {
    const { events, engine } = setup([ramp]);
    engine.hold = true;
    engine.tick(0);
    expect(events).toHaveLength(0);
  });
});

describe('EQ bindings', () => {
  const eq: EqBinding = {
    id: 'e',
    name: '',
    muted: false,
    source: { kind: 'eq', band: 'low' },
    transform: { gain: 1, attackMs: 0, releaseMs: 0 },
    action: { type: 'property.set', target: opacity, min: 0, max: 1, curve: 'linear', invert: false, interpolate: false },
  };

  it('follows the band level across min..max', () => {
    const { values, engine } = setup([eq]);
    engine.setEq({ low: 0.5 });
    engine.tick(0);
    expect((values[0]!.msg as { value: number }).value).toBeCloseTo(0.5);
  });

  it('bool properties switch on above the threshold', () => {
    const { events, engine } = setup([
      { ...eq, action: { type: 'property.threshold', target: enabled, threshold: 0.6 } },
    ]);
    engine.setEq({ low: 0.5 });
    engine.tick(0);
    engine.setEq({ low: 0.7 });
    engine.tick(10);
    engine.tick(20);
    engine.setEq({ low: 0.1 });
    engine.tick(30);
    expect(events.map((e) => (e as { value: boolean }).value)).toEqual([false, true, false]);
  });
});

describe('selector (APC40 A|B assign)', () => {
  const ab = (action: MidiBinding['action']): MidiBinding => ({
    id: 'ab',
    name: '',
    muted: false,
    source: { kind: 'midi', device: 'apc', channel: 5, message: 'note', number: 66, mode: 'absolute', control: 'selector', states: 3 },
    action,
  });

  it('spreads off/A/B across min..max', () => {
    const { values, engine } = setup([
      ab({ type: 'property.set', target: { uri: 'Scene.X.Index', type: 'Int' }, min: 0, max: 2, curve: 'linear', invert: false, interpolate: false }),
    ]);
    const send = (bytes: number[]) => engine.handleMidi('apc', parseMidi(bytes, 'x', 0)!);
    send([0x94, 66, 1]);
    send([0x94, 66, 2]);
    send([0x84, 66, 0]);
    expect(values.map((v) => (v.msg as { value: number }).value)).toEqual([1, 2, 0]);
  });

  it('bool is on for A or B, off for neither', () => {
    const { events, engine } = setup([ab({ type: 'property.bool', target: enabled, behavior: 'instant' })]);
    const send = (bytes: number[]) => engine.handleMidi('apc', parseMidi(bytes, 'x', 0)!);
    send([0x94, 66, 1]);
    send([0x94, 66, 2]);
    send([0x84, 66, 0]);
    expect(events.map((e) => (e as { value: boolean }).value)).toEqual([true, true, false]);
  });
});

describe('cycle', () => {
  const colors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const color = { uri: 'Scene.Stars.Renderable.FixedColor', type: 'Vec3' };

  it('each pad press sends the next value and loops', () => {
    const { events, midi } = setup([
      { id: 'c', name: '', muted: false, source: note(3), action: { type: 'property.cycle', target: color, values: colors } },
    ]);
    for (let i = 0; i < 4; i++) {
      midi([0x90, 3, 127]);
      midi([0x80, 3, 0]);
    }
    expect(events.map((e) => (e as { value: unknown }).value)).toEqual([colors[0], colors[1], colors[2], colors[0]]);
  });

  it('continues from the current value when it is in the list', () => {
    const { events, midi, engine } = setup([
      { id: 'c', name: '', muted: false, source: note(3), action: { type: 'property.cycle', target: { uri: 'Scene.X.Scale', type: 'Double' }, values: [1, 20, 100] } },
    ]);
    engine.observe('Scene.X.Scale', 20, -1000);
    midi([0x90, 3, 127]);
    expect((events[0] as { value: number }).value).toBe(100);
  });

  it('selection lists cycle as one-item string lists', () => {
    const sel = { uri: 'Scene.Constellations.Renderable.ConstellationSelection', type: 'Selection' };
    const { events, midi } = setup([
      { id: 'c', name: '', muted: false, source: note(4), action: { type: 'property.cycle', target: sel, values: [['Orion'], ['Virgo'], ['Aries']] } },
    ]);
    midi([0x90, 4, 127]);
    midi([0x80, 4, 0]);
    midi([0x90, 4, 127]);
    expect(events.map((e) => (e as { value: unknown }).value)).toEqual([['Orion'], ['Virgo']]);
  });

  it('BPM cycle steps every N beats', () => {
    const { events, engine } = setup([
      { id: 'c', name: '', muted: false, source: { kind: 'beat', every: 1, phaseOffset: 0 }, action: { type: 'beat.cycle', target: color, values: colors } },
    ]);
    engine.tempo.setBpm(60, 0);
    engine.tempo.resync(0);
    for (let t = 0; t <= 3000; t += 50) engine.tick(t);
    expect(events.map((e) => (e as { value: unknown }).value)).toEqual([colors[0], colors[1], colors[2]]);
  });

  it('A|B selector picks the entry for its state', () => {
    const { events, engine } = setup([
      {
        id: 'c',
        name: '',
        muted: false,
        source: { kind: 'midi', device: 'apc', channel: 1, message: 'note', number: 66, mode: 'absolute', control: 'selector', states: 3 },
        action: { type: 'property.cycle', target: { uri: 'Scene.X.Scale', type: 'Double' }, values: [1, 20, 100] },
      },
    ]);
    const send = (bytes: number[]) => engine.handleMidi('apc', parseMidi(bytes, 'x', 0)!);
    send([0x90, 66, 2]);
    send([0x80, 66, 0]);
    expect(events.map((e) => (e as { value: number }).value)).toEqual([100, 1]);
  });
});

describe('ledStates', () => {
  it('lists pads whose bool is on and pads muting a BPM mapping', () => {
    const ramp: BeatBinding = {
      id: 'r',
      name: '',
      muted: false,
      source: { kind: 'beat', every: 2, phaseOffset: 0 },
      action: { type: 'beat.value', target: opacity, min: 0, max: 1, shape: 'pingpong' },
    };
    const { engine, midi } = setup([
      ramp,
      { id: 'b', name: '', muted: false, source: note(5), action: { type: 'property.bool', target: enabled, behavior: 'toggle' } },
      { id: 'm', name: '', muted: false, source: note(9), action: { type: 'bpm.affect', binding: 'r', adjust: 'mute', behavior: 'toggle' } },
      { id: 'a', name: '', muted: false, source: note(1), action: { type: 'action.trigger', action: 'x' } },
    ]);
    expect(engine.ledStates('apc')).toEqual([]);
    engine.observe(enabled.uri, true, -1000);
    midi([0x90, 9, 127]);
    expect(engine.ledStates('apc')).toEqual([
      { channel: 1, number: 5 },
      { channel: 1, number: 9 },
    ]);
    expect(engine.ledStates('other')).toEqual([]);
  });
});

describe('ringValues', () => {
  it('places knobs at the current value of what they control', () => {
    const ramp: BeatBinding = {
      id: 'r',
      name: '',
      muted: false,
      source: { kind: 'beat', every: 4, phaseOffset: 0 },
      action: { type: 'beat.value', target: enabled, min: 0, max: 1, shape: 'pingpong' },
    };
    const { engine } = setup([
      ramp,
      { ...fader, action: { ...fader.action, min: 0, max: 1 } as MidiBinding['action'] },
      { id: 'd', name: '', muted: false, source: cc(49, { control: 'knob' }), action: { type: 'lua.value', fn: 'openspace.time.setDeltaTime', min: -100, max: 100, curve: 'linear' } },
      { id: 'i', name: '', muted: false, source: cc(50, { control: 'knob' }), action: { type: 'bpm.affect', binding: 'r', adjust: 'interval', behavior: 'instant' } },
      { id: 'e', name: '', muted: false, source: cc(13, { mode: 'relative-signed-bit7', control: 'encoder' }), action: { type: 'lua.value', fn: 'x', min: 0, max: 1, curve: 'linear' } },
    ]);
    engine.observe(opacity.uri, 0.5, -1000);
    engine.setLuaValue('openspace.time.setDeltaTime', 0);
    const rings = engine.ringValues('apc');
    expect(rings).toEqual([
      { channel: 1, number: 48, value: 64 },
      { channel: 1, number: 49, value: 64 },
      { channel: 1, number: 50, value: 74 }, // every 4 = 4th of 6 steps (½,1,2,4,8,16)
    ]);
    expect(engine.ringValues('apc', opacity.uri)).toEqual([{ channel: 1, number: 48, value: 64 }]);
  });
});

describe('half-beat interval', () => {
  it('fires twice per beat', () => {
    const { events, engine } = setup([
      { id: 'h', name: '', muted: false, source: { kind: 'beat', every: 0.5, phaseOffset: 0 }, action: { type: 'beat.cycle', target: { uri: 'Scene.X.Scale', type: 'Double' }, values: [1, 2] } },
    ]);
    engine.tempo.setBpm(120, 0);
    engine.tempo.resync(0);
    for (let t = 0; t <= 1000; t += 10) engine.tick(t); // 2 beats at 120 BPM = 4 half-beats
    expect(events).toHaveLength(4);
  });
});

describe('easing', () => {
  it('passes the chosen easing to OpenSpace and falls back to Linear for unknown names', () => {
    const glide = (easing: string) =>
      ({
        id: 'g',
        name: '',
        muted: false,
        source: { kind: 'beat', every: 4, phaseOffset: 0 },
        action: { type: 'beat.value', target: opacity, min: 0, max: 1, shape: 'pingpong', glide: 'quarter', easing },
      }) as BeatBinding;
    const a = setup([glide('SineEaseInOut')]);
    a.engine.tick(0);
    expect((a.events[0] as { easing?: string }).easing).toBe('SineEaseInOut');
    const b = setup([glide('NotAnEasing')]);
    b.engine.tick(0);
    expect((b.events[0] as { easing?: string }).easing).toBe('Linear');
  });
});

describe('glide in beats', () => {
  const moon = (extra: object) =>
    ({
      id: 'm',
      name: '',
      muted: false,
      source: { kind: 'beat', every: 16, phaseOffset: 0 },
      action: { type: 'beat.value', target: opacity, min: 0, max: 1, shape: 'pingpong', ...extra },
    }) as BeatBinding;
  const secondsFor = (extra: object) => {
    const { events, engine } = setup([moon(extra)]);
    engine.tempo.setBpm(120, 0);
    engine.tempo.resync(0);
    engine.tick(0);
    return (events[0] as { interpolateSeconds?: number }).interpolateSeconds;
  };

  it('glides over the chosen number of beats', () => {
    expect(secondsFor({ glideBeats: 4 })).toBeCloseTo(2); // 4 beats at 120 BPM
    expect(secondsFor({ glideBeats: 0.25 })).toBeCloseTo(0.125);
  });

  it('defaults to the whole interval and caps at it', () => {
    expect(secondsFor({})).toBeCloseTo(8); // 16 beats
    expect(secondsFor({ glideBeats: 64 })).toBeCloseTo(8);
  });

  it('still reads older full/half/quarter files', () => {
    expect(secondsFor({ glide: 'half' })).toBeCloseTo(4);
  });
});
