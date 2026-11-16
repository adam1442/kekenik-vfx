import { describe, expect, it } from 'vitest';
import { expandDefinition } from '../../../engine/graph/expand';
import definition, { starburstAxisRef } from './definition';

const base = { side: 128, radius: 0.45, rayWidth: 0.05, taper: 1.5, falloff: 1.2, coreSize: 0.04, coreGlow: 1, intensity: 1 };

describe('grayscale.starburst', () => {
  it('axis profile is 1 at the centre, decreases along the ray and is 0 past the tip', () => {
    expect(starburstAxisRef(0, base)).toBeCloseTo(1, 6);
    let prev = 2;
    for (let r = 4; r < 57; r += 4) {
      const v = starburstAxisRef(r, base);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    expect(starburstAxisRef(0.45 * 128 + 2, { ...base, coreGlow: 0 })).toBe(0);
  });
  it('declares a circle gizmo bound to existing params, a UV pin and blending', () => {
    const ex = expandDefinition(definition);
    const g = definition.gizmos?.[0] as { center: string; radius: string };
    expect(ex.params.some((p) => p.id === g.center)).toBe(true);
    expect(ex.params.some((p) => p.id === g.radius)).toBe(true);
    expect(ex.inputs.some((p) => p.id === 'uv' && p.optional)).toBe(true);
    expect(ex.inputs.some((p) => p.id === 'background')).toBe(true);
  });
});
