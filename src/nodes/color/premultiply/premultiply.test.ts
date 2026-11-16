import { describe, expect, it } from 'vitest';
import { PREMULT_MODES, premultRef } from './definition';

describe('color.premultiply', () => {
  it('premultiply then unpremultiply restores the colour', () => {
    const c = [0.8, 0.4, 2.5, 0.5];
    const r = premultRef('unpremultiply', premultRef('premultiply', c));
    c.forEach((v, i) => expect(r[i]).toBeCloseTo(v, 6));
  });
  it('is safe at alpha 0 and additive bakes alpha into emission', () => {
    expect(premultRef('unpremultiply', [1, 1, 1, 0])).toEqual([0, 0, 0, 0]);
    expect(premultRef('additive', [2, 1, 0.5, 0.5])).toEqual([1, 0.5, 0.25, 0]);
    expect(premultRef('opaque', [1, 2, 3, 0.1])).toEqual([1, 2, 3, 1]);
    expect(PREMULT_MODES).toHaveLength(4);
  });
});
