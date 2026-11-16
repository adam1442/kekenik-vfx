/**
 * Spline -> point cloud. PURE. Points are placed at equal arc length along each spline of the set; the orientation
 * quaternion sends +Z to the local tangent, `age` runs 0..1 along each spline. 2D (UV) splines are lifted to the XY plane exactly like
 * Sweep does (`liftTo3D`); splines that already carry `attrs.z` are treated as world-space 3D paths.
 */
import { MeshData, STD, checkMeshLimits, type Attribute } from '../mesh/mesh';
import { v3, type V3 } from '../mesh/math3';
import { orientFromNormal } from '../mesh/points';
import type { SplineValue } from '../params/schema';
import { sampleSpline3 } from '../../gizmos3d/models';
import type { SplineSet } from './ops';
import { liftTo3D } from './ops';

const is3D = (sp: SplineValue): boolean => sp.points.some((q) => q.attrs && 'z' in q.attrs);

/** Equal-arc-length samples (position + unit tangent) of a 3D spline. */
export function samplePath3(sp: SplineValue, count: number, perSeg = 24): { pos: V3[]; tan: V3[] } {
  const s3 = is3D(sp) ? sp : liftTo3D(sp);
  const dense = sampleSpline3(s3.points, !!s3.closed, perSeg);
  if (dense.length < 2 || count < 1) return { pos: dense.slice(0, count), tan: dense.slice(0, count).map(() => [0, 0, 1] as V3) };
  const cum: number[] = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + v3.len(v3.sub(dense[i], dense[i - 1])));
  const total = cum[cum.length - 1];
  const pos: V3[] = [];
  const tan: V3[] = [];
  const closed = !!s3.closed;
  // closed splines: do not duplicate the start point at the end
  const steps = closed ? count : Math.max(1, count - 1);
  let k = 0;
  for (let i = 0; i < count; i++) {
    const target = total > 0 ? (i / steps) * total : 0;
    while (k < dense.length - 2 && cum[k + 1] < target) k++;
    const span = cum[k + 1] - cum[k];
    const f = span > 1e-12 ? Math.min(1, Math.max(0, (target - cum[k]) / span)) : 0;
    pos.push(v3.lerp(dense[k], dense[k + 1], f));
    const d = v3.sub(dense[k + 1], dense[k]);
    tan.push(v3.len(d) > 1e-12 ? v3.norm(d) : ([0, 0, 1] as V3));
  }
  return { pos, tan };
}

export interface SplineToPointsParams {
  /** Points per spline. */
  count: number;
  pscale: number;
  align: boolean;
}

export function splineToPoints(set: SplineSet, p: SplineToPointsParams): MeshData {
  const count = Math.max(1, Math.round(p.count));
  const splines = set.splines.filter((s) => s.points.length >= 2);
  if (!splines.length) throw new Error('Spline to Points needs a spline with at least 2 points.');
  const n = count * splines.length;
  checkMeshLimits(n, 0, 0, 'Spline to Points');
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Q = new Float32Array(n * 4), ID = new Int32Array(n), AGE = new Float32Array(n), PS = new Float32Array(n).fill(p.pscale), CD = new Float32Array(n * 4).fill(1);
  let o = 0;
  for (const sp of splines) {
    const { pos, tan } = samplePath3(sp, count);
    for (let i = 0; i < count; i++, o++) {
      P.set(pos[i], o * 3);
      N.set(tan[i], o * 3);
      Q.set(p.align ? orientFromNormal(tan[i]) : [0, 0, 0, 1], o * 4);
      ID[o] = o;
      AGE[o] = count > 1 ? i / (count - 1) : 0;
    }
  }
  const m = MeshData.fromPositions(P);
  const add = (name: string, size: 1 | 2 | 3 | 4, data: Attribute['data'], kind: 'f32' | 'i32' = 'f32'): void => {
    m.setAttr({ name, element: 'point', size, kind, data });
  };
  add(STD.N, 3, N);
  add(STD.orient, 4, Q);
  add(STD.pscale, 1, PS);
  add(STD.id, 1, ID, 'i32');
  add(STD.age, 1, AGE);
  add(STD.Cd, 4, CD);
  return m;
}
