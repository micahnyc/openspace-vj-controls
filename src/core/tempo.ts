/**
 * Tempo clock (spec: "BPM mappings count from the bar's downbeat"; resync resets
 * beat 1 to now). Time is passed in, so it is testable without timers.
 */
import { clamp } from './transforms';

export const MIN_BPM = 20;
export const MAX_BPM = 300;

export type TempoSource = 'manual' | 'tap' | 'audio';

export class TempoClock {
  bpm = 120;
  /** Time (ms) of beat 0, the bar's downbeat. */
  downbeat = 0;
  source: TempoSource = 'manual';
  #taps: number[] = [];

  get beatMs(): number {
    return 60000 / this.bpm;
  }

  /** Beats elapsed since the downbeat (fractional). */
  beatsAt(now: number): number {
    return (now - this.downbeat) / this.beatMs;
  }

  /** Phase 0..1 across a cycle of `every` beats, shifted by phaseOffset beats. */
  phaseAt(now: number, every: number, phaseOffset = 0): number {
    const b = this.beatsAt(now) - phaseOffset;
    return (((b / every) % 1) + 1) % 1;
  }

  /** Whole cycles of `every` beats since the downbeat. */
  cycleAt(now: number, every: number, phaseOffset = 0): number {
    return Math.floor((this.beatsAt(now) - phaseOffset) / every);
  }

  /** Change tempo without a jump in the current beat position. */
  setBpm(bpm: number, now: number, source: TempoSource = 'manual'): void {
    const next = clamp(bpm, MIN_BPM, MAX_BPM);
    if (!Number.isFinite(next)) return;
    const pos = this.beatsAt(now);
    this.bpm = next;
    this.downbeat = now - pos * this.beatMs;
    this.source = source;
  }

  /** Beat 1 is now. */
  resync(now: number): void {
    this.downbeat = now;
  }

  /**
   * Tap tempo. Two or more taps less than 2 s apart set the BPM from the
   * average of the last 4 intervals; the first tap after a pause resyncs.
   */
  tap(now: number): void {
    const last = this.#taps[this.#taps.length - 1];
    if (last === undefined || now - last > 2000) {
      this.#taps = [now];
      this.resync(now);
      return;
    }
    this.#taps.push(now);
    if (this.#taps.length > 5) this.#taps.shift();
    const iv: number[] = [];
    for (let i = 1; i < this.#taps.length; i++) iv.push(this.#taps[i]! - this.#taps[i - 1]!);
    const avg = iv.reduce((a, b) => a + b, 0) / iv.length;
    this.bpm = clamp(60000 / avg, MIN_BPM, MAX_BPM);
    this.source = 'tap';
    // The first tap of the run was beat 1; keep the grid anchored there.
    this.downbeat = this.#taps[0]!;
  }

  /**
   * Pull the beat grid gently toward an onset that lands near a beat, so an
   * audio-locked clock doesn't drift. Ignores onsets far from any beat.
   */
  nudgeToOnset(t: number, strength = 0.1): void {
    const pos = this.beatsAt(t);
    const err = pos - Math.round(pos); // -0.5..0.5 beats
    if (Math.abs(err) > 0.15) return;
    this.downbeat += err * this.beatMs * strength;
  }
}
