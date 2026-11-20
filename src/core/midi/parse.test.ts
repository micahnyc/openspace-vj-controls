import { describe, expect, it } from 'vitest';
import { parseMidi, toHex } from './parse';

const p = (bytes: number[]) => parseMidi(bytes, 'APC40 mkII', 12.5);

describe('parseMidi', () => {
  it('parses CC with a 0..1 value and 1-based channel', () => {
    // APC40 track fader 3: CC 7 on channel 3
    expect(p([0xb2, 7, 127])).toMatchObject({ kind: 'cc', channel: 3, number: 7, raw: 127, value: 1, t: 12.5 });
    expect(p([0xb0, 48, 0])).toMatchObject({ kind: 'cc', channel: 1, number: 48, value: 0 });
  });

  it('parses note on and note off', () => {
    expect(p([0x90, 39, 127])).toMatchObject({ kind: 'noteon', channel: 1, number: 39, value: 1 });
    expect(p([0x87, 50, 64])).toMatchObject({ kind: 'noteoff', channel: 8, number: 50, raw: 64 });
  });

  it('treats note on velocity 0 as note off', () => {
    expect(p([0x90, 82, 0])).toMatchObject({ kind: 'noteoff', number: 82, value: 0 });
  });

  it('parses pitch bend to -1..+1 with center 0', () => {
    expect(p([0xe0, 0x00, 0x40])).toMatchObject({ kind: 'pitchbend', raw: 8192, value: 0 });
    expect(p([0xe0, 0x7f, 0x7f])!.value).toBe(1);
    expect(p([0xe0, 0x00, 0x00])!.value).toBe(-1);
  });

  it('parses program change and aftertouch', () => {
    expect(p([0xc4, 5])).toMatchObject({ kind: 'program', channel: 5, number: 5, raw: 5, value: null });
    expect(p([0xd0, 64])).toMatchObject({ kind: 'channelaftertouch', number: null, raw: 64 });
    expect(p([0xa0, 60, 10])).toMatchObject({ kind: 'polyaftertouch', number: 60, raw: 10 });
  });

  it('parses system messages without a channel', () => {
    expect(p([0xf8])).toMatchObject({ kind: 'clock', channel: null });
    expect(p([0xfe])).toMatchObject({ kind: 'activesensing', channel: null });
    expect(p([0xf0, 0x47, 0x7f, 0x29, 0xf7])).toMatchObject({ kind: 'sysex', channel: null });
  });

  it('keeps the original bytes and device name', () => {
    expect(p([0xb0, 13, 1])).toMatchObject({ device: 'APC40 mkII', bytes: [0xb0, 13, 1] });
  });

  it('returns null for empty or stray data bytes', () => {
    expect(p([])).toBeNull();
    expect(p([0x40, 1])).toBeNull();
  });

  it('accepts a Uint8Array like Web MIDI delivers', () => {
    expect(parseMidi(new Uint8Array([0xb0, 16, 64]), 'x', 0)).toMatchObject({ kind: 'cc', number: 16, raw: 64 });
  });
});

describe('toHex', () => {
  it('formats bytes as spaced uppercase hex', () => {
    expect(toHex([0xb0, 0x30, 0x7f, 0x05])).toBe('B0 30 7F 05');
  });
});
