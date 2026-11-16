import { describe, expect, it } from 'vitest';
import { expandDefinition } from '../../../engine/graph/expand';
import definition, { glyphNode } from './definition';

describe('grayscale.rune_ring', () => {
  it('lattice nodes span the glyph box symmetrically', () => {
    expect(glyphNode(0, 3)).toEqual([-0.5, -0.5]);
    expect(glyphNode(8, 3)).toEqual([0.5, 0.5]);
    expect(glyphNode(4, 3)).toEqual([0, 0]);
    expect(glyphNode(5, 4)[0]).toBeCloseTo(-0.5 + 1 / 3, 9);
  });
  it('declares a circle gizmo, reveal / rotation animation and a UV pin', () => {
    const ex = expandDefinition(definition);
    for (const id of ['reveal', 'rotation', 'count', 'seed']) expect(ex.params.some((p) => p.id === id), id).toBe(true);
    expect(ex.params.find((p) => p.id === 'reveal')?.animatable).toBe(true);
    expect(definition.gizmos?.[0].type).toBe('circle');
    expect(ex.inputs.some((p) => p.id === 'uv' && p.optional)).toBe(true);
  });
});
