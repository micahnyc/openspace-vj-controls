import { describe, expect, it } from 'vitest';
import { bestUnit, formatRate, toSeconds } from './timeunits';

describe('time units', () => {
  it('converts to seconds', () => {
    expect(toSeconds(1, 'days')).toBe(86400);
    expect(toSeconds(-2, 'hours')).toBe(-7200);
    expect(toSeconds(1, 'years')).toBe(31557600);
  });

  it('picks the most readable unit for saved seconds', () => {
    expect(bestUnit(86400)).toEqual({ amount: 1, unit: 'days' });
    expect(bestUnit(-31557600)).toEqual({ amount: -1, unit: 'years' });
    expect(bestUnit(172800)).toEqual({ amount: 2, unit: 'days' });
    expect(bestUnit(1209600)).toEqual({ amount: 14, unit: 'days' });
    expect(bestUnit(5400)).toEqual({ amount: 1.5, unit: 'hours' });
    expect(bestUnit(90)).toEqual({ amount: 90, unit: 'seconds' });
    expect(bestUnit(37)).toEqual({ amount: 37, unit: 'seconds' });
    expect(bestUnit(0)).toEqual({ amount: 0, unit: 'seconds' });
  });

  it('round-trips through the UI representation', () => {
    for (const s of [1, 60, 3600, 86400, -86400, 604800, 31557600, 12345]) {
      const { amount, unit } = bestUnit(s);
      expect(toSeconds(amount, unit)).toBeCloseTo(s, 3);
    }
  });

  it('formats rates for the mappings list', () => {
    expect(formatRate(86400)).toBe('+1 day/s');
    expect(formatRate(-172800)).toBe('−2 days/s');
    expect(formatRate(-31557600)).toBe('−1 yr/s');
    expect(formatRate(1)).toBe('+1 s/s');
  });
});
