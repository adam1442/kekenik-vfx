import { BLEND_MODES } from '../../../engine/graph/common-params';
import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.blend (Gray) / utils.blend_color (Color): Foreground + Background + optional Mask, every blend mode of the engine
 * (copy, add, subtract, multiply, divide, screen, overlay, soft / hard light, color dodge / burn, linear light, difference,
 * exclusion, min, max, smooth min / max with Smoothness, hue / saturation / color / luminosity). Alpha is an ordinary
 * channel (blended like R, G, B). Semantics (documented decision): cross mix 0% = background only, 50% = pure blend
 * result, 100% = foreground only; Opacity x Mask fades between the background and that result per pixel.
 * This is the explicit Blend node; it does NOT use the automatic Background pin (the blend IS the node).
 */
export const SHADER = defineShader('utils_blend.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'blend_type', type: 'u32' },
  { name: 'cross_mix', type: 'f32' },
  { name: 'smoothness', type: 'f32' },
  { name: 'opacity', type: 'f32' },
  { name: 'has_fg', type: 'u32' },
  { name: 'has_bg', type: 'u32' },
  { name: 'has_mask', type: 'u32' },
  { name: 'clamp_output', type: 'u32' },
]);

/** CPU reference of the SEPARABLE blend modes (identical formulas to blend.wgsl) for tests. */
export function blendReference(mode: string, bg: number, fg: number, k = 0.1): number {
  const smin = (a: number, b: number): number => (k <= 1e-5 ? Math.min(a, b) : Math.min(a, b) - (Math.max(k - Math.abs(a - b), 0) / k) ** 2 * k * 0.25);
  switch (mode) {
    case 'copy': return fg;
    case 'add': return bg + fg;
    case 'subtract': return bg - fg;
    case 'multiply': return bg * fg;
    case 'max': return Math.max(bg, fg);
    case 'min': return Math.min(bg, fg);
    case 'smooth_min': return smin(bg, fg);
    case 'smooth_max': return -smin(-bg, -fg);
    case 'screen': return 1 - (1 - bg) * (1 - fg);
    case 'overlay': return bg < 0.5 ? 2 * bg * fg : 1 - 2 * (1 - bg) * (1 - fg);
    case 'difference': return Math.abs(bg - fg);
    case 'divide': return bg / Math.max(fg, 1e-4);
    case 'exclusion': return bg + fg - 2 * bg * fg;
    case 'soft_light': return (1 - 2 * fg) * bg * bg + 2 * fg * bg;
    case 'hard_light': return fg <= 0.5 ? 2 * bg * fg : 1 - (1 - bg) * (1 - (2 * fg - 1));
    case 'color_dodge': return Math.min(bg / Math.max(1 - fg, 1e-4), 16);
    case 'color_burn': return 1 - Math.min((1 - bg) / Math.max(fg, 1e-4), 16);
    case 'linear_light': return bg + 2 * fg - 1;
    default: throw new Error(`no scalar reference for blend mode ${mode}`);
  }
}
/** Cross mix of the shader (0 = bg, 0.5 = blend, 1 = fg). */
export function crossReference(bg: number, fg: number, blended: number, cross: number): number {
  const c = Math.min(Math.max(cross, 0), 1);
  return c <= 0.5 ? bg + (blended - bg) * c * 2 : blended + (fg - blended) * (c - 0.5) * 2;
}

export default variants((k) =>
  defineNode({
    id: idOf('utils.blend', k),
    version: 1,
    category: 'utils',
    title: titleOf('Blend', k),
    description: 'Blends a Foreground over a Background using a blend mode. Optional Mask and Opacity limit the effect per pixel.',
    keywords: ['mix', 'composite', 'add', 'multiply', 'screen', 'overlay', 'layer', 'soft light', 'dodge', 'burn', 'hue', 'luminosity'],
    icon: 'blend',
    inputs: [
      { id: 'foreground', name: 'Foreground', type: pinOf(k), optional: true },
      { id: 'background', name: 'Background', type: pinOf(k), optional: true },
      { id: 'mask', name: 'Mask', type: 'gray', optional: true, role: 'mask' },
    ],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.enum('blend_type', 'add', BLEND_MODES, { label: 'Blend type' }),
      P.float('cross_mix', 0.5, { label: 'Cross mix', display: 'percent', min: 0, max: 1, step: 0.01, animatable: true, tooltip: '0% = background only, 50% = even, 100% = foreground only.' }),
      P.float('smoothness', 0.1, { min: 0, max: 1, step: 0.01, visibleIf: (v) => v.blend_type === 'smooth_min' || v.blend_type === 'smooth_max' }),
      P.float('opacity', 1, { display: 'percent', min: 0, max: 1, step: 0.01, animatable: true, tooltip: 'Final opacity (multiplied with the Mask).' }),
      P.bool('clamp_output', false, { label: 'Clamp 0..1' }),
    ],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 3, defines: { GRAY: k === 'gray' ? 1 : 0 } }],
    gallery: [
      { name: 'Multiply', params: { blend_type: 'multiply' } },
      { name: 'Screen', params: { blend_type: 'screen' } },
      { name: 'Overlay', params: { blend_type: 'overlay' } },
      { name: 'Difference', params: { blend_type: 'difference' } },
    ],
    evaluate(ctx) {
      const fg = ctx.texInput('foreground');
      const bg = ctx.texInput('background');
      const mask = ctx.texInput('mask');
      const p = ctx.params;
      const out = ctx.tex(pinOf(k));
      ctx.pass({
        label: 'blend',
        target: out,
        shader: SHADER,
        defines: { GRAY: k === 'gray' ? 1 : 0 },
        uniforms: {
          layout: LAYOUT,
          values: { blend_type: p.enumIndex('blend_type'), cross_mix: p.num('cross_mix'), smoothness: p.num('smoothness'), opacity: p.num('opacity'), has_fg: !!fg, has_bg: !!bg, has_mask: !!mask, clamp_output: p.bool('clamp_output') },
        },
        textures: [fg?.tex ?? null, bg?.tex ?? null, mask?.tex ?? null],
        ss: 1,
      });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);
