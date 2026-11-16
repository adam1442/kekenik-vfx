import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import initSrc from './jfa_init.wgsl?raw';
import resolveSrc from './jfa_resolve.wgsl?raw';
import stepSrc from './jfa_step.wgsl?raw';

/**
 * utils.distance — signed / unsigned distance field and nearest-point data by JUMP FLOODING (ping-pong fragment passes).
 *  - Seeds: `mask` = pixels with value >= threshold (signed: also the opposite class), `points` = every pixel above the
 *    threshold is a seed ("Single Pixel" input: one white pixel = one point).
 *  - Packing: the seed coordinate is stored in rgba16float as (xhi, xlo, yhi, ylo) with x = xhi*1024 + xlo — EXACT in half
 *    floats for images up to 1M px, so no 32-bit render target is needed.
 *  - Passes: ceil(log2(max side)) + 1 (JFA+1) per seed class; 9 taps each. Estimated 2048^2: 12 passes x 9 taps ~ 1.5 ms
 *    per class. Tiling-aware: neighbours wrap and the distance uses the minimum-image convention.
 *  - Outputs: distance (Gray, in fractions of the smaller side or normalised by Max distance), id (Gray, random per nearest
 *    seed), nearest UV (UV, coordinates of the nearest seed; half precision => ~1/2048 accuracy).
 *  - JFA is approximate in rare corner cases (errors of 1 px at thin features); the self-test compares against brute force.
 */
export const INIT = defineShader('utils_distance_init.wgsl', initSrc);
export const STEP = defineShader('utils_distance_step.wgsl', stepSrc);
export const RESOLVE = defineShader('utils_distance_resolve.wgsl', resolveSrc);
export const INIT_LAYOUT = makeLayout([
  { name: 'threshold', type: 'f32' },
  { name: 'invert', type: 'u32' },
  { name: 'seed_class', type: 'u32' },
]);
export const STEP_LAYOUT = makeLayout([{ name: 'step', type: 'i32' }]);
export const RESOLVE_LAYOUT = makeLayout([
  { name: 'which', type: 'u32' },
  { name: 'signed_mode', type: 'u32' },
  { name: 'norm_on', type: 'u32' },
  { name: 'max_dist', type: 'f32' },
  { name: 'seed', type: 'u32' },
]);

/** JFA step sizes for an image (pure, tested): N/2 ... 1 followed by an extra 1 (JFA+1). */
export function jfaSteps(w: number, h: number): number[] {
  const out: number[] = [];
  for (let s = Math.ceil(Math.max(w, h) / 2); s >= 1; s = s === 1 ? 0 : Math.ceil(s / 2)) out.push(s);
  out.push(1);
  return out;
}

export default defineNode({
  id: 'utils.distance',
  version: 1,
  category: 'utils',
  title: 'Distance',
  description: 'Signed or unsigned distance field from a mask or from single-pixel points (jump flooding). Also outputs a per-nearest-point id and the nearest point UV for custom animated voronoi.',
  keywords: ['sdf', 'distance field', 'voronoi', 'jump flooding', 'jfa', 'nearest point', 'outline', 'glow'],
  icon: 'distance',
  inputs: [{ id: 'input', name: 'Input', type: 'gray' }],
  outputs: [
    { id: 'output', name: 'Distance', type: 'gray' },
    { id: 'id', name: 'Point ID', type: 'gray' },
    { id: 'nearest_uv', name: 'Nearest UV', type: 'uv' },
  ],
  params: [
    P.enum('mode', 'mask', [{ value: 'mask', label: 'Mask', tooltip: 'Distance to / from the white region.' }, { value: 'points', label: 'Points', tooltip: 'Every pixel above the threshold is a point (single pixel input).' }], { group: 'Distance' }),
    P.bool('signed', true, { group: 'Distance', tooltip: 'Mask mode: negative inside, positive outside (0.5 at the edge when normalised).', visibleIf: (v) => v.mode === 'mask' }),
    P.float('threshold', 0.5, { group: 'Distance', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
    P.bool('invert', false, { group: 'Distance' }),
    P.float('max_distance', 0.25, { group: 'Output', label: 'Max distance', min: 0.001, max: 2, softMax: 1, step: 0.001, display: 'percent', animatable: true, tooltip: 'Fraction of the smaller side that maps to 100%.' }),
    P.bool('normalize', true, { group: 'Output', tooltip: 'Off: raw distance in fractions of the smaller side.' }),
    P.seed('seed', 1, { group: 'Output', label: 'ID seed' }),
  ],
  gizmos: [{ id: 'max', label: 'Max distance', type: 'circle', viewport: '2d', space: 'uv', radius: 'max_distance' }],
  cost: { gpu: 'medium', tiling: 'global', temporaries: 4 },
  shaders: [
    { source: INIT, uniforms: INIT_LAYOUT, textures: 1 },
    { source: STEP, uniforms: STEP_LAYOUT, textures: 1 },
    { source: RESOLVE, uniforms: RESOLVE_LAYOUT, textures: 2 },
  ],
  gallery: [
    { name: 'Unsigned', params: { signed: false } },
    { name: 'Points', params: { mode: 'points', threshold: 0.9, max_distance: 0.15 } },
    { name: 'Raw', params: { normalize: false } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Distance needs an input');
    const p = ctx.params;
    const points = p.str('mode') === 'points';
    const signed = !points && p.bool('signed');
    const steps = jfaSteps(ctx.frame.width, ctx.frame.height);
    const run = (seedClass: 0 | 1) => {
      let cur = ctx.tex('color');
      ctx.pass({ label: 'jfa init', target: cur, shader: INIT, uniforms: { layout: INIT_LAYOUT, values: { threshold: p.num('threshold'), invert: p.bool('invert'), seed_class: seedClass } }, textures: [src.tex], ss: 1 });
      for (const s of steps) {
        const nxt = ctx.tex('color');
        ctx.pass({ label: `jfa step ${s}`, target: nxt, shader: STEP, uniforms: { layout: STEP_LAYOUT, values: { step: s } }, textures: [cur], ss: 1 });
        ctx.free(cur);
        cur = nxt;
      }
      return cur;
    };
    const inside = run(0);
    const outside = signed ? run(1) : null;
    const out: Record<string, ReturnType<typeof ctx.result>> = {};
    const resolve = (which: 0 | 1 | 2, pin: 'gray' | 'uv', id: string): void => {
      const t = ctx.tex(pin);
      ctx.pass({
        label: `distance resolve ${id}`,
        target: t,
        shader: RESOLVE,
        uniforms: { layout: RESOLVE_LAYOUT, values: { which, signed_mode: signed ? 1 : 0, norm_on: p.bool('normalize'), max_dist: p.num('max_distance'), seed: p.seed('seed') >>> 0 } },
        textures: [inside, outside],
        ss: 1,
      });
      out[id] = ctx.result(t, pin);
    };
    resolve(0, 'gray', 'output');
    resolve(1, 'gray', 'id');
    resolve(2, 'uv', 'nearest_uv');
    ctx.free(inside);
    if (outside) ctx.free(outside);
    return out;
  },
});
