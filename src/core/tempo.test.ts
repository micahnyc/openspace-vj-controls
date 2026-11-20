import { describe, expect, it } from 'vitest';
import { TempoClock } from './tempo';
import { BpmLock, OnsetDetector, OnsetStrength, TempoEstimator } from './bpm';

describe('TempoClock', () => {
  it('counts beats and phase from the downbeat', () => {
    const c = new TempoClock();
    c.setBpm(120, 0);
    c.resync(1000);
    expect(c.beatsAt(1000)).toBe(0);
    expect(c.beatsAt(2000)).toBe(2);
    expect(c.phaseAt(2000, 4)).toBeCloseTo(0.5);
    expect(c.cycleAt(2999, 4)).toBe(0);
    expect(c.cycleAt(3000, 4)).toBe(1);
  });

  it('changes tempo without jumping the beat position', () => {
    const c = new TempoClock();
    c.setBpm(120, 0);
    const before = c.beatsAt(5000);
    c.setBpm(140, 5000);
    expect(c.beatsAt(5000)).toBeCloseTo(before);
  });

  it('tap tempo sets BPM from intervals and anchors beat 1 at the first tap', () => {
    const c = new TempoClock();
    [10_000, 10_500, 11_000, 11_500].forEach((t) => c.tap(t));
    expect(c.bpm).toBeCloseTo(120);
    expect(c.downbeat).toBe(10_000);
    expect(c.source).toBe('tap');
  });

  it('a tap after a long pause resyncs', () => {
    const c = new TempoClock();
    c.tap(0);
    c.tap(500);
    c.tap(10_000);
    expect(c.downbeat).toBe(10_000);
    expect(c.bpm).toBeCloseTo(120);
  });

  it('nudges toward onsets near a beat and ignores ones far away', () => {
    const c = new TempoClock();
    c.setBpm(120, 0);
    c.resync(0);
    c.nudgeToOnset(520, 1); // 20 ms late -> full correction
    expect(c.downbeat).toBeCloseTo(20);
    c.nudgeToOnset(270, 1); // half a beat off -> ignored
    expect(c.downbeat).toBeCloseTo(20);
  });
});

/**
 * Synthetic onset-strength signal at 10 ms frames, like the audio layer feeds:
 * kicks on every beat, hats on off-beats, random noise, timing jitter.
 */
function danceTrack(bpm: number, seconds: number, opts: { hats?: number; noise?: number; jitterMs?: number; seed?: number } = {}) {
  const { hats = 0.4, noise = 0.15, jitterMs = 4, seed = 1 } = opts;
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const frames = Math.round((seconds * 1000) / 10);
  const env = new Float64Array(frames);
  const beatMs = 60000 / bpm;
  const hit = (tMs: number, amp: number) => {
    const k = Math.round((tMs + (rnd() - 0.5) * 2 * jitterMs) / 10);
    if (k >= 0 && k < frames) env[k] = env[k]! + amp;
    if (k + 1 >= 0 && k + 1 < frames) env[k + 1] = env[k + 1]! + amp * 0.4;
  };
  for (let t = 0; t < seconds * 1000; t += beatMs) {
    hit(t, 1);
    if (hats) hit(t + beatMs / 2, hats);
  }
  for (let k = 0; k < frames; k++) env[k] = env[k]! + rnd() * noise;
  return env;
}

function run(env: Float64Array) {
  const est = new TempoEstimator();
  for (let k = 0; k < env.length; k++) est.feed(env[k]!, k * 10);
  return est.estimate((env.length - 1) * 10);
}

describe('TempoEstimator', () => {
  it('finds house and techno tempos to within 0.3 BPM', () => {
    for (const bpm of [118, 122, 124, 125, 126, 128, 130, 132, 135, 140, 145, 150]) {
      const e = run(danceTrack(bpm, 10, { seed: bpm }))!;
      expect(Math.abs(e.bpm - bpm), `${bpm} -> ${e.bpm}`).toBeLessThan(0.3);
    }
  });

  it('is confident on a steady kick', () => {
    expect(run(danceTrack(126, 10))!.confidence).toBeGreaterThan(0.5);
  });

  it('copes with loud hats and heavy noise', () => {
    const e = run(danceTrack(128, 10, { hats: 0.9, noise: 0.5, jitterMs: 8 }))!;
    expect(Math.abs(e.bpm - 128)).toBeLessThan(0.5);
  });

  it('does not pick half or double time for dance tempos', () => {
    for (const bpm of [120, 128, 140]) {
      const e = run(danceTrack(bpm, 10, { hats: 0, seed: bpm + 7 }))!;
      expect(Math.abs(e.bpm - bpm), `${bpm} -> ${e.bpm}`).toBeLessThan(0.5);
    }
  });

  it('has low confidence on noise', () => {
    let s = 3;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const env = Float64Array.from({ length: 1000 }, () => rnd());
    expect(run(env)!.confidence).toBeLessThan(0.25);
  });

  it('waits for enough audio', () => {
    expect(run(danceTrack(128, 3))).toBeNull();
  });
});

describe('OnsetStrength', () => {
  it('responds to a jump in level the same at any volume', () => {
    const quiet = (db: number) => Array.from({ length: 64 }, () => db);
    const a = new OnsetStrength();
    a.feed(quiet(-60), 23.4);
    const loud = a.feed(quiet(-40), 23.4);
    const b = new OnsetStrength();
    b.feed(quiet(-40), 23.4);
    const louder = b.feed(quiet(-20), 23.4);
    expect(loud).toBeGreaterThan(0);
    expect(louder).toBeCloseTo(loud);
  });

  it('ignores level drops and silence below the floor', () => {
    const o = new OnsetStrength();
    o.feed(Array(64).fill(-30), 23.4);
    expect(o.feed(Array(64).fill(-50), 23.4)).toBe(0);
    const s = new OnsetStrength();
    s.feed(Array(64).fill(-120), 23.4);
    expect(s.feed(Array(64).fill(-100), 23.4)).toBe(0);
  });
});

describe('OnsetDetector', () => {
  it('fires on a spike and respects the minimum gap', () => {
    const d = new OnsetDetector();
    let t = 0;
    for (let i = 0; i < 20; i++) expect(d.feed(0.1 + (i % 2) * 0.01, (t += 10))).toBe(false);
    expect(d.feed(2, (t += 10))).toBe(true);
    expect(d.feed(2, (t += 10))).toBe(false);
  });
});

describe('BpmLock', () => {
  const est = (bpm: number, confidence = 0.6) => ({ bpm, confidence });

  it('applies a tempo only after several confident estimates agree', () => {
    const l = new BpmLock();
    expect(l.update(est(128), 0.35)).toBeNull();
    expect(l.update(est(128.2), 0.35)).toBeNull();
    expect(l.update(est(127.9), 0.35)).toBeNull();
    expect(l.update(est(128.1), 0.35)).toBe(128.1);
    expect(l.update(est(128.1), 0.35)).toBeNull(); // no change
  });

  it('ignores wandering and low-confidence estimates', () => {
    const l = new BpmLock();
    for (const b of [145, 100.8, 175, 128, 145, 100]) expect(l.update(est(b), 0.35)).toBeNull();
    for (let i = 0; i < 6; i++) expect(l.update(est(128, 0.2), 0.35)).toBeNull();
  });

  it('needs twice the agreement to jump to half or double time', () => {
    const l = new BpmLock();
    l.setCurrent(128);
    const results = Array.from({ length: 8 }, () => l.update(est(64), 0.35));
    expect(results.slice(0, 7).every((r) => r === null)).toBe(true);
    expect(results[7]).toBe(64);
  });
});
