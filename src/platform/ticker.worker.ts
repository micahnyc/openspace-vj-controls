/// <reference lib="webworker" />
/**
 * Send-loop timer. Runs in a Web Worker because Chrome throttles timers and
 * pauses requestAnimationFrame in hidden tabs; a worker interval keeps the show
 * running when the operator switches windows (spec: "Show reliability").
 */
let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent<{ periodMs: number } | 'stop'>) => {
  if (timer !== null) clearInterval(timer);
  timer = null;
  if (e.data === 'stop') return;
  const period = Math.max(1, Math.min(100, e.data.periodMs));
  timer = setInterval(() => self.postMessage(0), period);
};
