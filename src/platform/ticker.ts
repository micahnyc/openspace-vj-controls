import TickerWorker from './ticker.worker?worker&inline';

/** Calls `onTick(performance.now())` every periodMs from a Web Worker timer. */
export class Ticker {
  #worker: Worker;
  #period = 10;

  constructor(onTick: (now: number) => void) {
    this.#worker = new TickerWorker();
    this.#worker.onmessage = () => onTick(performance.now());
  }

  start(periodMs: number): void {
    this.#period = periodMs;
    this.#worker.postMessage({ periodMs });
  }

  get period(): number {
    return this.#period;
  }

  stop(): void {
    this.#worker.postMessage('stop');
  }
}
