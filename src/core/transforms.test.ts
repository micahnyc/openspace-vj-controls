import { describe, expect, it } from 'vitest';
import {
  beatShape,
  clampToLimits,
  decodeRelative,
  deltaCurve,
  deltaCurveInverse,
  envelope,
  guessEncoderMode,
  intervalFromKnob,
  narrowRange,
  nearlyEqual,
  scale,
  stepInterval,
} from './transforms';

describe('scale', () => {
  it('maps 0..1 across min..max', () => {
    expect(scale(0, 0.2, 1)).toBeCloseTo(0.2);
    expect(scale(1, 0.2, 1)).toBeCloseTo(1);
    expect(scale(0.5, 0, 10)).toBe(5);
  });
  it('applies the exp curve', () => {
    expect(scale(0.5, 0, 1, 'exp')).toBeCloseTo(0.25);
  });
  it('scales vectors per component', () => {
    expect(scale(0.5, [0, 0, 0], [1, 2, 4])).toEqual([0.5, 1, 2]);
  });
  it('clamps input', () => {
    expect(scale(2, 0, 1)).toBe(1);
    expect(scale(-1, 0, 1)).toBe(0);
  });
});

describe('deltaCurve', () => {
  it('linear covers min..max', () => {
    expect(deltaCurve(0, -86400, 86400, 'linear')).toBe(-86400);
    expect(deltaCurve(1, -86400, 86400, 'linear')).toBe(86400);
    expect(deltaCurve(0.5, -86400, 86400, 'linear')).toBe(0);
  });
  it('exp keeps the ends and spends more travel near zero', () => {
    expect(deltaCurve(0, -100, 100, 'exp')).toBeCloseTo(-100);
    expect(deltaCurve(1, -100, 100, 'exp')).toBeCloseTo(100);
    expect(deltaCurve(0.5, -100, 100, 'exp')).toBeCloseTo(0);
    expect(Math.abs(deltaCurve(0.6, -100, 100, 'exp'))).toBeLessThan(Math.abs(deltaCurve(0.6, -100, 100, 'linear')));
  });
  it('inverse round-trips', () => {
    for (const curve of ['linear', 'exp'] as const) {
      for (const [min, max] of [[-100, 100], [1, 1000], [-1000, -1], [0, 50]] as const) {
        for (const x of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
          expect(deltaCurveInverse(deltaCurve(x, min, max, curve), min, max, curve)).toBeCloseTo(x, 6);
        }
      }
    }
  });
});

describe('decodeRelative', () => {
  it('decodes two\'s complement (APC40 tempo knob)', () => {
    expect(decodeRelative(1, 'relative-signed-bit7')).toBe(1);
    expect(decodeRelative(63, 'relative-signed-bit7')).toBe(63);
    expect(decodeRelative(127, 'relative-signed-bit7')).toBe(-1);
    expect(decodeRelative(64, 'relative-signed-bit7')).toBe(-64);
    expect(decodeRelative(0, 'relative-signed-bit7')).toBe(0);
  });
  it('decodes sign-magnitude and binary offset', () => {
    expect(decodeRelative(65, 'relative-sign-magnitude')).toBe(-1);
    expect(decodeRelative(3, 'relative-sign-magnitude')).toBe(3);
    expect(decodeRelative(63, 'relative-binary-offset')).toBe(-1);
    expect(decodeRelative(66, 'relative-binary-offset')).toBe(2);
  });
});

describe('guessEncoderMode', () => {
  it('spots relative encoders from their first values', () => {
    expect(guessEncoderMode([1, 1, 2, 1])).toBe('relative-signed-bit7');
    expect(guessEncoderMode([127, 126, 127])).toBe('relative-signed-bit7');
    expect(guessEncoderMode([65, 66, 63])).toBe('relative-binary-offset');
    expect(guessEncoderMode([40, 41, 43, 47])).toBe('absolute');
    expect(guessEncoderMode([])).toBe('absolute');
  });
});

describe('beatShape', () => {
  it('ping-pong goes up then down', () => {
    expect(beatShape(0, 'pingpong')).toBe(0);
    expect(beatShape(0.25, 'pingpong')).toBe(0.5);
    expect(beatShape(0.5, 'pingpong')).toBe(1);
    expect(beatShape(0.75, 'pingpong')).toBe(0.5);
  });
  it('ramp rises then snaps back', () => {
    expect(beatShape(0.75, 'ramp')).toBe(0.75);
    expect(beatShape(1, 'ramp')).toBe(0);
  });
});

describe('narrowRange', () => {
  it('collapses to the midpoint at 0 and is full at 1', () => {
    expect(narrowRange(0.2, 1, 0)).toEqual({ min: 0.6, max: 0.6 });
    expect(narrowRange(0.2, 1, 1)).toEqual({ min: 0.2, max: 1 });
    const half = narrowRange(0, 1, 0.5);
    expect(half.min).toBeCloseTo(0.25);
    expect(half.max).toBeCloseTo(0.75);
  });
  it('works per component', () => {
    expect(narrowRange([0, 0], [2, 4], 0)).toEqual({ min: [1, 2], max: [1, 2] });
  });
});

describe('beat intervals', () => {
  it('knob travel steps through ½, 1, 2, 4, 8, 16', () => {
    expect([0, 0.16, 0.17, 0.34, 0.5, 0.67, 0.84, 1].map(intervalFromKnob)).toEqual([0.5, 0.5, 1, 2, 4, 8, 16, 16]);
  });
  it('encoder steps one position at a time and stops at the ends', () => {
    expect(stepInterval(4, 1)).toBe(8);
    expect(stepInterval(4, -5)).toBe(2);
    expect(stepInterval(16, 1)).toBe(16);
    expect(stepInterval(1, -1)).toBe(0.5);
    expect(stepInterval(0.5, -1)).toBe(0.5);
  });
});

describe('envelope', () => {
  it('attacks fast and releases slowly', () => {
    const up = envelope(0, 1, 10, 10, 1000);
    const down = envelope(1, 0, 10, 10, 1000);
    expect(up).toBeGreaterThan(0.6);
    expect(down).toBeGreaterThan(0.98);
  });
  it('zero time constant follows instantly', () => {
    expect(envelope(0, 0.7, 5, 0, 0)).toBe(0.7);
  });
});

describe('clampToLimits / nearlyEqual', () => {
  it('clamps scalars and vectors', () => {
    expect(clampToLimits(2, 0, 1)).toBe(1);
    expect(clampToLimits([-1, 0.5, 9], [0, 0, 0], [1, 1, 1])).toEqual([0, 0.5, 1]);
    expect(clampToLimits(5, undefined, undefined)).toBe(5);
  });
  it('compares within epsilon', () => {
    expect(nearlyEqual(0.5, 0.5 + 1e-9)).toBe(true);
    expect(nearlyEqual(0.5, 0.51)).toBe(false);
    expect(nearlyEqual([1, 2], [1, 2])).toBe(true);
    expect(nearlyEqual(true, false)).toBe(false);
  });
});
