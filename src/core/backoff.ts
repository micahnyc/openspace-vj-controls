/**
 * Reconnect delays from the spec: 0.5 s, 1 s, 2 s, ... capped at 5 s.
 * `attempt` is 0 for the first retry after a disconnect.
 */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 5000;

export function backoffDelay(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) return BACKOFF_BASE_MS;
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.floor(attempt), BACKOFF_CAP_MS);
}
