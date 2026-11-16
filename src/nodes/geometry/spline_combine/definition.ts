import { defineNode } from '../../../engine/graph/node';
import { cloneSet } from '../../../engine/spline/ops';
import { asSplineSet, splineValue } from '../../../engine/spline/value';

/** geometry.spline_combine — concatenates the splines of up to four inputs into one set (multiple loops / strokes). */
export default defineNode({
  id: 'geometry.spline_combine',
  version: 1,
  category: 'geometry',
  title: 'Spline Combine',
  description: 'Merges up to four spline inputs into one set. A Sweep with a multi-spline Profile builds one loop per spline.',
  keywords: ['spline', 'combine', 'merge', 'join', 'loops'],
  icon: 'spline',
  inputs: [
    { id: 'a', name: 'A', type: 'spline' },
    { id: 'b', name: 'B', type: 'spline', optional: true },
    { id: 'c', name: 'C', type: 'spline', optional: true },
    { id: 'd', name: 'D', type: 'spline', optional: true },
  ],
  outputs: [{ id: 'spline', name: 'Spline', type: 'spline' }],
  common: { texture: false },
  params: [],
  cost: { gpu: 'trivial', tiling: 'global' },
  evaluate(ctx) {
    const sets = ['a', 'b', 'c', 'd'].map((k) => asSplineSet(ctx.inputs[k])).filter((s): s is NonNullable<typeof s> => !!s);
    if (!sets.length) throw new Error('Spline Combine needs at least one Spline input.');
    return { spline: splineValue({ splines: sets.flatMap((s) => cloneSet(s).splines) }) };
  },
});
