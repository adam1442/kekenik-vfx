import { bakeCurveLut, bakeGradientLut } from '../params/curve';
import type { CurveValue, GradientValue } from '../params/schema';

/**
 * Curve LUT helpers. A curve param is baked on the CPU into LUT_SIZE samples and sent to the shader as a
 * `vec4f` uniform array (UField `{ name, type: 'vec4f', count: LUT_VEC4 }`), so no extra buffer plumbing is needed.
 * WGSL side (copy into the node shader; P.<name> is the uniform array):
 *   fn lut_at(i: i32) -> f32 { return P.<name>[i >> 2u][i & 3]; }
 *   fn lut_eval(x: f32) -> f32 { ... linear interpolation, see lut.wgsl-snippet in grayscale/shape/shader.wgsl }
 */
export const LUT_SIZE = 64;
export const LUT_VEC4 = LUT_SIZE / 4;

/** Bake a curve to a flat array of LUT_SIZE floats (the uniform value for a `count: LUT_VEC4` vec4f field). */
export function bakeCurveUniform(curve: CurveValue): Float32Array {
  return bakeCurveLut(curve, LUT_SIZE);
}

/** True when the curve is (numerically) the identity y = x: nodes skip the remap for speed and exactness. */
export function isIdentityCurve(curve: CurveValue): boolean {
  const lut = bakeCurveLut(curve, LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) if (Math.abs(lut[i] - i / (LUT_SIZE - 1)) > 1e-4) return false;
  return true;
}

/** CPU mirror of the shader's lut_eval (linear interpolation between LUT_SIZE samples). */
export function lutEval(lut: ArrayLike<number>, x: number): number {
  const f = Math.min(Math.max(x, 0), 1) * (LUT_SIZE - 1);
  const i = Math.min(Math.floor(f), LUT_SIZE - 2);
  return lut[i] + (lut[i + 1] - lut[i]) * (f - i);
}

/* ------------------------------------------------------------------------------------------------
 * high-resolution LUTs.
 *  - Curve LUT, 256 samples: uniform field `{ name: 'lut', type: 'vec4f', count: LUT256_VEC4 }`; WGSL `#include "lut_curve"`
 *    gives `curve_lut(x)` (reads `P.lut`).
 *  - Gradient LUT, 256 RGBA texels: uniform field `{ name: 'glut', type: 'vec4f', count: GRAD_LUT_SIZE }`; WGSL
 *    `#include "lut_gradient"` gives `gradient_lut(x)` (reads `P.glut`).
 * The data model of curves/gradients is plain JSON (CurveValue / GradientValue), so they stay keyframable (
 * interpolates keys/stops; the LUT is re-baked per evaluation).
 * ---------------------------------------------------------------------------------------------- */
export const LUT256_SIZE = 256;
export const LUT256_VEC4 = LUT256_SIZE / 4;
export const GRAD_LUT_SIZE = 256;

export function bakeCurveUniform256(curve: CurveValue): Float32Array {
  return bakeCurveLut(curve, LUT256_SIZE);
}
export function bakeGradientUniform256(g: GradientValue): Float32Array {
  return bakeGradientLut(g, GRAD_LUT_SIZE);
}
/** CPU mirror of the shader's curve_lut() (linear interpolation of the 256-entry LUT). */
export function lutEval256(lut: ArrayLike<number>, x: number): number {
  const f = Math.min(Math.max(x, 0), 1) * (LUT256_SIZE - 1);
  const i = Math.min(Math.floor(f), LUT256_SIZE - 2);
  return lut[i] + (lut[i + 1] - lut[i]) * (f - i);
}
