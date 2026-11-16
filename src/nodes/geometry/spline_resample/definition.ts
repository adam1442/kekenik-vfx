import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { offsetSpline, resample, smooth } from '../../../engine/spline/ops';
import { asSplineSet, splineValue } from '../../../engine/spline/value';

/** geometry.spline_resample — resample (equal arc length), smooth or offset every spline of a set. */
export default defineNode({
  id: 'geometry.spline_resample',
  version: 1,
  category: 'geometry',
  title: 'Spline Resample',
  description: 'Resamples the splines to a fixed point count (equal arc length), smooths them (neighbour averaging) or offsets them sideways.',
  keywords: ['spline', 'resample', 'smooth', 'offset', 'simplify', 'path'],
  icon: 'spline',
  inputs: [{ id: 'spline', name: 'Spline', type: 'spline' }],
  outputs: [{ id: 'spline', name: 'Spline', type: 'spline' }],
  common: { texture: false },
  params: [
    P.enum('mode', 'resample', [{ value: 'resample', label: 'Resample' }, { value: 'smooth', label: 'Smooth' }, { value: 'offset', label: 'Offset' }]),
    P.int('count', 16, { min: 2, max: 2048, softMax: 128, label: 'Points', visibleIf: (v) => v.mode === 'resample' || v.mode === 'offset' }),
    P.int('iterations', 2, { min: 1, max: 32, visibleIf: (v) => v.mode === 'smooth' }),
    P.float('distance', 0.03, { min: -1, max: 1, step: 0.002, animatable: true, visibleIf: (v) => v.mode === 'offset' }),
  ],
  cost: { gpu: 'trivial', tiling: 'global' },
  evaluate(ctx) {
    const src = asSplineSet(ctx.inputs.spline);
    if (!src) throw new Error('Spline Resample needs a Spline input.');
    const p = ctx.params;
    const mode = p.str('mode');
    const out = src.splines.map((sp) => (mode === 'smooth' ? smooth(sp, p.int('iterations')) : mode === 'offset' ? offsetSpline(sp, p.num('distance'), p.int('count')) : resample(sp, p.int('count'))));
    return { spline: splineValue({ splines: out }) };
  },
});
