import { describe, expect, it } from 'vitest';
import { defaultValues } from '../../../engine/params/schema';
import { expandDefinition } from '../../../engine/graph/expand';
import definition, { computeReach, LAYOUT, OCTAVE_MODES, SHAPES } from './definition';
import { gizmos } from './gizmo';

// Pure-logic tests (no GPU). GPU known answers (single pixel grid, cone profiles, roll tileability, Z loop, modulation
// pins, atlas) live in src/selftest/generators.ts; the full evaluate() -> uniform packing check is tests/generators.test.ts.
describe('grayscale.fractal', () => {
  const v = defaultValues(expandDefinition(definition).params);
  it('declares every pin of the spec', () => {
    const ids = expandDefinition(definition).inputs.map((i) => i.id);
    for (const p of ['background', 'pattern', 'uv', 'z_position_mod', 'ramp_mod', 'gain_mod', 'uv_amount_mod', 'size_mod', 'intensity_mod', 'visibility_mod', 'atlas_pick_mod']) expect(ids).toContain(p);
  });
  it('shape / octave enums keep the shader order', () => {
    expect(SHAPES).toEqual(['cone', 'pyramid', 'polygon', 'star', 'pixel']);
    expect(OCTAVE_MODES).toEqual(['add', 'max', 'fbm', 'mix', 'multiply', 'screen']);
  });
  it('visits at most a 5x5 window and 3x3 by default', () => {
    expect(computeReach(v, false)).toBe(1);
    expect(computeReach({ ...v, scale_max: 3 }, false)).toBe(2);
  });
  it('uniform block is WGSL-aligned and ends with the 64-sample curve LUT', () => {
    expect(LAYOUT.size % 16).toBe(0);
    expect(LAYOUT.fields[LAYOUT.fields.length - 1].count).toBe(16);
    expect(LAYOUT.offsets[LAYOUT.offsets.length - 1] % 16).toBe(0);
  });
  it('ships a transform gizmo plus range gizmos', () => {
    expect(gizmos.map((g) => g.type)).toEqual(['transform', 'range', 'range']);
  });
});
