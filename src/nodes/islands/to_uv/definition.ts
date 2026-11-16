import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('islands_to_uv.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'offset', type: 'vec2f' },
  { name: 'angle', type: 'f32' },
  { name: 'angle_random', type: 'f32' },
  { name: 'scale', type: 'f32' },
  { name: 'seed', type: 'u32' },
  { name: 'fit', type: 'u32' },
  { name: 'mirror', type: 'u32' },
  { name: 'random_90', type: 'u32' },
  { name: 'align_long', type: 'u32' },
  { name: 'which', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
]);

/** islands.to_uv — per-island local UV (stretch / fit / fill, rotation, random 90 degree turns, mirror) + mask. */
export default defineNode({
  id: 'islands.to_uv',
  version: 1,
  category: 'islands',
  title: 'Islands To UV',
  description: 'Local UV coordinates for every island: 0..1 across its bounding box with stretch / fit / fill, rotation (also random and 90 degree steps), mirror and scale. Feed it to Transform\'s UV pin to put a texture on every shard.',
  keywords: ['islands', 'uv', 'local uv', 'per element', 'texture per island', 'atlas', 'shards', 'flood fill'],
  icon: 'islands',
  inputs: [{ id: 'islands', name: 'Island Map', type: 'color' }],
  outputs: [
    { id: 'output', name: 'UV', type: 'uv' },
    { id: 'mask', name: 'Mask', type: 'gray', tooltip: '1 inside islands.' },
  ],
  params: [
    P.enum('fit', 'fit', [{ value: 'stretch', label: 'Stretch to box' }, { value: 'fit', label: 'Fit (keep aspect, letterbox)' }, { value: 'fill', label: 'Fill (keep aspect, crop)' }], { group: 'UV' }),
    P.float('angle', 0, { group: 'UV', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 0.5, display: 'angle', animatable: true }),
    P.float('angle_random', 0, { group: 'UV', label: 'Random angle', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true }),
    P.bool('random_90', false, { group: 'UV', label: 'Random 90° steps' }),
    P.bool('align_long', false, { group: 'UV', label: 'Align long axis', tooltip: 'Turns tall islands by 90° so the image runs along the long side.' }),
    P.bool('mirror', false, { group: 'UV', label: 'Random mirror' }),
    P.float('scale', 1, { group: 'UV', min: 0.01, max: 64, softMin: 0.25, softMax: 4, step: 0.01, animatable: true }),
    P.vec2('offset', [0, 0], { group: 'UV', min: -8, max: 8, softMin: -0.5, softMax: 0.5, step: 0.005, animatable: true }),
    P.seed('seed', 1, { group: 'UV' }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  gizmos: [{ id: 'angle', label: 'Rotation', type: 'angle', viewport: '2d', space: 'uv', angle: 'angle' }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Stretch', params: { fit: 'stretch' } }, { name: 'Random 90°', params: { random_90: true, mirror: true } }, { name: 'Fill', params: { fit: 'fill' } }],
  evaluate(ctx) {
    const src = ctx.texInput('islands');
    if (!src) throw new Error('Islands To UV needs an Island Map');
    const p = ctx.params;
    const base = { offset: p.vec2('offset'), angle: (p.num('angle') * Math.PI) / 180, angle_random: p.num('angle_random'), scale: p.num('scale'), seed: p.seed('seed') >>> 0, fit: p.enumIndex('fit'), mirror: p.bool('mirror'), random_90: p.bool('random_90'), align_long: p.bool('align_long'), uv_mode: uvModeIndex(p.str('uv_out')) };
    const uvT = ctx.tex('uv');
    ctx.pass({ label: 'islands to uv', target: uvT, shader: SHADER, uniforms: { layout: LAYOUT, values: { ...base, which: 0 } }, textures: [src.tex], ss: 1 });
    const mask = ctx.tex('gray');
    ctx.pass({ label: 'islands mask', target: mask, shader: SHADER, uniforms: { layout: LAYOUT, values: { ...base, which: 1 } }, textures: [src.tex], ss: 1 });
    return { output: ctx.result(uvT, 'uv'), mask: ctx.result(mask, 'gray') };
  },
});
