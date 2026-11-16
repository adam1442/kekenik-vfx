import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * grayscale.starburst: star-burst / spike rays / sparkle glint generator. N rays (1..64) around a centre, each a tapered spike
 * (half width `ray_width * radius` at the centre shrinking with `taper` to 0 at the tip), per-ray random length, alternating long / short rays
 * (4-point glints with small diagonals), gaussian core + halo, rotation and a `twinkle` length multiplier (animate both).
 * Algorithm: polar coordinates around the centre in PIXELS of the full image (resolution independent); the nearest ray is found by rounding the
 * angle to the ray lattice, the distance to its axis is r*|sin(a)|. Tiling: the burst is drawn in the periodic image nearest to its centre.
 * Limitations: one burst per node (use Polar Scatter / Copy Transform for many); rays are straight (no curved flares).
 */
export const SHADER = defineShader('grayscale_starburst.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'center', type: 'vec2f' },
  { name: 'radius', type: 'f32' },
  { name: 'rays', type: 'i32' },
  { name: 'ray_width', type: 'f32' },
  { name: 'taper', type: 'f32' },
  { name: 'falloff', type: 'f32' },
  { name: 'softness', type: 'f32' },
  { name: 'length_random', type: 'f32' },
  { name: 'alt_scale', type: 'f32' },
  { name: 'rotation', type: 'f32' },
  { name: 'twinkle', type: 'f32' },
  { name: 'core_size', type: 'f32' },
  { name: 'core_glow', type: 'f32' },
  { name: 'halo_radius', type: 'f32' },
  { name: 'halo', type: 'f32' },
  { name: 'intensity', type: 'f32' },
  { name: 'seed', type: 'u32' },
  { name: 'invert', type: 'u32' },
  { name: 'has_uv', type: 'u32' },
  { name: 'uv_amount', type: 'f32' },
]);

/**
 * CPU reference of the shader on the axis of ray 0 (angle = rotation): value at distance `r` (px). Used by vitest and the GPU known-answer test.
 * Only valid for length_random = 0, alt_scale = 1, twinkle = 1, halo = 0 and the core evaluated on the axis.
 */
export function starburstAxisRef(r: number, p: { side: number; radius: number; rayWidth: number; taper: number; falloff: number; coreSize: number; coreGlow: number; intensity: number }): number {
  const R = Math.max(p.radius * p.side, 1);
  const t = Math.min(1, Math.max(0, r / R));
  const along = r < R ? Math.pow(1 - t, p.falloff) : 0;
  const ray = along; // on the axis dperp = 0 -> across = 1 (width >= 0)
  const core = Math.exp(-Math.pow(r / Math.max(p.coreSize * p.side, 1), 2)) * p.coreGlow;
  const v = 1 - (1 - Math.min(1, Math.max(ray, core))) * 1;
  return Math.min(1, Math.max(0, v * p.intensity));
}

export default defineNode({
  id: 'grayscale.starburst',
  version: 1,
  category: 'grayscale',
  title: 'Starburst / Glint',
  description: 'Spike rays, star glints and flare bursts: N tapered rays with random lengths, long / short alternation, core and halo, rotation and twinkle. For sparkles, muzzle flashes, hit flashes and crystals.',
  keywords: ['starburst', 'star', 'sparkle', 'glint', 'flare', 'rays', 'spikes', 'burst', 'twinkle', 'lens', 'muzzle', 'flash', 'crystal'],
  icon: 'shape',
  inputs: [{ id: 'uv', name: 'UV', type: 'uv', optional: true, tooltip: 'Optional UV map: the burst is looked up through it (warp / deform).' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [
    P.vec2('center', [0.5, 0.5], { group: 'Burst', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true, tooltip: 'Centre (UV, y down).' }),
    P.float('radius', 0.45, { group: 'Burst', label: 'Ray length', min: 0.005, max: 4, softMax: 1, step: 0.005, display: 'percent', animatable: true, tooltip: 'Length of the longest ray (fraction of the smaller image side).' }),
    P.int('rays', 4, { group: 'Rays', min: 1, max: 64, softMax: 16, tooltip: 'Number of rays (4 = classic glint, 8 = with short diagonals).' }),
    P.float('ray_width', 0.05, { group: 'Rays', label: 'Ray width', min: 0, max: 1, softMax: 0.3, step: 0.002, display: 'percent', animatable: true, tooltip: 'Half width at the centre relative to the ray length.' }),
    P.float('taper', 1.5, { group: 'Rays', min: 0, max: 8, softMax: 4, step: 0.05, tooltip: 'How fast the ray thins towards its tip (0 = constant width).' }),
    P.float('falloff', 1.2, { group: 'Rays', min: 0, max: 8, softMax: 4, step: 0.05, tooltip: 'Brightness falloff along the ray (0 = full brightness to the tip).' }),
    P.float('softness', 0.5, { group: 'Rays', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'Edge softness across the ray.' }),
    P.float('length_random', 0.3, { group: 'Variation', label: 'Length randomness', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.float('alt_scale', 1, { group: 'Variation', label: 'Odd ray length', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'Length of every second ray (8 rays + 40% = 4-point star with small diagonals).' }),
    P.float('rotation', 0, { group: 'Variation', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true }),
    P.float('twinkle', 1, { group: 'Variation', min: 0, max: 3, softMax: 1.5, step: 0.01, animatable: true, tooltip: 'Multiplies every ray length: animate for a twinkle / pop-in.' }),
    P.float('core_size', 0.04, { group: 'Core', min: 0.001, max: 1, softMax: 0.2, step: 0.001, display: 'percent', animatable: true }),
    P.float('core_glow', 1, { group: 'Core', min: 0, max: 4, softMax: 1.5, step: 0.01, animatable: true }),
    P.float('halo_radius', 0.12, { group: 'Core', min: 0.001, max: 2, softMax: 0.5, step: 0.005, display: 'percent' }),
    P.float('halo', 0.2, { group: 'Core', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: 'Soft glow around the core.' }),
    P.float('intensity', 1, { group: 'Output', min: 0, max: 4, softMax: 2, step: 0.01, animatable: true }),
    P.seed('seed', 1, { group: 'Output', animatable: true }),
    P.bool('invert', false, { group: 'Output' }),
    P.float('uv_amount', 1, { group: 'Output', label: 'UV amount', min: 0, max: 1, step: 0.01, showWhenConnected: 'uv' }),
  ],
  gizmos: [{ id: 'burst', label: 'Burst centre / length', type: 'circle', viewport: '2d', space: 'uv', center: 'center', radius: 'radius' }],
  cost: { gpu: 'low', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: '4-point glint', params: { rays: 8, alt_scale: 0.35, ray_width: 0.04 } },
    { name: 'Muzzle star', params: { rays: 5, length_random: 0.6, ray_width: 0.09, taper: 1 } },
    { name: 'Crystal spikes', params: { rays: 12, length_random: 0.8, ray_width: 0.07, softness: 0.1 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const out = ctx.tex('gray');
    const uvIn = ctx.texInput('uv');
    ctx.pass({
      label: 'starburst',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          center: p.vec2('center'),
          radius: p.num('radius'),
          rays: p.int('rays'),
          ray_width: p.num('ray_width'),
          taper: p.num('taper'),
          falloff: p.num('falloff'),
          softness: p.num('softness'),
          length_random: p.num('length_random'),
          alt_scale: p.num('alt_scale'),
          rotation: p.num('rotation'),
          twinkle: p.num('twinkle'),
          core_size: p.num('core_size'),
          core_glow: p.num('core_glow'),
          halo_radius: p.num('halo_radius'),
          halo: p.num('halo'),
          intensity: p.num('intensity'),
          seed: p.seed('seed') >>> 0,
          invert: p.bool('invert'),
          has_uv: uvIn ? 1 : 0,
          uv_amount: p.num('uv_amount'),
        },
      },
      textures: [uvIn?.tex ?? null],
    });
    return { output: ctx.result(out, 'gray') };
  },
});
