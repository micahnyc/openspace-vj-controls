/**
 * Raw MIDI bytes -> normalized event (spec: "MIDI input layer").
 * Pure: no Web MIDI or DOM types, so it runs under Node in tests.
 */

export type MidiKind =
  | 'cc'
  | 'noteon'
  | 'noteoff'
  | 'polyaftertouch'
  | 'program'
  | 'channelaftertouch'
  | 'pitchbend'
  | 'sysex'
  | 'clock'
  | 'start'
  | 'continue'
  | 'stop'
  | 'activesensing'
  | 'reset'
  | 'system';

export interface MidiEvent {
  /** Device name as the OS reports it. */
  device: string;
  /** 1-16 for channel messages, null for system messages. */
  channel: number | null;
  kind: MidiKind;
  /** CC number, note number, or program number; null where it doesn't apply. */
  number: number | null;
  /** Normalized value: 0..1 for 7-bit data, -1..+1 for pitch bend, null if none. */
  value: number | null;
  /** Raw data value: 0-127, or 0-16383 for pitch bend; null if none. */
  raw: number | null;
  /** Timestamp in ms (performance.now() clock from Web MIDI). */
  t: number;
  /** Original bytes, for the monitor. */
  bytes: number[];
}

const SYSTEM_REALTIME: Record<number, MidiKind> = {
  0xf8: 'clock',
  0xfa: 'start',
  0xfb: 'continue',
  0xfc: 'stop',
  0xfe: 'activesensing',
  0xff: 'reset',
};

/**
 * Parse one complete MIDI message (Web MIDI always delivers whole messages,
 * with running status already expanded). Returns null for empty input.
 */
export function parseMidi(
  data: ArrayLike<number>,
  device: string,
  t: number,
): MidiEvent | null {
  if (data.length === 0) return null;
  const bytes = Array.from(data);
  const status = bytes[0]!;
  const d1 = bytes[1] ?? 0;
  const d2 = bytes[2] ?? 0;
  const base = { device, t, bytes };

  if (status >= 0xf0) {
    if (status === 0xf0) {
      return { ...base, channel: null, kind: 'sysex', number: null, value: null, raw: null };
    }
    const kind = SYSTEM_REALTIME[status] ?? 'system';
    return { ...base, channel: null, kind, number: null, value: null, raw: null };
  }

  const channel = (status & 0x0f) + 1;
  switch (status & 0xf0) {
    case 0x80:
      return { ...base, channel, kind: 'noteoff', number: d1, value: d2 / 127, raw: d2 };
    case 0x90:
      // Note on with velocity 0 is a note off by convention.
      if (d2 === 0) {
        return { ...base, channel, kind: 'noteoff', number: d1, value: 0, raw: 0 };
      }
      return { ...base, channel, kind: 'noteon', number: d1, value: d2 / 127, raw: d2 };
    case 0xa0:
      return { ...base, channel, kind: 'polyaftertouch', number: d1, value: d2 / 127, raw: d2 };
    case 0xb0:
      return { ...base, channel, kind: 'cc', number: d1, value: d2 / 127, raw: d2 };
    case 0xc0:
      return { ...base, channel, kind: 'program', number: d1, value: null, raw: d1 };
    case 0xd0:
      return { ...base, channel, kind: 'channelaftertouch', number: null, value: d1 / 127, raw: d1 };
    case 0xe0: {
      const raw = (d2 << 7) | d1;
      // Center 8192 -> 0; scale so both ends reach exactly -1 and +1.
      const value = raw >= 8192 ? (raw - 8192) / 8191 : (raw - 8192) / 8192;
      return { ...base, channel, kind: 'pitchbend', number: null, value, raw };
    }
    default:
      return null;
  }
}

/** "B0 30 7F" style hex for the monitor. */
export function toHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}
