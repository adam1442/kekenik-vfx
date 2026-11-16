import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.directional_blur — linear blur along an angle. Angle and length are MODULATABLE per pixel (Gray `mod` pins);
 * alternatively an optional UV pin drives the blur vector per pixel (UV values are absolute lookup coordinates;
 * the blur vector is (uv_field - uv) * UV scale, wrapped when the node tiles). Placement centered / forward / backward,
 * weight box / linear trail / gaussian. Edges wrap or clamp following the node's Tiling.
 * Cost: `samples` bilinear taps; "Adaptive" caps taps at ceil(length in px) + 1 (default).
 */
export const SHADER = defineShader('utils_directional_blur.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'angle', type: 'f32' },
  { name: 'length', type: 'f32' },
  { name: 'angle_mod_k', type: 'f32' },
  { name: 'length_mod_k', type: 'f32' },
  { name: 'uv_scale', type: 'f32' },
  { name: 'samples', type: 'i32' },
  { name: 'placement', type: 'u32' },
  { name: 'falloff', type: 'u32' },
  { name: 'adaptive', type: 'u32' },
  { name: 'jitter', type: 'u32' },
  { name: 'has_uv', type: 'u32' },
]);

export default variants((k) =>
  defineNode({
    id: idOf('utils.directional_blur', k),
    version: 1,
    category: 'utils',
    title: titleOf('Directional Blur', k),
    description: 'Blur along a direction. Angle / length can be modulated per pixel by Gray inputs or driven by a UV field.',
    keywords: ['motion', 'streak', 'linear blur', 'smear', 'trail', 'directional'],
    icon: 'blur',
    common: { texture: true, blending: true },
    inputs: [
      { id: 'input', name: 'Input', type: pinOf(k) },
      { id: 'uv', name: 'UV', type: 'uv', optional: true, tooltip: 'Optional: per-pixel blur vector = (UV - own coordinate) * UV scale.' },
    ],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.float('angle', 0, { group: 'Direction', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true, modulatable: true, tooltip: 'Direction in degrees, clockwise on screen. Modulation multiplies the angle.' }),
      P.float('length', 0.05, { group: 'Direction', min: 0, max: 1, softMax: 0.3, step: 0.001, display: 'percent', animatable: true, modulatable: true, tooltip: 'Total blur length as a fraction of the smaller side.' }),
      P.float('uv_scale', 1, { group: 'Direction', label: 'UV scale', min: -64, max: 64, softMin: -4, softMax: 4, step: 0.05, animatable: true, tooltip: 'Scale of the UV displacement when the UV pin is connected.' }),
      P.int('samples', 32, { group: 'Quality', min: 2, max: 128, softMax: 64 }),
      P.bool('adaptive', true, { group: 'Quality', tooltip: 'Never use more taps than pixels along the blur line.' }),
      P.bool('jitter', true, { group: 'Quality', tooltip: 'Per-pixel offset of the taps; trades banding for fine noise.' }),
      P.enum('placement', 'centered', ['centered', 'forward', 'backward'], { group: 'Shape' }),
      P.enum('falloff', 'box', [{ value: 'box', label: 'Box' }, { value: 'trail', label: 'Trail (linear)' }, { value: 'gaussian', label: 'Gaussian' }], { group: 'Shape' }),
    ],
    gizmos: [{ id: 'angle', label: 'Blur direction', type: 'angle', viewport: '2d', space: 'uv', angle: 'angle' }],
    cost: { gpu: 'medium', tiling: 'halo', halo: (v) => Math.ceil((v.length as number) * 8192) + 2, temporaries: 0 },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 4 }],
    gallery: [
      { name: 'Long streak', params: { length: 0.25, angle: 30, falloff: 'trail', placement: 'backward' } },
      { name: 'Vertical gaussian', params: { angle: 90, length: 0.1, falloff: 'gaussian' } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Directional Blur needs an input');
      const p = ctx.params;
      const ma = ctx.mod('angle');
      const ml = ctx.mod('length');
      const uvIn = ctx.texInput('uv');
      const out = ctx.tex(pinOf(k));
      ctx.pass({
        label: 'directional blur',
        target: out,
        shader: SHADER,
        uniforms: {
          layout: LAYOUT,
          values: {
            angle: (p.num('angle') * Math.PI) / 180,
            length: p.num('length'),
            angle_mod_k: ma.k,
            length_mod_k: ml.k,
            uv_scale: p.num('uv_scale'),
            samples: p.int('samples'),
            placement: p.enumIndex('placement'),
            falloff: p.enumIndex('falloff'),
            adaptive: p.bool('adaptive'),
            jitter: p.bool('jitter'),
            has_uv: !!uvIn,
          },
        },
        textures: [src.tex, ma.tex?.tex ?? null, ml.tex?.tex ?? null, uvIn?.tex ?? null],
        ss: 1,
      });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);
