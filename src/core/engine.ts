/**
 * Mapping engine: turns MIDI events, the tempo clock and EQ levels into
 * outgoing messages through the send scheduler. No DOM, no sockets: everything
 * it needs comes in through the constructor so it is testable under Node.
 */
import type { MidiEvent } from './midi/parse';
import type { OutMsg } from './scheduler';
import { TempoClock } from './tempo';
import {
  clamp01,
  clampToLimits,
  decodeRelative,
  deltaCurve,
  deltaCurveInverse,
  envelope,
  intervalFromKnob,
  narrowRange,
  nearlyEqual,
  scale,
  stepInterval,
} from './transforms';
import {
  BEAT_INTERVALS,
  glideBeatsOf,
  validEasing,
  valueKind,
  type BeatBinding,
  type BeatInterval,
  type Binding,
  type EqBand,
  type EqBinding,
  type MidiBinding,
  type PropertySetAction,
} from './types';

export interface EngineOutput {
  /** Latest-value lane. */
  value(key: string, msg: OutMsg, inputT: number): void;
  /** Ordered event lane. */
  event(msg: OutMsg, inputT: number): void;
  /** Controller LED feedback. */
  led?(device: string, channel: number, number: number, state: 'on' | 'off' | 'flash'): void;
  /** Local app commands (panic, resync, tap). */
  app?(command: 'panic' | 'resync' | 'tap', t: number): void;
}

export interface EngineEnv {
  /** False when the binding's target property or action isn't in the scene. */
  available(b: Binding): boolean;
  /** Property limits from OpenSpace metadata, if known. */
  limits(uri: string): { min?: number | number[]; max?: number | number[] } | undefined;
}

/** Per-binding live state. Public fields are read by the UI. */
export interface Runtime {
  /** Last value this binding produced (for readouts). */
  last?: unknown;
  /** Bool state for toggle-style bindings. */
  toggle?: boolean;
  /** CC-as-button previous on/off, for edge detection. */
  ccOn?: boolean;
  /** Relative encoder position 0..1. */
  encPos?: number;
  /** Last selector state (velocity). */
  selectorState?: number;
  /** Pickup target (0..1) after reconnect; input is ignored until it is crossed. */
  pickup?: number;
  lastX?: number;
  // BPM bindings
  muteHeld?: boolean;
  muteToggle?: boolean;
  interval?: BeatInterval;
  intervalAcc?: number;
  range?: number;
  lastCycle?: number;
  step?: number;
  // EQ bindings
  env?: number;
  lastT?: number;
}

const ECHO_GUARD_MS = 250;
const PICKUP_TOLERANCE = 0.03;

function midiAddr(device: string, message: 'cc' | 'note', channel: number, number: number): string {
  return `${device}|${message}|${channel}|${number}`;
}

export class Engine {
  readonly tempo = new TempoClock();
  /** While true (reconnect sync), MIDI is ignored and nothing is computed. */
  gated = false;
  /** While true (panic hold), BPM and EQ bindings send nothing. */
  hold = false;

  #out: EngineOutput;
  #env: EngineEnv;
  #bindings: Binding[] = [];
  #byAddr = new Map<string, MidiBinding[]>();
  #beat: BeatBinding[] = [];
  #eq: EqBinding[] = [];
  #rt = new Map<string, Runtime>();
  #observed = new Map<string, unknown>();
  #drivenAt = new Map<string, number>();
  #eqLevels: Record<EqBand, number> = { level: 0, low: 0, mid: 0, high: 0 };
  /** Last value sent through a lua.value function, e.g. current delta time. */
  #luaValues = new Map<string, number>();

  constructor(out: EngineOutput, env: EngineEnv) {
    this.#out = out;
    this.#env = env;
  }

  setBindings(bindings: readonly Binding[]): void {
    this.#bindings = [...bindings];
    this.#byAddr.clear();
    this.#beat = [];
    this.#eq = [];
    const ids = new Set<string>();
    for (const b of bindings) {
      ids.add(b.id);
      if (b.source.kind === 'midi') {
        const s = b.source;
        const key = midiAddr(s.device, s.message, s.channel, s.number);
        const list = this.#byAddr.get(key) ?? [];
        list.push(b as MidiBinding);
        this.#byAddr.set(key, list);
      } else if (b.source.kind === 'beat') {
        this.#beat.push(b as BeatBinding);
      } else {
        this.#eq.push(b as EqBinding);
      }
    }
    for (const id of [...this.#rt.keys()]) if (!ids.has(id)) this.#rt.delete(id);
  }

  runtime(id: string): Runtime {
    let r = this.#rt.get(id);
    if (!r) {
      r = {};
      this.#rt.set(id, r);
    }
    return r;
  }

  /** Is a BPM binding currently muted (by its flag or a MIDI mute control)? */
  isBeatMuted(b: Binding): boolean {
    const r = this.#rt.get(b.id);
    return b.muted || !!r?.muteHeld || !!r?.muteToggle;
  }

  effectiveInterval(b: BeatBinding): BeatInterval {
    return this.#rt.get(b.id)?.interval ?? b.source.every;
  }

  setEq(levels: Partial<Record<EqBand, number>>): void {
    Object.assign(this.#eqLevels, levels);
  }

  setLuaValue(fn: string, v: number): void {
    this.#luaValues.set(fn, v);
  }

  /** Property value reported by OpenSpace (subscription or read). */
  observe(uri: string, value: unknown, now: number): void {
    const driven = this.#drivenAt.get(uri);
    if (driven !== undefined && now - driven < ECHO_GUARD_MS) return;
    this.#observed.set(uri, value);
    // Keep toggle state in sync with changes made elsewhere (main GUI).
    if (typeof value === 'boolean') {
      for (const b of this.#bindings) {
        const a = b.action;
        if ((a.type === 'property.bool' || a.type === 'beat.toggle') && a.target.uri === uri) {
          this.runtime(b.id).toggle = value;
        }
      }
    }
  }

  observed(uri: string): unknown {
    return this.#observed.get(uri);
  }

  /** True if this app set the property within the echo-guard window. */
  recentlyDriven(uri: string, now: number): boolean {
    const t = this.#drivenAt.get(uri);
    return t !== undefined && now - t < ECHO_GUARD_MS;
  }

  /**
   * Where each absolute CC control on a device should sit (0-127), from the
   * current state of what it controls. Feeds knob LED rings, which on the
   * APC40 also set the knob's position so the next turn continues from there.
   * `uri` limits the result to bindings that drive that property.
   */
  ringValues(device: string, uri?: string): { channel: number; number: number; value: number }[] {
    const out: { channel: number; number: number; value: number }[] = [];
    for (const b of this.#bindings) {
      const s = b.source;
      if (s.kind !== 'midi' || s.device !== device || s.message !== 'cc' || s.mode !== 'absolute') continue;
      const a = b.action;
      let x: number | undefined;
      if (a.type === 'property.set') {
        if (uri !== undefined && a.target.uri !== uri) continue;
        const v = this.#observed.get(a.target.uri);
        x = typeof v === 'number' ? this.#inverse(a, v) : undefined;
      } else if (uri !== undefined) {
        continue;
      } else if (a.type === 'lua.value') {
        const v = this.#luaValues.get(a.fn);
        x = v === undefined ? undefined : deltaCurveInverse(v, a.min, a.max, a.curve);
      } else if (a.type === 'bpm.affect' && a.adjust !== 'mute') {
        const target = this.#bindings.find((t) => t.id === a.binding);
        if (target?.source.kind !== 'beat') continue;
        const tr = this.#rt.get(target.id);
        if (a.adjust === 'range') x = tr?.range ?? 1;
        else {
          const i = BEAT_INTERVALS.indexOf(tr?.interval ?? target.source.every);
          x = (Math.max(0, i) + 0.5) / BEAT_INTERVALS.length;
        }
      }
      if (x === undefined) continue;
      out.push({ channel: s.channel, number: s.number, value: Math.round(clamp01(x) * 127) });
    }
    return out;
  }

  /**
   * LEDs that should be lit on a device right now, from mapping state: bool
   * properties that are on, and BPM mappings muted from a pad. Used to restore
   * the controller after it has been cleared.
   */
  ledStates(device: string): { channel: number; number: number }[] {
    const lit: { channel: number; number: number }[] = [];
    for (const b of this.#bindings) {
      if (b.source.kind !== 'midi' || b.source.device !== device || b.source.message !== 'note') continue;
      const a = b.action;
      let on = false;
      if (a.type === 'property.bool') {
        const r = this.#rt.get(b.id);
        on = (r?.toggle ?? this.#observed.get(a.target.uri)) === true;
      } else if (a.type === 'bpm.affect' && a.adjust === 'mute') {
        const target = this.#bindings.find((x) => x.id === a.binding);
        on = !!target && this.isBeatMuted(target);
      }
      if (on) lit.push({ channel: b.source.channel, number: b.source.number });
    }
    return lit;
  }

  /** Reconnect: stop accepting MIDI until endSync(). */
  beginSync(): void {
    this.gated = true;
  }

  /**
   * Reconnect done: store re-read values and arm pickup on every absolute
   * fader/knob bound to a number property, so a fader moved while offline
   * doesn't jump the scene.
   */
  endSync(values: ReadonlyMap<string, unknown>, now: number): void {
    for (const [uri, v] of values) this.observe(uri, v, now);
    for (const b of this.#bindings) {
      if (b.source.kind !== 'midi' || b.source.message !== 'cc' || b.source.mode !== 'absolute') continue;
      const a = b.action;
      if (a.type !== 'property.set') continue;
      const v = values.get(a.target.uri);
      const x = typeof v === 'number' ? this.#inverse(a, v) : undefined;
      const r = this.runtime(b.id);
      r.pickup = x;
      r.lastX = undefined;
    }
    this.gated = false;
  }

  handleMidi(device: string, ev: MidiEvent): void {
    if (this.gated || ev.channel === null || ev.number === null || ev.raw === null) return;
    const message = ev.kind === 'cc' ? 'cc' : ev.kind === 'noteon' || ev.kind === 'noteoff' ? 'note' : null;
    if (!message) return;
    const list = this.#byAddr.get(midiAddr(device, message, ev.channel, ev.number));
    if (!list) return;
    for (const b of list) {
      if (b.muted || !this.#env.available(b)) continue;
      this.#midiBinding(b, ev);
    }
  }

  /** Called every scheduler tick, before the scheduler flushes. */
  tick(now: number): void {
    if (this.gated) return;
    for (const b of this.#beat) this.#beatBinding(b, now);
    for (const b of this.#eq) this.#eqBinding(b, now);
  }

  // ---------------- MIDI ----------------

  #midiBinding(b: MidiBinding, ev: MidiEvent): void {
    const s = b.source;
    const a = b.action;
    const r = this.runtime(b.id);
    const t = ev.t;
    const raw = ev.raw!;
    const isCc = ev.kind === 'cc';
    const relative = isCc && s.mode !== 'absolute';
    if (s.control === 'selector' && !isCc) {
      this.#selector(b, ev);
      return;
    }
    // Press state for buttons: note on/off, or CC above 63.
    const pressed = isCc ? raw > 63 : ev.kind === 'noteon';
    const prevPressed = isCc ? !!r.ccOn : !pressed;
    if (isCc) r.ccOn = pressed;
    const rising = pressed && (!isCc || !prevPressed);
    const falling = !pressed && (!isCc || prevPressed);

    switch (a.type) {
      case 'property.set': {
        let x: number;
        if (!isCc) {
          if (!rising && !falling) return;
          x = pressed ? 1 : 0;
        } else if (relative) {
          const cur = r.encPos ?? this.#currentX(a) ?? 0;
          x = clamp01(cur + decodeRelative(raw, s.mode) / 127);
          r.encPos = x;
        } else {
          x = ev.value!;
          if (r.pickup !== undefined) {
            const crossed = r.lastX !== undefined && (r.lastX - r.pickup) * (x - r.pickup) <= 0;
            if (Math.abs(x - r.pickup) > PICKUP_TOLERANCE && !crossed) {
              r.lastX = x;
              return;
            }
            r.pickup = undefined;
          }
          r.lastX = x;
        }
        if (a.invert) x = 1 - x;
        this.#sendPropertyValue(b, a, x, t);
        return;
      }
      case 'property.bool': {
        let next: boolean | undefined;
        if (a.behavior === 'instant') {
          if (rising) next = true;
          else if (falling) next = false;
        } else if (rising) {
          const cur = r.toggle ?? this.#observed.get(a.target.uri);
          next = !(cur === true);
        }
        if (next === undefined) return;
        r.toggle = next;
        r.last = next;
        this.#drivenAt.set(a.target.uri, t);
        this.#out.event({ kind: 'set', uri: a.target.uri, value: next }, t);
        this.#out.led?.(s.device, s.channel, s.number, next ? 'on' : 'off');
        return;
      }
      case 'bpm.affect': {
        const target = this.#bindings.find((x) => x.id === a.binding);
        if (!target || target.source.kind !== 'beat') return;
        const tr = this.runtime(target.id);
        if (a.adjust === 'mute') {
          if (a.behavior === 'instant') {
            if (rising) tr.muteHeld = true;
            else if (falling) tr.muteHeld = false;
            else return;
          } else if (rising) {
            tr.muteToggle = !tr.muteToggle;
          } else return;
          const muted = this.isBeatMuted(target);
          this.#out.led?.(s.device, s.channel, s.number, muted ? 'on' : 'off');
          return;
        }
        if (!isCc) return;
        if (a.adjust === 'range') {
          tr.range = relative ? clamp01((tr.range ?? 1) + decodeRelative(raw, s.mode) / 127) : ev.value!;
        } else {
          const cur = tr.interval ?? target.source.every;
          if (relative) {
            tr.intervalAcc = (tr.intervalAcc ?? 0) + decodeRelative(raw, s.mode);
            if (Math.abs(tr.intervalAcc) >= 4) {
              tr.interval = stepInterval(cur, tr.intervalAcc);
              tr.intervalAcc = 0;
            }
          } else {
            tr.interval = intervalFromKnob(ev.value!);
          }
        }
        return;
      }
      case 'action.trigger': {
        if (!rising) return;
        this.#out.event({ kind: 'action', id: a.action }, t);
        this.#out.led?.(s.device, s.channel, s.number, 'flash');
        return;
      }
      case 'lua.script': {
        if (!rising) return;
        this.#out.event({ kind: 'lua', script: a.script }, t);
        this.#out.led?.(s.device, s.channel, s.number, 'flash');
        return;
      }
      case 'lua.value': {
        if (!isCc) return;
        let x: number;
        if (relative) {
          const curV = this.#luaValues.get(a.fn);
          const cur = r.encPos ?? (curV !== undefined ? deltaCurveInverse(curV, a.min, a.max, a.curve) : 0.5);
          x = clamp01(cur + decodeRelative(raw, s.mode) / 127);
          r.encPos = x;
        } else {
          x = ev.value!;
        }
        const v = deltaCurve(x, a.min, a.max, a.curve);
        r.last = v;
        this.#luaValues.set(a.fn, v);
        this.#out.value(`lua:${a.fn}`, { kind: 'luaValue', fn: a.fn, value: v }, t);
        return;
      }
      case 'property.cycle': {
        if (!rising || a.values.length === 0) return;
        const i = this.#nextCycleIndex(r, a.values, a.target.uri);
        this.#sendCycle(r, a.target.uri, a.values[i]!, t);
        this.#out.led?.(s.device, s.channel, s.number, 'flash');
        return;
      }
      case 'app': {
        if (!rising) return;
        this.#out.app?.(a.command, t);
        this.#out.led?.(s.device, s.channel, s.number, 'flash');
        return;
      }
    }
  }

  /**
   * Next index in a cycle list. The first press continues from the property's
   * current value when it is in the list, so the cycle doesn't restart at item 1.
   */
  #nextCycleIndex(r: Runtime, values: readonly unknown[], uri: string): number {
    if (r.step === undefined) {
      const cur = this.#observed.get(uri);
      const at = cur === undefined ? -1 : values.findIndex((v) => nearlyEqual(v, cur, 1e-4));
      r.step = at;
    }
    r.step = (r.step + 1) % values.length;
    return r.step;
  }

  #sendCycle(r: Runtime, uri: string, value: unknown, t: number): void {
    r.last = value;
    this.#drivenAt.set(uri, t);
    this.#out.event({ kind: 'set', uri, value }, t);
  }

  /**
   * Selector (e.g. APC40 A|B assign): the device cycles states itself and
   * reports the state as velocity; note off is state 0. Numbers spread the
   * states across min..max, bools are on in any state but 0, triggers fire on
   * each change.
   */
  #selector(b: MidiBinding, ev: MidiEvent): void {
    const a = b.action;
    const state = ev.kind === 'noteoff' ? 0 : ev.raw!;
    const r = this.runtime(b.id);
    if (r.selectorState === state) return;
    r.selectorState = state;
    const t = ev.t;
    switch (a.type) {
      case 'property.set': {
        const steps = Math.max(1, (b.source.states ?? 3) - 1);
        const x = Math.min(1, state / steps);
        this.#sendPropertyValue(b, a, a.invert ? 1 - x : x, t);
        return;
      }
      case 'property.bool': {
        const next = state > 0;
        r.toggle = next;
        r.last = next;
        this.#drivenAt.set(a.target.uri, t);
        this.#out.event({ kind: 'set', uri: a.target.uri, value: next }, t);
        return;
      }
      case 'property.cycle': {
        // Each selector state picks its own list entry (off/A/B -> values 1/2/3).
        if (a.values.length === 0) return;
        this.#sendCycle(r, a.target.uri, a.values[state % a.values.length]!, t);
        return;
      }
      case 'action.trigger':
        this.#out.event({ kind: 'action', id: a.action }, t);
        return;
      case 'lua.script':
        this.#out.event({ kind: 'lua', script: a.script }, t);
        return;
      case 'app':
        this.#out.app?.(a.command, t);
        return;
      default:
        return;
    }
  }

  #sendPropertyValue(b: Binding, a: PropertySetAction, x: number, t: number): void {
    const kind = valueKind(a.target.type);
    let v = scale(x, a.min, a.max, a.curve);
    const lim = this.#env.limits(a.target.uri);
    if (lim) v = clampToLimits(v, lim.min, lim.max);
    if (kind === 'int' || kind === 'option') v = Array.isArray(v) ? v.map(Math.round) : Math.round(v);
    this.runtime(b.id).last = v;
    this.#drivenAt.set(a.target.uri, t);
    this.#out.value(`prop:${a.target.uri}`, { kind: 'set', uri: a.target.uri, value: v }, t);
  }

  /** Normalized position of the property's current value within min..max, if known. */
  #currentX(a: PropertySetAction): number | undefined {
    const v = this.#observed.get(a.target.uri);
    return typeof v === 'number' ? this.#inverse(a, v) : undefined;
  }

  #inverse(a: PropertySetAction, v: number): number | undefined {
    if (typeof a.min !== 'number' || typeof a.max !== 'number' || a.max === a.min) return undefined;
    let x = clamp01((v - a.min) / (a.max - a.min));
    if (a.curve === 'exp') x = Math.sqrt(x);
    return a.invert ? 1 - x : x;
  }

  // ---------------- Beat ----------------

  #beatBinding(b: BeatBinding, now: number): void {
    const r = this.runtime(b.id);
    const every = r.interval ?? b.source.every;
    const cycle = this.tempo.cycleAt(now, every, b.source.phaseOffset);
    const boundary = r.lastCycle !== undefined && cycle !== r.lastCycle;
    const first = r.lastCycle === undefined;
    r.lastCycle = cycle;
    // Muted: hold the property at its last value and don't build a backlog.
    if (this.hold || this.isBeatMuted(b) || !this.#env.available(b)) return;

    const a = b.action;
    switch (a.type) {
      case 'beat.toggle': {
        if (!boundary && !first) return;
        const next = ((cycle % 2) + 2) % 2 === 0;
        if (r.toggle === next) return;
        r.toggle = next;
        r.last = next;
        this.#drivenAt.set(a.target.uri, now);
        this.#out.event({ kind: 'set', uri: a.target.uri, value: next }, now);
        return;
      }
      case 'beat.value': {
        // One command per firing; OpenSpace interpolates over the glide time.
        if (!boundary && !first) return;
        const range = narrowRange(a.min, a.max, r.range ?? 1);
        const fit = (x: number | number[]) => {
          let v = x;
          const lim = this.#env.limits(a.target.uri);
          if (lim) v = clampToLimits(v, lim.min, lim.max);
          if (valueKind(a.target.type) === 'int') v = Array.isArray(v) ? v.map(Math.round) : Math.round(v);
          return v;
        };
        const seconds = (glideBeatsOf(a, every) * this.tempo.beatMs) / 1000;
        const up = a.shape === 'ramp' || ((cycle % 2) + 2) % 2 === 0;
        const target = fit(up ? range.max : range.min);
        this.#drivenAt.set(a.target.uri, now);
        if (a.shape === 'ramp') {
          this.#out.event({ kind: 'set', uri: a.target.uri, value: fit(range.min) }, now);
        }
        r.last = target;
        this.#out.event({ kind: 'set', uri: a.target.uri, value: target, interpolateSeconds: seconds, easing: validEasing(a.easing) }, now);
        return;
      }
      case 'beat.cycle': {
        if (!boundary || a.values.length === 0) return;
        const i = this.#nextCycleIndex(r, a.values, a.target.uri);
        this.#sendCycle(r, a.target.uri, a.values[i]!, now);
        return;
      }
      case 'beat.actions': {
        if (!boundary || a.actions.length === 0) return;
        const i = (r.step ?? 0) % a.actions.length;
        r.step = i + 1;
        r.last = a.actions[i];
        this.#out.event({ kind: 'action', id: a.actions[i]! }, now);
        return;
      }
      case 'beat.scripts': {
        if (!boundary || a.scripts.length === 0) return;
        const i = (r.step ?? 0) % a.scripts.length;
        r.step = i + 1;
        r.last = i + 1;
        this.#out.event({ kind: 'lua', script: a.scripts[i]! }, now);
        return;
      }
    }
  }

  // ---------------- EQ ----------------

  #eqBinding(b: EqBinding, now: number): void {
    const r = this.runtime(b.id);
    const dt = r.lastT === undefined ? 0 : now - r.lastT;
    r.lastT = now;
    const input = clamp01(this.#eqLevels[b.source.band] * b.transform.gain);
    r.env = envelope(r.env ?? 0, input, dt, b.transform.attackMs, b.transform.releaseMs);
    if (this.hold || b.muted || !this.#env.available(b)) return;
    const a = b.action;
    if (a.type === 'property.threshold') {
      const on = r.env > a.threshold;
      if (r.toggle === on) return;
      r.toggle = on;
      r.last = on;
      this.#drivenAt.set(a.target.uri, now);
      this.#out.event({ kind: 'set', uri: a.target.uri, value: on }, now);
      return;
    }
    this.#sendPropertyValue(b, a, a.invert ? 1 - r.env : r.env, now);
  }
}
