/**
 * Mapping model, schema v1 (spec: "Mapping model"). A binding connects one
 * source to one action through a transform. Pure data: everything here is JSON.
 */

/** Beats per firing. 0.5 = twice per beat (eighth notes). */
export type BeatInterval = 0.5 | 1 | 2 | 4 | 8 | 16;
export const BEAT_INTERVALS: readonly BeatInterval[] = [0.5, 1, 2, 4, 8, 16];

/** "½", "1", "16" for labels. */
export function beatsLabel(n: number): string {
  return n === 0.5 ? '½' : n === 0.25 ? '¼' : String(n);
}

/** "½ beat", "1 beat", "4 beats". */
export function everyLabel(n: number): string {
  return `${beatsLabel(n)} beat${n <= 1 ? '' : 's'}`;
}

/** relative-signed-bit7 is two's complement (the APC40 profile's name for it). */
export type EncoderMode = 'absolute' | 'relative-signed-bit7' | 'relative-sign-magnitude' | 'relative-binary-offset';
/** selector: a button that cycles through states itself and reports the state as note velocity (APC40 A|B). */
export type ControlType = 'slider' | 'knob' | 'encoder' | 'pad' | 'button' | 'selector';

/** What kind of value a property takes, derived from its OpenSpace type. */
/** string: one text value. list: a list of strings (StringList, Selection such as constellation selection). */
export type ValueKind = 'bool' | 'number' | 'int' | 'vector' | 'option' | 'string' | 'list' | 'trigger' | 'other';

export interface MidiSource {
  kind: 'midi';
  /** Device alias, a key of MappingFile.devices. */
  device: string;
  /** 1-16 */
  channel: number;
  message: 'cc' | 'note';
  number: number;
  /** For CCs. */
  mode: EncoderMode;
  /** Physical control type from the profile or the user's answer at learn time. */
  control: ControlType;
  /** For selectors: how many states the control cycles through (APC40 A|B = 3). */
  states?: number;
}

export interface BeatSource {
  kind: 'beat';
  every: BeatInterval;
  /** Beats to shift the cycle by. */
  phaseOffset: number;
}

export type EqBand = 'level' | 'low' | 'mid' | 'high';

export interface EqSource {
  kind: 'eq';
  band: EqBand;
}

export type Source = MidiSource | BeatSource | EqSource;

/** Reference to an OpenSpace property, with what we knew about it when the mapping was made. */
export interface PropertyRef {
  uri: string;
  /** OpenSpace type without the "Property" suffix: Float, Bool, Vec3... */
  type: string;
}

export type Curve = 'linear' | 'exp';

// ---- Actions ----

/** MIDI CC or EQ -> number/int/vector property across min..max. */
export interface PropertySetAction {
  type: 'property.set';
  target: PropertyRef;
  min: number | number[];
  max: number | number[];
  curve: Curve;
  invert: boolean;
  /** Ask OpenSpace to interpolate over one send interval (Lua call per message). */
  interpolate: boolean;
}

/** MIDI note -> bool property. */
export interface PropertyBoolAction {
  type: 'property.bool';
  target: PropertyRef;
  behavior: 'instant' | 'toggle';
}

/** EQ -> bool property: on above threshold. */
export interface PropertyThresholdAction {
  type: 'property.threshold';
  target: PropertyRef;
  threshold: number;
}

/** MIDI -> adjust an existing BPM binding. */
export interface BpmAffectAction {
  type: 'bpm.affect';
  /** Binding id of a BPM binding. */
  binding: string;
  adjust: 'mute' | 'range' | 'interval';
  behavior: 'instant' | 'toggle';
}

/** MIDI note -> fire an OpenSpace action once. */
export interface ActionTriggerAction {
  type: 'action.trigger';
  action: string;
}

/** MIDI note -> run a Lua script once. */
export interface ScriptAction {
  type: 'lua.script';
  script: string;
}

/** MIDI CC -> a Lua function called with one value (delta time is the first). */
export interface LuaValueAction {
  type: 'lua.value';
  fn: string;
  min: number;
  max: number;
  curve: Curve;
}

/** One value in a cycle list: number, string, bool, vector, or string list (selection). */
export type CycleValue = number | string | boolean | number[] | string[];

/** MIDI press -> next value in a list, looping (colors, scales, constellation names...). */
export interface PropertyCycleAction {
  type: 'property.cycle';
  target: PropertyRef;
  values: CycleValue[];
}

/** Beat -> next value in a list every N beats, looping. */
export interface BeatCycleAction {
  type: 'beat.cycle';
  target: PropertyRef;
  values: CycleValue[];
}

/** MIDI -> local app command. */
export interface AppAction {
  type: 'app';
  command: 'panic' | 'resync' | 'tap';
}

/** Beat -> bool flips every N beats. */
export interface BeatToggleAction {
  type: 'beat.toggle';
  target: PropertyRef;
}

/** Beat -> number/vector interpolates over N beats. */
/**
 * Beat -> number/vector glides between min and max. Every N beats it sends
 * one set with an OpenSpace interpolation time, so OpenSpace animates it.
 * pingpong: alternate max, min, max... ramp: snap to min, then glide to max.
 */
export interface BeatValueAction {
  type: 'beat.value';
  target: PropertyRef;
  min: number | number[];
  max: number | number[];
  shape: 'pingpong' | 'ramp';
  /** Glide length in beats (capped at the interval). Missing = the whole interval. */
  glideBeats?: number;
  /** Older files: glide as a fraction of the interval. Read only when glideBeats is missing. */
  glide?: GlideTime;
  /** OpenSpace easing function name (missing = Linear). */
  easing?: string;
}

export type GlideTime = 'full' | 'half' | 'quarter';
export const GLIDE_FRACTION: Record<GlideTime, number> = { full: 1, half: 0.5, quarter: 0.25 };

/** Glide lengths offered in the dialog, in beats. */
export const GLIDE_BEATS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8, 16];

/** Glide length in beats for a beat.value action at a given interval. */
export function glideBeatsOf(a: { glideBeats?: number; glide?: GlideTime }, every: number): number {
  const beats = a.glideBeats ?? every * GLIDE_FRACTION[a.glide ?? 'full'];
  return Math.max(0, Math.min(beats, every));
}

/** Easing families accepted by openspace.setPropertyValueSingle (checked against OpenSpace's own docs). */
export const EASING_FAMILIES = ['Quadratic', 'Cubic', 'Quartic', 'Quintic', 'Sine', 'Circular', 'Exponential', 'Elastic', 'Bounce'] as const;
export const EASINGS: readonly string[] = [
  'Linear',
  ...EASING_FAMILIES.flatMap((f) => [`${f}EaseIn`, `${f}EaseOut`, `${f}EaseInOut`]),
];

/** A saved easing name, or Linear if it isn't one OpenSpace knows. */
export function validEasing(name: string | undefined): string {
  return name && EASINGS.includes(name) ? name : 'Linear';
}

/** Beat -> fire actions, one per firing, looping. */
export interface BeatActionsAction {
  type: 'beat.actions';
  actions: string[];
}

/** Beat -> run scripts, one per firing, looping. */
export interface BeatScriptsAction {
  type: 'beat.scripts';
  scripts: string[];
}

export type MidiAction =
  | PropertySetAction
  | PropertyBoolAction
  | BpmAffectAction
  | ActionTriggerAction
  | ScriptAction
  | LuaValueAction
  | AppAction
  | PropertyCycleAction;

export type BeatAction = BeatToggleAction | BeatValueAction | BeatActionsAction | BeatScriptsAction | BeatCycleAction;
export type EqAction = PropertySetAction | PropertyThresholdAction;
export type Action = MidiAction | BeatAction | EqAction;

export interface EqTransform {
  gain: number;
  attackMs: number;
  releaseMs: number;
}

interface BindingBase {
  id: string;
  name: string;
  muted: boolean;
}

export interface MidiBinding extends BindingBase {
  source: MidiSource;
  action: MidiAction;
}

export interface BeatBinding extends BindingBase {
  source: BeatSource;
  action: BeatAction;
}

export interface EqBinding extends BindingBase {
  source: EqSource;
  transform: EqTransform;
  action: EqAction;
}

export type Binding = MidiBinding | BeatBinding | EqBinding;

export interface DeviceEntry {
  /** Substring of the OS device name. */
  match: string;
  /** Built-in profile name, if one applies. */
  profile?: string;
}

export interface Palette {
  name: string;
  colors: string[];
  /** The panel gray (outlines, panel and dialog fills). Missing = the built-in palette's, else #141714. */
  panel?: string;
  /** The raised gray (mapping rows, buttons, inputs). Missing = the built-in palette's, else #1F231F. */
  raised?: string;
  /** Text color. Missing = the built-in palette's, else #F0F2EA. */
  ink?: string;
}

export const LUA_DELTA_TIME = 'openspace.time.setDeltaTime';

export function valueKind(type: string): ValueKind {
  switch (type) {
    case 'Bool':
      return 'bool';
    case 'Float':
    case 'Double':
      return 'number';
    case 'Int':
    case 'UInt':
    case 'Long':
    case 'ULong':
    case 'Short':
    case 'UShort':
      return 'int';
    case 'Vec2':
    case 'Vec3':
    case 'Vec4':
    case 'DVec2':
    case 'DVec3':
    case 'DVec4':
    case 'IVec2':
    case 'IVec3':
    case 'IVec4':
    case 'UVec2':
    case 'UVec3':
    case 'UVec4':
      return 'vector';
    case 'Option':
      return 'option';
    case 'String':
      return 'string';
    case 'StringList':
    case 'Selection':
      return 'list';
    case 'Trigger':
      return 'trigger';
    default:
      return 'other';
  }
}

export function vectorSize(type: string): number {
  const m = /Vec([234])$/.exec(type);
  return m ? Number(m[1]) : 1;
}

/** The property or Lua function a binding writes, or null if it writes none. */
export function targetKey(b: Binding): string | null {
  const a = b.action;
  switch (a.type) {
    case 'property.set':
    case 'property.bool':
    case 'property.threshold':
    case 'beat.toggle':
    case 'beat.value':
    case 'property.cycle':
    case 'beat.cycle':
      return `prop:${a.target.uri}`;
    case 'lua.value':
      return `lua:${a.fn}`;
    default:
      return null;
  }
}

/** Property URIs a binding needs to exist in the scene. */
export function requiredProperties(b: Binding): string[] {
  const a = b.action;
  if ('target' in a) return [a.target.uri];
  return [];
}

/** Action identifiers a binding needs to exist. */
export function requiredActions(b: Binding): string[] {
  const a = b.action;
  if (a.type === 'action.trigger') return [a.action];
  if (a.type === 'beat.actions') return a.actions;
  return [];
}

/** Every Lua script a binding would run. */
export function scriptsOf(b: Binding): string[] {
  const a = b.action;
  if (a.type === 'lua.script') return [a.script];
  if (a.type === 'beat.scripts') return a.scripts;
  return [];
}
