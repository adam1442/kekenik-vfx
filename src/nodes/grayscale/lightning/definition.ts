import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * grayscale.lightning: procedural lightning bolt. Zig-zag fractal displacement of a straight axis, taper,
 * up to 6 branches, soft glow halo, and a REVEAL parameter (0 -> 1) that makes the bolt strike from start to end.
 * Animate `reveal` (strike), `evolution` (smooth morph), `seed` (re-roll = flicker) and `intensity` (fade out).
 * Texture slot: t0 = optional UV map. Tiling: the bolt is drawn in the periodic image nearest to its centre.
 */
export const SHADER = defineShader('grayscale_lightning.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'start', type: 'vec2f' },
  { name: 'end', type: 'vec2f' },
  { name: 'width', type: 'f32' },
  { name: 'softness', type: 'f32' },
  { name: 'taper', type: 'f32' },
  { name: 'glow', type: 'f32' },
  { name: 'glow_radius', type: 'f32' },
  { name: 'jag', type: 'f32' },
  { name: 'segments', type: 'i32' },
  { name: 'octaves', type: 'i32' },
  { name: 'roughness', type: 'f32' },
  { name: 'evolution', type: 'f32' },
  { name: 'seed', type: 'u32' },
  { name: 'branches', type: 'i32' },
  { name: 'branch_length', type: 'f32' },
  { name: 'branch_angle', type: 'f32' },
  { name: 'branch_width', type: 'f32' },
  { name: 'branch_jag', type: 'f32' },
  { name: 'reveal', type: 'f32' },
  { name: 'reveal_soft', type: 'f32' },
  { name: 'intensity', type: 'f32' },
  { name: 'invert', type: 'u32' },
  { name: 'has_uv', type: 'u32' },
  { name: 'uv_amount', type: 'f32' },
]);

export default defineNode({
  id: 'grayscale.lightning',
  version: 1,
  category: 'grayscale',
  title: 'Lightning',
  description: 'Procedural lightning bolt: fractal zig-zag, taper, branches, glow halo and an animatable strike reveal.',
  keywords: ['lightning', 'bolt', 'electric', 'thunder', 'arc', 'zap', 'strike', 'branch', 'tesla'],
  icon: 'shape',
  inputs: [{ id: 'uv', name: 'UV', type: 'uv', optional: true, tooltip: 'Optional UV map: the bolt is looked up through it (warp / deform).' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [
    P.vec2('start', [0.5, 0.04], { group: 'Bolt', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true, tooltip: 'Start point (UV, y down).' }),
    P.vec2('end', [0.5, 0.96], { group: 'Bolt', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true, tooltip: 'End point (UV, y down).' }),
    P.float('width', 0.012, { group: 'Bolt', min: 0, max: 0.5, softMax: 0.06, step: 0.0005, display: 'percent', animatable: true, tooltip: 'Core half-width (fraction of the smaller side).' }),
    P.float('softness', 0.35, { group: 'Bolt', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'Edge softness of the core.' }),
    P.float('taper', 0.5, { group: 'Bolt', min: 0, max: 2, softMax: 1, step: 0.01, display: 'percent', tooltip: 'Width at the end relative to the start (100% = constant width).' }),
    P.float('glow', 0.45, { group: 'Glow', min: 0, max: 4, softMax: 1.5, step: 0.01, animatable: true, tooltip: 'Strength of the soft halo added around the core.' }),
    P.float('glow_radius', 0.03, { group: 'Glow', label: 'Glow radius', min: 0.001, max: 0.5, softMax: 0.15, step: 0.001, display: 'percent', animatable: true }),
    P.float('jag', 0.09, { group: 'Shape', label: 'Jaggedness', min: 0, max: 1, softMax: 0.3, step: 0.002, display: 'percent', animatable: true, tooltip: 'Maximum sideways deviation as a fraction of the bolt length.' }),
    P.int('segments', 5, { group: 'Shape', label: 'Base segments', min: 1, max: 64, softMax: 24, tooltip: 'Number of kinks of the first octave; every octave doubles it.' }),
    P.int('octaves', 5, { group: 'Shape', min: 1, max: 8 }),
    P.float('roughness', 0.52, { group: 'Shape', min: 0, max: 1, step: 0.01, tooltip: 'Amplitude gain per octave.' }),
    P.float('evolution', 0, { group: 'Shape', min: -1000, max: 1000, softMin: 0, softMax: 8, step: 0.01, animatable: true, tooltip: 'Smoothly morphs the bolt between random shapes (integer = a fresh shape).' }),
    P.seed('seed', 3, { group: 'Shape', animatable: true, tooltip: 'Random seed. Animating it (stepped) gives a classic flicker.' }),
    P.int('branches', 3, { group: 'Branches', min: 0, max: 6 }),
    P.float('branch_length', 0.45, { group: 'Branches', label: 'Length', min: 0.02, max: 2, softMax: 1, step: 0.01, display: 'percent', tooltip: 'Maximum branch length relative to the bolt length.' }),
    P.float('branch_angle', 38, { group: 'Branches', label: 'Angle', min: 0, max: 85, step: 1, display: 'angle', tooltip: 'Average angle between a branch and the main axis.' }),
    P.float('branch_width', 0.55, { group: 'Branches', label: 'Width', min: 0.05, max: 1.5, step: 0.01, display: 'percent', tooltip: 'Branch width relative to the main bolt.' }),
    P.float('branch_jag', 0.8, { group: 'Branches', label: 'Jaggedness', min: 0, max: 3, softMax: 1.5, step: 0.01, display: 'percent' }),
    P.float('reveal', 1, { group: 'Strike', min: 0, max: 1, step: 0.005, display: 'percent', animatable: true, tooltip: 'Animate 0 -> 100% to make the bolt strike from start to end (branches follow).' }),
    P.float('reveal_soft', 0.12, { group: 'Strike', label: 'Head softness', min: 0.001, max: 1, softMax: 0.5, step: 0.005, display: 'percent' }),
    P.float('intensity', 1, { group: 'Output', min: 0, max: 4, softMax: 2, step: 0.01, animatable: true, tooltip: 'Final multiplier: animate to fade the bolt out.' }),
    P.bool('invert', false, { group: 'Output' }),
    P.float('uv_amount', 1, { group: 'Output', label: 'UV amount', min: 0, max: 1, step: 0.01, showWhenConnected: 'uv' }),
  ],
  gizmos: [{ id: 'axis', label: 'Bolt start / end', type: 'line', viewport: '2d', space: 'uv', from: 'start', to: 'end' }],
  cost: { gpu: 'medium', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: 'Forked bolt', params: { branches: 5, jag: 0.12 } },
    { name: 'Thin arc', params: { width: 0.005, glow: 0.8, branches: 0, jag: 0.05, segments: 8 } },
    { name: 'Striking (50%)', params: { reveal: 0.5 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const out = ctx.tex('gray');
    const uvIn = ctx.texInput('uv');
    ctx.pass({
      label: 'lightning',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          start: p.vec2('start'),
          end: p.vec2('end'),
          width: p.num('width'),
          softness: p.num('softness'),
          taper: p.num('taper'),
          glow: p.num('glow'),
          glow_radius: p.num('glow_radius'),
          jag: p.num('jag'),
          segments: p.int('segments'),
          octaves: p.int('octaves'),
          roughness: p.num('roughness'),
          evolution: p.num('evolution'),
          seed: p.seed('seed'),
          branches: p.int('branches'),
          branch_length: p.num('branch_length'),
          branch_angle: p.num('branch_angle'),
          branch_width: p.num('branch_width'),
          branch_jag: p.num('branch_jag'),
          reveal: p.num('reveal'),
          reveal_soft: p.num('reveal_soft'),
          intensity: p.num('intensity'),
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
