import { checkMeshLimits, MeshData, STD, type Attribute } from './mesh';
import { quatFromTo, quatNormalize, rng, v3, type V3 } from './math3';

/**
 * Point generators ("Points Shape"). Output is a POINT CLOUD (MeshData with 0 primitives) with the standard point
 * attributes: P, N, orient (local +Z -> N when `align`), pscale, id (int), age (0..1 along the generation order), Cd.
 */
export const POINT_MODES = ['line', 'circle', 'grid', 'sphere', 'surface', 'random'] as const;
export type PointMode = (typeof POINT_MODES)[number];

export interface PointsParams {
  mode: PointMode;
  count: number;
  /** line */
  start: V3;
  end: V3;
  /** circle / sphere / random / grid centre */
  center: V3;
  radius: number;
  /** grid / random box extents */
  size: V3;
  /** circle arc in degrees */
  sweep: number;
  /** grid divisions along x / y (count is ignored for grids) */
  grid: [number, number];
  seed: number;
  pscale: number;
  align: boolean;
  color: [number, number, number, number];
  random_orient: boolean;
}

export const defaultPointsParams = (): PointsParams => ({
  mode: 'circle', count: 16, start: [-1, 0, 0], end: [1, 0, 0], center: [0, 0, 0], radius: 1, size: [2, 2, 0], sweep: 360, grid: [4, 4], seed: 1, pscale: 1, align: true, color: [1, 1, 1, 1], random_orient: false,
});

/** Orientation that sends local +Z to the normal `n`. */
export const orientFromNormal = (n: ArrayLike<number>) => quatFromTo([0, 0, 1], n);

export function makePoints(p: PointsParams, surface?: MeshData): MeshData {
  const mode = p.mode;
  let n = Math.max(1, Math.round(p.count));
  if (mode === 'grid') n = Math.max(1, Math.round(p.grid[0])) * Math.max(1, Math.round(p.grid[1]));
  checkMeshLimits(n, 0, 0, `Points ${mode}`);
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const Q = new Float32Array(n * 4);
  const ID = new Int32Array(n);
  const AGE = new Float32Array(n);
  const PS = new Float32Array(n).fill(p.pscale);
  const CD = new Float32Array(n * 4);
  let UV: Float32Array | null = null;
  const rand = rng(p.seed);
  const age = (i: number): number => (n > 1 ? i / (n - 1) : 0);
  const put = (i: number, pos: ArrayLike<number>, nor: ArrayLike<number>): void => {
    P.set([pos[0], pos[1], pos[2]], i * 3);
    const nn = v3.norm(nor);
    N.set(nn, i * 3);
    ID[i] = i;
    AGE[i] = age(i);
    CD.set(p.color, i * 4);
    let q = p.align ? orientFromNormal(nn) : ([0, 0, 0, 1] as [number, number, number, number]);
    if (p.random_orient) q = quatNormalize([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]);
    Q.set(q, i * 4);
  };
  const [cx, cy, cz] = p.center;
  switch (mode) {
    case 'line':
      for (let i = 0; i < n; i++) put(i, v3.lerp(p.start, p.end, n > 1 ? i / (n - 1) : 0.5), [0, 0, 1]);
      break;
    case 'circle': {
      const sweep = (Math.max(1, Math.min(360, p.sweep)) * Math.PI) / 180;
      const full = p.sweep >= 359.999;
      for (let i = 0; i < n; i++) {
        const a = full ? (sweep * i) / n : n > 1 ? (sweep * i) / (n - 1) : 0;
        put(i, [cx + Math.cos(a) * p.radius, cy + Math.sin(a) * p.radius, cz], [Math.cos(a), Math.sin(a), 0]);
      }
      break;
    }
    case 'grid': {
      const nx = Math.max(1, Math.round(p.grid[0]));
      const ny = Math.max(1, Math.round(p.grid[1]));
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const u = nx > 1 ? i / (nx - 1) - 0.5 : 0;
        const v = ny > 1 ? j / (ny - 1) - 0.5 : 0;
        put(j * nx + i, [cx + u * p.size[0], cy + v * p.size[1], cz], [0, 0, 1]);
      }
      break;
    }
    case 'sphere': {
      // Fibonacci lattice: uniform, deterministic, no seams
      const ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const z = n > 1 ? 1 - (2 * i) / (n - 1) : 1;
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        const a = ga * i;
        const d: V3 = [Math.cos(a) * r, Math.sin(a) * r, z];
        put(i, [cx + d[0] * p.radius, cy + d[1] * p.radius, cz + d[2] * p.radius], d);
      }
      break;
    }
    case 'random':
      for (let i = 0; i < n; i++) put(i, [cx + (rand() - 0.5) * p.size[0], cy + (rand() - 0.5) * p.size[1], cz + (rand() - 0.5) * p.size[2]], [0, 0, 1]);
      break;
    case 'surface': {
      if (!surface || surface.primCount === 0) throw new Error('Surface mode needs a connected mesh with primitives');
      const tri = surface.topology.triangles();
      const nt = tri.verts.length / 3;
      if (nt === 0) throw new Error('The mesh has no triangles to scatter on');
      const vp = surface.topology.vertPoint;
      const S = surface.positions;
      const cum = new Float64Array(nt);
      let total = 0;
      for (let t = 0; t < nt; t++) {
        const a = vp[tri.verts[t * 3]] * 3, b = vp[tri.verts[t * 3 + 1]] * 3, c = vp[tri.verts[t * 3 + 2]] * 3;
        const e1 = [S[b] - S[a], S[b + 1] - S[a + 1], S[b + 2] - S[a + 2]];
        const e2 = [S[c] - S[a], S[c + 1] - S[a + 1], S[c + 2] - S[a + 2]];
        total += 0.5 * v3.len(v3.cross(e1, e2));
        cum[t] = total;
      }
      if (!(total > 0)) throw new Error('The mesh has zero surface area');
      const uvs = surface.resolveToVertex(STD.uv);
      if (uvs && uvs.size === 2) UV = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const r = rand() * total;
        let lo = 0, hi = nt - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] < r) lo = mid + 1;
          else hi = mid;
        }
        const t = lo;
        let u = rand(), v = rand();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        const w = 1 - u - v;
        const va = tri.verts[t * 3], vb = tri.verts[t * 3 + 1], vc = tri.verts[t * 3 + 2];
        const a = vp[va] * 3, b = vp[vb] * 3, c = vp[vc] * 3;
        const pos: V3 = [S[a] * w + S[b] * u + S[c] * v, S[a + 1] * w + S[b + 1] * u + S[c + 1] * v, S[a + 2] * w + S[b + 2] * u + S[c + 2] * v];
        const nor = v3.cross([S[b] - S[a], S[b + 1] - S[a + 1], S[b + 2] - S[a + 2]], [S[c] - S[a], S[c + 1] - S[a + 1], S[c + 2] - S[a + 2]]);
        put(i, pos, nor);
        if (UV && uvs) {
          UV[i * 2] = uvs.data[va * 2] * w + uvs.data[vb * 2] * u + uvs.data[vc * 2] * v;
          UV[i * 2 + 1] = uvs.data[va * 2 + 1] * w + uvs.data[vb * 2 + 1] * u + uvs.data[vc * 2 + 1] * v;
        }
      }
      break;
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
  if (UV) add(STD.uv, 2, UV);
  return m;
}
