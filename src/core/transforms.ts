/**
 * Pure value transforms. Value in, value out; no state, no browser APIs.
 */
import { BEAT_INTERVALS, type BeatInterval, type Curve, type EncoderMode } from './types';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** 0..1 through a curve. 'exp' spends more travel near the bottom of the range. */
export function shape(x: number, curve: Curve): number {
  const t = clamp01(x);
  return curve === 'exp' ? t * t : t;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map 0..1 across min..max, per component for vectors. */
export function scale(
  x: number,
  min: number | number[],
  max: number | number[],
  curve: Curve = 'linear',
): number | number[] {
  const t = shape(x, curve);
  if (Array.isArray(min) || Array.isArray(max)) {
    const lo = Array.isArray(min) ? min : [min];
    const hi = Array.isArray(max) ? max : [max];
    const n = Math.max(lo.length, hi.length);
    return Array.from({ length: n }, (_, i) => lerp(lo[i] ?? lo[0] ?? 0, hi[i] ?? hi[0] ?? 0, t));
  }
  return lerp(min, max, t);
}

/**
 * Delta-time style curve (spec: "Delta time"). Linear maps straight across.
 * Exponential spends more of the travel near zero (or near min when the
 * range is all positive) so real time stays playable on a wide range.
 */
export function deltaCurve(x: number, min: number, max: number, curve: Curve): number {
  const t = clamp01(x);
  if (curve === 'linear') return lerp(min, max, t);
  if (min < 0 && max > 0) {
    const c = 2 * t - 1; // -1..+1, centre = 0
    return c >= 0 ? max * c ** 3 : -min * c ** 3;
  }
  if (min > 0 && max > 0) return min * (max / min) ** t;
  if (min < 0 && max < 0) return -(-min * (max / min) ** t);
  return lerp(min, max, t ** 3);
}

/** Inverse of deltaCurve, so an encoder can continue from the current value. */
export function deltaCurveInverse(v: number, min: number, max: number, curve: Curve): number {
  if (max === min) return 0;
  if (curve === 'linear') return clamp01((v - min) / (max - min));
  if (min < 0 && max > 0) {
    const c = v >= 0 ? Math.cbrt(v / max) : -Math.cbrt(v / min);
    return clamp01((c + 1) / 2);
  }
  if (min > 0 && max > 0) return clamp01(Math.log(clamp(v, min, max) / min) / Math.log(max / min));
  if (min < 0 && max < 0) return clamp01(Math.log(clamp(v, min, max) / min) / Math.log(max / min));
  return clamp01(Math.cbrt((v - min) / (max - min)));
}

/** Signed step from a relative encoder's raw value. */
export function decodeRelative(raw: number, mode: EncoderMode): number {
  switch (mode) {
    case 'relative-signed-bit7':
      return raw < 64 ? raw : raw - 128;
    case 'relative-sign-magnitude':
      return raw & 0x40 ? -(raw & 0x3f) : raw & 0x3f;
    case 'relative-binary-offset':
      return raw - 64;
    default:
      return 0;
  }
}

/**
 * Guess absolute vs relative from the first few raw values of a CC
 * (spec: MIDI learn "guesses absolute vs relative from the first few values").
 */
export function guessEncoderMode(raws: readonly number[]): EncoderMode {
  if (raws.length === 0) return 'absolute';
  if (raws.every((r) => r >= 58 && r <= 70 && r !== 64)) return 'relative-binary-offset';
  if (raws.every((r) => (r >= 1 && r <= 8) || (r >= 120 && r <= 127))) return 'relative-signed-bit7';
  if (raws.every((r) => (r >= 1 && r <= 8) || (r >= 65 && r <= 72))) return 'relative-sign-magnitude';
  return 'absolute';
}

/** Beat phase 0..1 -> 0..1 output. Ping-pong goes min -> max -> min; ramp snaps back. */
export function beatShape(phase: number, kind: 'pingpong' | 'ramp'): number {
  const p = ((phase % 1) + 1) % 1;
  return kind === 'pingpong' ? (p < 0.5 ? p * 2 : 2 - p * 2) : p;
}

/** Narrow min..max around its midpoint. amount 0 = collapsed, 1 = full range. */
export function narrowRange(
  min: number | number[],
  max: number | number[],
  amount: number,
): { min: number | number[]; max: number | number[] } {
  const a = clamp01(amount);
  const one = (lo: number, hi: number) => {
    const mid = (lo + hi) / 2;
    return [mid + (lo - mid) * a, mid + (hi - mid) * a] as const;
  };
  if (Array.isArray(min) && Array.isArray(max)) {
    const pairs = min.map((lo, i) => one(lo, max[i] ?? lo));
    return { min: pairs.map((p) => p[0]), max: pairs.map((p) => p[1]) };
  }
  if (typeof min === 'number' && typeof max === 'number') {
    const [lo, hi] = one(min, max);
    return { min: lo, max: hi };
  }
  return { min, max };
}

/** Knob travel 0..1 -> every ½, 1, 2, 4, 8 or 16 beats. */
export function intervalFromKnob(x: number): BeatInterval {
  const i = Math.min(BEAT_INTERVALS.length - 1, Math.floor(clamp01(x) * BEAT_INTERVALS.length));
  return BEAT_INTERVALS[i]!;
}

/** Step through the interval list by delta positions (relative encoders). */
export function stepInterval(current: BeatInterval, delta: number): BeatInterval {
  const i = BEAT_INTERVALS.indexOf(current);
  const next = clamp((i < 0 ? 0 : i) + Math.sign(delta), 0, BEAT_INTERVALS.length - 1);
  return BEAT_INTERVALS[next]!;
}

/** One step of an attack/release envelope follower. */
export function envelope(prev: number, target: number, dtMs: number, attackMs: number, releaseMs: number): number {
  const tau = target > prev ? attackMs : releaseMs;
  if (tau <= 0) return target;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  return prev + (target - prev) * k;
}

/** Clamp a value (or each component) to property limits when known. */
export function clampToLimits(
  v: number | number[],
  min: number | number[] | undefined,
  max: number | number[] | undefined,
): number | number[] {
  const at = (x: number | number[] | undefined, i: number) => (Array.isArray(x) ? x[i] : x);
  const one = (x: number, i: number) => {
    const lo = at(min, i);
    const hi = at(max, i);
    let r = x;
    if (typeof lo === 'number' && Number.isFinite(lo)) r = Math.max(lo, r);
    if (typeof hi === 'number' && Number.isFinite(hi)) r = Math.min(hi, r);
    return r;
  };
  return Array.isArray(v) ? v.map(one) : one(v, 0);
}

/** True if two outgoing values are equal within epsilon (spec: change threshold). */
export function nearlyEqual(a: unknown, b: unknown, eps = 1e-6): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => nearlyEqual(x, b[i], eps));
  }
  return a === b;
}
