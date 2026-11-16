import type { SplineValue } from '../../../engine/params/schema';
import { P } from '../../../engine/params/schema';
import { presetSpline, toPolyline } from '../../../engine/spline/ops';
import { asSplineSet } from '../../../engine/spline/value';
import { shaderNode } from '../../_shared/shadernode';
import { FALLOFF_OPTIONS } from '../_falloff';
import src from './shader.wgsl?raw';

export const MAX_SPLINE_POINTS = 96;

/** Flattened first spline as a vec4 table (x, y, 0, 0) + count + closed flag (pure; tested). */
export function splineTable(sp: SplineValue | undefined): { pts: Float32Array; count: number; closed: number } {
  const pts = new Float32Array(MAX_SPLINE_POINTS * 4);
  if (!sp || sp.points.length < 2) return { pts, count: 0, closed: 0 };
  const poly = toPolyline(sp, 8);
  const n = Math.min(poly.length, MAX_SPLINE_POINTS);
  for (let i = 0; i < n; i++) {
    const src = poly.length <= MAX_SPLINE_POINTS ? i : Math.round((i * (poly.length - 1)) / (n - 1));
    pts[i * 4] = poly[src][0];
    pts[i * 4 + 1] = poly[src][1];
  }
  return { pts, count: n, closed: sp.closed ? 1 : 0 };
}

/** vector.spline: flow along / across a spline (Spline pin or the internal spline edited with the spline gizmo). */
export default shaderNode({
  id: 'vector.spline',
  title: 'Vector Spline',
  description: 'Flow along and around a spline: tangent flow, attraction towards (or away from) the curve and shear on its two sides, with width and falloff. Uses the Spline input or the spline gizmo.',
  keywords: ['vector', 'spline', 'path', 'curve', 'flow', 'river', 'along', 'attract', 'shear'],
  inputs: [{ id: 'spline_in', name: 'Spline', type: 'spline', tooltip: 'Optional Spline input (its first spline is used instead of the internal one).' }],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  vecScale: 1,
  extraFields: [{ name: 'pts', type: 'vec4f', count: MAX_SPLINE_POINTS }, { name: 'npts', type: 'u32' }, { name: 'closed', type: 'u32' }],
  extra: (ctx) => {
    const set = asSplineSet(ctx.inputs.spline_in);
    const t = splineTable(set?.splines[0] ?? (ctx.params.values.spline as SplineValue));
    return { pts: t.pts, npts: t.count, closed: t.closed };
  },
  params: [
    P.spline('spline', presetSpline('s_curve'), { group: 'Spline', label: 'Spline', minPoints: 2, tooltip: 'Edited with the spline gizmo in a 2D viewport.' }),
    P.float('width', 0.15, { group: 'Field', label: 'Width', min: 0.002, max: 2, softMax: 0.5, step: 0.002, animatable: true, tooltip: 'Distance from the curve where the flow fades out (fraction of the smaller side).' }),
    P.enum('falloff', 'smooth', FALLOFF_OPTIONS, { group: 'Field', label: 'Falloff' }),
    P.float('along', 0.4, { group: 'Field', label: 'Flow along', min: -100, max: 100, softMin: -2, softMax: 2, step: 0.01, animatable: true, unit: 'tile/s' }),
    P.float('attract', 0, { group: 'Field', label: 'Attract / repel', min: -100, max: 100, softMin: -2, softMax: 2, step: 0.01, animatable: true, tooltip: 'Positive = towards the curve, negative = away.' }),
    P.float('shear', 0, { group: 'Field', label: 'Shear (around)', min: -100, max: 100, softMin: -2, softMax: 2, step: 0.01, animatable: true, tooltip: 'Flow along the curve with opposite signs on its two sides (rotation around it).' }),
  ],
  gizmos: [{ id: 'path', label: 'Spline', type: 'path', viewport: '2d', space: 'uv', param: 'spline' }],
  gallery: [{ name: 'River', params: { along: 0.5, width: 0.12 } }, { name: 'Suction', params: { along: 0.1, attract: 0.8 } }, { name: 'Shear flow', params: { along: 0, shear: 0.6 } }],
  shader: src,
});
