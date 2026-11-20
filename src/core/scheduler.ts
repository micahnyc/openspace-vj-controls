/**
 * Send scheduler (spec: "Send rate policy" and "Send mode").
 *
 * Two lanes:
 *  - events: FIFO, never coalesced (notes, toggles, BPM flips, actions, scripts)
 *  - values: one pending value per target, latest wins (faders, knobs, BPM ramps, EQ)
 *
 * Two modes:
 *  - 'queue':  every tick (intervalMs) sends queued events, then each changed value.
 *  - 'direct': events go out at once; a value goes out at once unless its target sent
 *              within the last throttleMs, in which case the newest value waits and
 *              goes out when the window ends (leading + trailing edge, per target).
 *
 * The clock is injected and tick() is called from outside (a Web Worker timer in
 * the app, fake time in tests), so this file has no browser dependencies.
 */
import { nearlyEqual } from './transforms';

export type OutMsg =
  | { kind: 'set'; uri: string; value: unknown; interpolateSeconds?: number; easing?: string }
  | { kind: 'lua'; script: string }
  | { kind: 'luaValue'; fn: string; value: number }
  | { kind: 'action'; id: string };

export interface Sink {
  send(msg: OutMsg): void;
  /** False while the socket's outgoing buffer is backing up (backpressure). */
  canSend(): boolean;
}

export type SendMode = 'queue' | 'direct';

interface Pending {
  msg: OutMsg;
  inputT: number;
}

export interface SchedulerMetrics {
  mode: SendMode;
  /** Messages sent in the last full second. */
  sentPerSec: number;
  /** Values overwritten before they were sent, last full second. */
  coalescedPerSec: number;
  /** Values skipped because they didn't change, last full second. */
  unchangedPerSec: number;
  /** Ticks skipped for backpressure, last full second. */
  skippedTicksPerSec: number;
  /** Input-to-send delay in ms over the recent window. */
  delayMedianMs: number;
  delayWorstMs: number;
  /** Values waiting to go out right now. */
  pendingValues: number;
  pendingEvents: number;
}

const DELAY_WINDOW = 512;

/** Comparable key for a value message, used for the change threshold. */
function valueOf(msg: OutMsg): unknown {
  if (msg.kind === 'set') return msg.value;
  if (msg.kind === 'luaValue') return msg.value;
  return undefined;
}

export class SendScheduler {
  mode: SendMode = 'queue';
  intervalMs = 10;
  throttleMs = 10;

  #sink: Sink;
  #events: Pending[] = [];
  #values = new Map<string, Pending>();
  #lastSentAt = new Map<string, number>();
  #lastSentValue = new Map<string, unknown>();
  #lastTick = -Infinity;

  // Metrics
  #delays: number[] = [];
  #delayIdx = 0;
  #windowStart = 0;
  #count = { sent: 0, coalesced: 0, unchanged: 0, skipped: 0 };
  #rates = { sent: 0, coalesced: 0, unchanged: 0, skipped: 0 };
  /** Called after each send with the key (or null for events), for RTT tracking. */
  onSent: ((key: string | null, msg: OutMsg, t: number) => void) | null = null;

  constructor(sink: Sink) {
    this.#sink = sink;
  }

  /** Latest-value lane. `key` identifies the target, e.g. "prop:Scene.X.Opacity". */
  setValue(key: string, msg: OutMsg, inputT: number, now: number): void {
    const prev = this.#values.get(key);
    if (prev) this.#count.coalesced++;
    // Keep the earliest input time of a coalesced run so the delay metric is honest.
    this.#values.set(key, { msg, inputT: prev ? prev.inputT : inputT });
    if (this.mode === 'direct') this.#tryDirect(key, now);
  }

  /** Ordered event lane. */
  pushEvent(msg: OutMsg, inputT: number, now: number): void {
    if (this.mode === 'direct' && this.#events.length === 0 && this.#sink.canSend()) {
      this.#send(null, msg, inputT, now);
      return;
    }
    this.#events.push({ msg, inputT });
  }

  /** Drive from a timer. Safe to call more often than intervalMs. */
  tick(now: number): void {
    this.#rollMetrics(now);
    if (this.mode === 'queue') {
      if (now - this.#lastTick < this.intervalMs - 0.5) return;
      this.#lastTick = now;
      if (this.#events.length === 0 && this.#values.size === 0) return;
      if (!this.#sink.canSend()) {
        this.#count.skipped++;
        return;
      }
      this.#flushAll(now);
      return;
    }
    // direct: flush any events held for backpressure, then trailing edges whose window ended.
    if (!this.#sink.canSend()) {
      if (this.#events.length || this.#values.size) this.#count.skipped++;
      return;
    }
    this.#flushEvents(now);
    for (const key of [...this.#values.keys()]) this.#tryDirect(key, now);
  }

  setMode(mode: SendMode, now: number): void {
    if (mode === this.mode) return;
    // Spec: switching mid-performance is safe; pending values flush first.
    if (this.#sink.canSend()) this.#flushAll(now);
    this.mode = mode;
    this.#lastTick = -Infinity;
  }

  /** Drop everything waiting (panic). */
  clear(): void {
    this.#events = [];
    this.#values.clear();
  }

  /** Forget last-sent values so the next value always goes out (after reconnect). */
  resetSentState(): void {
    this.#lastSentAt.clear();
    this.#lastSentValue.clear();
  }

  metrics(): SchedulerMetrics {
    const sorted = this.#delays.slice().sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
    const worst = sorted.length ? sorted[sorted.length - 1]! : 0;
    return {
      mode: this.mode,
      sentPerSec: this.#rates.sent,
      coalescedPerSec: this.#rates.coalesced,
      unchangedPerSec: this.#rates.unchanged,
      skippedTicksPerSec: this.#rates.skipped,
      delayMedianMs: median,
      delayWorstMs: worst,
      pendingValues: this.#values.size,
      pendingEvents: this.#events.length,
    };
  }

  resetMetrics(): void {
    this.#delays = [];
    this.#delayIdx = 0;
  }

  #tryDirect(key: string, now: number): void {
    const p = this.#values.get(key);
    if (!p) return;
    const last = this.#lastSentAt.get(key) ?? -Infinity;
    if (now - last < this.throttleMs) return; // trailing edge goes out from tick()
    if (!this.#sink.canSend()) return;
    this.#values.delete(key);
    this.#sendValue(key, p, now);
  }

  #flushAll(now: number): void {
    this.#flushEvents(now);
    const values = [...this.#values];
    this.#values.clear();
    for (const [key, p] of values) this.#sendValue(key, p, now);
  }

  #flushEvents(now: number): void {
    const events = this.#events;
    this.#events = [];
    for (const e of events) this.#send(null, e.msg, e.inputT, now);
  }

  #sendValue(key: string, p: Pending, now: number): void {
    const v = valueOf(p.msg);
    if (this.#lastSentValue.has(key) && nearlyEqual(this.#lastSentValue.get(key), v)) {
      this.#count.unchanged++;
      return;
    }
    this.#lastSentValue.set(key, v);
    this.#lastSentAt.set(key, now);
    this.#send(key, p.msg, p.inputT, now);
  }

  #send(key: string | null, msg: OutMsg, inputT: number, now: number): void {
    this.#sink.send(msg);
    this.#count.sent++;
    const d = Math.max(0, now - inputT);
    if (this.#delays.length < DELAY_WINDOW) this.#delays.push(d);
    else this.#delays[this.#delayIdx++ % DELAY_WINDOW] = d;
    this.onSent?.(key, msg, now);
  }

  #rollMetrics(now: number): void {
    if (now - this.#windowStart < 1000) return;
    this.#rates = { ...this.#count };
    this.#count = { sent: 0, coalesced: 0, unchanged: 0, skipped: 0 };
    this.#windowStart = now;
  }
}
