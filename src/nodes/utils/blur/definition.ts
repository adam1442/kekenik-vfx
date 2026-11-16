import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { blurFast, boxAxes, BLUR2_DECLS, gaussianAxes, kawaseBlur } from '../../_shared/blur2';
import { idOf, pinOf, titleOf, variants, RADIUS_TIP } from '../../_shared/variants';
import modSrc from './shader.wgsl?raw';

/**
 * utils.blur / utils.blur_color — Blur with three engines:
 *   gaussian : hybrid PYRAMID gaussian (box downsample -> gaussian -> bicubic up). Cost ~independent of the radius.
 *   box      : exact separable box (strided decomposition for big radii)
 *   kawase   : N x 4 bilinear taps with growing offsets (fastest, approximate gaussian)
 * Radius = fraction of the smaller side (sigma = radius for gaussian/kawase, box half-width = radius). Per-axis radius via
 * the Stretch multiplier. The radius is MODULATABLE: with a Gray `radius mod` input the blur radius varies per pixel
 * (5 gaussian levels sigma = S/16 .. S are interpolated per pixel; documented approximation).
 */
export const MOD_SHADER = defineShader('utils_blur_mod.wgsl', modSrc);
export const MOD_LAYOUT = makeLayout([{ name: 'mod_k', type: 'f32' }]);
const MODES = [
  { value: 'gaussian', label: 'Gaussian (pyramid)', tooltip: 'Large radii cost almost nothing: downsample, blur, upsample.' },
  { value: 'box', label: 'Box' },
  { value: 'kawase', label: 'Kawase (fast)', tooltip: 'Fast approximate gaussian built from bilinear taps.' },
];

export default variants((k) =>
  defineNode({
    id: idOf('utils.blur', k),
    version: 1,
    category: 'utils',
    title: titleOf('Blur', k),
    description: 'Gaussian (pyramid hybrid), box or Kawase blur with per-axis radius and per-pixel radius modulation. Wraps when the node tiles.',
    keywords: ['gaussian', 'box', 'kawase', 'soften', 'smooth', 'defocus', 'blur'],
    icon: 'blur',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.enum('mode', 'gaussian', MODES, { group: 'Blur' }),
      P.float('radius', 0.02, { group: 'Blur', min: 0, max: 0.5, softMax: 0.15, step: 0.0005, display: 'percent', animatable: true, modulatable: true, tooltip: RADIUS_TIP }),
      P.vec2('stretch', [1, 1], { group: 'Blur', label: 'Axis radius', min: 0, max: 16, softMax: 4, step: 0.05, labels: ['X', 'Y'], animatable: true, tooltip: 'Per-axis radius multiplier (X = 1, Y = 0 blurs horizontally only).' }),
    ],
    gizmos: [{ id: 'radius', label: 'Blur radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }],
    cost: { gpu: 'medium', tiling: 'halo', halo: (v) => Math.min(Math.ceil((v.radius as number) * 8192 * 3) + 2, 4096), temporaries: 3 },
    shaders: [...BLUR2_DECLS, { source: MOD_SHADER, uniforms: MOD_LAYOUT, textures: 7 }],
    gallery: [
      { name: 'Box', params: { mode: 'box', radius: 0.03 } },
      { name: 'Kawase', params: { mode: 'kawase', radius: 0.04 } },
      { name: 'Horizontal', params: { stretch: [1, 0], radius: 0.05 } },
      { name: 'Huge', params: { radius: 0.35 } },
    ],
    /** identity short-cut (the evaluator forwards the input, no pass recorded). */
    identity: (v) => (v.radius as number) <= 0 || ((v.stretch as number[])[0] <= 0 && (v.stretch as number[])[1] <= 0),
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Blur needs an input');
      const pin = pinOf(k);
      const p = ctx.params;
      const mode = p.str('mode');
      const side = Math.min(ctx.frame.width, ctx.frame.height);
      const [mx, my] = p.vec2('stretch');
      const r = p.num('radius') * side;
      const mod = ctx.mod('radius');
      const sx = r * mx;
      const sy = r * my;
      const run = (rx: number, ry: number) => (mode === 'box' ? boxAxes(ctx, src.tex, pin, rx, ry) : mode === 'kawase' ? kawaseBlur(ctx, src.tex, pin, rx, ry) : blurFast(ctx, src.tex, pin, rx, ry));
      if (!mod.tex) return { output: ctx.result(run(sx, sy), pin) };
      // Per-pixel radius: 5 gaussian levels (S/16 .. S), interpolated per pixel.
      const levels = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1].map((f) => blurFast(ctx, src.tex, pin, sx * f, sy * f));
      const out = ctx.tex(pin);
      ctx.pass({ label: 'blur radius-mod', target: out, shader: MOD_SHADER, uniforms: { layout: MOD_LAYOUT, values: { mod_k: mod.k } }, textures: [src.tex, ...levels, mod.tex.tex], ss: 1 });
      for (const l of levels) ctx.free(l);
      return { output: ctx.result(out, pin) };
    },
  }),
);
// keep gaussianAxes referenced for tree-shaking-free API symmetry (exported for other nodes)
export { gaussianAxes };
