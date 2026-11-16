import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { modOf, uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_noise.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'scale', type: 'vec2f' },
  { name: 'offset', type: 'vec2f' },
  { name: 'strength', type: 'f32' },
  { name: 'strength_mod_k', type: 'f32' },
  { name: 'roughness', type: 'f32' },
  { name: 'evolution', type: 'f32' },
  { name: 'octaves', type: 'i32' },
  { name: 'lacunarity', type: 'i32' },
  { name: 'z_cells', type: 'i32' },
  { name: 'mode', type: 'u32' },
  { name: 'seed', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
]);

/** uv.noise — tileable + loopable noise warp (vector / curl / angle). Same Transform2D gizmo semantics as grayscale.noise. */
export default defineNode({
  id: 'uv.noise',
  version: 1,
  category: 'uv',
  title: 'UV Noise',
  description: 'Tileable, seamlessly looping noise warp. Vector = independent X/Y noise, Curl = divergence-free swirling flow, Angle = constant-speed flow with noise-driven direction.',
  keywords: ['uv', 'noise', 'warp', 'distortion', 'curl', 'flow noise', 'heat haze', 'wobble'],
  icon: 'noise',
  inputs: [],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [
    P.enum('mode', 'vector', [{ value: 'vector', label: 'Vector' }, { value: 'curl', label: 'Curl (flow)' }, { value: 'angle', label: 'Angle (constant speed)' }], { group: 'Noise' }),
    P.vec2('scale', [4, 4], { group: 'Noise', min: 0.1, max: 128, softMin: 1, softMax: 16, step: 1, labels: ['X', 'Y'], linkable: true, animatable: true, tooltip: 'Cells across the image. Whole numbers are used while the graph tiles.' }),
    P.float('strength', 0.05, { group: 'Noise', min: 0, max: 2, softMax: 0.3, step: 0.001, display: 'percent', modulatable: true, animatable: true, tooltip: 'Maximum displacement as a fraction of the smaller image side.' }),
    P.int('octaves', 2, { group: 'fBm', min: 1, max: 8 }),
    P.int('lacunarity', 2, { group: 'fBm', min: 2, max: 4 }),
    P.float('roughness', 0.5, { group: 'fBm', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true }),
    P.vec2('offset', [0, 0], { group: 'Transform', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true }),
    P.float('evolution', 0, { group: 'Animation', min: -1000, max: 1000, softMin: 0, softMax: 1, step: 0.01, animatable: true, tooltip: '0 -> 1 is one seamless loop.' }),
    P.int('z_cells', 2, { group: 'Animation', label: 'Z layers', min: 1, max: 16 }),
    P.seed('seed', 0, { group: 'Noise' }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  gizmos: [{ id: 'pattern', label: 'Noise transform', type: 'transform', viewport: '2d', space: 'uv', position: { param: 'offset', map: { scale: -1, offset: 0.5 } }, scale: { param: 'scale', map: { reciprocal: true } }, tilingSafe: true }],
  cost: { gpu: 'low', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: 'Heat haze', params: { mode: 'vector', scale: [6, 6], strength: 0.02, octaves: 3 } },
    { name: 'Curl swirls', params: { mode: 'curl', scale: [3, 3], strength: 0.12 } },
    { name: 'Flowmap angles', params: { mode: 'angle', scale: [4, 4], strength: 0.1 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const m = modOf(ctx, 'strength');
    const out = ctx.tex('uv');
    ctx.pass({
      label: 'uv noise',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: { scale: p.vec2('scale'), offset: p.vec2('offset'), strength: p.num('strength'), strength_mod_k: m.k, roughness: p.num('roughness'), evolution: p.num('evolution'), octaves: p.int('octaves'), lacunarity: p.int('lacunarity'), z_cells: p.int('z_cells'), mode: p.enumIndex('mode'), seed: p.seed('seed') >>> 0, uv_mode: uvModeIndex(p.str('uv_out')) },
      },
      textures: [m.tex],
    });
    return { output: ctx.result(out, 'uv') };
  },
});
