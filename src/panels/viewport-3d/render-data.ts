import { computeIslands, primNormal } from '../../engine/mesh/builder';
import { STD, type MeshData } from '../../engine/mesh/mesh';

/**
 * CPU render data derived from a MeshData (pure; no three.js, unit-tested). Everything is PER VERTEX (the mesh vertex is the
 * render vertex): positions come through vertPoint, normals prefer vertex N, then point N, then flat face normals.
 */
export interface RenderArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** RGBA per vertex when the mesh has Cd, else null. */
  colors: Float32Array | null;
  /** Triangle list of VERTEX indices. */
  indices: Uint32Array;
  vertexCount: number;
  triCount: number;
}

export function renderArrays(mesh: MeshData, uvSet = 0): RenderArrays {
  const nv = mesh.vertexCount;
  const P = mesh.positions;
  const vp = mesh.topology.vertPoint;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = P[vp[i] * 3];
    positions[i * 3 + 1] = P[vp[i] * 3 + 1];
    positions[i * 3 + 2] = P[vp[i] * 3 + 2];
  }
  const tri = mesh.topology.triangles();
  let normals: Float32Array;
  const rn = mesh.resolveToVertex(STD.N);
  if (rn && rn.size === 3) normals = rn.data;
  else {
    normals = new Float32Array(nv * 3);
    const ps = mesh.topology.primStart;
    for (let p = 0; p < mesh.primCount; p++) {
      const n = primNormal(P, vp, ps[p], ps[p + 1]);
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      for (let k = ps[p]; k < ps[p + 1]; k++) {
        normals[k * 3] = n[0] / l;
        normals[k * 3 + 1] = n[1] / l;
        normals[k * 3 + 2] = n[2] / l;
      }
    }
  }
  const ru = mesh.resolveToVertex(uvSet <= 0 ? STD.uv : `uv${uvSet}`);
  const uvs = ru && ru.size === 2 ? ru.data : new Float32Array(nv * 2);
  const rc = mesh.resolveToVertex(STD.Cd);
  let colors: Float32Array | null = null;
  if (rc) {
    colors = new Float32Array(nv * 4);
    for (let i = 0; i < nv; i++) for (let c = 0; c < 4; c++) colors[i * 4 + c] = c < rc.size ? rc.data[i * rc.size + c] : c === 3 ? 1 : rc.data[i * rc.size + (rc.size - 1)];
  }
  return { positions, normals, uvs, colors, indices: tri.verts, vertexCount: nv, triCount: tri.verts.length / 3 };
}

/** Edge list as a flat position array (pairs of xyz) from the unique n-gon edges. */
export function edgePositions(mesh: MeshData): Float32Array {
  const e = mesh.topology.edges();
  const P = mesh.positions;
  const out = new Float32Array(e.length * 3);
  for (let i = 0; i < e.length; i++) {
    out[i * 3] = P[e[i] * 3];
    out[i * 3 + 1] = P[e[i] * 3 + 1];
    out[i * 3 + 2] = P[e[i] * 3 + 2];
  }
  return out;
}

/** Vertex colours (RGB per vertex) that show one channel of Cd: 'rgb' | 'r' | 'g' | 'b' | 'a'. Missing Cd = white. */
export function vertexColorChannel(ra: RenderArrays, channel: 'rgb' | 'r' | 'g' | 'b' | 'a'): Float32Array {
  const out = new Float32Array(ra.vertexCount * 3);
  for (let i = 0; i < ra.vertexCount; i++) {
    const c = ra.colors ? [ra.colors[i * 4], ra.colors[i * 4 + 1], ra.colors[i * 4 + 2], ra.colors[i * 4 + 3]] : [1, 1, 1, 1];
    if (channel === 'rgb') out.set([c[0], c[1], c[2]], i * 3);
    else {
      const v = c['rgba'.indexOf(channel)];
      out.set([v, v, v], i * 3);
    }
  }
  return out;
}
export const normalColors = (ra: RenderArrays): Float32Array => {
  const out = new Float32Array(ra.vertexCount * 3);
  for (let i = 0; i < out.length; i++) out[i] = ra.normals[i] * 0.5 + 0.5;
  return out;
};
const hashColor = (id: number): [number, number, number] => {
  let h = (id * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  const hue = (h % 360) / 360, s = 0.55 + ((h >>> 9) % 40) / 100, v = 0.7 + ((h >>> 17) % 30) / 100;
  const k = (n: number): number => {
    const x = (n + hue * 6) % 6;
    return v - v * s * Math.max(0, Math.min(1, Math.min(x, 4 - x)));
  };
  return [k(5), k(3), k(1)];
};
/** Island id colours per vertex (uses the `island` primitive attribute when present, else connected components). */
export function islandColors(mesh: MeshData): { colors: Float32Array; count: number } {
  const ia = mesh.attr('primitive', STD.island);
  let ids: ArrayLike<number>;
  let count: number;
  if (ia && ia.size === 1) {
    ids = ia.data;
    count = new Set(Array.from(ia.data)).size;
  } else {
    const r = computeIslands(mesh);
    ids = r.ids;
    count = r.count;
  }
  const out = new Float32Array(mesh.vertexCount * 3);
  const ps = mesh.topology.primStart;
  for (let p = 0; p < mesh.primCount; p++) {
    const c = hashColor(ids[p]);
    for (let k = ps[p]; k < ps[p + 1]; k++) out.set(c, k * 3);
  }
  return { colors: out, count };
}

/**
 * Bad triangles: non-finite positions, (near) zero area, or UV-degenerate while the mesh has UVs. Returns the triangle indices
 * (of mesh.topology.triangles()) plus a de-indexed position array of just those triangles for the highlight overlay.
 */
export function badTriangles(mesh: MeshData, ra: RenderArrays): { tris: number[]; positions: Float32Array; reasons: { nonFinite: number; zeroArea: number; zeroUv: number } } {
  const tris: number[] = [];
  const reasons = { nonFinite: 0, zeroArea: 0, zeroUv: 0 };
  const b = mesh.bounds();
  const eps = Math.max(1e-14, (b.radius * 1e-5) ** 2);
  const hasUv = mesh.resolveToVertex(STD.uv) !== null;
  const I = ra.indices, P = ra.positions, U = ra.uvs;
  for (let t = 0; t < ra.triCount; t++) {
    const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
    const fin = Number.isFinite(P[a] + P[a + 1] + P[a + 2] + P[c] + P[c + 1] + P[c + 2] + P[d] + P[d + 1] + P[d + 2]);
    let bad = false;
    if (!fin) {
      reasons.nonFinite++;
      bad = true;
    } else {
      const e1x = P[c] - P[a], e1y = P[c + 1] - P[a + 1], e1z = P[c + 2] - P[a + 2], e2x = P[d] - P[a], e2y = P[d + 1] - P[a + 1], e2z = P[d + 2] - P[a + 2];
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
      if ((cx * cx + cy * cy + cz * cz) * 0.25 <= eps * eps) {
        reasons.zeroArea++;
        bad = true;
      } else if (hasUv) {
        const ua = I[t * 3] * 2, ub = I[t * 3 + 1] * 2, uc = I[t * 3 + 2] * 2;
        const area2 = (U[ub] - U[ua]) * (U[uc + 1] - U[ua + 1]) - (U[uc] - U[ua]) * (U[ub + 1] - U[ua + 1]);
        if (Math.abs(area2) < 1e-12) {
          reasons.zeroUv++;
          bad = true;
        }
      }
    }
    if (bad) tris.push(t);
  }
  const positions = new Float32Array(Math.min(tris.length, 200_000) * 9);
  for (let k = 0; k < positions.length / 9; k++) for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) positions[k * 9 + v * 3 + c] = Number.isFinite(P[I[tris[k] * 3 + v] * 3 + c]) ? P[I[tris[k] * 3 + v] * 3 + c] : 0;
  return { tris, positions, reasons };
}

/** Normal visualisation lines: (position, position + n * len) for at most `max` vertices (strided). */
export function normalLines(ra: RenderArrays, len: number, max = 40_000): Float32Array {
  const stride = Math.max(1, Math.ceil(ra.vertexCount / max));
  const n = Math.ceil(ra.vertexCount / stride);
  const out = new Float32Array(n * 6);
  let o = 0;
  for (let i = 0; i < ra.vertexCount; i += stride) {
    for (let c = 0; c < 3; c++) {
      out[o + c] = ra.positions[i * 3 + c];
      out[o + 3 + c] = ra.positions[i * 3 + c] + ra.normals[i * 3 + c] * len;
    }
    o += 6;
  }
  return out;
}

/** Small "cross" markers for point / vertex display (WebGPU points are 1 px): 3 axis-aligned segments per point. */
export function crossMarkers(positions: Float32Array, count: number, size: number, max = 60_000): Float32Array {
  const stride = Math.max(1, Math.ceil(count / max));
  const n = Math.ceil(count / stride);
  const out = new Float32Array(n * 18);
  let o = 0;
  for (let i = 0; i < count; i += stride) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    out.set([x - size, y, z, x + size, y, z, x, y - size, z, x, y + size, z, x, y, z - size, x, y, z + size], o);
    o += 18;
  }
  return out;
}
