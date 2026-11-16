import { defineNode, type GizmoDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * grayscale.ao — heightmap ambient occlusion. One fullscreen pass, dirs x steps taps per pixel
 * (default 12 x 8 = 96 taps: ~0.4 G taps at 2048^2, an estimated 3-6 ms on a mid-range GPU).
 */
export const SHADER = defineShader('grayscale_ao.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'radius_px', type: 'f32' },
  { name: 'height_scale', type: 'f32' },
  { name: 'bias', type: 'f32' },
  { name: 'strength', type: 'f32' },
  { name: 'power', type: 'f32' },
  { name: 'dirs', type: 'i32' },
  { name: 'steps', type: 'i32' },
  { name: 'jitter', type: 'u32' },
  { name: 'invert', type: 'u32' },
]);
export const gizmos: GizmoDecl[] = [{ id: 'radius', label: 'AO radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }];

/** Number of height taps per pixel (cost model used by docs and tests). */
export const aoTaps = (dirs: number, steps: number): number => dirs * steps;

export default defineNode({
  id: 'grayscale.ao',
  version: 1,
  category: 'grayscale',
  title: 'Ambient Occlusion',
  description: 'Heightmap ambient occlusion: horizon-based, radius / directions / steps / bias / strength, tiling-aware. White = open, dark = occluded.',
  keywords: ['ao', 'occlusion', 'ambient', 'cavity', 'shadow', 'height', 'hbao'],
  icon: 'sun',
  inputs: [{ id: 'input', name: 'Height', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  params: [
    P.float('radius', 0.08, { group: 'Occlusion', min: 0.002, max: 0.5, softMax: 0.25, step: 0.002, display: 'percent', animatable: true, tooltip: 'Search radius as a fraction of the smaller image side.' }),
    P.float('height_scale', 0.2, { group: 'Occlusion', min: 0, max: 64, softMax: 2, step: 0.01, animatable: true, tooltip: 'Height of value 1.0 relative to the image size. Bigger = deeper relief = darker AO.' }),
    P.float('strength', 1, { group: 'Occlusion', min: 0, max: 8, softMax: 3, step: 0.01, animatable: true }),
    P.float('bias', 10, { group: 'Occlusion', min: 0, max: 80, softMax: 45, step: 0.5, display: 'angle', tooltip: 'Horizon angle below which nothing occludes. Removes banding on flat slopes.' }),
    P.float('power', 1, { group: 'Occlusion', min: 0.1, max: 8, softMax: 3, step: 0.01, label: 'Contrast (power)' }),
    P.int('directions', 12, { group: 'Quality', min: 2, max: 64, softMax: 32, tooltip: 'Directions per pixel.' }),
    P.int('steps', 8, { group: 'Quality', min: 1, max: 48, softMax: 24, tooltip: 'Samples along each direction.' }),
    P.bool('jitter', true, { group: 'Quality', tooltip: 'Rotates the direction set per pixel (hides banding; adds fine noise at low direction counts).' }),
    P.bool('invert', false, { group: 'Output' }),
  ],
  gizmos,
  cost: { gpu: 'high', tiling: 'halo', halo: (v) => Math.ceil((v.radius as number) * 8192) + 2 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: 'Tight', params: { radius: 0.03, strength: 1.5 } },
    { name: 'Deep + broad', params: { radius: 0.2, height_scale: 0.6 } },
    { name: 'High quality', params: { directions: 24, steps: 12 } },
    { name: 'Inverted (cavity)', params: { invert: true } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Ambient Occlusion needs a height input');
    const p = ctx.params;
    const out = ctx.tex('gray');
    ctx.pass({
      label: 'ao',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          radius_px: Math.max(p.num('radius') * Math.min(ctx.frame.width, ctx.frame.height), 1),
          height_scale: p.num('height_scale'),
          bias: (p.num('bias') * Math.PI) / 180,
          strength: p.num('strength'),
          power: p.num('power'),
          dirs: p.int('directions'),
          steps: p.int('steps'),
          jitter: p.bool('jitter'),
          invert: p.bool('invert'),
        },
      },
      textures: [src.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'gray') };
  },
});
