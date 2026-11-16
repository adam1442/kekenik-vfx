import { describe, expect, it } from 'vitest';
import { defaultValues } from '../../../engine/params/schema';
import { expandDefinition } from '../../../engine/graph/expand';
import definition, { SHAPE_TYPES } from './definition';
import { gizmos } from './gizmo';

describe('grayscale.shape', () => {
  it('has the 14 shapes of the spec in shader order', () => {
    expect(SHAPE_TYPES).toHaveLength(14);
    expect(SHAPE_TYPES.slice(0, 3)).toEqual(['circle', 'ellipse', 'rounded_rect']);
  });
  it('rect gizmo converts cell-relative size to image fractions and back (repeat aware)', () => {
    const v = { ...defaultValues(expandDefinition(definition).params), repeat: [4, 2], size: [0.8, 0.5] };
    const rect = gizmos[0] as { size: { map: { to: (r: unknown, v: unknown) => number[]; from: (g: number[], v: unknown) => number[] } } };
    const to = rect.size.map.to(v.size, v);
    expect(to[0]).toBeCloseTo(0.2, 9);
    expect(to[1]).toBeCloseTo(0.25, 9);
    const back = rect.size.map.from(to, v);
    expect(back[0]).toBeCloseTo(0.8, 9);
    expect(back[1]).toBeCloseTo(0.5, 9);
  });
  it('radius gizmo round-trips rounding', () => {
    const v = { ...defaultValues(expandDefinition(definition).params), shape: 'rounded_rect', size: [0.5, 0.3] };
    const c = gizmos[1] as { radius: { map: { to: (r: unknown, v: unknown) => number; from: (g: number, v: unknown) => number } } };
    const r = c.radius.map.to(0.5, v);
    expect(r).toBeCloseTo(0.5 * 0.15, 9);
    expect(c.radius.map.from(r, v)).toBeCloseTo(0.5, 9);
    expect(gizmos[1].visibleIf?.(v)).toBe(true);
    expect(gizmos[1].visibleIf?.({ ...v, shape: 'circle' })).toBe(false);
  });
});
