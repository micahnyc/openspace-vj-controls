/** Built-in show palettes (design/PALETTES.md). Slots 1-3 drive the MIDI, BPM and audio roles. */
import type { Palette } from '../core/types';

export const BUILT_IN_PALETTES: Palette[] = [
  { name: 'Acid', colors: ['#C8FF1A', '#FF2E88', '#1FE5FF', '#A47CFF', '#FFD21A', '#2BFFA8', '#5C9DFF', '#E8E2D0'] },
  { name: 'Hazard', colors: ['#7CFF4F', '#A47CFF', '#FFD21A', '#FF4FD8', '#1FE5FF', '#E8E2D0'] },
  { name: 'LED', colors: ['#3CFF3C', '#FFE01A', '#5C9DFF', '#FF4FD8', '#B9B9B9'] },
];

export const DEFAULT_PALETTE: Palette = BUILT_IN_PALETTES[0]!;
