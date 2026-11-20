/**
 * The running show: the mapping file, the engine, the send scheduler, and the
 * wiring between MIDI, audio, the tempo clock and OpenSpace.
 *
 * High-frequency state (engine runtime, scheduler queues) lives in plain
 * objects outside Svelte's reactivity; the UI reads it through `uiClock`,
 * which ticks ~30 times a second (spec: "separate high-frequency value table
 * outside the UI framework").
 */
import { untrack } from 'svelte';
import { Engine, type Runtime } from '../core/engine';
import { findControl, findProfile, type ControllerProfile, type ProfileControl } from '../core/profile';
import { SendScheduler, type SchedulerMetrics } from '../core/scheduler';
import { BpmLock } from '../core/bpm';
import type { MidiEvent } from '../core/midi/parse';
import { nearlyEqual } from '../core/transforms';
import {
  LUA_DELTA_TIME,
  requiredActions,
  requiredProperties,
  targetKey,
  type Binding,
  type DeviceEntry,
  type Palette,
} from '../core/types';
import { audio } from '../inputs/audio/audio.svelte';
import { midi, parseHexBytes } from '../inputs/midi/webmidi.svelte';
import { connection } from '../openspace/connection.svelte';
import { discovery } from '../openspace/discovery.svelte';
import { OpenSpaceSink, readLua } from '../openspace/sender';
import { PropertySubscriptions } from '../openspace/subscriptions';
import { Ticker } from '../platform/ticker';
import { builtInProfiles } from '../profiles';
import { allBindings, emptyMappingFile, migrateWithWarnings, type MappingFile } from '../presets/schema';
import { readAutosave, writeAutosave, type FsFileHandle } from '../presets/storage';
import { neutralsOf } from '../presets/palettes';
import { saveSettings, settings } from '../settings.svelte';

export interface LearnCapture {
  device: string;
  inputName: string;
  channel: number;
  message: 'cc' | 'note';
  number: number;
  raw: number;
  control: ProfileControl | undefined;
  /** Raw values seen in the first moments, for guessing encoder mode. */
  raws: number[];
}

export interface DeviceRow {
  alias: string;
  name: string;
  profile: ControllerProfile | undefined;
  connected: boolean;
  active: boolean;
  /** In the mapping file (has or had mappings). */
  known: boolean;
}

const RTT_WINDOW = 256;
const UI_MS = 33;
const METRICS_MS = 250;
const LED_FLASH_MS = 120;
const APC_LED_ON = 21; // green in the APC40 RGB pad palette
const SYNC_TIMEOUT_MS = 3000;
/** Wait after a mode-switch sysex before writing LEDs. */
const INIT_SETTLE_MS = 150;
/** APC40 LED ring styles (ring type CC values). */
const RING_OFF = 0;
const RING_VOLUME = 2;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
}

class Show {
  file: MappingFile = $state(emptyMappingFile());
  fileHandle: FsFileHandle | null = null;
  fileName: string | null = $state(null);
  /** Changed since last Save. */
  dirty = $state(false);
  loadWarnings: string[] = $state([]);
  log: { t: number; text: string; warn: boolean }[] = $state([]);

  /** Bumps ~30 times a second so the UI re-reads live values. */
  uiClock = $state(0);
  metrics: SchedulerMetrics | null = $state(null);
  rtt = $state({ median: 0, worst: 0, samples: 0 });
  /** MIDI accepted? False while re-syncing after a reconnect. */
  syncing = $state(false);
  /** Panic hold: BPM and EQ bindings paused. */
  hold = $state(false);
  bpm = $state(120);
  tempoSource = $state<'manual' | 'tap' | 'audio'>('manual');
  /** Learn in progress: resolve with the next control moved. */
  learning = $state(false);

  readonly sink = new OpenSpaceSink();
  readonly bpmLock = new BpmLock();
  readonly scheduler = new SendScheduler(this.sink);
  readonly engine: Engine;
  readonly subs: PropertySubscriptions;
  #ticker: Ticker | null = null;

  // Non-reactive caches for the hot path.
  #propSet = new Set<string>();
  #propLimits = new Map<string, { min?: number | number[]; max?: number | number[] }>();
  #actionSet = new Set<string>();
  #discoveryReady = false;
  #echo = new Map<string, { value: unknown; t: number }>();
  #rtts: number[] = [];
  #rttIdx = 0;
  #lastUi = 0;
  #lastMetrics = 0;
  #learn: ((c: LearnCapture) => void) | null = null;
  /** OS names of controllers initialised since they connected. */
  #initialized = new Set<string>();
  /** "alias|channel|cc" of absolute CC controls that have a mapping (their rings echo the knob). */
  #mappedCcs = new Set<string>();
  #autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  #ledTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Last observed property values, for UI readouts. */
  observedValues = new Map<string, unknown>();

  constructor() {
    this.engine = new Engine(
      {
        value: (key, msg, t) => this.scheduler.setValue(key, msg, t, performance.now()),
        event: (msg, t) => this.scheduler.pushEvent(msg, t, performance.now()),
        led: (device, channel, number, state) => this.#led(device, channel, number, state),
        app: (command, t) => this.appCommand(command, t),
      },
      {
        available: (b) => this.#available(b),
        limits: (uri) => this.#propLimits.get(uri),
      },
    );
    this.subs = new PropertySubscriptions((uri, value) => this.#onPropertyValue(uri, value));
    this.scheduler.onSent = (key, msg, t) => {
      if (msg.kind === 'set') this.#echo.set(msg.uri, { value: msg.value, t });
    };
    this.sink.onError = (text) => this.note(text, true);
  }

  // ---------------- lifecycle ----------------

  /** Call once from the root component (inside an effect root). */
  init(): void {
    const saved = readAutosave();
    if (saved) {
      try {
        const { file, warnings } = migrateWithWarnings(saved);
        this.file = file;
        if (warnings.length) this.note(`Autosave restored with ${warnings.length} problem(s): ${warnings.join(' ')}`, true);
      } catch (e) {
        this.note(`Couldn't restore autosave: ${String(e)}`, true);
      }
    }
    this.applySendSettings();
    this.#ticker = new Ticker((now) => this.#tick(now));
    this.#restartTicker();

    midi.listen((ev) => this.#onMidi(ev));
    audio.onLevels = (l) => this.engine.setEq(l);
    audio.onOnset = (t) => {
      if (settings.autoBpm && this.engine.tempo.source === 'audio') this.engine.tempo.nudgeToOnset(t);
    };
    audio.onEstimate = (e) => {
      if (!settings.autoBpm) return;
      // The lock waits for several agreeing, confident estimates before touching the clock.
      const bpm = this.bpmLock.update(e, settings.bpmConfidence);
      if (bpm !== null) {
        this.engine.tempo.setBpm(bpm, performance.now(), 'audio');
        this.note(`Detected tempo locked at ${bpm.toFixed(1)} BPM.`);
      }
    };

    connection.start(settings.host, settings.port);
    void midi.request();

    $effect(() => {
      // Re-index whenever mappings change; snapshot so the hot path never touches proxies.
      const bindings = $state.snapshot(allBindings(this.file)) as Binding[];
      this.engine.setBindings(bindings);
      this.#mappedCcs = new Set(
        bindings.flatMap((b) =>
          b.source.kind === 'midi' && b.source.message === 'cc' && b.source.mode === 'absolute'
            ? [`${b.source.device}|${b.source.channel}|${b.source.number}`]
            : [],
        ),
      );
      this.subs.sync(this.#mappedUris(bindings));
      // New or edited knob mappings: show their positions, switch off rings that lost theirs.
      untrack(() => this.#syncAllRings());
    });

    $effect(() => {
      // Autosave on any change to the file.
      const json = JSON.stringify(this.file);
      if (this.#autosaveTimer) clearTimeout(this.#autosaveTimer);
      this.#autosaveTimer = setTimeout(() => writeAutosave(JSON.parse(json) as MappingFile), 400);
    });

    $effect(() => {
      this.#applyPalette(this.file.palette);
    });

    $effect(() => {
      // Discovery cache -> fast lookup sets for missing-target checks and limits.
      const props = discovery.properties;
      const actions = discovery.actions;
      this.#discoveryReady = discovery.propertiesState === 'ready' && discovery.actionsState === 'ready';
      this.#propSet = new Set(props.map((p) => p.uri));
      this.#propLimits = new Map(props.filter((p) => p.min !== undefined || p.max !== undefined).map((p) => [p.uri, { min: p.min, max: p.max }]));
      this.#actionSet = new Set(actions.map((a) => a.identifier));
    });

    $effect(() => {
      const session = connection.session;
      const api = connection.api;
      // untrack: only the connection should re-run this, not edits to the mappings it reads.
      untrack(() => {
        if (session > 0 && api) void this.#onConnected();
        else this.#onDisconnected();
      });
    });

    $effect(() => {
      // Initialise every active controller once per connection: on page load, when selected, after replug.
      void midi.portsVersion;
      const rows = this.devices.filter((d) => d.active && d.known && d.connected);
      const connected = new Set(this.devices.filter((d) => d.connected).map((d) => d.name));
      untrack(() => {
        // Forget unplugged devices so they are initialised again when they come back.
        for (const name of [...this.#initialized]) if (!connected.has(name)) this.#initialized.delete(name);
        rows.forEach((d) => this.#initDevice(d));
      });
    });

    // Leave the controller dark when the page closes.
    window.addEventListener('pagehide', () => {
      for (const d of this.devices) if (d.active && d.known && d.connected) this.#clearLeds(d.name, d.profile);
    });
  }

  applySendSettings(): void {
    const now = performance.now();
    this.scheduler.intervalMs = settings.intervalMs;
    this.scheduler.throttleMs = settings.throttleMs;
    this.scheduler.setMode(settings.sendMode, now);
    this.scheduler.resetMetrics();
    this.#restartTicker();
    saveSettings();
  }

  #restartTicker(): void {
    // Queue mode ticks at the interval; direct mode needs finer ticks for trailing edges.
    const period =
      settings.sendMode === 'queue'
        ? Math.min(settings.intervalMs, 10)
        : Math.max(1, Math.min(10, Math.floor(settings.throttleMs / 2)));
    this.#ticker?.start(period);
  }

  #tick(now: number): void {
    audio.poll(now);
    this.engine.tick(now);
    this.scheduler.tick(now);
    if (now - this.#lastUi >= UI_MS) {
      this.#lastUi = now;
      this.uiClock = now;
      this.bpm = this.engine.tempo.bpm;
      this.tempoSource = this.engine.tempo.source;
    }
    if (now - this.#lastMetrics >= METRICS_MS) {
      this.#lastMetrics = now;
      this.metrics = this.scheduler.metrics();
      const s = this.#rtts.slice().sort((a, b) => a - b);
      this.rtt = { median: s[Math.floor(s.length / 2)] ?? 0, worst: s[s.length - 1] ?? 0, samples: s.length };
    }
  }

  // ---------------- OpenSpace ----------------

  async #onConnected(refreshLists = true): Promise<void> {
    const api = connection.api;
    if (!api) return;
    // Spec: on reconnect, re-subscribe and re-read every mapped property before accepting MIDI.
    this.syncing = true;
    this.engine.beginSync();
    this.scheduler.clear();
    this.scheduler.resetSentState();
    this.sink.api = api;
    this.subs.attach(api);
    // Fetch the property tree and action list once per connection (the mapping editor searches this cache).
    if (refreshLists) void discovery.refresh(api);
    const bindings = $state.snapshot(allBindings(this.file)) as Binding[];
    const uris = this.#mappedUris(bindings);
    this.subs.sync(uris);
    const values = await this.subs.readAll(uris, SYNC_TIMEOUT_MS);
    try {
      const dt = await readLua(api, 'openspace.time.deltaTime()');
      if (typeof dt === 'number') this.engine.setLuaValue(LUA_DELTA_TIME, dt);
    } catch {
      // Leave delta time unknown; encoders start from the middle of their range.
    }
    if (connection.api !== api) return; // dropped again meanwhile
    const now = performance.now();
    for (const [uri, v] of values) this.observedValues.set(uri, v);
    this.engine.endSync(values, now);
    this.syncing = false;
    this.#restoreAllLeds();
    this.note(`Connected to OpenSpace. ${values.size} mapped propert${values.size === 1 ? 'y' : 'ies'} re-read; faders pick up when they cross the current value.`);
  }

  #onDisconnected(): void {
    this.sink.api = null;
    this.subs.attach(null);
    discovery.cancel();
    // Values queued while offline would be stale on reconnect.
    this.scheduler.clear();
    this.engine.beginSync();
    this.syncing = connection.state !== 'idle';
  }

  #onPropertyValue(uri: string, value: unknown): void {
    const now = performance.now();
    this.observedValues.set(uri, value);
    this.engine.observe(uri, value, now);
    // Knob rings follow changes made elsewhere, but not while this app is driving the property.
    if (!this.engine.recentlyDriven(uri, now)) this.#syncAllRings(uri);
    const echo = this.#echo.get(uri);
    if (echo && now - echo.t < 2000 && nearlyEqual(echo.value, value, 1e-4)) {
      const d = now - echo.t;
      if (this.#rtts.length < RTT_WINDOW) this.#rtts.push(d);
      else this.#rtts[this.#rttIdx++ % RTT_WINDOW] = d;
      this.#echo.delete(uri);
    }
  }

  #mappedUris(bindings: readonly Binding[]): string[] {
    return [...new Set(bindings.flatMap(requiredProperties))];
  }

  #available(b: Binding): boolean {
    if (!this.#discoveryReady) return true;
    return requiredProperties(b).every((u) => this.#propSet.has(u)) && requiredActions(b).every((a) => this.#actionSet.has(a));
  }

  /** For the UI: names of targets this binding needs that aren't in the scene. */
  missingTargets(b: Binding): string[] {
    void discovery.properties;
    void discovery.actions;
    if (discovery.propertiesState !== 'ready' || discovery.actionsState !== 'ready') return [];
    const props = new Set(discovery.properties.map((p) => p.uri));
    const acts = new Set(discovery.actions.map((a) => a.identifier));
    return [...requiredProperties(b).filter((u) => !props.has(u)), ...requiredActions(b).filter((a) => !acts.has(a))];
  }

  // ---------------- MIDI ----------------

  get devices(): DeviceRow[] {
    const rows: DeviceRow[] = [];
    const used = new Set<string>();
    const inactive = new Set(settings.inactiveDevices);
    for (const input of midi.inputs) {
      const alias = this.aliasFor(input.name);
      const profile = findProfile(builtInProfiles, input.name);
      if (alias) used.add(alias);
      rows.push({
        alias: alias ?? '',
        name: input.name,
        profile,
        connected: input.state === 'connected',
        active: !!alias && !inactive.has(alias),
        known: !!alias,
      });
    }
    for (const [alias, d] of Object.entries(this.file.devices)) {
      if (used.has(alias)) continue;
      rows.push({
        alias,
        name: d.match,
        profile: findProfile(builtInProfiles, d.match),
        connected: false,
        active: !inactive.has(alias),
        known: true,
      });
    }
    return rows;
  }

  /** Alias of the file device that matches an OS device name: exact first, then substring. */
  aliasFor(inputName: string): string | undefined {
    const entries = Object.entries(this.file.devices);
    const exact = entries.find(([, d]) => d.match === inputName);
    if (exact) return exact[0];
    const lower = inputName.toLowerCase();
    return entries.find(([, d]) => lower.includes(d.match.toLowerCase()))?.[0];
  }

  /** OS input name currently matching an alias. */
  inputNameFor(alias: string): string | undefined {
    const d = this.file.devices[alias];
    if (!d) return undefined;
    const ins = midi.inputs.filter((i) => i.state === 'connected');
    return (ins.find((i) => i.name === d.match) ?? ins.find((i) => i.name.toLowerCase().includes(d.match.toLowerCase())))?.name;
  }

  /** Select a device in the device selector. Adds it to the file the first time. */
  setDeviceActive(row: DeviceRow, active: boolean): string {
    let alias = row.alias;
    if (!alias) {
      const profile = findProfile(builtInProfiles, row.name);
      const base = slug(profile ? profile.name.replace(/^akai\s+/i, '') : row.name);
      alias = base;
      for (let i = 2; alias in this.file.devices; i++) alias = `${base}-${i}`;
      const entry: DeviceEntry = { match: row.name, ...(profile ? { profile: profile.name } : {}) };
      this.file.devices[alias] = entry;
      this.dirty = true;
    }
    const set = new Set(settings.inactiveDevices);
    if (active) set.delete(alias);
    else set.add(alias);
    settings.inactiveDevices = [...set];
    saveSettings();
    if (active && row.connected) this.#initDevice({ name: row.name, alias, profile: row.profile ?? findProfile(builtInProfiles, row.name) });
    return alias;
  }

  /** Point an alias at a different OS device (load: "which connected device to use"). */
  rebindDevice(alias: string, inputName: string): void {
    const d = this.file.devices[alias];
    if (!d) return;
    d.match = inputName;
    const profile = findProfile(builtInProfiles, inputName);
    if (profile) d.profile = profile.name;
    this.dirty = true;
  }

  profileFor(alias: string): ControllerProfile | undefined {
    const d = this.file.devices[alias];
    if (!d) return undefined;
    return (d.profile ? builtInProfiles.find((p) => p.name === d.profile) : undefined) ?? findProfile(builtInProfiles, d.match);
  }

  #onMidi(ev: MidiEvent): void {
    const alias = this.aliasFor(ev.device);
    if (this.#learn && (ev.kind === 'cc' || ev.kind === 'noteon') && ev.channel !== null && ev.number !== null) {
      // Learn listens to every connected device, so a new controller can be learned directly.
      const learn = this.#learn;
      this.#learn = null;
      this.learning = false;
      const deviceAlias = alias ?? this.setDeviceActive({ alias: '', name: ev.device, profile: undefined, connected: true, active: true, known: false }, true);
      const profile = this.profileFor(deviceAlias);
      learn({
        device: deviceAlias,
        inputName: ev.device,
        channel: ev.channel,
        message: ev.kind === 'cc' ? 'cc' : 'note',
        number: ev.number,
        raw: ev.raw ?? 0,
        control: profile ? findControl(profile, ev) : undefined,
        raws: [ev.raw ?? 0],
      });
      return;
    }
    if (!alias || settings.inactiveDevices.includes(alias)) return;
    this.engine.handleMidi(alias, ev);
    if (ev.kind === 'cc') this.#echoRing(alias, ev);
  }

  /** Capture the next control moved. Returns a cancel function. */
  startLearn(onCapture: (c: LearnCapture) => void): () => void {
    this.#learn = onCapture;
    this.learning = true;
    return () => {
      if (this.#learn === onCapture) {
        this.#learn = null;
        this.learning = false;
      }
    };
  }

  /** Listen to raw MIDI for a moment (e.g. to collect encoder values after learn). */
  listenRaw(fn: (ev: MidiEvent) => void): () => void {
    return midi.listen((ev) => fn(ev));
  }

  /**
   * Bring a controller to a known state: profile init (APC40: Mode 2, so the
   * app owns the LEDs), then every LED off, then the LEDs the mappings say
   * should be lit. Runs once per connection; `force` re-runs it (RE-INIT).
   */
  #initDevice(d: Pick<DeviceRow, 'name' | 'alias' | 'profile'>, force = false): void {
    if (!force && this.#initialized.has(d.name)) return;
    this.#initialized.add(d.name);
    const init = d.profile?.init as { sysex?: string } | undefined;
    if (init?.sysex) {
      if (!midi.sysex) {
        this.note(`${d.name}: sysex permission not granted, so it can't be switched to Mode 2. LEDs may not clear fully.`, true);
      } else if (!midi.sendTo(d.name, parseHexBytes(init.sysex))) {
        this.note(`${d.name}: no matching MIDI output, so it can't be initialised.`, true);
        return;
      }
    }
    // Give the controller a moment to switch modes before writing LEDs.
    setTimeout(() => {
      this.#clearLeds(d.name, d.profile);
      this.#restoreLeds(d.alias);
      this.#syncRings(d.alias, d.name, d.profile);
      this.note(`${d.name}: ${init?.sysex && midi.sysex ? 'Mode 2, ' : ''}LEDs cleared and restored from mappings.`);
    }, init?.sysex ? INIT_SETTLE_MS : 0);
  }

  /** Re-initialise every active, connected controller (RE-INIT button). */
  reinitDevices(): void {
    for (const d of this.devices) if (d.active && d.known && d.connected) this.#initDevice(d, true);
  }

  /** All LEDs off: every profiled note control, plus every note on channel 1 (transport and other lit buttons). */
  #clearLeds(name: string, profile: ControllerProfile | undefined): void {
    const bytes: number[] = [];
    const seen = new Set<string>();
    const off = (channel: number, number: number) => {
      const k = `${channel}:${number}`;
      if (seen.has(k)) return;
      seen.add(k);
      bytes.push(0x90 | ((channel - 1) & 0x0f), number, 0);
    };
    for (const c of profile?.controls ?? []) if (c.kind === 'note') off(c.channel, c.number);
    for (let n = 0; n < 128; n++) off(1, n);
    // One send of back-to-back messages; Web MIDI accepts a byte stream of complete messages.
    midi.sendTo(name, bytes);
  }

  #restoreLeds(alias: string): void {
    for (const { channel, number } of this.engine.ledStates(alias)) this.#led(alias, channel, number, 'on');
  }

  /** After OpenSpace sync, current values are known: re-light every active device. */
  #restoreAllLeds(): void {
    for (const d of this.devices) {
      if (!d.active || !d.known || !d.connected) continue;
      this.#restoreLeds(d.alias);
      this.#syncRings(d.alias, d.name, d.profile);
    }
  }

  /**
   * Set every knob LED ring on a device. Mapped knobs show the current value of
   * what they control (which on the APC40 also moves the knob there, so the next
   * turn continues from the scene's value). Unmapped rings are switched off.
   * `uri` limits it to knobs driving that property (feedback from OpenSpace).
   */
  #syncRings(alias: string, name: string, profile: ControllerProfile | undefined, uri?: string): void {
    if (!profile) return;
    const values = new Map(this.engine.ringValues(alias, uri).map((r) => [`${r.channel}:${r.number}`, r.value]));
    const bytes: number[] = [];
    for (const c of profile.controls) {
      if (!c.ledRing) continue;
      const v = values.get(`${c.channel}:${c.number}`);
      if (uri !== undefined && v === undefined) continue;
      const status = 0xb0 | ((c.channel - 1) & 0x0f);
      bytes.push(status, c.ledRing.typeCc, v === undefined ? RING_OFF : RING_VOLUME);
      if (v !== undefined) bytes.push(status, c.ledRing.cc, v);
    }
    if (bytes.length) midi.sendTo(name, bytes);
  }

  /**
   * In Mode 2 the APC40 doesn't move a knob's ring when it is turned; the host
   * has to. Send the knob's own value back to its ring as it moves (mapped knobs only).
   */
  #echoRing(alias: string, ev: MidiEvent): void {
    if (ev.channel === null || ev.number === null || ev.raw === null) return;
    if (!this.#mappedCcs.has(`${alias}|${ev.channel}|${ev.number}`)) return;
    const control = this.profileFor(alias)?.controls.find((c) => c.kind === 'cc' && c.channel === ev.channel && c.number === ev.number);
    if (!control?.ledRing) return;
    midi.sendTo(ev.device, [0xb0 | ((ev.channel - 1) & 0x0f), control.ledRing.cc, ev.raw]);
  }

  #syncAllRings(uri?: string): void {
    for (const d of this.devices) if (d.active && d.known && d.connected) this.#syncRings(d.alias, d.name, d.profile, uri);
  }

  #led(device: string, channel: number, number: number, state: 'on' | 'off' | 'flash'): void {
    const name = this.inputNameFor(device);
    if (!name) return;
    const profile = this.profileFor(device);
    const control = profile?.controls.find((c) => c.kind === 'note' && c.channel === channel && c.number === number);
    if (profile && !control) return;
    const onVel = control?.led === 'rgb' ? APC_LED_ON : 127;
    const status = 0x90 | ((channel - 1) & 0x0f);
    const key = `${device}|${channel}|${number}`;
    const prev = this.#ledTimers.get(key);
    if (prev) clearTimeout(prev);
    if (state === 'flash') {
      midi.sendTo(name, [status, number, onVel]);
      this.#ledTimers.set(key, setTimeout(() => midi.sendTo(name, [status, number, 0]), LED_FLASH_MS));
      return;
    }
    midi.sendTo(name, [status, number, state === 'on' ? onVel : 0]);
  }

  // ---------------- app commands ----------------

  appCommand(command: 'panic' | 'resync' | 'tap', t = performance.now()): void {
    if (command === 'panic') this.panic();
    else if (command === 'resync') this.engine.tempo.resync(t);
    else {
      this.engine.tempo.tap(t);
      this.bpmLock.setCurrent(this.engine.tempo.bpm);
    }
  }

  /**
   * Panic: drop everything queued, set time to real time, and hold BPM/EQ
   * output until released. (Camera stop and cue cancel arrive with those features.)
   */
  panic(): void {
    const now = performance.now();
    this.scheduler.clear();
    this.hold = true;
    this.engine.hold = true;
    this.scheduler.pushEvent({ kind: 'luaValue', fn: LUA_DELTA_TIME, value: 1 }, now, now);
    this.engine.setLuaValue(LUA_DELTA_TIME, 1);
    for (const b of allBindings(this.file)) {
      if (b.action.type === 'lua.value') this.engine.runtime(b.id).encPos = undefined;
    }
    this.note('PANIC: queue cleared, delta time set to real time, BPM and EQ mappings on hold.', true);
  }

  releaseHold(): void {
    this.hold = false;
    this.engine.hold = false;
  }

  setBpm(bpm: number): void {
    this.engine.tempo.setBpm(bpm, performance.now(), 'manual');
    this.bpmLock.setCurrent(this.engine.tempo.bpm);
    this.bpm = this.engine.tempo.bpm;
  }

  // ---------------- mappings ----------------

  get bindings(): Binding[] {
    return allBindings(this.file);
  }

  addBinding(b: Binding): void {
    this.file.banks[0]!.bindings.push(b);
    this.dirty = true;
  }

  updateBinding(b: Binding): void {
    for (const bank of this.file.banks) {
      const i = bank.bindings.findIndex((x) => x.id === b.id);
      if (i >= 0) {
        bank.bindings[i] = b;
        this.dirty = true;
        return;
      }
    }
  }

  removeBinding(id: string): void {
    for (const bank of this.file.banks) {
      const i = bank.bindings.findIndex((x) => x.id === id);
      if (i >= 0) bank.bindings.splice(i, 1);
      // Drop "Affect BPM" mappings pointing at it.
      bank.bindings = bank.bindings.filter((x) => !(x.action.type === 'bpm.affect' && x.action.binding === id));
    }
    this.dirty = true;
  }

  setMuted(id: string, muted: boolean): void {
    const b = this.bindings.find((x) => x.id === id);
    if (b) {
      b.muted = muted;
      this.dirty = true;
    }
  }

  /** Target key -> how many bindings drive it (for the shared-target marker). */
  get targetCounts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const b of this.bindings) {
      const k = targetKey(b);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }

  runtime(id: string): Runtime {
    return this.engine.runtime(id);
  }

  newId(): string {
    const ids = new Set(this.bindings.map((b) => b.id));
    let i = this.bindings.length + 1;
    while (ids.has(`b${i}`)) i++;
    return `b${i}`;
  }

  // ---------------- file ----------------

  replaceFile(file: MappingFile, handle: FsFileHandle | null, name: string | null, warnings: string[]): void {
    this.file = file;
    this.fileHandle = handle;
    this.fileName = name;
    this.loadWarnings = warnings;
    this.dirty = false;
    // Re-read values for the new mappings if connected.
    if (connection.api) void this.#onConnected(false);
  }

  setPalette(p: Palette): void {
    // Copy the palette as-is (colors and its grays) into the show file.
    this.file.palette = { ...p, colors: [...p.colors] };
    this.dirty = true;
  }

  #applyPalette(p: Palette): void {
    const root = document.documentElement.style;
    for (let i = 0; i < 8; i++) {
      const c = p.colors[i];
      if (c) root.setProperty(`--palette-${i + 1}`, c);
      else root.removeProperty(`--palette-${i + 1}`);
    }
    const n = neutralsOf(p);
    root.setProperty('--ground', n.ground);
    root.setProperty('--ink', n.ink);
    root.setProperty('--panel', n.panel);
    root.setProperty('--raised', n.raised);
    root.setProperty('--rule', n.rule);
    root.setProperty('--line', n.line);
    root.setProperty('--ink-muted', n.inkMuted);
  }

  note(text: string, warn = false): void {
    // untrack: note() is called from effects; reading the log there would make them loop.
    untrack(() => {
      this.log = [{ t: Date.now(), text, warn }, ...this.log].slice(0, 50);
    });
  }
}

export const show = new Show();
