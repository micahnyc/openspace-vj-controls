/**
 * Mapping file schema v1 and the migration entry point (spec: "Mapping model").
 * Every loader (file, autosave) goes through migrate().
 */
import { scriptsOf, type Binding, type DeviceEntry, type Palette } from '../core/types';
import { DEFAULT_PALETTE } from './palettes';

export const CURRENT_SCHEMA_VERSION = 1;

export interface MappingFileV1 {
  schemaVersion: 1;
  name: string;
  /** Alias -> how to find the device. Bindings refer to aliases, not OS names. */
  devices: Record<string, DeviceEntry>;
  banks: { id: string; bindings: Binding[] }[];
  /** Reserved for cues (post-v1). */
  cues: unknown[];
  palette: Palette;
}

export type MappingFile = MappingFileV1;

export function emptyMappingFile(name = 'Untitled show'): MappingFile {
  return {
    schemaVersion: 1,
    name,
    devices: {},
    banks: [{ id: 'global', bindings: [] }],
    cues: [],
    palette: { ...DEFAULT_PALETTE, colors: [...DEFAULT_PALETTE.colors] },
  };
}

export class SchemaError extends Error {}

/** Step functions: migrations[n] upgrades a version-n file to version n+1. */
const migrations: Record<number, (file: Record<string, unknown>) => Record<string, unknown>> = {};

export interface MigrateResult {
  file: MappingFile;
  /** Human-readable notes about anything dropped or fixed. */
  warnings: string[];
}

/**
 * Upgrade any supported file to the current schema. Throws SchemaError for
 * files that aren't mapping files or come from a newer app version.
 */
export function migrate(input: unknown): MappingFile {
  return migrateWithWarnings(input).file;
}

export function migrateWithWarnings(input: unknown): MigrateResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new SchemaError('Not a mapping file: expected a JSON object.');
  }
  let file = input as Record<string, unknown>;
  const version = file.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SchemaError('Not a mapping file: schemaVersion is missing or invalid.');
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new SchemaError(
      `This file uses schema version ${version}, newer than this app supports (${CURRENT_SCHEMA_VERSION}). Update the app to load it.`,
    );
  }
  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = migrations[v];
    if (!step) throw new SchemaError(`No migration from schema version ${v}.`);
    file = { ...step(file), schemaVersion: v + 1 };
  }

  const warnings: string[] = [];
  const base = emptyMappingFile();
  const devices: Record<string, DeviceEntry> = {};
  if (isObject(file.devices)) {
    for (const [alias, d] of Object.entries(file.devices)) {
      if (isObject(d) && typeof d.match === 'string') {
        devices[alias] = { match: d.match, ...(typeof d.profile === 'string' ? { profile: d.profile } : {}) };
      } else warnings.push(`Device "${alias}" has no name to match and was skipped.`);
    }
  }

  const banks: MappingFile['banks'] = [];
  const rawBanks = Array.isArray(file.banks) ? file.banks : [];
  for (const [i, bank] of rawBanks.entries()) {
    if (!isObject(bank)) continue;
    const bindings: Binding[] = [];
    for (const b of Array.isArray(bank.bindings) ? bank.bindings : []) {
      const problem = bindingProblem(b, devices);
      if (problem) warnings.push(problem);
      else bindings.push(b as Binding);
    }
    banks.push({ id: typeof bank.id === 'string' ? bank.id : `bank-${i + 1}`, bindings });
  }
  if (banks.length === 0) banks.push(...base.banks);

  let palette = base.palette;
  if (isObject(file.palette) && Array.isArray(file.palette.colors)) {
    const colors = file.palette.colors.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
    if (colors.length >= 4 && colors.length <= 16) {
      palette = { name: typeof file.palette.name === 'string' ? file.palette.name : 'Custom', colors };
    } else warnings.push('The palette needs 4 to 16 colors; the default palette is used instead.');
  }

  return {
    file: {
      schemaVersion: 1,
      name: typeof file.name === 'string' ? file.name : base.name,
      devices,
      banks,
      cues: Array.isArray(file.cues) ? file.cues : [],
      palette,
    },
    warnings,
  };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const ACTIONS_BY_SOURCE: Record<string, string[]> = {
  midi: ['property.set', 'property.bool', 'property.cycle', 'bpm.affect', 'action.trigger', 'lua.script', 'lua.value', 'app'],
  beat: ['beat.toggle', 'beat.value', 'beat.cycle', 'beat.actions', 'beat.scripts'],
  eq: ['property.set', 'property.threshold'],
};

/** Returns a reason the binding can't be used, or null if it looks valid. */
function bindingProblem(b: unknown, devices: Record<string, DeviceEntry>): string | null {
  if (!isObject(b) || typeof b.id !== 'string') return 'A mapping without an id was skipped.';
  const name = typeof b.name === 'string' && b.name ? `"${b.name}"` : b.id;
  if (!isObject(b.source) || typeof b.source.kind !== 'string') return `Mapping ${name} has no source and was skipped.`;
  if (!isObject(b.action) || typeof b.action.type !== 'string') return `Mapping ${name} has no action and was skipped.`;
  const allowed = ACTIONS_BY_SOURCE[b.source.kind];
  if (!allowed) return `Mapping ${name} has an unknown source "${b.source.kind}" and was skipped.`;
  if (!allowed.includes(b.action.type)) return `Mapping ${name} has an unknown action "${b.action.type}" and was skipped.`;
  if (b.source.kind === 'midi' && (typeof b.source.device !== 'string' || !(b.source.device in devices))) {
    return `Mapping ${name} refers to a device that isn't in the file and was skipped.`;
  }
  if (typeof b.muted !== 'boolean') b.muted = false;
  if (typeof b.name !== 'string') b.name = '';
  if (b.source.kind === 'eq' && !isObject(b.transform)) b.transform = { gain: 1, attackMs: 10, releaseMs: 200 };
  return null;
}

export function allBindings(file: MappingFile): Binding[] {
  return file.banks.flatMap((b) => b.bindings);
}

/** Every custom script in the file, for the load warning. */
export function listScripts(file: MappingFile): { binding: string; script: string }[] {
  return allBindings(file).flatMap((b) => scriptsOf(b).map((script) => ({ binding: b.name || b.id, script })));
}
