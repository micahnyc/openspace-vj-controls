/**
 * OpenSpace WebSocket connection with auto-reconnect (spec: "Connection handling").
 *
 * openspace-api-js has no reconnect of its own: it calls onDisconnect when the
 * socket closes and leaves any pending requests hanging. So each attempt gets a
 * fresh OpenSpaceApi instance, and a generation counter makes callbacks from a
 * stale socket harmless.
 */
import openspaceApi from 'openspace-api-js';
import type { OpenSpaceApi } from 'openspace-api-js/api';
import { backoffDelay } from '../core/backoff';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'waiting';

class OpenSpaceConnection {
  state: ConnectionState = $state('idle');
  /** Retry number since the last successful connection. */
  attempt = $state(0);
  /** When the next retry fires (ms since epoch), while state is 'waiting'. */
  retryAt: number | null = $state(null);
  lastError: string | null = $state(null);
  host = $state('localhost');
  port = $state(4682);
  /** Increments on every successful connect, so dependents can re-run discovery. */
  session = $state(0);

  #api: OpenSpaceApi | null = null;
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #wanted = false;

  get api(): OpenSpaceApi | null {
    return this.state === 'connected' ? this.#api : null;
  }

  /** Start (or restart) connecting to host:port, retrying until stop(). */
  start(host: string, port: number): void {
    this.stop();
    this.host = host;
    this.port = port;
    this.#wanted = true;
    this.attempt = 0;
    this.lastError = null;
    this.#open();
  }

  stop(): void {
    this.#wanted = false;
    this.#generation++;
    this.#clearTimer();
    const api = this.#api;
    this.#api = null;
    try {
      api?.disconnect();
    } catch {
      // Already closed.
    }
    this.state = 'idle';
    this.retryAt = null;
  }

  /** Skip the remaining backoff and try now. */
  retryNow(): void {
    if (!this.#wanted || this.state === 'connected' || this.state === 'connecting') return;
    this.#clearTimer();
    this.#open();
  }

  #open(): void {
    const gen = ++this.#generation;
    this.state = 'connecting';
    this.retryAt = null;
    let api: OpenSpaceApi;
    try {
      api = openspaceApi(this.host, this.port);
    } catch (e) {
      this.#failed(gen, `Couldn't create socket: ${String(e)}`);
      return;
    }
    this.#api = api;
    api.onConnect(() => {
      if (gen !== this.#generation) return;
      this.state = 'connected';
      this.attempt = 0;
      this.lastError = null;
      this.session++;
    });
    api.onDisconnect(() => {
      if (gen !== this.#generation) return;
      const wasConnected = this.state === 'connected';
      this.#failed(
        gen,
        wasConnected
          ? 'Connection to OpenSpace closed.'
          : `No OpenSpace at ws://${this.host}:${this.port}. Is it running with the WebSocket server on?`,
      );
    });
    try {
      api.connect();
    } catch (e) {
      // Bad host string makes the WebSocket constructor throw.
      this.#failed(gen, `Couldn't connect: ${String(e)}`);
    }
  }

  #failed(gen: number, message: string): void {
    if (gen !== this.#generation) return;
    this.#api = null;
    this.lastError = message;
    if (!this.#wanted) {
      this.state = 'idle';
      return;
    }
    const delay = backoffDelay(this.attempt);
    this.attempt++;
    this.state = 'waiting';
    this.retryAt = Date.now() + delay;
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (gen === this.#generation && this.#wanted) this.#open();
    }, delay);
  }

  #clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

export const connection = new OpenSpaceConnection();
