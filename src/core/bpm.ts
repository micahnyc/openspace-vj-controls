/**
 * Beat detection (spec: "Audio input"): onset strength, onset picking, tempo
 * estimation and a lock that decides when a detected tempo may drive the clock.
 * Pure: fed with dB spectra and timestamps by the browser audio layer.
 *
 * Method (the standard one for dance music):
 *  1. Onset strength per frame = log-spectral flux: how much each band got
 *     louder, in dB, summed with the kick range weighted up. Working in dB makes
 *     it independent of input volume.
 *  2. Tempo = the period at which that strength signal repeats, found by
 *     autocorrelation over ~8 s, checked at 1, 2 and 4 beats for precision,
 *     with a gentle preference for tempos near 125 (house/techno/EDM) to avoid
 *     half/double time.
 *  3. A lock only lets the tempo change after several estimates agree.
 */

/** Frequency weighting for onset strength: kick range counts most, air not at all. */
function bandWeight(hz: number): number {
  if (hz < 30) return 0;
  if (hz < 200) return 2;
  if (hz < 4000) return 1;
  if (hz < 10000) return 0.5;
  return 0;
}

/** dB floor: quieter bins count as this, so noise in silence can't make flux. */
const DB_FLOOR = -80;

export class OnsetStrength {
  #prev: Float32Array | null = null;
  #weights: Float32Array | null = null;
  #weightSum = 1;

  /** Feed one dB spectrum (AnalyserNode.getFloatFrequencyData); returns strength >= 0. */
  feed(db: ArrayLike<number>, binHz: number): number {
    const n = db.length;
    if (!this.#weights || this.#weights.length !== n) {
      this.#weights = new Float32Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += this.#weights[i] = bandWeight(i * binHz);
      this.#weightSum = sum || 1;
      this.#prev = null;
    }
    const w = this.#weights;
    let flux = 0;
    if (this.#prev) {
      for (let i = 0; i < n; i++) {
        if (w[i] === 0) continue;
        const v = Math.max(DB_FLOOR, db[i]!);
        const d = v - this.#prev[i]!;
        if (d > 0) flux += d * w[i]!;
      }
    }
    if (!this.#prev) this.#prev = new Float32Array(n);
    for (let i = 0; i < n; i++) this.#prev[i] = Math.max(DB_FLOOR, db[i]!);
    return flux / this.#weightSum;
  }

  reset(): void {
    this.#prev = null;
  }
}

/**
 * Picks discrete onsets (for the HIT light and phase nudging) from the
 * strength signal: above recent mean + k * std, and not too soon after the last.
 */
export class OnsetDetector {
  k = 1.5;
  minGapMs = 120;
  #history: number[] = [];
  #historyLen: number;
  #lastOnset = -Infinity;

  constructor(historyLen = 60) {
    this.#historyLen = historyLen;
  }

  feed(strength: number, t: number): boolean {
    const h = this.#history;
    let onset = false;
    if (h.length >= 8) {
      const mean = h.reduce((a, b) => a + b, 0) / h.length;
      const sd = Math.sqrt(h.reduce((a, b) => a + (b - mean) ** 2, 0) / h.length);
      if (strength > mean + this.k * sd && strength > 1e-6 && t - this.#lastOnset >= this.minGapMs) {
        onset = true;
        this.#lastOnset = t;
      }
    }
    h.push(strength);
    if (h.length > this.#historyLen) h.shift();
    return onset;
  }

  reset(): void {
    this.#history = [];
    this.#lastOnset = -Infinity;
  }
}

export interface BpmEstimate {
  bpm: number;
  /** 0..1: how strongly the onset signal repeats at this tempo. */
  confidence: number;
}

export interface TempoOptions {
  minBpm: number;
  maxBpm: number;
  windowMs: number;
  /** Envelope resolution. */
  frameMs: number;
}

const TEMPO_DEFAULTS: TempoOptions = { minBpm: 70, maxBpm: 180, windowMs: 8000, frameMs: 10 };

/** Autocorrelation tempo estimator over a sliding window of onset strength. */
export class TempoEstimator {
  readonly opts: TempoOptions;
  #t: number[] = [];
  #s: number[] = [];

  constructor(opts: Partial<TempoOptions> = {}) {
    this.opts = { ...TEMPO_DEFAULTS, ...opts };
  }

  feed(strength: number, t: number): void {
    this.#t.push(t);
    this.#s.push(strength);
    const cutoff = t - this.opts.windowMs - 1000;
    let drop = 0;
    while (drop < this.#t.length && this.#t[drop]! < cutoff) drop++;
    if (drop > 0) {
      this.#t.splice(0, drop);
      this.#s.splice(0, drop);
    }
  }

  reset(): void {
    this.#t = [];
    this.#s = [];
  }

  estimate(now: number): BpmEstimate | null {
    const { frameMs, windowMs, minBpm, maxBpm } = this.opts;
    const n = Math.floor(windowMs / frameMs);
    const start = now - n * frameMs;
    if (this.#t.length < 2 || this.#t[0]! > start + windowMs * 0.25) return null; // under ~6 s of audio

    // Resample onto a regular grid (max per frame; gaps stay 0).
    const env = new Float64Array(n);
    for (let i = 0; i < this.#t.length; i++) {
      const k = Math.floor((this.#t[i]! - start) / frameMs);
      if (k >= 0 && k < n && this.#s[i]! > env[k]!) env[k] = this.#s[i]!;
    }
    // Remove the mean so the autocorrelation measures repetition, not loudness.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += env[i]!;
    mean /= n;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      env[i] = env[i]! - mean;
      energy += env[i]! * env[i]!;
    }
    if (energy <= 1e-9) return null;

    // Lags up to 60% of the window, so long spans (4 and 8 beats) can refine the tempo.
    const maxLag = Math.min(n - 1, Math.max(Math.ceil((60000 / minBpm / frameMs) * 4) + 2, Math.floor(n * 0.6)));
    const acf = new Float64Array(maxLag + 1);
    for (let lag = 0; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < n; i++) sum += env[i]! * env[i + lag]!;
      acf[lag] = sum / (n - lag); // unbiased
    }
    const a0 = acf[0]!;
    const at = (lag: number): number => {
      if (lag < 0 || lag >= maxLag) return 0;
      const i = Math.floor(lag);
      const f = lag - i;
      return (acf[i]! * (1 - f) + acf[i + 1]! * f) / a0;
    };
    const score = (bpm: number): number => {
      const lag = 60000 / bpm / frameMs;
      // The true beat repeats at 1, 2, 3 and 4 beats. A 2/3 or 3/2 error (locking onto kick + off-beat)
      // only lines up at some of these, so it scores lower.
      const harmonic = (at(lag) + at(lag * 2) + at(lag * 3) + at(lag * 4)) / 4;
      // Dance music sits around 115-150; prefer that octave to avoid half/double-time picks.
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 125) / 0.6) ** 2);
      return harmonic * (0.75 + 0.25 * prior);
    };

    let best = minBpm;
    let bestScore = -Infinity;
    for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
      const s = score(bpm);
      if (s > bestScore) {
        bestScore = s;
        best = bpm;
      }
    }
    // Refine on long spans: a 10 ms grid error over 8 beats is a far smaller tempo error than over 1.
    const fine = (bpm: number): number => {
      const lag = 60000 / bpm / frameMs;
      let v = at(lag * 2) + at(lag * 4);
      if (lag * 8 < maxLag) v += at(lag * 8);
      return v;
    };
    const coarse = best;
    let fineBest = -Infinity;
    for (let bpm = coarse - 0.6; bpm <= coarse + 0.6; bpm += 0.02) {
      const v = fine(bpm);
      if (v > fineBest) {
        fineBest = v;
        best = bpm;
      }
    }

    // Confidence: how far the beat-lag correlation stands above the typical correlation.
    const lag = 60000 / best / frameMs;
    const peak = (at(lag) + at(lag * 2) + at(lag * 4)) / 3;
    let base = 0;
    let count = 0;
    const lo = Math.floor(60000 / maxBpm / frameMs / 2);
    for (let l = lo; l < maxLag; l++) {
      base += acf[l]! / a0;
      count++;
    }
    base = count ? base / count : 0;
    const confidence = Math.max(0, Math.min(1, (peak - base) / Math.max(1e-6, 1 - base)));
    return { bpm: Math.round(best * 10) / 10, confidence };
  }
}

/**
 * Decides when a detected tempo may change the clock: only after `agree`
 * consecutive confident estimates fall within `toleranceBpm` of each other,
 * and only by more than `minChange`. A move to roughly half or double the
 * current tempo needs twice as many agreeing estimates.
 */
export class BpmLock {
  agree = 4;
  toleranceBpm = 1;
  minChange = 0.3;
  #recent: number[] = [];
  current: number | null = null;

  /** Returns the BPM to apply, or null to leave the clock alone. */
  update(est: BpmEstimate | null, minConfidence: number): number | null {
    if (!est || est.confidence < minConfidence) {
      this.#recent = [];
      return null;
    }
    this.#recent.push(est.bpm);
    if (this.#recent.length > this.agree * 2) this.#recent.shift();
    const needed = this.#isOctaveJump(est.bpm) ? this.agree * 2 : this.agree;
    if (this.#recent.length < needed) return null;
    const window = this.#recent.slice(-needed);
    const sorted = [...window].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    if (window.some((b) => Math.abs(b - median) > this.toleranceBpm)) return null;
    const avg = Math.round((window.reduce((a, b) => a + b, 0) / window.length) * 10) / 10;
    if (this.current !== null && Math.abs(avg - this.current) < this.minChange) return null;
    this.current = avg;
    return avg;
  }

  /** The clock was set by hand (tap, typing): judge new estimates against it. */
  setCurrent(bpm: number | null): void {
    this.current = bpm;
    this.#recent = [];
  }

  #isOctaveJump(bpm: number): boolean {
    if (this.current === null) return false;
    const r = bpm / this.current;
    return Math.abs(r - 2) < 0.06 || Math.abs(r - 0.5) < 0.015;
  }
}
