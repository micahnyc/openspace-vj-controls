import { describe, expect, it } from 'vitest';
import { BUILT_IN_PALETTES, DEFAULT_PANEL, panelOf } from './palettes';

describe('panelOf', () => {
  it('gives each built-in palette its own panel gray', () => {
    expect(new Set(BUILT_IN_PALETTES.map(panelOf)).size).toBe(BUILT_IN_PALETTES.length);
  });

  it('falls back to the built-in panel for files saved before it existed', () => {
    expect(panelOf({ name: 'Hazard', colors: [] })).toBe('#1C1426');
    expect(panelOf({ name: 'Custom', colors: [] })).toBe(DEFAULT_PANEL);
  });

  it('rejects panel colors too light for ink text', () => {
    expect(panelOf({ name: 'Custom', colors: [], panel: '#808080' })).toBe(DEFAULT_PANEL);
    expect(panelOf({ name: 'Custom', colors: [], panel: '#202028' })).toBe('#202028');
  });
});

import { contrast, raisedOf, DEFAULT_RAISED } from './palettes';

describe('raisedOf', () => {
  it('gives each built-in palette its own raised gray, with the same fallbacks', () => {
    expect(new Set(BUILT_IN_PALETTES.map(raisedOf)).size).toBe(BUILT_IN_PALETTES.length);
    expect(raisedOf({ name: 'LED', colors: [] })).toBe('#262626');
    expect(raisedOf({ name: 'Custom', colors: [], raised: '#909090' })).toBe(DEFAULT_RAISED);
  });

  it('keeps every accent at 4.5:1 or better on its palette raised gray (Neon Flat rule)', () => {
    for (const p of BUILT_IN_PALETTES) {
      for (const c of p.colors) expect(contrast(c, raisedOf(p)), `${p.name} ${c}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#F0F2EA', raisedOf(p)), `${p.name} ink`).toBeGreaterThanOrEqual(12);
    }
  });
});

import { neutralsOf } from './palettes';

describe('neutralsOf', () => {
  it('derives tinted grays that meet Neon Flat contrast minimums for every built-in palette', () => {
    for (const p of BUILT_IN_PALETTES) {
      const n = neutralsOf(p);
      for (const bg of ['#0A0B0A', n.panel, n.raised]) expect(contrast(n.line, bg), `${p.name} line on ${bg}`).toBeGreaterThanOrEqual(3.5);
      expect(contrast(n.inkMuted, n.raised), `${p.name} ink-muted`).toBeGreaterThanOrEqual(6.8);
    }
  });

  it('gives each palette different grays', () => {
    const lines = BUILT_IN_PALETTES.map((p) => neutralsOf(p).line);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('keeps Acid close to the original Neon Flat grays', () => {
    const n = neutralsOf(BUILT_IN_PALETTES[0]!);
    expect(contrast(n.line, '#6F796F')).toBeLessThan(1.25);
    expect(contrast(n.inkMuted, '#A3AC9F')).toBeLessThan(1.2);
  });
});

describe('whole-page palette', () => {
  it('keeps the page dark and sets ink per palette with readable contrast', () => {
    for (const p of BUILT_IN_PALETTES) {
      const n = neutralsOf(p);
      expect(contrast(n.ink, n.ground), `${p.name} ink on ground`).toBeGreaterThanOrEqual(14);
      expect(contrast(n.ink, n.panel), `${p.name} ink on panel`).toBeGreaterThanOrEqual(14);
      for (const c of p.colors) expect(contrast(c, n.ground), `${p.name} ${c} on ground`).toBeGreaterThanOrEqual(4.5);
    }
    expect(new Set(BUILT_IN_PALETTES.map((p) => neutralsOf(p).ground))).toEqual(new Set(['#0A0B0A']));
  });

  it('keeps Acid identical to the original Neon Flat page', () => {
    const n = neutralsOf(BUILT_IN_PALETTES[0]!);
    expect([n.ground, n.panel, n.raised, n.ink]).toEqual(['#0A0B0A', '#141714', '#1F231F', '#F0F2EA']);
  });

  it('repairs a custom palette whose ink would be unreadable', () => {
    const n = neutralsOf({ name: 'Custom', colors: [], ink: '#333333' });
    expect(contrast(n.ink, n.raised)).toBeGreaterThanOrEqual(12);
  });
});
