/** Plain-language labels for mappings, used by the list and dialogs. */
import type { ControllerProfile } from '../core/profile';
import { findControl } from '../core/profile';
import { formatRate } from '../core/timeunits';
import { LUA_DELTA_TIME, everyLabel, glideBeatsOf, type Binding, type MidiSource } from '../core/types';

export function fmtNum(v: unknown): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
    return String(Math.round(v * 1000) / 1000);
  }
  if (Array.isArray(v)) return `(${v.map(fmtNum).join(', ')})`;
  if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
  return v === undefined || v === null ? '–' : String(v);
}

/** "CC 48 CH 01" style MIDI address. */
export function midiAddress(s: Pick<MidiSource, 'message' | 'number' | 'channel'>): string {
  return `${s.message === 'cc' ? 'CC' : 'NOTE'} ${s.number} CH ${String(s.channel).padStart(2, '0')}`;
}

export function sourceLabel(b: Binding, profile: ControllerProfile | undefined): string {
  const s = b.source;
  if (s.kind === 'beat') return `Every ${everyLabel(s.every)}`;
  if (s.kind === 'eq') return s.band === 'level' ? 'Audio level' : `EQ ${s.band}`;
  const control = profile ? findControl(profile, { kind: s.message === 'cc' ? 'cc' : 'noteon', channel: s.channel, number: s.number }) : undefined;
  return control ? control.label : midiAddress(s);
}

/** Last two segments of a URI read best: "SaturnRings.Renderable.Opacity" -> "SaturnRings › Opacity". */
export function shortUri(uri: string): string {
  const parts = uri.replace(/^Scene\./, '').split('.');
  if (parts.length <= 2) return parts.join(' › ');
  return `${parts[0]} › ${parts[parts.length - 1]}`;
}

export function actionLabel(b: Binding, bindingName: (id: string) => string): string {
  const a = b.action;
  switch (a.type) {
    case 'property.set':
      return `${shortUri(a.target.uri)} ${fmtNum(a.min)}–${fmtNum(a.max)}${a.curve === 'exp' ? ' exp' : ''}`;
    case 'property.bool':
      return `${shortUri(a.target.uri)} ${a.behavior === 'toggle' ? 'toggle' : 'while held'}`;
    case 'property.threshold':
      return `${shortUri(a.target.uri)} on above ${fmtNum(a.threshold)}`;
    case 'bpm.affect':
      return `${a.adjust === 'mute' ? (a.behavior === 'toggle' ? 'Mute toggle' : 'Mute while held') : a.adjust === 'range' ? 'Range' : 'Beat interval'} of "${bindingName(a.binding)}"`;
    case 'action.trigger':
      return `Action ${a.action}`;
    case 'lua.script':
      return `Script: ${firstLine(a.script)}`;
    case 'lua.value':
      return a.fn === LUA_DELTA_TIME
        ? `Delta time ${formatRate(a.min)} to ${formatRate(a.max)}${a.curve === 'exp' ? ' exp' : ''}`
        : `${a.fn}(${fmtNum(a.min)}…${fmtNum(a.max)})`;
    case 'property.cycle':
    case 'beat.cycle':
      return `${shortUri(a.target.uri)} cycles ${a.values.map(cycleLabel).join(' → ')}`;
    case 'app':
      return a.command === 'panic' ? 'PANIC' : a.command === 'resync' ? 'Resync downbeat' : 'Tap tempo';
    case 'beat.toggle':
      return `${shortUri(a.target.uri)} flips`;
    case 'beat.value':
      return `${shortUri(a.target.uri)} ${fmtNum(a.min)}–${fmtNum(a.max)} ${a.shape === 'pingpong' ? 'up/down' : 'ramp'}, glide ${everyLabel(glideBeatsOf(a, b.source.kind === 'beat' ? b.source.every : 1))}${a.easing && a.easing !== 'Linear' ? ` ${a.easing.replace(/Ease/, ' ').replace(/InOut$/, 'in-out').replace(/In$/, 'in').replace(/Out$/, 'out').toLowerCase()}` : ''}`;
    case 'beat.actions':
      return a.actions.length === 1 ? `Action ${a.actions[0]}` : `Actions ${a.actions.join(' → ')} (loop)`;
    case 'beat.scripts':
      return a.scripts.length === 1 ? `Script: ${firstLine(a.scripts[0]!)}` : `${a.scripts.length} scripts (loop)`;
  }
}

function firstLine(s: string): string {
  const line = s.trim().split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

/** "Orion", "1", "#FF2E88" for a color vector, "Orion + Virgo" for a multi-selection. */
export function cycleLabel(v: unknown): string {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(' + ');
  if (Array.isArray(v) && (v.length === 3 || v.length === 4) && v.every((x) => typeof x === 'number' && x >= 0 && x <= 1)) {
    return `#${v.slice(0, 3).map((x) => Math.round((x as number) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  return fmtNum(v);
}
