import { defineNode, type GizmoDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { MORPH_DECLS, morphRun, type MorphShape } from '../../_shared/morph';

/**
 * grayscale.dilate — morphological grow / shrink (+ open / close) of a Gray image with a flat structuring element.
 * Radius is a fraction of the SMALLER image side, so previews and exports look the same at every resolution.
 * Algorithm (sparse-table line morphology, O(log r) per pixel, wrap-aware): see nodes/_shared/morph.ts.
 */
export const OPERATIONS = ['grow', 'shrink', 'open', 'close'] as const;
export const SHAPES = ['circle', 'square', 'diamond', 'octagon'] as const;

export const gizmos: GizmoDecl[] = [{ id: 'radius', label: 'Dilate radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }];

export default defineNode({
  id: 'grayscale.dilate',
  version: 1,
  category: 'grayscale',
  title: 'Dilate',
  description: 'Morphological grow (max) / shrink (min) with a circle, square, diamond or octagon of any radius; open and close remove small bright / dark features. Tiling-aware.',
  keywords: ['grow', 'shrink', 'erode', 'expand', 'morphology', 'min', 'max', 'open', 'close', 'thicken'],
  icon: 'filter',
  inputs: [{ id: 'input', name: 'Input', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  params: [
    P.enum('operation', 'grow', [{ value: 'grow', label: 'Grow (dilate)' }, { value: 'shrink', label: 'Shrink (erode)' }, { value: 'open', label: 'Open' }, { value: 'close', label: 'Close' }], { group: 'Morphology', label: 'Operation' }),
    P.enum('shape', 'circle', SHAPES.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })), { group: 'Morphology', tooltip: 'Structuring element. Circle is a 16-gon (max error ~2%), exact below 6 px.' }),
    P.float('radius', 0.02, { group: 'Morphology', min: 0, max: 0.5, softMax: 0.15, step: 0.001, display: 'percent', animatable: true, tooltip: 'Radius as a fraction of the smaller image side.' }),
  ],
  gizmos,
  cost: { gpu: 'medium', tiling: 'halo', halo: (v) => Math.ceil((v.radius as number) * 8192 * 2) + 2, temporaries: 3 },
  shaders: MORPH_DECLS,
  gallery: [
    { name: 'Shrink', params: { operation: 'shrink', radius: 0.03 } },
    { name: 'Square grow', params: { shape: 'square', radius: 0.04 } },
    { name: 'Open', params: { operation: 'open', radius: 0.03 } },
    { name: 'Close', params: { operation: 'close', radius: 0.04, shape: 'octagon' } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Dilate needs an input');
    const p = ctx.params;
    const rPx = p.num('radius') * Math.min(ctx.frame.width, ctx.frame.height);
    const shape = p.str('shape') as MorphShape;
    const op = p.str('operation');
    let tex = src.tex;
    if (op === 'grow') tex = morphRun(ctx, tex, 'gray', shape, rPx, true);
    else if (op === 'shrink') tex = morphRun(ctx, tex, 'gray', shape, rPx, false);
    else if (op === 'open') tex = morphRun(ctx, morphRun(ctx, tex, 'gray', shape, rPx, false), 'gray', shape, rPx, true);
    else tex = morphRun(ctx, morphRun(ctx, tex, 'gray', shape, rPx, true), 'gray', shape, rPx, false);
    return { output: ctx.result(tex, 'gray') };
  },
});
