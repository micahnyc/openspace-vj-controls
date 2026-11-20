/**
 * Thin Web MIDI wrapper: requests access (with sysex when allowed, for the
 * APC40 Mode 2 init), tracks inputs and outputs with hot-plug, and hands
 * parsed events to listeners.
 */
import { parseMidi, type MidiEvent } from '../../core/midi/parse';

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: MIDIPortDeviceState;
}

type Listener = (ev: MidiEvent, inputId: string) => void;

class MidiAccessStore {
  supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  status: 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported' = $state(
    typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'idle' : 'unsupported',
  );
  sysex = $state(false);
  error: string | null = $state(null);
  inputs: MidiPortInfo[] = $state.raw([]);
  outputs: MidiPortInfo[] = $state.raw([]);
  /** Increments on every port change, so dependents can re-run (Mode 2 init on replug). */
  portsVersion = $state(0);

  #access: MIDIAccess | null = null;
  #listeners = new Set<Listener>();

  async request(): Promise<void> {
    if (!this.supported || this.status === 'requesting' || this.status === 'ready') return;
    this.status = 'requesting';
    this.error = null;
    try {
      this.#access = await navigator.requestMIDIAccess({ sysex: true });
      this.sysex = true;
    } catch {
      try {
        // Sysex refused: still read MIDI, just without the Mode 2 init.
        this.#access = await navigator.requestMIDIAccess({ sysex: false });
        this.sysex = false;
      } catch (e) {
        this.status = 'denied';
        this.error =
          e instanceof Error && e.name === 'SecurityError'
            ? 'Chrome blocked MIDI access. Allow MIDI for this site in the address bar, then reload.'
            : `MIDI access failed: ${String(e)}`;
        return;
      }
    }
    this.status = 'ready';
    this.#access.onstatechange = () => this.#sync();
    this.#sync();
  }

  listen(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Send bytes to the output whose name matches the input's name. */
  sendTo(name: string, bytes: number[]): boolean {
    const out = this.#outputFor(name);
    if (!out) return false;
    if (bytes[0] === 0xf0 && !this.sysex) return false;
    try {
      out.send(bytes);
      return true;
    } catch {
      return false;
    }
  }

  #outputFor(name: string): MIDIOutput | undefined {
    if (!this.#access) return undefined;
    let found: MIDIOutput | undefined;
    this.#access.outputs.forEach((o) => {
      if (!found && o.state === 'connected' && o.name === name) found = o;
    });
    return found;
  }

  #sync(): void {
    const access = this.#access;
    if (!access) return;
    const ins: MidiPortInfo[] = [];
    access.inputs.forEach((input) => {
      ins.push({ id: input.id, name: input.name ?? 'Unknown device', manufacturer: input.manufacturer ?? '', state: input.state });
      // Re-attach on every sync: a replugged device can come back as a new object.
      input.onmidimessage = (msg: MIDIMessageEvent) => {
        if (!msg.data) return;
        const ev = parseMidi(msg.data, input.name ?? input.id, msg.timeStamp);
        if (!ev) return;
        for (const fn of this.#listeners) fn(ev, input.id);
      };
    });
    const outs: MidiPortInfo[] = [];
    access.outputs.forEach((o) =>
      outs.push({ id: o.id, name: o.name ?? 'Unknown device', manufacturer: o.manufacturer ?? '', state: o.state }),
    );
    this.inputs = ins.sort((a, b) => a.name.localeCompare(b.name));
    this.outputs = outs;
    this.portsVersion++;
  }
}

export const midi = new MidiAccessStore();

/** "F0 47 7F ..." -> bytes */
export function parseHexBytes(hex: string): number[] {
  return hex
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((h) => parseInt(h, 16))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}
