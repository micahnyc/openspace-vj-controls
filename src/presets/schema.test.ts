import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, SchemaError, emptyMappingFile, listScripts, migrate, migrateWithWarnings } from './schema';

const midiBinding = (id: string, action: object) => ({
  id,
  name: id,
  muted: false,
  source: { kind: 'midi', device: 'apc', channel: 1, message: 'note', number: 0, mode: 'absolute', control: 'pad' },
  action,
});

describe('migrate', () => {
  it('passes a current file through, filling missing sections', () => {
    const out = migrate({ schemaVersion: 1, name: 'Hayden dome set' });
    expect(out).toMatchObject({ schemaVersion: 1, name: 'Hayden dome set', devices: {}, cues: [] });
    expect(out.banks).toHaveLength(1);
    expect(out.palette.name).toBe('Acid');
  });

  it('round-trips an empty file', () => {
    const file = emptyMappingFile('Test');
    expect(migrate(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  it('rejects things that are not mapping files', () => {
    expect(() => migrate(null)).toThrow(SchemaError);
    expect(() => migrate([])).toThrow(SchemaError);
    expect(() => migrate({ name: 'x' })).toThrow(/schemaVersion/);
    expect(() => migrate({ schemaVersion: 0 })).toThrow(SchemaError);
  });

  it('rejects files from a newer app version', () => {
    expect(() => migrate({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(/newer/);
  });

  it('keeps valid bindings and drops broken ones with a warning', () => {
    const { file, warnings } = migrateWithWarnings({
      schemaVersion: 1,
      devices: { apc: { match: 'APC40 mkII' } },
      banks: [
        {
          id: 'global',
          bindings: [
            midiBinding('ok', { type: 'action.trigger', action: 'os.flyToEarth' }),
            midiBinding('bad-action', { type: 'beat.toggle' }),
            { ...midiBinding('bad-device', { type: 'lua.script', script: 'x' }), source: { kind: 'midi', device: 'nope' } },
            { id: 'no-source' },
          ],
        },
      ],
    });
    expect(file.banks[0]!.bindings.map((b) => b.id)).toEqual(['ok']);
    expect(warnings).toHaveLength(3);
  });

  it('falls back to the default palette when the saved one is invalid', () => {
    const { file, warnings } = migrateWithWarnings({ schemaVersion: 1, palette: { name: 'x', colors: ['#fff'] } });
    expect(file.palette.name).toBe('Acid');
    expect(warnings).toHaveLength(1);
  });
});

describe('listScripts', () => {
  it('lists MIDI and BPM scripts for the load warning', () => {
    const file = migrate({
      schemaVersion: 1,
      devices: { apc: { match: 'APC40 mkII' } },
      banks: [
        {
          id: 'global',
          bindings: [
            midiBinding('s1', { type: 'lua.script', script: 'openspace.printInfo(1)' }),
            {
              id: 'b1',
              name: 'Beat scripts',
              muted: false,
              source: { kind: 'beat', every: 4, phaseOffset: 0 },
              action: { type: 'beat.scripts', scripts: ['a()', 'b()'] },
            },
          ],
        },
      ],
    });
    expect(listScripts(file).map((s) => s.script)).toEqual(['openspace.printInfo(1)', 'a()', 'b()']);
  });
});
