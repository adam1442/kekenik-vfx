import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import type { TexturePin } from '../../../engine/types';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.softblend — height-aware blend (like a soft "which layer is on top" test): the foreground wins where its height is
 * above the background height, with a soft transition of `Softness`. Outputs the blended image and the blended height.
 */
export const SHADER = defineShader('utils_softblend.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'softness', type: 'f32' },
  { name: 'offset', type: 'f32' },
  { name: 'opacity', type: 'f32' },
  { name: 'has_fh', type: 'u32' },
  { name: 'has_bh', type: 'u32' },
  { name: 'has_mask', type: 'u32' },
  { name: 'want_height', type: 'u32' },
]);
/** CPU reference of the blend weight. */
export function softblendWeight(fh: number, bh: number, softness: number, offset = 0): number {
  const t = Math.min(Math.max((fh + offset - bh + softness) / (2 * Math.max(softness, 1e-5)), 0), 1);
  return t * t * (3 - 2 * t);
}

export default variants((k) =>
  defineNode({
    id: idOf('utils.softblend', k),
    version: 1,
    category: 'utils',
    title: titleOf('Softblend', k),
    description: 'Height-aware blend: the layer with the higher height wins, softly. Also outputs the blended height.',
    keywords: ['height blend', 'soft blend', 'layer', 'terrain blend', 'depth blend'],
    icon: 'blend',
    inputs: [
      { id: 'foreground', name: 'Foreground', type: pinOf(k) },
      { id: 'background', name: 'Background', type: pinOf(k) },
      { id: 'foreground_height', name: 'Foreground height', type: 'gray', optional: true },
      { id: 'background_height', name: 'Background height', type: 'gray', optional: true },
      { id: 'mask', name: 'Mask', type: 'gray', optional: true, role: 'mask' },
    ],
    outputs: [
      { id: 'output', name: 'Output', type: pinOf(k) },
      { id: 'height', name: 'Height', type: 'gray' },
    ],
    params: [
      P.float('softness', 0.1, { group: 'Blend', min: 0, max: 4, softMax: 1, step: 0.005, animatable: true }),
      P.float('offset', 0, { group: 'Blend', label: 'Foreground height offset', min: -16, max: 16, softMin: -1, softMax: 1, step: 0.005, animatable: true, tooltip: 'Raises / lowers the foreground (positive = foreground wins more often).' }),
      P.float('opacity', 1, { group: 'Blend', display: 'percent', min: 0, max: 1, step: 0.01, animatable: true }),
    ],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 5 }],
    gallery: [{ name: 'Hard', params: { softness: 0.01 } }, { name: 'Raised', params: { offset: 0.3 } }],
    evaluate(ctx) {
      const fg = ctx.texInput('foreground');
      const bg = ctx.texInput('background');
      if (!fg || !bg) throw new Error('Softblend needs Foreground and Background');
      const fh = ctx.texInput('foreground_height');
      const bh = ctx.texInput('background_height');
      const mask = ctx.texInput('mask');
      const p = ctx.params;
      const draw = (pin: TexturePin, wantHeight: boolean) => {
        const t = ctx.tex(pin);
        ctx.pass({
          label: wantHeight ? 'softblend height' : 'softblend',
          target: t,
          shader: SHADER,
          uniforms: { layout: LAYOUT, values: { softness: p.num('softness'), offset: p.num('offset'), opacity: p.num('opacity'), has_fh: !!fh, has_bh: !!bh, has_mask: !!mask, want_height: wantHeight } },
          textures: [fg.tex, bg.tex, fh?.tex ?? null, bh?.tex ?? null, mask?.tex ?? null],
          ss: 1,
        });
        return ctx.result(t, pin);
      };
      return { output: draw(pinOf(k), false), height: draw('gray', true) };
    },
  }),
);
