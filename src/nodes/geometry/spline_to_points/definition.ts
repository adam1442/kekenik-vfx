import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { meshValue } from '../../../engine/mesh/accounting';
import { splineToPoints } from '../../../engine/spline/to-points';
import { asSplineSet } from '../../../engine/spline/value';

/** geometry.spline_to_points — equal-arc-length points along every spline (feed Copy To Points / Emitter-like scatter). */
export default defineNode({
  id: 'geometry.spline_to_points',
  version: 1,
  category: 'geometry',
  title: 'Spline to Points',
  description: 'Places points at equal arc length along each spline of the input set. Orientation follows the tangent (+Z), `age` runs 0..1 along each spline. 2D splines lie on the XY plane.',
  keywords: ['spline', 'points', 'scatter', 'path', 'resample', 'curve'],
  icon: 'spline',
  inputs: [{ id: 'spline', name: 'Spline', type: 'spline' }],
  outputs: [{ id: 'points', name: 'Points', type: 'points' }],
  common: { texture: false },
  params: [
    P.int('count', 32, { min: 1, max: 100000, softMax: 512, label: 'Count', tooltip: 'Points per spline.' }),
    P.float('pscale', 1, { min: 0, max: 1000, softMax: 4, step: 0.01, label: 'Point scale' }),
    P.bool('align', true, { label: 'Align to tangent', tooltip: 'Orient each point so +Z follows the spline direction.' }),
  ],
  cost: { gpu: 'trivial', tiling: 'global' },
  evaluate(ctx) {
    const src = asSplineSet(ctx.inputs.spline);
    if (!src) throw new Error('Spline to Points needs a Spline input.');
    const p = ctx.params;
    return { points: meshValue(splineToPoints(src, { count: p.int('count'), pscale: p.num('pscale'), align: p.bool('align') }), 'points') };
  },
});
