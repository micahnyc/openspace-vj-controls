/**
 * Page settings, saved in localStorage (not in the show file): OpenSpace host
 * and port, send mode and timing, which devices are switched off.
 */
import type { SendMode } from './core/scheduler';

const KEY = 'osvj.settings.v1';

export interface Settings {
  host: string;
  port: number;
  sendMode: SendMode;
  /** Message-queue tick, ms (1-100). */
  intervalMs: number;
  /** Direct-mode throttle window, ms (1-100). */
  throttleMs: number;
  /** Device aliases the user switched off in the selector. */
  inactiveDevices: string[];
  /** Let detected BPM drive the tempo clock. */
  autoBpm: boolean;
  /** Minimum detector confidence before it may change the BPM. */
  bpmConfidence: number;
  /** Audio input device id to reopen on load ('' = off). System-audio share is never reopened: Chrome needs a click for it. */
  audioSource: string;
  /** System panels (04-09) the user closed. */
  hiddenPanels: string[];
}

const DEFAULTS: Settings = {
  host: 'localhost',
  port: 4682,
  sendMode: 'queue',
  intervalMs: 10,
  throttleMs: 10,
  inactiveDevices: [],
  autoBpm: true,
  bpmConfidence: 0.35,
  audioSource: '',
  hiddenPanels: [],
};

export function isValidPort(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p > 0 && p < 65536;
}

const ms = (v: unknown, d: number) => (typeof v === 'number' && v >= 1 && v <= 100 ? Math.round(v) : d);

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      host: typeof p.host === 'string' && p.host.trim() ? p.host.trim() : DEFAULTS.host,
      port: isValidPort(p.port) ? p.port : DEFAULTS.port,
      sendMode: p.sendMode === 'direct' ? 'direct' : 'queue',
      intervalMs: ms(p.intervalMs, DEFAULTS.intervalMs),
      throttleMs: ms(p.throttleMs, DEFAULTS.throttleMs),
      inactiveDevices: Array.isArray(p.inactiveDevices) ? p.inactiveDevices.filter((x) => typeof x === 'string') : [],
      autoBpm: typeof p.autoBpm === 'boolean' ? p.autoBpm : DEFAULTS.autoBpm,
      bpmConfidence:
        typeof p.bpmConfidence === 'number' && p.bpmConfidence >= 0 && p.bpmConfidence <= 1
          ? p.bpmConfidence
          : DEFAULTS.bpmConfidence,
      audioSource: typeof p.audioSource === 'string' ? p.audioSource : '',
      hiddenPanels: Array.isArray(p.hiddenPanels) ? p.hiddenPanels.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = $state(load());

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: settings still apply for this session.
  }
}
