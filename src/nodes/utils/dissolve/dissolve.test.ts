import { describe, expect, it } from 'vitest';
import { expandDefinition } from '../../../engine/graph/expand';
import definition, { dissolveRef } from './definition';

describe('utils.dissolve', () => {
  it('shows everything at progress 0 and nothing at progress 1, with no edge at either end', () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const a = dissolveRef(v, 0, 0.1, 0.2);
      expect(a.mask).toBeCloseTo(1, 6);
      expect(a.edge).toBeCloseTo(0, 6);
      const b = dissolveRef(v, 1, 0.1, 0.2);
      expect(b.mask).toBeCloseTo(0, 6);
      expect(b.edge).toBeCloseTo(0, 6);
    }
  });
  it('mask is monotonic in progress and the edge sits inside the mask', () => {
    let prev = 1;
    for (let i = 0; i <= 20; i++) {
      const r = dissolveRef(0.4, i / 20, 0.1, 0.2);
      expect(r.mask).toBeLessThanOrEqual(prev + 1e-9);
      expect(r.edge).toBeLessThanOrEqual(r.mask + 1e-9);
      prev = r.mask;
    }
  });
  it('declares three gray outputs, a noise pin and a progress modulation pin', () => {
    const ex = expandDefinition(definition);
    expect(ex.outputs.map((o) => o.id)).toEqual(['mask', 'edge', 'heat']);
    expect(ex.inputs.find((p) => p.id === 'noise')?.optional).toBe(true);
    expect(ex.inputs.some((p) => p.role === 'modulation')).toBe(true);
  });
});
