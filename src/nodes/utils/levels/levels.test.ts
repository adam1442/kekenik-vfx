import { describe, expect, it } from 'vitest';
import { levelsReference } from './definition';

const id = { inLow: 0, inHigh: 1, gamma: 1, outLow: 0, outHigh: 1, clamp: true };

describe('levels reference math', () => {
  it('identity settings are identity', () => {
    for (const v of [0, 0.25, 0.5, 1]) expect(levelsReference(v, id)).toBeCloseTo(v, 9);
  });
  it('remaps input and output ranges and applies gamma', () => {
    expect(levelsReference(0.5, { ...id, inLow: 0.25, inHigh: 0.75 })).toBeCloseTo(0.5, 9);
    expect(levelsReference(0.25, { ...id, inLow: 0.25, inHigh: 0.75 })).toBe(0);
    expect(levelsReference(0.5, { ...id, outLow: 0.2, outHigh: 0.8 })).toBeCloseTo(0.5, 9);
    expect(levelsReference(0.25, { ...id, gamma: 2 })).toBeCloseTo(0.5, 9);
  });
  it('clamps (or not) the output; supports inverted ranges', () => {
    expect(levelsReference(2, id)).toBe(1);
    expect(levelsReference(2, { ...id, clamp: false })).toBe(2);
    expect(levelsReference(0, { ...id, outLow: 1, outHigh: 0 })).toBe(1);
    expect(levelsReference(0.25, { ...id, inLow: 1, inHigh: 0 })).toBeCloseTo(0.75, 9);
  });
});
