import { describe, expect, it } from 'vitest';
import { findControl, findProfile, type ControllerProfile } from './profile';
import apc40 from '../../profiles/akai-apc40-mk2.json';

const profile = apc40 as ControllerProfile;

describe('APC40 mkII profile', () => {
  it('has 122 controls with unique ids and unique MIDI addresses', () => {
    expect(profile.controls).toHaveLength(122);
    expect(new Set(profile.controls.map((c) => c.id)).size).toBe(122);
    const addrs = profile.controls.map((c) => `${c.kind}:${c.channel}:${c.number}`);
    expect(new Set(addrs).size).toBe(addrs.length);
  });
});

describe('findProfile', () => {
  it('matches Windows-style device names case-insensitively', () => {
    expect(findProfile([profile], 'APC40 mkII')?.name).toBe('Akai APC40 mkII');
    expect(findProfile([profile], '2- apc40 MKII')?.name).toBe('Akai APC40 mkII');
    expect(findProfile([profile], 'Launch Control XL')).toBeUndefined();
  });
});

describe('findControl', () => {
  it('finds faders by channel', () => {
    expect(findControl(profile, { kind: 'cc', channel: 3, number: 7 })?.id).toBe('track-fader-3');
  });
  it('matches note on and note off to the same pad', () => {
    expect(findControl(profile, { kind: 'noteon', channel: 1, number: 0 })?.id).toBe('pad-0');
    expect(findControl(profile, { kind: 'noteoff', channel: 1, number: 0 })?.id).toBe('pad-0');
  });
  it('returns undefined for unknown or channel-less messages', () => {
    expect(findControl(profile, { kind: 'cc', channel: 16, number: 127 })).toBeUndefined();
    expect(findControl(profile, { kind: 'clock', channel: null, number: null })).toBeUndefined();
    expect(findControl(profile, { kind: 'pitchbend', channel: 1, number: null })).toBeUndefined();
  });
});
