import { describe, expect, it } from 'vitest';
import { expandDefinition } from '../../../engine/graph/expand';
import definition, { blackbodyLinear } from './definition';

describe('color.blackbody', () => {
  it('goes from deep red to white with rising temperature', () => {
    const lo = blackbodyLinear(1000);
    const mid = blackbodyLinear(3000);
    const hi = blackbodyLinear(6600);
    expect(lo[0]).toBeGreaterThan(lo[1]);
    expect(lo[2]).toBe(0);
    expect(mid[0]).toBeGreaterThan(mid[2]);
    expect(hi[0]).toBeCloseTo(1, 2);
    expect(hi[1]).toBeGreaterThan(0.95);
    expect(hi[2]).toBeCloseTo(1, 2);
    expect(blackbodyLinear(-5)).toEqual(blackbodyLinear(1000));
  });
  it('green rises monotonically over the fire range', () => {
    let prev = -1;
    for (let k = 1000; k <= 6500; k += 250) {
      const g = blackbodyLinear(k)[1];
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
  it('is registered with an intensity modulation pin and HDR emission', () => {
    const ex = expandDefinition(definition);
    expect(ex.inputs.some((p) => p.role === 'modulation')).toBe(true);
    expect(ex.params.find((p) => p.id === 'intensity')).toBeTruthy();
  });
});
