import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { gaussianAxes } from '../../_shared/blur2';
import { idOf, kindDefines, pinOf, RADIUS_TIP, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';
import tensorSrc from './tensor.wgsl?raw';

/**
 * utils.kuwahara — Anisotropic Kuwahara (painterly). 3 stages: (1) structure tensor (Sobel), (2) gaussian smoothing of the
 * tensor (shared separable blur), (3) 8-sector anisotropic window filter. Window radius is capped at 16 px
 * (cost ~ (2R+1)^2 taps; R = 6 ~ 169 taps ~ 5 ms at 2048^2 estimated).
 */
export const TENSOR_SHADER = defineShader('utils_kuwahara_tensor.wgsl', tensorSrc);
export const SHADER = defineShader('utils_kuwahara.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'radius', type: 'f32' },
  { name: 'alpha', type: 'f32' },
  { name: 'sharpness', type: 'f32' },
]);
export const MAX_RADIUS_PX = 16;

export default variants((k) =>
  defineNode({
    id: idOf('utils.kuwahara', k),
    version: 1,
    category: 'utils',
    title: titleOf('Anisotropic Kuwahara', k),
    description: 'Painterly oil-paint look: flattens regions along edge directions while keeping edges crisp.',
    keywords: ['painterly', 'oil paint', 'kuwahara', 'stylize', 'anisotropic', 'brush'],
    icon: 'filter',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.float('radius', 0.006, { group: 'Brush', min: 0.0005, max: 0.1, softMax: 0.02, step: 0.0005, display: 'percent', animatable: true, tooltip: `${RADIUS_TIP} Capped at ${MAX_RADIUS_PX} px.` }),
      P.float('anisotropy', 1, { group: 'Brush', min: 0.05, max: 4, softMax: 2, step: 0.05, animatable: true, tooltip: 'Low = strongly stretched along edges, high = round window.' }),
      P.float('sharpness', 8, { group: 'Brush', min: 1, max: 32, softMax: 16, step: 0.5, animatable: true, tooltip: 'How strongly the lowest-variance sector wins.' }),
      P.float('smoothing', 0.004, { group: 'Brush', min: 0, max: 0.05, softMax: 0.015, step: 0.0005, display: 'percent', tooltip: 'Smoothing of the direction field.' }),
    ],
    gizmos: [{ id: 'radius', label: 'Brush radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }],
    cost: { gpu: 'high', tiling: 'halo', halo: (v) => Math.min(Math.ceil((v.radius as number) * 8192), MAX_RADIUS_PX) + Math.ceil((v.smoothing as number) * 8192 * 3) + 2, temporaries: 3 },
    shaders: [{ source: TENSOR_SHADER, textures: 1, defines: kindDefines(k) }, { source: SHADER, uniforms: LAYOUT, textures: 2, defines: kindDefines(k) }],
    gallery: [
      { name: 'Broad strokes', params: { radius: 0.012, sharpness: 12 } },
      { name: 'Fine', params: { radius: 0.003, anisotropy: 0.4 } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Anisotropic Kuwahara needs an input');
      const p = ctx.params;
      const side = Math.min(ctx.frame.width, ctx.frame.height);
      const tensor = ctx.tex('color');
      ctx.pass({ label: 'structure tensor', target: tensor, shader: TENSOR_SHADER, defines: kindDefines(k), textures: [src.tex], ss: 1 });
      const sm = p.num('smoothing') * side;
      const smooth = sm > 0.2 ? gaussianAxes(ctx, tensor, 'color', sm, sm) : tensor;
      if (smooth !== tensor) ctx.free(tensor);
      const out = ctx.tex(pinOf(k));
      const radius = Math.min(Math.max(p.num('radius') * side, 1), MAX_RADIUS_PX);
      ctx.pass({
        label: 'anisotropic kuwahara',
        target: out,
        shader: SHADER,
        defines: kindDefines(k),
        uniforms: { layout: LAYOUT, values: { radius, alpha: p.num('anisotropy'), sharpness: p.num('sharpness') } },
        textures: [src.tex, smooth],
        ss: 1,
      });
      ctx.free(smooth);
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);
