/**
 * Controller profiles (profiles/*.json). Pure lookups, no browser APIs.
 */
import type { MidiEvent } from './midi/parse';

/** selector: a button that cycles through states itself and reports the state as note velocity (APC40 A|B). */
export type ControlType = 'slider' | 'knob' | 'encoder' | 'pad' | 'button' | 'selector';

export interface ProfileControl {
  id: string;
  label: string;
  type: ControlType;
  kind: 'cc' | 'note';
  /** 1-16 */
  channel: number;
  number: number;
  mode?: string;
  group?: string;
  verify?: string;
  /** For selectors: state names, indexed by note velocity (note off = state 0). */
  states?: string[];
  /** 'rgb' pads take a color index as velocity; others are on/off. */
  led?: string;
  /** Knob LED ring: `cc` sets the ring (and the knob's position), `typeCc` its style. */
  ledRing?: { cc: number; typeCc: number };
}

export interface ControllerProfile {
  profileVersion: number;
  name: string;
  /** Substrings of the OS device name that select this profile. */
  match: string[];
  controls: ProfileControl[];
  [extra: string]: unknown;
}

/** Profile whose `match` entries appear in the device name (case-insensitive). */
export function findProfile(
  profiles: readonly ControllerProfile[],
  deviceName: string,
): ControllerProfile | undefined {
  const name = deviceName.toLowerCase();
  return profiles.find((p) => p.match.some((m) => name.includes(m.toLowerCase())));
}

/** Profile control addressed by an event; note on and note off both match a 'note' control. */
export function findControl(
  profile: ControllerProfile,
  ev: Pick<MidiEvent, 'channel' | 'kind' | 'number'>,
): ProfileControl | undefined {
  if (ev.channel === null || ev.number === null) return undefined;
  const kind = ev.kind === 'cc' ? 'cc' : ev.kind === 'noteon' || ev.kind === 'noteoff' ? 'note' : null;
  if (!kind) return undefined;
  return profile.controls.find(
    (c) => c.kind === kind && c.channel === ev.channel && c.number === ev.number,
  );
}
