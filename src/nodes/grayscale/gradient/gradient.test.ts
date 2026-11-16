import { describe, expect, it } from 'vitest';
import definition, { GRADIENT_TYPES } from './definition';
import { gizmos } from './gizmo';

describe('grayscale.gradient', () => {
  it('has the 7 gradient types of the spec', () => {
    expect(GRADIENT_TYPES).toEqual(['linear', 'radial', 'angular', 'diamond', 'square', 'reflected', 'spiral']);
    expect(definition.inputs.map((i) => i.id)).toEqual(['uv']);
  });
  it('shows a line gizmo for linear types, a circle for radial types and an angle for sweeps', () => {
    const vis = (type: string) => gizmos.filter((g) => g.visibleIf?.({ gtype: type })).map((g) => g.id);
    expect(vis('linear')).toEqual(['line']);
    expect(vis('reflected')).toEqual(['line']);
    expect(vis('radial')).toEqual(['circle']);
    expect(vis('angular')).toEqual(['angle']);
    expect(vis('spiral')).toEqual(['circle', 'angle']);
  });
});
