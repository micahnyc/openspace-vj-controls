/**
 * Audio input (spec: "Audio input"). Captures a device or the system mix.
 *  - Beat detection: an AudioWorklet measures band energies on the audio
 *    thread, sample-accurately and evenly spaced, which tempo estimation needs.
 *  - Meters and EQ sources: an AnalyserNode polled from the Web Worker tick.
 * If the worklet can't load, beat detection falls back to the analyser.
 */
import { BandFlux, type BandFrame } from '../../core/bands';
import { OnsetDetector, OnsetStrength, TempoEstimator, type BpmEstimate } from '../../core/bpm';
import beatWorkletUrl from './beat.worklet.ts?worker&url';
import type { EqBand } from '../../core/types';

export interface AudioDevice {
  id: string;
  label: string;
}

export const SYSTEM_AUDIO = 'system';
const ANALYSIS_MS = 10;
const ESTIMATE_MS = 500;
const UI_MS = 33;

/** Band edges in Hz. */
const BANDS: Record<Exclude<EqBand, 'level'>, [number, number]> = {
  low: [20, 250],
  mid: [250, 4000],
  high: [4000, 16000],
};
/** dB range mapped to 0..1 for band meters. */
const DB_FLOOR = -90;
const DB_CEIL = -25;

class AudioInput {
  devices: AudioDevice[] = $state.raw([]);
  /** '' = off, SYSTEM_AUDIO, or a device id. */
  source = $state('');
  running = $state(false);
  error: string | null = $state(null);
  /** UI meters, refreshed ~30 times a second. */
  levels: Record<EqBand, number> = $state({ level: 0, low: 0, mid: 0, high: 0 });
  lastOnset = $state(0);
  estimate: BpmEstimate | null = $state(null);

  onLevels: ((l: Record<EqBand, number>) => void) | null = null;
  onOnset: ((t: number) => void) | null = null;
  onEstimate: ((e: BpmEstimate) => void) | null = null;

  #ctx: AudioContext | null = null;
  #stream: MediaStream | null = null;
  #analyser: AnalyserNode | null = null;
  #freq: Float32Array<ArrayBuffer> = new Float32Array(0);
  #time: Float32Array<ArrayBuffer> = new Float32Array(0);
  #strength = new OnsetStrength();
  #detector = new OnsetDetector();
  #tempo = new TempoEstimator();
  #flux = new BandFlux();
  #worklet: AudioWorkletNode | null = null;
  #lastEstimateAudio = 0;
  /** Which path feeds beat detection (shown in the UI for diagnosis). */
  beatSource: 'worklet' | 'analyser' | null = $state(null);
  #lastAnalysis = 0;
  #lastEstimate = 0;
  #lastUi = 0;
  #raw: Record<EqBand, number> = { level: 0, low: 0, mid: 0, high: 0 };

  async refreshDevices(): Promise<void> {
    // Re-list when Windows adds or removes an input (e.g. a virtual cable after install).
    navigator.mediaDevices.ondevicechange ??= () => void this.refreshDevices();
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices = all
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1} (name hidden until audio is allowed)` }));
    } catch {
      this.devices = [];
    }
  }

  async start(source: string): Promise<void> {
    this.stop();
    this.source = source;
    if (!source) return;
    this.error = null;
    try {
      let stream: MediaStream;
      if (source === SYSTEM_AUDIO) {
        // Chrome needs video requested to offer "Share system audio"; the video track is dropped.
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        for (const t of stream.getVideoTracks()) {
          t.stop();
          stream.removeTrack(t);
        }
        if (stream.getAudioTracks().length === 0) {
          throw new Error('No audio was shared. Pick "Entire screen" and turn on "Share system audio".');
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: source },
            // Processing makes levels lie (spec).
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }
      this.#stream = stream;
      for (const t of stream.getAudioTracks()) t.onended = () => this.stop();
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      src.connect(analyser);
      this.#ctx = ctx;
      this.#analyser = analyser;
      this.#freq = new Float32Array(analyser.frequencyBinCount);
      this.#time = new Float32Array(analyser.fftSize);
      this.#strength.reset();
      this.#detector.reset();
      this.#flux.reset();
      this.#worklet = await this.#startWorklet(ctx, src);
      // Frame size of the tempo estimator matches whichever path feeds it.
      this.#tempo = new TempoEstimator(this.#worklet ? { frameMs: (512 / ctx.sampleRate) * 1000 } : {});
      this.beatSource = this.#worklet ? 'worklet' : 'analyser';
      this.running = true;
      await this.refreshDevices();
    } catch (e) {
      this.stop();
      this.source = '';
      this.error =
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Audio capture was blocked or cancelled.'
          : e instanceof Error
            ? e.message
            : String(e);
    }
  }

  /** Load the beat worklet; null if the browser can't (falls back to the analyser). */
  async #startWorklet(ctx: AudioContext, src: MediaStreamAudioSourceNode): Promise<AudioWorkletNode | null> {
    try {
      await ctx.audioWorklet.addModule(beatWorkletUrl);
      const node = new AudioWorkletNode(ctx, 'beat-bands', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = (e: MessageEvent<BandFrame[]>) => this.#onFrames(e.data);
      src.connect(node);
      // Keep the node pulled by the graph without making any sound.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);
      return node;
    } catch (e) {
      console.warn('Beat worklet unavailable, using the analyser for beat detection:', e);
      return null;
    }
  }

  /** Band frames from the worklet, timestamped on the audio clock. */
  #onFrames(frames: BandFrame[]): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    // Map audio-clock seconds to performance.now() ms (the tempo clock's time base).
    const ts = ctx.getOutputTimestamp();
    const offset = (ts.performanceTime ?? performance.now()) - (ts.contextTime ?? ctx.currentTime) * 1000;
    for (const f of frames) {
      const audioMs = f.t * 1000;
      const strength = this.#flux.feed(f);
      this.#tempo.feed(strength, audioMs);
      const perfMs = audioMs + offset;
      if (this.#detector.feed(strength, perfMs)) {
        this.onOnset?.(perfMs);
        this.lastOnset = perfMs;
      }
      if (audioMs - this.#lastEstimateAudio >= ESTIMATE_MS) {
        this.#lastEstimateAudio = audioMs;
        const est = this.#tempo.estimate(audioMs);
        this.estimate = est;
        if (est) this.onEstimate?.(est);
      }
    }
  }

  stop(): void {
    this.#worklet?.port.close();
    this.#worklet = null;
    this.beatSource = null;
    this.#lastEstimateAudio = 0;
    for (const t of this.#stream?.getTracks() ?? []) t.stop();
    this.#stream = null;
    void this.#ctx?.close();
    this.#ctx = null;
    this.#analyser = null;
    this.running = false;
    this.estimate = null;
    this.#raw = { level: 0, low: 0, mid: 0, high: 0 };
    this.levels = { level: 0, low: 0, mid: 0, high: 0 };
    this.onLevels?.(this.#raw);
  }

  /** Called from the worker tick. Analyses at most every ANALYSIS_MS. */
  poll(now: number): void {
    const analyser = this.#analyser;
    const ctx = this.#ctx;
    if (!analyser || !ctx) return;
    if (now - this.#lastAnalysis < ANALYSIS_MS) return;
    this.#lastAnalysis = now;

    analyser.getFloatTimeDomainData(this.#time);
    let sum = 0;
    for (let i = 0; i < this.#time.length; i++) sum += this.#time[i]! * this.#time[i]!;
    const rms = Math.sqrt(sum / this.#time.length);
    const dbfs = 20 * Math.log10(rms + 1e-9);
    this.#raw.level = Math.min(1, Math.max(0, (dbfs + 60) / 60));

    analyser.getFloatFrequencyData(this.#freq);
    const binHz = ctx.sampleRate / analyser.fftSize;
    for (const band of ['low', 'mid', 'high'] as const) {
      const [lo, hi] = BANDS[band];
      const a = Math.max(1, Math.floor(lo / binHz));
      const b = Math.min(this.#freq.length - 1, Math.ceil(hi / binHz));
      let acc = 0;
      for (let i = a; i <= b; i++) acc += this.#freq[i]!;
      const db = acc / Math.max(1, b - a + 1);
      this.#raw[band] = Math.min(1, Math.max(0, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
    }
    this.onLevels?.(this.#raw);

    if (this.#worklet) {
      if (now - this.#lastUi >= UI_MS) {
        this.#lastUi = now;
        this.levels = { ...this.#raw };
      }
      return; // beat detection runs on the worklet's frames
    }

    // Fallback: onset strength from the analyser drives the HIT light and the tempo estimate.
    const strength = this.#strength.feed(this.#freq, binHz);
    this.#tempo.feed(strength, now);
    if (this.#detector.feed(strength, now)) {
      this.onOnset?.(now);
      this.lastOnset = now;
    }

    if (now - this.#lastEstimate >= ESTIMATE_MS) {
      this.#lastEstimate = now;
      const est = this.#tempo.estimate(now);
      this.estimate = est;
      if (est) this.onEstimate?.(est);
    }

    if (now - this.#lastUi >= UI_MS) {
      this.#lastUi = now;
      this.levels = { ...this.#raw };
    }
  }
}

export const audio = new AudioInput();
