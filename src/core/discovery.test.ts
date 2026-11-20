import { describe, expect, it } from 'vitest';
import { flattenProperties, matchesQuery, normalizeActions, type RawPropertyOwner } from './discovery';

const prop = (uri: string, type: string, extra: object = {}) => ({
  uri,
  value: 0,
  metaData: { type, guiName: uri.split('.').pop()!, identifier: uri.split('.').pop()!, ...extra },
});

const scene: RawPropertyOwner = {
  uri: 'Scene',
  identifier: 'Scene',
  guiName: 'Scene',
  properties: [],
  subowners: [
    {
      uri: 'Scene.SaturnRings',
      identifier: 'SaturnRings',
      guiName: 'Saturn Rings',
      properties: [prop('Scene.SaturnRings.Enabled', 'BoolProperty')],
      subowners: [
        {
          uri: 'Scene.SaturnRings.Renderable',
          identifier: 'Renderable',
          properties: [
            prop('Scene.SaturnRings.Renderable.Opacity', 'FloatProperty', {
              additionalData: { min: 0, max: 1, step: 0.01, exponent: 1 },
            }),
          ],
          subowners: [],
        },
      ],
    },
    {
      uri: 'Scene.Earth',
      identifier: 'Earth',
      guiName: 'Earth',
      properties: [prop('Scene.Earth.Name', 'StringProperty', { isReadOnly: true })],
    },
  ],
};

describe('flattenProperties', () => {
  const list = flattenProperties(scene);

  it('collects every property in tree order', () => {
    expect(list.map((p) => p.uri)).toEqual([
      'Scene.SaturnRings.Enabled',
      'Scene.SaturnRings.Renderable.Opacity',
      'Scene.Earth.Name',
    ]);
  });

  it('strips the Property suffix from the type', () => {
    expect(list.map((p) => p.type)).toEqual(['Bool', 'Float', 'String']);
  });

  it('builds the owner path from gui names, falling back to identifiers', () => {
    expect(list[1]!.ownerPath).toBe('Scene › Saturn Rings › Renderable');
  });

  it('keeps min/max and read-only flags', () => {
    expect(list[1]).toMatchObject({ min: 0, max: 1, readOnly: false });
    expect(list[2]).toMatchObject({ readOnly: true });
  });

  it('handles a very deep tree without recursion', () => {
    let owner: RawPropertyOwner = { uri: 'leaf', identifier: 'leaf', properties: [prop('leaf.X', 'IntProperty')] };
    for (let i = 0; i < 20_000; i++) owner = { uri: `n${i}`, identifier: `n${i}`, subowners: [owner] };
    expect(flattenProperties(owner)).toHaveLength(1);
  });
});

describe('normalizeActions', () => {
  it('sorts by gui path then name and fills defaults', () => {
    const out = normalizeActions([
      { identifier: 'os.b', name: 'Toggle trails', guiPath: '/Trails' },
      { identifier: 'os.flyToSaturn', name: 'Fly to Saturn', guiPath: '/Navigation' },
      { identifier: 'os.flyToEarth', name: '', guiPath: '/Navigation' },
    ]);
    expect(out.map((a) => a.identifier)).toEqual(['os.flyToSaturn', 'os.flyToEarth', 'os.b']);
    expect(out[1]).toMatchObject({ name: 'os.flyToEarth', documentation: '' });
  });
});

describe('matchesQuery', () => {
  it('requires every term, in any order, case-insensitively', () => {
    const h = 'Scene.SaturnRings.Renderable.Opacity Opacity';
    expect(matchesQuery(h, 'saturn opac')).toBe(true);
    expect(matchesQuery(h, 'OPACITY saturn')).toBe(true);
    expect(matchesQuery(h, 'saturn color')).toBe(false);
    expect(matchesQuery(h, '   ')).toBe(true);
  });
});

describe('selection options', () => {
  it('keeps the allowed names of Selection properties', () => {
    const list = flattenProperties({
      uri: 'Scene',
      identifier: 'Scene',
      properties: [
        {
          uri: 'Scene.Constellations.Renderable.ConstellationSelection',
          value: [],
          metaData: { type: 'SelectionProperty', guiName: 'Constellation Selection', identifier: 'ConstellationSelection', additionalData: { options: ['Aries', 'Orion', 'Virgo'] } },
        },
      ],
    });
    expect(list[0]!.options).toEqual(['Aries', 'Orion', 'Virgo']);
  });
});
