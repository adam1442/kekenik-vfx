import { describe, expect, it } from 'vitest';
import { expandDefinition } from '../../../engine/graph/expand';
import definition, { lightRef } from './definition';

describe('utils.light_pack', () => {
  it('flat surface: every light gives ambient + (1-ambient) * wrapped sin(elevation)', () => {
    const flat: [number, number, number] = [0, 0, 1];
    const expected = 0.1 + 0.9 * Math.min(1, (Math.sin((40 * Math.PI) / 180) + 0.4) / 1.4);
    for (const az of [135, 45, -90]) expect(lightRef(flat, az, 40, 0.4, 0.1)).toBeCloseTo(expected, 9);
  });
  it('a surface tilted towards the light is brighter than one tilted away', () => {
    // normal tilted to the screen left (-x): the top-left light (az 135, x < 0) faces it
    const left: [number, number, number] = [-0.6, 0, 0.8];
    const right: [number, number, number] = [0.6, 0, 0.8];
    expect(lightRef(left, 135, 30, 0, 0)).toBeGreaterThan(lightRef(right, 135, 30, 0, 0));
    expect(lightRef(right, 45, 30, 0, 0)).toBeGreaterThan(lightRef(left, 45, 30, 0, 0));
  });
  it('has Height and optional Alpha pins and a colour output', () => {
    const ex = expandDefinition(definition);
    expect(ex.inputs.find((p) => p.id === 'alpha')?.optional).toBe(true);
    expect(ex.outputs[0].type).toBe('color');
  });
});
