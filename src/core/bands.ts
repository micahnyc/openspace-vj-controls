/**
 * Sample-accurate band energies for beat detection. Runs inside the
 * AudioWorklet (audio thread) in the app, and in plain Node in tests.
 *
 * Splits mono audio into low (< 150 Hz, the kick), mid (150 Hz - 4 kHz) and
 * high (> 4 kHz, hats) with one-pole filters, and emits the mean energy of
 * each band every `hop` samples, timestamped at the end of the hop.
 */

export interface BandFrame {
  /** Seconds on the audio clock at the end of this hop. */
  t: number;
  low: number;
  mid: number;
  high: number;
}

class OnePoleLowpass {
  #a: number;
  #y = 0;
  constructor(cutoffHz: number, sampleRate: number) {
    this.#a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  }
  step(x: number): number {
    this.#y += this.#a * (x - this.#y);
    return this.#y;
  }
}

export class BandEnergies {
  readonly hop: number;
  readonly sampleRate: number;
  // Two cascaded poles for the kick band give a steeper slope than one.
  #lowA: OnePoleLowpass;
  #lowB: OnePoleLowpass;
  #hiCut: OnePoleLowpass;
  #acc = { low: 0, mid: 0, high: 0 };
  #n = 0;

  constructor(sampleRate: number, hop = 512) {
    this.sampleRate = sampleRate;
    this.hop = hop;
    this.#lowA = new OnePoleLowpass(150, sampleRate);
    this.#lowB = new OnePoleLowpass(150, sampleRate);
    this.#hiCut = new OnePoleLowpass(4000, sampleRate);
  }

  /** Hop length in milliseconds (10.67 ms at 48 kHz with hop 512). */
  get hopMs(): number {
    return (this.hop / this.sampleRate) * 1000;
  }

  /**
   * Feed a block of mono samples whose first sample is at `startTime`
   * seconds. Returns the frames completed within the block.
   */
  process(samples: ArrayLike<number>, startTime: number): BandFrame[] {
    const out: BandFrame[] = [];
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]!;
      const low = this.#lowB.step(this.#lowA.step(x));
      const belowHi = this.#hiCut.step(x);
      const mid = belowHi - low;
      const high = x - belowHi;
      this.#acc.low += low * low;
      this.#acc.mid += mid * mid;
      this.#acc.high += high * high;
      if (++this.#n === this.hop) {
        out.push({
          t: startTime + (i + 1) / this.sampleRate,
          low: this.#acc.low / this.hop,
          mid: this.#acc.mid / this.hop,
          high: this.#acc.high / this.hop,
        });
        this.#acc = { low: 0, mid: 0, high: 0 };
        this.#n = 0;
      }
    }
    return out;
  }
}

/** dB floor relative to full scale: quieter than this counts as silence. */
const FLOOR_DB = -80;
const WEIGHTS = { low: 2, mid: 1, high: 0.5 } as const;

/**
 * Onset strength from band energies: how many dB each band rose since the
 * previous frame (rises only), weighted toward the kick. Working in dB makes
 * it independent of input level.
 */
export class BandFlux {
  #prev: { low: number; mid: number; high: number } | null = null;

  feed(f: BandFrame): number {
    const db = (e: number) => Math.max(FLOOR_DB, 10 * Math.log10(e + 1e-12));
    const cur = { low: db(f.low), mid: db(f.mid), high: db(f.high) };
    let s = 0;
    if (this.#prev) {
      for (const k of ['low', 'mid', 'high'] as const) {
        const d = cur[k] - this.#prev[k];
        if (d > 0) s += d * WEIGHTS[k];
      }
    }
    this.#prev = cur;
    return s / (WEIGHTS.low + WEIGHTS.mid + WEIGHTS.high);
  }

  reset(): void {
    this.#prev = null;
  }
}
