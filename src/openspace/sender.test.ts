import { describe, expect, it } from 'vitest';
import { luaValue, setPropertyLua, wrapForErrors } from './sender';

describe('Lua building', () => {
  it('writes values as Lua literals', () => {
    expect(luaValue(0.5)).toBe('0.5');
    expect(luaValue(true)).toBe('true');
    expect(luaValue([1, 0.5, 0])).toBe('{1, 0.5, 0}');
    expect(luaValue(['Orion'])).toBe('{"Orion"}');
  });

  it('builds an interpolated set with easing', () => {
    expect(setPropertyLua('Scene.Moon.Scale.Scale', 3, 1.92, 'SineEaseInOut')).toBe(
      'openspace.setPropertyValueSingle("Scene.Moon.Scale.Scale", 3, 1.92, "SineEaseInOut")',
    );
  });

  it('quotes scripts safely inside the error wrapper', () => {
    expect(wrapForErrors('print("a")')).toContain('load("print(\\"a\\")")');
  });
});
