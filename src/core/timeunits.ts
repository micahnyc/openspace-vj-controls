/**
 * Time units for delta-time mappings. Values are stored in seconds (what
 * openspace.time.setDeltaTime takes); the UI shows a number plus a unit.
 * Year = 365.25 days (Julian year).
 */

export type TimeUnit = 'seconds' | 'hours' | 'days' | 'years';

const DAY = 86400;
const YEAR = 365.25 * DAY;

export const TIME_UNITS: readonly { unit: TimeUnit; seconds: number; label: string; short: string }[] = [
  { unit: 'seconds', seconds: 1, label: 'seconds', short: 's' },
  { unit: 'hours', seconds: 3600, label: 'hours', short: 'h' },
  { unit: 'days', seconds: DAY, label: 'days', short: 'day' },
  { unit: 'years', seconds: YEAR, label: 'years', short: 'yr' },
];

export function unitSeconds(unit: TimeUnit): number {
  return TIME_UNITS.find((u) => u.unit === unit)!.seconds;
}

export function toSeconds(amount: number, unit: TimeUnit): number {
  return amount * unitSeconds(unit);
}

/**
 * The most readable way to show a number of seconds: the largest unit in
 * which it is at least 1 and close to a round number (3 decimals).
 */
export function bestUnit(seconds: number): { amount: number; unit: TimeUnit } {
  if (seconds === 0) return { amount: 0, unit: 'seconds' };
  const abs = Math.abs(seconds);
  for (let i = TIME_UNITS.length - 1; i > 0; i--) {
    const u = TIME_UNITS[i]!;
    const amount = abs / u.seconds;
    if (amount >= 1 && Math.abs(amount * 1000 - Math.round(amount * 1000)) < 1e-6) {
      return { amount: Math.sign(seconds) * Math.round(amount * 1000) / 1000, unit: u.unit };
    }
  }
  return { amount: seconds, unit: 'seconds' };
}

/** "+1 day/s", "−30 min/s", "0 s/s" for labels. */
export function formatRate(seconds: number): string {
  const { amount, unit } = bestUnit(seconds);
  const u = TIME_UNITS.find((x) => x.unit === unit)!;
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  const n = Math.abs(amount);
  const short = u.short === 'day' && n !== 1 ? 'days' : u.short;
  return `${sign}${n} ${short}/s`;
}
