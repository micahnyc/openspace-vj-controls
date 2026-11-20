/** Built-in show palettes (design/PALETTES.md). Slots 1-3 drive the MIDI, BPM and audio roles. */
import type { Palette } from '../core/types';

export const DEFAULT_PANEL = '#141714';
export const DEFAULT_RAISED = '#1F231F';

export const BUILT_IN_PALETTES: Palette[] = [
  { name: 'Acid', panel: '#141714', raised: '#1F231F', ink: '#F0F2EA', colors: ['#C8FF1A', '#FF2E88', '#1FE5FF', '#A47CFF', '#FFD21A', '#2BFFA8', '#5C9DFF', '#E8E2D0'] },
  { name: 'Hazard', panel: '#1C1426', raised: '#2A1F38', ink: '#F2EDF8', colors: ['#7CFF4F', '#A47CFF', '#FFD21A', '#FF4FD8', '#1FE5FF', '#E8E2D0'] },
  { name: 'LED', panel: '#1A1A1A', raised: '#262626', ink: '#F4F4F4', colors: ['#3CFF3C', '#FFE01A', '#5C9DFF', '#FF4FD8', '#B9B9B9'] },
  { name: 'Synthwave', panel: '#1A1020', raised: '#27182F', ink: '#F7EEF8', colors: ['#FF4FD8', '#2EE6FF', '#FFE14F', '#A98CFF', '#4FFFB0', '#FF9CC8'] },
  { name: 'Deep Sea', panel: '#0F171C', raised: '#17242C', ink: '#EAF5F7', colors: ['#2EF0D0', '#FFD23F', '#6AB4FF', '#C49CFF', '#9CF5FF', '#E8E2D0'] },
  { name: 'Mono', panel: '#161616', raised: '#232323', ink: '#FFFFFF', colors: ['#F2F2F2', '#8FD3FF', '#FFE58F', '#C4C4C4'] },
];

export const DEFAULT_PALETTE: Palette = BUILT_IN_PALETTES[0]!;

/** Relative luminance (WCAG) of a #rrggbb color. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/**
 * The panel gray a palette uses. It must stay dark so ink text keeps its
 * contrast (Neon Flat: 14:1+ on panels); anything lighter than #333 falls back.
 */
export function panelOf(p: Palette): string {
  return neutral(p, 'panel', DEFAULT_PANEL, '#333333');
}

/** The raised gray (rows, buttons, inputs). Same darkness rule, a step lighter allowed. */
export function raisedOf(p: Palette): string {
  return neutral(p, 'raised', DEFAULT_RAISED, '#3A3A3A');
}

/** Contrast ratio (WCAG) between two #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function neutral(p: Palette, key: 'panel' | 'raised', fallback: string, lightest: string): string {
  const v = p[key];
  const own = v && /^#[0-9a-f]{6}$/i.test(v) && luminance(v) <= luminance(lightest) ? v : undefined;
  return own ?? BUILT_IN_PALETTES.find((b) => b.name === p.name)?.[key] ?? fallback;
}

export const INK = '#F0F2EA';
/** The page background stays this near-black for every palette. */
export const GROUND = '#0A0B0A';

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
function rgbToHex(c: readonly number[]): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
/** a + (b - a) * t, per channel. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i]! - v) * t));
}
/** The first blend of `from` toward `to` that reaches `ratio` contrast against `bg`. */
function blendTo(from: string, to: string, bg: string, ratio: number, start: number): string {
  for (let t = start; t <= 1; t += 0.01) {
    const c = mix(from, to, t);
    if (contrast(c, bg) >= ratio) return c;
  }
  return to;
}

export interface Neutrals {
  /** Page background (fixed for every palette). */
  ground: string;
  /** Text. */
  ink: string;
  panel: string;
  raised: string;
  /** Decorative dividers. */
  rule: string;
  /** Control borders: 3.5:1+ on ground, panel and raised. */
  line: string;
  /** Secondary text: 6.8:1+ on raised. */
  inkMuted: string;
}

/**
 * Every gray in the UI for a palette. panel and raised come from the palette;
 * rule, line and ink-muted are blended from raised toward ink, so they carry
 * the palette's tint while keeping Neon Flat's contrast minimums.
 */
export function neutralsOf(p: Palette): Neutrals {
  const panel = panelOf(p);
  const raised = raisedOf(p);
  const builtIn = BUILT_IN_PALETTES.find((b) => b.name === p.name);
  const hex = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
  const ground = GROUND;
  // Ink: the palette's, but only if it keeps 12:1+ on raised (text sits on rows and inputs).
  let ink = hex(p.ink) ?? builtIn?.ink ?? INK;
  if (contrast(ink, raised) < 12) ink = INK;
  return {
    ground,
    ink,
    panel,
    raised,
    rule: mix(raised, ink, 0.07),
    line: blendTo(raised, ink, raised, 3.5, 0.3),
    inkMuted: blendTo(raised, ink, raised, 6.8, 0.5),
  };
}
