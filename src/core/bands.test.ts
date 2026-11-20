import { describe, expect, it } from 'vitest';
import { BandEnergies, BandFlux } from './bands';
import { TempoEstimator } from './bpm';

const SR = 48000;

/**
 * Synthesize a house groove as raw audio: four-on-the-floor kick (pitch-swept
 * sine), off-beat open hats and 16th closed hats (filtered noise), a bassline
 * on the off-beats, a sustained pad, and background noise.
 */
function house(bpm: number, seconds: number, opts: { gain?: number; seed?: number; swingMs?: number } = {}): Float32Array {
  const { gain = 1, seed = 7, swingMs = 0 } = opts;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  const beat = (60 / bpm) * SR;
  const add = (start: number, len: number, f: (i: number) => number) => {
    for (let i = 0; i < len && start + i < n; i++) if (start + i >= 0) out[start + i] = out[start + i]! + f(i);
  };
  for (let b = 0; b * beat < n; b++) {
    const t0 = Math.round(b * beat);
    // Kick: 120 -> 45 Hz sweep, fast decay.
    let phase = 0;
    add(t0, Math.round(0.25 * SR), (i) => {
      const f = 45 + 75 * Math.exp(-i / (0.03 * SR));
      phase += (2 * Math.PI * f) / SR;
      return 0.9 * Math.sin(phase) * Math.exp(-i / (0.12 * SR));
    });
    // Open hat on the off-beat, closed hats on 16ths (with optional swing on the "e" and "a").
    const hat = (start: number, amp: number, decay: number) => {
      let prev = 0;
      add(start, Math.round(decay * 5 * SR), (i) => {
        const w = rnd();
        const hp = w - prev; // crude high-pass
        prev = w;
        return amp * hp * Math.exp(-i / (decay * SR));
      });
    };
    hat(t0 + Math.round(beat / 2), 0.25, 0.05);
    for (const q of [1, 3]) hat(t0 + Math.round((beat / 4) * q + (swingMs / 1000) * SR), 0.12, 0.012);
    // Bass on the off-beat.
    add(t0 + Math.round(beat / 2), Math.round(beat / 2), (i) => 0.35 * Math.sin((2 * Math.PI * 55 * i) / SR) * Math.min(1, i / 400));
  }
  // Pad and noise floor.
  for (let i = 0; i < n; i++) out[i] = out[i]! + 0.08 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.01 * rnd();
  for (let i = 0; i < n; i++) out[i] = out[i]! * gain;
  return out;
}

/** Run audio through the worklet pipeline in 128-sample render quanta, as the browser does. */
function detect(audio: Float32Array): ReturnType<TempoEstimator['estimate']> {
  const bands = new BandEnergies(SR);
  const flux = new BandFlux();
  const tempo = new TempoEstimator({ frameMs: bands.hopMs });
  let last = 0;
  for (let start = 0; start < audio.length; start += 128) {
    const block = audio.subarray(start, start + 128);
    for (const f of bands.process(block, start / SR)) {
      last = f.t * 1000;
      tempo.feed(flux.feed(f), last);
    }
  }
  return tempo.estimate(last);
}

describe('beat detection on synthesized house audio', () => {
  it('finds house and techno tempos from raw audio', () => {
    for (const bpm of [118, 120, 122, 124, 125, 126, 128, 130, 132]) {
      const e = detect(house(bpm, 10, { seed: bpm }))!;
      expect(Math.abs(e.bpm - bpm), `${bpm} -> ${e.bpm}`).toBeLessThan(0.3);
      expect(e.confidence, `${bpm} confidence`).toBeGreaterThan(0.35);
    }
  });

  it('holds up across every tempo from 115 to 135 BPM and different grooves', () => {
    const misses: string[] = [];
    for (let bpm = 115; bpm <= 135; bpm++) {
      for (const seed of [3, 11]) {
        const e = detect(house(bpm, 10, { seed: bpm * seed, swingMs: seed === 11 ? 15 : 0 }))!;
        if (Math.abs(e.bpm - bpm) >= 0.3) misses.push(`${bpm} -> ${e.bpm}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it('does not care about input level', () => {
    const loud = detect(house(124, 10, { gain: 1 }))!;
    const quiet = detect(house(124, 10, { gain: 0.02 }))!;
    expect(Math.abs(quiet.bpm - 124)).toBeLessThan(0.3);
    expect(Math.abs(quiet.confidence - loud.confidence)).toBeLessThan(0.05);
  });

  it('copes with swung hats', () => {
    const e = detect(house(123, 10, { swingMs: 25 }))!;
    expect(Math.abs(e.bpm - 123)).toBeLessThan(0.3);
  });

  it('band energies are timestamped on the audio clock at a fixed hop', () => {
    const b = new BandEnergies(SR, 512);
    const frames = b.process(new Float32Array(2048), 1);
    expect(frames.map((f) => f.t)).toEqual([1 + 512 / SR, 1 + 1024 / SR, 1 + 1536 / SR, 1 + 2048 / SR]);
  });
});
