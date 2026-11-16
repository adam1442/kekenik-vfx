import { describe, expect, it } from 'vitest';
import { defaultValues } from '../../../engine/params/schema';
import { expandDefinition } from '../../../engine/graph/expand';
import definition, { MATH_OPS, mathOp } from './definition';

describe('utils.math', () => {
  it('declares every op in shader order and the default is the identity', () => {
    expect(MATH_OPS).toHaveLength(17);
    const v = defaultValues(expandDefinition(definition).params);
    expect(definition.identity?.(v)).toBe(true);
    expect(definition.identity?.({ ...v, op: 'add' })).toBe(false);
  });
  it('CPU reference gives the closed-form answers', () => {
    expect(mathOp('add', 0.25, 0.5, 0)).toBeCloseTo(0.75);
    expect(mathOp('divide', 1, 0, 0)).toBe(0);
    expect(mathOp('pow', 0.5, 2, 0)).toBeCloseTo(0.25);
    expect(mathOp('pow', -1, 2, 0)).toBe(0);
    expect(mathOp('lerp', 0, 1, 0.25)).toBeCloseTo(0.25);
    expect(mathOp('mod', 1.25, 0.5, 0)).toBeCloseTo(0.25);
    expect(mathOp('step', 0.5, 0.5, 0)).toBe(1);
    expect(mathOp('smoothstep', 0.5, 0.4, 0.2)).toBeCloseTo(0.5);
    expect(mathOp('remap', 0.5, 0, 0, { inLo: 0, inHi: 1, outLo: 2, outHi: 4 })).toBeCloseTo(3);
    expect(mathOp('clamp', 2, 0, 1)).toBe(1);
    expect(mathOp('gamma', 0.25, 2, 0)).toBeCloseTo(0.5);
  });
  it('registers a B input and a value modulation pin', () => {
    const ex = expandDefinition(definition);
    expect(ex.inputs.some((p) => p.id === 'b' && p.optional)).toBe(true);
    expect(ex.inputs.some((p) => p.role === 'modulation')).toBe(true);
  });
});
