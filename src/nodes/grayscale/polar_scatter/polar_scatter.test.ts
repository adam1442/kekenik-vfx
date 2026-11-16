import { describe, expect, it } from 'vitest';
import definition, { ringElements } from './definition';
import { gizmos } from './gizmo';

describe('grayscale.polar_scatter', () => {
  it('exposes size / visibility modulation pins and the Input Pattern pin', () => {
    const pins = definition.params.filter((p) => p.type === 'float' && p.modulatable).map((p) => p.id);
    expect(pins).toEqual(['size', 'visibility']);
    expect(definition.inputs.map((i) => i.id)).toEqual(['pattern']);
  });
  it('count per ring: constant, growing, proportional to radius, capped', () => {
    expect(ringElements(1, 0.3, 10, 1.5, false, 0.4)).toBe(15);
    expect(ringElements(0, 0.2, 40, 1, true, 0.4)).toBe(20);
    expect(ringElements(0, 0.1, 9999, 1, false, 0.4)).toBe(512);
  });
  it('gizmos: ring radii (falloff circles) + start angle', () => {
    expect(gizmos.map((g) => g.type)).toEqual(['falloff', 'angle']);
  });
});
