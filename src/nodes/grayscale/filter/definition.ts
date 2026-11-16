import { defineNode, type GizmoDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { BLUR_DECL, boxBlur, gaussianBlur } from '../../_shared/blur';
import { MORPH_DECLS, morphRun, type MorphShape } from '../../_shared/morph';
import shaderSrc from './shader.wgsl?raw';

/**
 * grayscale.filter — generic wrap-aware kernels: sharpen, high-pass, emboss, median (3x3 / 5x5), box, gaussian, min, max.
 *  - box / gaussian: separable passes (box beyond 24 px uses the exact strided two-stage decomposition: s+m taps for a
 *    window of s*m; gaussian beyond sigma 20 px is cascaded) — see nodes/_shared/blur.ts.
 *  - min / max: sparse-table line morphology, O(log r) (nodes/_shared/morph.ts).
 *  - median / emboss: exact integer-tap kernels in one pass.
 */
export const SHADER = defineShader('grayscale_filter.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'op', type: 'u32' },
  { name: 'amount', type: 'f32' },
  { name: 'angle', type: 'f32' },
]);
export const MODES = ['sharpen', 'highpass', 'emboss', 'median', 'box', 'gaussian', 'min', 'max'] as const;
const usesRadius = (v: Record<string, unknown>): boolean => ['sharpen', 'highpass', 'box', 'gaussian', 'min', 'max'].includes(v.mode as string);

export const gizmos: GizmoDecl[] = [{ id: 'radius', label: 'Filter radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius', visibleIf: usesRadius }];

export default defineNode({
  id: 'grayscale.filter',
  version: 1,
  category: 'grayscale',
  title: 'Filter',
  description: 'Generic filters: sharpen, high-pass, emboss, median, box blur, gaussian blur, min and max. All kernels wrap when the node tiles.',
  keywords: ['sharpen', 'median', 'emboss', 'high pass', 'highpass', 'box', 'blur', 'gaussian', 'min', 'max', 'denoise', 'unsharp'],
  icon: 'filter',
  inputs: [{ id: 'input', name: 'Input', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  params: [
    P.enum(
      'mode',
      'sharpen',
      [
        { value: 'sharpen', label: 'Sharpen', tooltip: 'Unsharp mask: input + amount * (input - blurred).' },
        { value: 'highpass', label: 'High-pass', tooltip: '0.5 + amount * (input - blurred). Removes low frequencies.' },
        { value: 'emboss', label: 'Emboss' },
        { value: 'median', label: 'Median', tooltip: 'Removes speckles while keeping edges.' },
        { value: 'box', label: 'Box blur' },
        { value: 'gaussian', label: 'Gaussian blur' },
        { value: 'min', label: 'Min' },
        { value: 'max', label: 'Max' },
      ],
      { group: 'Filter' },
    ),
    P.float('radius', 0.006, { group: 'Filter', min: 0, max: 0.3, softMax: 0.05, step: 0.0005, display: 'percent', animatable: true, visibleIf: usesRadius, tooltip: 'Kernel radius as a fraction of the smaller image side (box blur up to 160 px, gaussian sigma = radius / 2).' }),
    P.float('amount', 1, { group: 'Filter', min: -16, max: 16, softMin: 0, softMax: 4, step: 0.01, animatable: true, visibleIf: (v) => ['sharpen', 'highpass', 'emboss'].includes(v.mode as string) }),
    P.float('angle', 45, { group: 'Filter', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true, visibleIf: (v) => v.mode === 'emboss', tooltip: 'Light direction.' }),
    P.enum('median_size', '3x3', [{ value: '3x3', label: '3 x 3' }, { value: '5x5', label: '5 x 5' }], { group: 'Filter', visibleIf: (v) => v.mode === 'median' }),
    P.enum('shape', 'square', [{ value: 'square', label: 'Square' }, { value: 'circle', label: 'Circle' }, { value: 'diamond', label: 'Diamond' }, { value: 'octagon', label: 'Octagon' }], { group: 'Filter', visibleIf: (v) => v.mode === 'min' || v.mode === 'max' }),
  ],
  gizmos,
  cost: { gpu: 'medium', tiling: 'halo', halo: (v) => Math.ceil((v.radius as number) * 8192) + 3, temporaries: 3 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }, BLUR_DECL, ...MORPH_DECLS],
  gallery: [
    { name: 'Emboss', params: { mode: 'emboss', amount: 2 } },
    { name: 'High-pass', params: { mode: 'highpass', radius: 0.02 } },
    { name: 'Median 5x5', params: { mode: 'median', median_size: '5x5' } },
    { name: 'Gaussian', params: { mode: 'gaussian', radius: 0.03 } },
    { name: 'Box blur', params: { mode: 'box', radius: 0.03 } },
    { name: 'Max circle', params: { mode: 'max', shape: 'circle', radius: 0.02 } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Filter needs an input');
    const p = ctx.params;
    const mode = p.str('mode');
    const rPx = p.num('radius') * Math.min(ctx.frame.width, ctx.frame.height);
    if (mode === 'box') return { output: ctx.result(boxBlur(ctx, src.tex, 'gray', rPx), 'gray') };
    if (mode === 'gaussian') return { output: ctx.result(gaussianBlur(ctx, src.tex, 'gray', rPx / 2), 'gray') };
    if (mode === 'min' || mode === 'max') return { output: ctx.result(morphRun(ctx, src.tex, 'gray', p.str('shape') as MorphShape, rPx, mode === 'max'), 'gray') };
    const op = mode === 'sharpen' ? 0 : mode === 'highpass' ? 1 : mode === 'emboss' ? 2 : p.str('median_size') === '5x5' ? 4 : 3;
    const blurred = op <= 1 ? gaussianBlur(ctx, src.tex, 'gray', Math.max(rPx / 2, 0.3)) : null;
    const out = ctx.tex('gray');
    ctx.pass({
      label: `filter ${mode}`,
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { op, amount: p.num('amount'), angle: (p.num('angle') * Math.PI) / 180 } },
      textures: [src.tex, blurred],
      ss: 1,
    });
    return { output: ctx.result(out, 'gray') };
  },
});
