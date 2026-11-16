import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { BLUR2_DECLS, blurFast } from '../../_shared/blur2';
import { uvInParam, uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_blur_convert.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'from_mode', type: 'u32' },
  { name: 'to_mode', type: 'u32' },
]);

/** uv.blur — smooths a UV field (gaussian pyramid hybrid on the DELTAS, wrap aware). */
export default defineNode({
  id: 'uv.blur',
  version: 1,
  category: 'uv',
  title: 'UV Blur',
  description: 'Smooths a UV field. The blur runs on the warp offsets, so identity regions stay exactly neutral; use it to soften noisy or painted flowmaps.',
  keywords: ['uv', 'blur', 'smooth', 'soften', 'flowmap', 'warp'],
  icon: 'blur',
  inputs: [{ id: 'input', name: 'UV', type: 'uv' }],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [P.float('radius', 0.02, { group: 'Blur', min: 0, max: 0.5, softMax: 0.1, step: 0.001, display: 'percent', animatable: true, tooltip: 'Gaussian sigma x 2 as a fraction of the smaller side.' }), uvInParam(), uvOutParam()],
  common: { texture: true, blending: false },
  gizmos: [{ id: 'radius', label: 'Radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }],
  cost: { gpu: 'medium', tiling: 'global', temporaries: 3 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }, ...BLUR2_DECLS],
  gallery: [{ name: 'Heavy smooth', params: { radius: 0.1 } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('UV Blur needs a UV input');
    const p = ctx.params;
    const inMode = uvModeIndex(p.str('uv_in'));
    const outMode = uvModeIndex(p.str('uv_out'));
    const delta = ctx.tex('uv', src.width, src.height);
    ctx.pass({ label: 'uv to offset', target: delta, shader: SHADER, uniforms: { layout: LAYOUT, values: { from_mode: inMode, to_mode: 1 } }, textures: [src.tex], ss: 1 });
    const sigma = (p.num('radius') * Math.min(src.width, src.height)) / 2;
    const blurred = sigma < 0.05 ? delta : blurFast(ctx, delta, 'uv', sigma, sigma);
    const out = ctx.tex('uv');
    ctx.pass({ label: 'uv from offset', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { from_mode: 1, to_mode: outMode } }, textures: [blurred], ss: 1 });
    if (blurred !== delta) ctx.free(blurred);
    ctx.free(delta);
    return { output: ctx.result(out, 'uv') };
  },
});
