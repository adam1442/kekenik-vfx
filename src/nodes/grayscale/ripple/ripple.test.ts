import { describe, expect, it } from 'vitest';
import { expandDefinition } from '../../../engine/graph/expand';
import definition, { rippleProfileRef } from './definition';

describe('grayscale.ripple', () => {
  it('profile is 1 on the ring, falls off sharply outside and slowly inside (asymmetric tail)', () => {
    expect(rippleProfileRef(0, 4, 0.9, 30)).toBeCloseTo(1, 6);
    expect(rippleProfileRef(3, 4, 0.9, 30)).toBeLessThan(0.05);
    expect(rippleProfileRef(-10, 4, 0.9, 30)).toBeGreaterThan(0.5);
    expect(rippleProfileRef(-40, 4, 0.9, 30)).toBe(0);
    expect(rippleProfileRef(-4, 4, 0.9, 30)).toBe(1);
  });
  it('front sharpness widens the outer falloff', () => {
    expect(rippleProfileRef(2, 8, 0.1, 10)).toBeGreaterThan(rippleProfileRef(2, 8, 0.95, 10));
  });
  it('has an intensity modulation pin, a circle gizmo and blending', () => {
    const ex = expandDefinition(definition);
    expect(ex.inputs.some((p) => p.role === 'modulation')).toBe(true);
    expect(definition.gizmos?.[0].type).toBe('circle');
    expect(ex.inputs.some((p) => p.id === 'background')).toBe(true);
  });
});
