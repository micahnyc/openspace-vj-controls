import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';

describe('backoffDelay', () => {
  it('follows 0.5 s, 1 s, 2 s, 4 s then caps at 5 s', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(backoffDelay)).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000]);
  });
  it('treats bad input as the first attempt', () => {
    expect(backoffDelay(-1)).toBe(500);
    expect(backoffDelay(Number.NaN)).toBe(500);
  });
  it('never overflows on huge attempt counts', () => {
    expect(backoffDelay(10_000)).toBe(5000);
  });
});
