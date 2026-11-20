/**
 * AudioWorklet: runs on the audio thread and measures band energies for beat
 * detection on every sample, timestamped on the audio clock. Posts batches of
 * BandFrames (~every 10.7 ms at 48 kHz) to the main thread.
 */
import { BandEnergies } from '../../core/bands';

// AudioWorkletGlobalScope (not in TypeScript's DOM lib).
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class BeatBands extends AudioWorkletProcessor {
  #bands = new BandEnergies(sampleRate);
  #mono = new Float32Array(128);

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (channels && channels.length > 0 && channels[0]) {
      const n = channels[0].length;
      if (this.#mono.length !== n) this.#mono = new Float32Array(n);
      const mono = this.#mono;
      mono.fill(0);
      for (const ch of channels) for (let i = 0; i < n; i++) mono[i]! += ch[i]! / channels.length;
      // currentTime is the audio-clock time of this block's first sample.
      const frames = this.#bands.process(mono, currentTime);
      if (frames.length) this.port.postMessage(frames);
    }
    return true;
  }
}

registerProcessor('beat-bands', BeatBands);
