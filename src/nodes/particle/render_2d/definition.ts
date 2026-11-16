import { packParticles, type PackOptions } from '../../../engine/particles/attributes';
import { defineNode } from '../../../engine/graph/node';
import { asMesh } from '../../../engine/mesh/accounting';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('particle_render_2d.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'count', type: 'u32' },
  { name: 'copies_x', type: 'u32' },
  { name: 'copies_y', type: 'u32' },
  { name: 'shape', type: 'u32' },
  { name: 'soft', type: 'f32' },
  { name: 'trail', type: 'f32' },
  { name: 'opacity', type: 'f32' },
  { name: 'intensity', type: 'f32' },
  { name: 's_cols', type: 'u32' },
  { name: 's_rows', type: 'u32' },
  { name: 's_frames', type: 'u32' },
  { name: 'sprite_mode', type: 'u32' },
  { name: 'sprite_luma', type: 'u32' },
]);

const BLENDS: Record<string, GPUBlendState> = {
  additive: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } },
  alpha: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } },
  max: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' } },
};
const SHAPES = ['disc', 'square', 'ring', 'diamond', 'sprite'];

/** Hard limit of drawn instances (particles x tiling copies): protects the GPU and the tab. */
export const MAX_INSTANCES = 4_000_000;

/** particle.render_2d — draws Points as instanced sprites into a texture. */
export default defineNode({
  id: 'particle.render_2d',
  version: 2,
  category: 'particle',
  title: '2D Render',
  description:
    'Renders points as sprites (soft disc, square, ring, diamond or an input sprite / atlas) with GPU instanced quads: size, rotation and colour come from the point attributes (pscale, rot, Cd, age, v). Additive, alpha or max blending, soft edge, motion stretch and tiling wrap. Hard caps on count and memory.',
  keywords: ['particles', 'sprites', 'render', 'points', 'splat', 'instanced', 'stars', 'dust', 'sparks'],
  icon: 'points-shape',
  inputs: [
    { id: 'points', name: 'Points', type: 'points' },
    { id: 'sprite', name: 'Sprite', type: 'color', optional: true, tooltip: 'Optional sprite or atlas texture.' },
  ],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  common: { texture: true, blending: true },
  params: [
    P.enum('plane', 'xy', [{ value: 'xy', label: 'XY' }, { value: 'xz', label: 'XZ' }, { value: 'yz', label: 'YZ' }], { group: 'View', tooltip: 'World plane projected into the image.' }),
    P.vec2('center', [0, 0], { group: 'View', step: 0.01, softMin: -2, softMax: 2, animatable: true, label: 'View center' }),
    P.float('extent', 1, { group: 'View', min: 0.001, max: 1000, softMax: 4, step: 0.01, animatable: true, label: 'View width (world)', tooltip: 'World units covered by the image width.' }),
    P.enum('blend', 'additive', [{ value: 'additive', label: 'Additive' }, { value: 'alpha', label: 'Alpha (over)' }, { value: 'max', label: 'Max' }], { group: 'Sprite' }),
    P.enum('shape', 'disc', SHAPES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })), { group: 'Sprite', tooltip: 'Sprite uses the Sprite input.' }),
    P.float('soft', 0.6, { group: 'Sprite', label: 'Soft edge', min: 0.001, max: 1, display: 'percent', step: 0.01, animatable: true, visibleIf: (v) => v.shape !== 'sprite' }),
    P.float('size_scale', 1, { group: 'Sprite', min: 0, max: 1000, softMax: 4, step: 0.01, animatable: true, label: 'Size scale' }),
    P.float('opacity', 1, { group: 'Sprite', min: 0, max: 1, display: 'percent', step: 0.01, animatable: true }),
    P.float('intensity', 1, { group: 'Sprite', min: 0, max: 100, softMax: 8, step: 0.05, animatable: true }),
    P.float('trail', 0, { group: 'Motion stretch', label: 'Trail (loop fraction)', min: 0, max: 1, display: 'percent', step: 0.005, animatable: true, tooltip: 'Stretches every sprite along its velocity by this fraction of one loop of travel.' }),
    P.int('atlas_cols', 1, { group: 'Atlas', min: 1, max: 64, visibleIf: (v) => v.shape === 'sprite' }),
    P.int('atlas_rows', 1, { group: 'Atlas', min: 1, max: 64, visibleIf: (v) => v.shape === 'sprite' }),
    P.int('atlas_frames', 1, { group: 'Atlas', min: 1, max: 4096, visibleIf: (v) => v.shape === 'sprite' }),
    P.enum('atlas_pick', 'first', [{ value: 'first', label: 'First frame' }, { value: 'age', label: 'By age' }, { value: 'random', label: 'Random per particle' }], { group: 'Atlas', visibleIf: (v) => v.shape === 'sprite' }),
    P.bool('sprite_luma', false, { group: 'Atlas', label: 'Use luminance as alpha', visibleIf: (v) => v.shape === 'sprite', tooltip: 'For Gray sprites (alpha is 1): the brightness becomes the sprite alpha.' }),
    P.enum('sort', 'none', [{ value: 'none', label: 'Point order' }, { value: 'oldest_first', label: 'Oldest first (young on top)' }, { value: 'youngest_first', label: 'Youngest first (old on top)' }], { group: 'Limits', label: 'Draw order', tooltip: 'Sort by age before drawing (alpha blending of overlapping smoke / sprites). Additive / max blending do not need it.' }),
    P.int('max_particles', 200_000, { group: 'Limits', min: 1, max: 1_000_000, advanced: true, tooltip: 'Hard cap on drawn particles (extra points are ignored).' }),
  ],
  /** v2: added `sort` (default 'none' = identical to v1). */
  migrateParams: (old) => ({ sort: 'none', ...old }),
  cost: { gpu: 'medium', tiling: 'global' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1, storage: 1, mode: 'raw', vertexEntry: 'vs_particle' }],
  evaluate(ctx) {
    const pts = asMesh(ctx.inputs.points);
    if (!pts) throw new Error('2D Render needs a Points input.');
    if (ctx.gpu.caps.compat) throw new Error('2D Render needs storage buffers in the vertex stage, which GPU compatibility mode does not offer. Use a browser / GPU with full WebGPU, or bake the particles in another way.');
    if (!ctx.uploadBuffer) throw new Error('This evaluation context cannot upload particle data.');
    const p = ctx.params;
    const c = p.vec2('center');
    const opts: PackOptions = { plane: p.str('plane') as PackOptions['plane'], center: [c[0], c[1]], extent: p.num('extent'), aspect: ctx.frame.fullWidth / ctx.frame.fullHeight, sizeScale: p.num('size_scale'), maxCount: p.int('max_particles'), sort: p.str('sort') as PackOptions['sort'] };
    const packed = packParticles(pts, opts);
    const cx = ctx.frame.tileX ? 3 : 1;
    const cy = ctx.frame.tileY ? 3 : 1;
    if (packed.count * cx * cy > MAX_INSTANCES) throw new Error(`Too many particles to draw (${packed.count * cx * cy} instances, limit ${MAX_INSTANCES}). Lower the count or Max particles.`);
    const out = ctx.tex('color');
    const sprite = ctx.texInput('sprite');
    const shape = p.str('shape');
    const buf = ctx.uploadBuffer(packed.data.length ? packed.data : new Float32Array(16));
    ctx.pass({
      label: 'particles',
      target: out,
      shader: SHADER,
      mode: 'raw',
      blend: BLENDS[p.str('blend')],
      uniforms: {
        layout: LAYOUT,
        values: {
          count: packed.count,
          copies_x: cx,
          copies_y: cy,
          shape: Math.max(0, SHAPES.indexOf(shape)),
          soft: p.num('soft'),
          trail: p.num('trail'),
          opacity: p.num('opacity'),
          intensity: p.num('intensity'),
          s_cols: p.int('atlas_cols'),
          s_rows: p.int('atlas_rows'),
          s_frames: p.int('atlas_frames'),
          sprite_mode: ['first', 'age', 'random'].indexOf(p.str('atlas_pick')),
          sprite_luma: p.bool('sprite_luma') ? 1 : 0,
        },
      },
      textures: [shape === 'sprite' ? sprite?.tex : null],
      storageBuffers: [buf],
      draw: { vertexCount: 6, instanceCount: packed.count * cx * cy, vertexEntry: 'vs_particle' },
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});
