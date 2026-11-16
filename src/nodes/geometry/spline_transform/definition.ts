import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { transformSpline } from '../../../engine/spline/ops';
import { asSplineSet, splineValue } from '../../../engine/spline/value';

/** geometry.spline_transform — move / rotate / scale every spline of a set about a pivot (UV space). */
export default defineNode({
  id: 'geometry.spline_transform',
  version: 1,
  category: 'geometry',
  title: 'Spline Transform',
  description: 'Translates, rotates and scales all splines of the input about a pivot. Handles are transformed with the points.',
  keywords: ['spline', 'transform', 'move', 'rotate', 'scale', 'path', 'profile'],
  icon: 'spline',
  inputs: [{ id: 'spline', name: 'Spline', type: 'spline' }],
  outputs: [{ id: 'spline', name: 'Spline', type: 'spline' }],
  common: { texture: false },
  params: [
    P.vec2('translate', [0, 0], { step: 0.005, softMin: -1, softMax: 1, animatable: true }),
    P.float('rotation', 0, { min: -3600, max: 3600, softMin: -180, softMax: 180, unit: '°', step: 1, animatable: true }),
    P.vec2('scale', [1, 1], { step: 0.01, softMin: -4, softMax: 4, animatable: true }),
    P.vec2('pivot', [0.5, 0.5], { step: 0.01, softMin: 0, softMax: 1 }),
  ],
  gizmos: [{ id: 'move', label: 'Translate', type: 'point', viewport: '2d', space: 'uv', param: 'pivot' }],
  cost: { gpu: 'trivial', tiling: 'global' },
  evaluate(ctx) {
    const src = asSplineSet(ctx.inputs.spline);
    if (!src) throw new Error('Spline Transform needs a Spline input.');
    const p = ctx.params;
    const t = p.vec2('translate');
    const s = p.vec2('scale');
    const pv = p.vec2('pivot');
    const rot = (p.num('rotation') * Math.PI) / 180;
    return { spline: splineValue({ splines: src.splines.map((sp) => transformSpline(sp, { tx: t[0], ty: t[1], rot, sx: s[0], sy: s[1], pivot: [pv[0], pv[1]] })) }) };
  },
});
