import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, kindDefines, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.copy_transform — scatter up to 4096 transformed copies of a pattern (position jitter, scale / rotation / value
 * ranges, seed). Approach (documented decision): NOT instanced quads — the engine's pass API is fullscreen-only — but a
 * GRID-BUCKETED pixel shader: copy k owns the distinct cell (k * a) mod G^2, every pixel visits only the (2R+1)^2 neighbour
 * cells (R <= 6, derived from the biggest copy extent). Per-pixel cost is independent of the copy count, so 4096 copies at
 * 2048^2 cost about the same as 64 (estimate: R = 3 -> 49 cells x ~60 ALU ~ 2-3 ms).
 * Combine: Max, Add, or Over (highest copy index on top). With Tiling on, cells and distances wrap -> seamless.
 * Limits: copies must fit within `reach` cells (size x max scale is clamped so R <= 6); copies do not interpenetrate across
 * more than R cells.
 */
export const SHADER = defineShader('utils_copy_transform.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'offset', type: 'vec2f' },
  { name: 'grid', type: 'i32' },
  { name: 'reach', type: 'i32' },
  { name: 'count', type: 'u32' },
  { name: 'cells_total', type: 'u32' },
  { name: 'inv_a', type: 'u32' },
  { name: 'seed', type: 'u32' },
  { name: 'size', type: 'f32' },
  { name: 'scale_min', type: 'f32' },
  { name: 'scale_max', type: 'f32' },
  { name: 'rot_min', type: 'f32' },
  { name: 'rot_max', type: 'f32' },
  { name: 'value_min', type: 'f32' },
  { name: 'value_max', type: 'f32' },
  { name: 'jitter', type: 'f32' },
  { name: 'combine', type: 'u32' },
  { name: 'has_scale_map', type: 'u32' },
  { name: 'has_mask', type: 'u32' },
]);
export const MAX_COPIES = 4096;
export const MAX_REACH = 6;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** Modular inverse by extended Euclid (a, m coprime). */
export function modInverse(a: number, m: number): number {
  let [r0, r1, s0, s1] = [m, ((a % m) + m) % m, 0, 1];
  while (r1 !== 0) {
    const q = Math.floor(r0 / r1);
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1) throw new Error(`${a} is not invertible modulo ${m}`);
  return ((s0 % m) + m) % m;
}
/** Grid plan: G, total cells, a (coprime stride) and its inverse (pure, tested). */
export function scatterPlan(count: number): { grid: number; total: number; a: number; invA: number } {
  const n = Math.min(Math.max(Math.round(count), 1), MAX_COPIES);
  const grid = Math.max(1, Math.ceil(Math.sqrt(n)));
  const total = grid * grid;
  let a = Math.max(1, Math.round(total * 0.6180339887));
  while (gcd(a, total) !== 1) a++;
  return { grid, total, a: a % total || 1, invA: total === 1 ? 0 : modInverse(a % total || 1, total) };
}
/** Neighbour-cell reach for copies of half-diagonal `halfDiag` (side units), jitter in cells (pure, tested). */
export function scatterReach(grid: number, size: number, scaleMax: number, jitter: number): number {
  const halfDiag = 0.7071068 * size * scaleMax;
  return Math.min(MAX_REACH, Math.max(1, Math.ceil(halfDiag * grid + 0.5 * jitter)));
}

export default variants((k) =>
  defineNode({
    id: idOf('utils.copy_transform', k),
    version: 1,
    category: 'utils',
    title: titleOf('Copy and Transform', k),
    description: 'Scatters many transformed copies of the input pattern with random position, scale, rotation and value ranges.',
    keywords: ['scatter', 'copy', 'instances', 'splat', 'distribute', 'stamp', 'random', 'sprites'],
    icon: 'scatter',
    inputs: [
      { id: 'input', name: 'Pattern', type: pinOf(k) },
      { id: 'scale_map', name: 'Scale map', type: 'gray', optional: true, tooltip: 'Copy scale is multiplied by this value at the copy centre.' },
      { id: 'mask', name: 'Distribution', type: 'gray', optional: true, role: 'mask', tooltip: 'A copy survives with probability = mask value at its centre.' },
    ],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    common: { texture: true, blending: true },
    params: [
      P.int('count', 64, { group: 'Copies', min: 1, max: MAX_COPIES, softMax: 512, animatable: true }),
      P.seed('seed', 1, { group: 'Copies' }),
      P.float('size', 0.12, { group: 'Copies', min: 0.001, max: 2, softMax: 0.5, step: 0.001, display: 'percent', animatable: true, tooltip: 'Base copy size as a fraction of the smaller image side.' }),
      P.vec2('offset', [0, 0], { group: 'Copies', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true, tooltip: 'Shifts the whole scatter.' }),
      P.float('jitter', 1, { group: 'Copies', label: 'Position randomness', min: 0, max: 1, display: 'percent', step: 0.01, animatable: true, tooltip: '0% = regular grid, 100% = anywhere inside its cell.' }),
      P.float('scale_min', 0.6, { group: 'Ranges', label: 'Scale min', min: 0.01, max: 16, softMax: 2, step: 0.01, animatable: true }),
      P.float('scale_max', 1.2, { group: 'Ranges', label: 'Scale max', min: 0.01, max: 16, softMax: 2, step: 0.01, animatable: true }),
      P.float('rot_min', 0, { group: 'Ranges', label: 'Rotation min', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true }),
      P.float('rot_max', 360, { group: 'Ranges', label: 'Rotation max', min: -3600, max: 3600, softMin: -180, softMax: 360, step: 1, display: 'angle', animatable: true }),
      P.float('value_min', 0.4, { group: 'Ranges', label: 'Value min', min: 0, max: 16, softMax: 1, step: 0.01, animatable: true }),
      P.float('value_max', 1, { group: 'Ranges', label: 'Value max', min: 0, max: 16, softMax: 1, step: 0.01, animatable: true }),
      P.enum('combine', 'max', [{ value: 'max', label: 'Max' }, { value: 'add', label: 'Add' }, { value: 'over', label: 'Over (last on top)' }], { group: 'Ranges' }),
    ],
    gizmos: [
      { id: 'size', label: 'Copy size', type: 'circle', viewport: '2d', space: 'uv', center: { param: 'offset', map: { offset: [0.5, 0.5] } }, radius: { param: 'size', map: { scale: 0.5 } } },
    ],
    cost: { gpu: 'medium', tiling: 'pixel' },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 3, defines: kindDefines(k) }],
    gallery: [
      { name: 'Dense small', params: { count: 400, size: 0.06 } },
      { name: 'Grid', params: { count: 36, jitter: 0, rot_min: 0, rot_max: 0, scale_min: 1, scale_max: 1 } },
      { name: 'Additive', params: { combine: 'add', count: 150, value_min: 0.1, value_max: 0.3 } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Copy and Transform needs a pattern input');
      const p = ctx.params;
      const plan = scatterPlan(p.int('count'));
      const smax = Math.max(p.num('scale_min'), p.num('scale_max'));
      const smin = Math.min(p.num('scale_min'), p.num('scale_max'));
      const sm = ctx.texInput('scale_map');
      const mk = ctx.texInput('mask');
      const out = ctx.tex(pinOf(k));
      const rad = Math.PI / 180;
      ctx.pass({
        label: 'copy and transform',
        target: out,
        shader: SHADER,
        defines: kindDefines(k),
        uniforms: {
          layout: LAYOUT,
          values: {
            offset: p.vec2('offset'),
            grid: plan.grid,
            reach: scatterReach(plan.grid, p.num('size'), smax, p.num('jitter')),
            count: Math.min(p.int('count'), MAX_COPIES),
            cells_total: plan.total,
            inv_a: plan.invA,
            seed: p.seed('seed') >>> 0,
            size: p.num('size'),
            scale_min: smin,
            scale_max: smax,
            rot_min: p.num('rot_min') * rad,
            rot_max: p.num('rot_max') * rad,
            value_min: p.num('value_min'),
            value_max: p.num('value_max'),
            jitter: p.num('jitter'),
            combine: p.enumIndex('combine'),
            has_scale_map: !!sm,
            has_mask: !!mk,
          },
        },
        textures: [src.tex, sm?.tex ?? null, mk?.tex ?? null],
        ss: 1,
      });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);
