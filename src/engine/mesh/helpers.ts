import { MeshBuilder, promoteAttr } from './builder';
import { checkMeshLimits, MeshData, STD, Topology, type Attribute, type AttrData, type Element } from './mesh';

/* ------------------------------------------------------------------------------------------------
 * Mesh helpers: angle-weighted normals, tangents, triangulate, subdivide, delete by mask, merge vertices (fuse),
 * bounds box, and the generic `remesh` gather that the topology-changing helpers share. Pure CPU, no frozen-mesh mutation
 * (every helper that returns a new mesh clones its input first).
 * ---------------------------------------------------------------------------------------------- */

/**
 * Angle-weighted normals (each corner contributes its unit face normal times the corner angle: independent of triangulation
 * density, unlike the area weighting of `computeNormals`). 'smooth' = point N, 'flat' = vertex N. Needs an UNFROZEN mesh.
 */
export function computeNormalsAngle(m: MeshData, mode: 'smooth' | 'flat'): MeshData {
  const P = m.positions;
  const vp = m.topology.vertPoint;
  const ps = m.topology.primStart;
  const nPrim = m.primCount;
  const acc = mode === 'smooth' ? new Float32Array(m.pointCount * 3) : new Float32Array(m.vertexCount * 3);
  for (let p = 0; p < nPrim; p++) {
    const s = ps[p], e = ps[p + 1], n = e - s;
    if (n < 3) continue;
    // face normal (Newell)
    let fx = 0, fy = 0, fz = 0;
    for (let k = 0; k < n; k++) {
      const a = vp[s + k] * 3, b = vp[s + ((k + 1) % n)] * 3;
      fx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
      fy += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
      fz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
    }
    const fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-20) continue;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    for (let k = 0; k < n; k++) {
      const c = vp[s + k] * 3, a = vp[s + ((k + n - 1) % n)] * 3, b = vp[s + ((k + 1) % n)] * 3;
      let ux = P[a] - P[c], uy = P[a + 1] - P[c + 1], uz = P[a + 2] - P[c + 2];
      let wx = P[b] - P[c], wy = P[b + 1] - P[c + 1], wz = P[b + 2] - P[c + 2];
      const lu = Math.hypot(ux, uy, uz), lw = Math.hypot(wx, wy, wz);
      if (lu < 1e-20 || lw < 1e-20) continue;
      ux /= lu; uy /= lu; uz /= lu; wx /= lw; wy /= lw; wz /= lw;
      const ang = Math.acos(Math.min(1, Math.max(-1, ux * wx + uy * wy + uz * wz)));
      const i = (mode === 'smooth' ? vp[s + k] : s + k) * 3;
      acc[i] += fx * ang;
      acc[i + 1] += fy * ang;
      acc[i + 2] += fz * ang;
    }
  }
  for (let i = 0; i < acc.length / 3; i++) {
    const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]);
    if (l > 1e-20) {
      acc[i * 3] /= l; acc[i * 3 + 1] /= l; acc[i * 3 + 2] /= l;
    } else acc[i * 3 + 2] = 1;
  }
  if (mode === 'smooth') {
    m.removeAttr('vertex', STD.N);
    m.setAttr({ name: STD.N, element: 'point', size: 3, kind: 'f32', data: acc });
  } else {
    m.removeAttr('point', STD.N);
    m.setAttr({ name: STD.N, element: 'vertex', size: 3, kind: 'f32', data: acc });
  }
  return m;
}

/** Value of `name` per POINT (point attr as is; vertex / primitive / detail averaged). null when missing. */
export function pointAttr(m: MeshData, name: string): { data: AttrData; size: number } | null {
  const a = m.attr('point', name);
  if (a) return { data: a.data, size: a.size };
  for (const el of ['vertex', 'primitive', 'detail'] as const) {
    if (m.has(el, name)) {
      const r = promoteAttr(m, name, el, 'point', 'average', true).attr('point', name)!;
      return { data: r.data, size: r.size };
    }
  }
  return null;
}

/** UV per point (first referencing vertex wins at seams). null when the mesh has no such UV set. */
export function pointUV(m: MeshData, set = 0): Float32Array | null {
  const name = set <= 0 ? 'uv' : `uv${set}`;
  const pa = m.attr('point', name);
  if (pa && pa.size === 2) return pa.data as Float32Array;
  const va = m.attr('vertex', name);
  if (!va || va.size !== 2) return null;
  const out = new Float32Array(m.pointCount * 2);
  const seen = new Uint8Array(m.pointCount);
  const vp = m.topology.vertPoint;
  for (let v = 0; v < vp.length; v++) {
    const p = vp[v];
    if (seen[p]) continue;
    seen[p] = 1;
    out[p * 2] = va.data[v * 2];
    out[p * 2 + 1] = va.data[v * 2 + 1];
  }
  return out;
}

/** Smooth point normals; computes them (angle weighted) when the mesh only has flat / no normals. Does not touch `m`. */
export function pointNormals(m: MeshData): Float32Array {
  const n = m.attr('point', STD.N);
  if (n && n.size === 3) return n.data as Float32Array;
  const tmp = m.clone();
  computeNormalsAngle(tmp, 'smooth');
  return tmp.attr('point', STD.N)!.data as Float32Array;
}

/** Per-vertex tangents (xyz + handedness w) from UV set `set`; written as vertex attribute `tangent`. Needs an unfrozen mesh. */
export function computeTangents(m: MeshData, set = 0): MeshData {
  const uv = m.resolveToVertex(set <= 0 ? 'uv' : `uv${set}`);
  if (!uv || uv.size !== 2) throw new Error('Tangents need UVs');
  const P = m.positions;
  const vp = m.topology.vertPoint;
  const nv = m.vertexCount;
  const tan = new Float32Array(nv * 3), bit = new Float32Array(nv * 3);
  const tr = m.topology.triangles();
  for (let t = 0; t < tr.verts.length / 3; t++) {
    const a = tr.verts[t * 3], b = tr.verts[t * 3 + 1], c = tr.verts[t * 3 + 2];
    const pa = vp[a] * 3, pb = vp[b] * 3, pc = vp[c] * 3;
    const e1 = [P[pb] - P[pa], P[pb + 1] - P[pa + 1], P[pb + 2] - P[pa + 2]];
    const e2 = [P[pc] - P[pa], P[pc + 1] - P[pa + 1], P[pc + 2] - P[pa + 2]];
    const du1 = uv.data[b * 2] - uv.data[a * 2], dv1 = uv.data[b * 2 + 1] - uv.data[a * 2 + 1];
    const du2 = uv.data[c * 2] - uv.data[a * 2], dv2 = uv.data[c * 2 + 1] - uv.data[a * 2 + 1];
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-20) continue;
    const r = 1 / det;
    for (const v of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        tan[v * 3 + k] += (e1[k] * dv2 - e2[k] * dv1) * r;
        bit[v * 3 + k] += (e2[k] * du1 - e1[k] * du2) * r;
      }
    }
  }
  const N = m.resolveToVertex('N');
  const out = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    const n = N ? [N.data[v * 3], N.data[v * 3 + 1], N.data[v * 3 + 2]] : [0, 0, 1];
    let tx = tan[v * 3], ty = tan[v * 3 + 1], tz = tan[v * 3 + 2];
    const d = n[0] * tx + n[1] * ty + n[2] * tz;
    tx -= n[0] * d; ty -= n[1] * d; tz -= n[2] * d; // Gram-Schmidt
    let l = Math.hypot(tx, ty, tz);
    if (l < 1e-12) {
      // degenerate UVs: any perpendicular
      const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      tx = n[1] * ax[2] - n[2] * ax[1]; ty = n[2] * ax[0] - n[0] * ax[2]; tz = n[0] * ax[1] - n[1] * ax[0];
      l = Math.hypot(tx, ty, tz) || 1;
    }
    const cx = n[1] * tz - n[2] * ty, cy = n[2] * tx - n[0] * tz, cz = n[0] * ty - n[1] * tx;
    const w = cx * bit[v * 3] + cy * bit[v * 3 + 1] + cz * bit[v * 3 + 2] < 0 ? -1 : 1;
    out[v * 4] = tx / l; out[v * 4 + 1] = ty / l; out[v * 4 + 2] = tz / l; out[v * 4 + 3] = w;
  }
  m.setAttr({ name: 'tangent', element: 'vertex', size: 4, kind: 'f32', data: out });
  return m;
}

/* ----------------------------------------------------------------------------------------------- remesh */
export interface RemeshSpec {
  /** New vertex -> old vertex (per-vertex attributes are gathered from it). */
  vertSrc: Uint32Array;
  /** CSR of the new primitives over the new vertices. */
  primStart: Uint32Array;
  /** New primitive -> old primitive (primitive attributes are gathered from it). */
  primSrc: Uint32Array;
  /** Optional: new point -> old point (point attributes are gathered), requires `pointMap`. */
  pointSrc?: Uint32Array;
  /** Optional: old point -> new point (-1 = removed). */
  pointMap?: Int32Array;
}

const gather = (a: Attribute, src: ArrayLike<number>, count: number): AttrData => {
  const out: AttrData = a.kind === 'f32' ? new Float32Array(count * a.size) : new Int32Array(count * a.size);
  const sz = a.size;
  for (let i = 0; i < count; i++) for (let c = 0; c < sz; c++) out[i * sz + c] = a.data[src[i] * sz + c];
  return out;
};

/** Build a new mesh from gathered vertices / primitives (and optionally a point remap). Detail attributes are shared. */
export function remesh(src: MeshData, s: RemeshSpec): MeshData {
  const nv = s.vertSrc.length;
  const oldVP = src.topology.vertPoint;
  const vp = new Uint32Array(nv);
  for (let i = 0; i < nv; i++) {
    const op = oldVP[s.vertSrc[i]];
    vp[i] = s.pointMap ? Math.max(0, s.pointMap[op]) : op;
  }
  const pointCount = s.pointSrc ? s.pointSrc.length : src.pointCount;
  const out = new MeshData(pointCount, new Topology(vp, s.primStart));
  const np = s.primStart.length - 1;
  for (const a of src.list()) {
    if (a.element === 'detail') out.shareAttr(a);
    else if (a.element === 'point') {
      if (s.pointSrc) out.setAttr({ ...a, data: gather(a, s.pointSrc, pointCount) });
      else out.shareAttr(a);
    } else if (a.element === 'vertex') out.setAttr({ ...a, data: gather(a, s.vertSrc, nv) });
    else out.setAttr({ ...a, data: gather(a, s.primSrc, np) });
  }
  return out;
}

/** Every primitive becomes triangles (fan; exact for convex n-gons). Point attributes are shared. */
export function triangulateMesh(src: MeshData): MeshData {
  const tr = src.topology.triangles();
  const nt = tr.prim.length;
  const ps = new Uint32Array(nt + 1);
  for (let i = 0; i <= nt; i++) ps[i] = i * 3;
  return remesh(src, { vertSrc: tr.verts, primStart: ps, primSrc: tr.prim });
}

/** Keep the primitives where `keep[p]` is non-zero. `removeUnused` also drops points no kept primitive references. */
export function deletePrimitives(src: MeshData, keep: ArrayLike<number>, removeUnused = true): MeshData {
  const topo = src.topology;
  let nv = 0, np = 0;
  for (let p = 0; p < topo.primCount; p++) if (keep[p]) {
    nv += topo.primStart[p + 1] - topo.primStart[p];
    np++;
  }
  const vertSrc = new Uint32Array(nv), primSrc = new Uint32Array(np), primStart = new Uint32Array(np + 1);
  let v = 0, q = 0;
  for (let p = 0; p < topo.primCount; p++) {
    if (!keep[p]) continue;
    for (let k = topo.primStart[p]; k < topo.primStart[p + 1]; k++) vertSrc[v++] = k;
    primSrc[q] = p;
    primStart[++q] = v;
  }
  if (!removeUnused) return remesh(src, { vertSrc, primStart, primSrc });
  const used = new Uint8Array(src.pointCount);
  for (let i = 0; i < nv; i++) used[topo.vertPoint[vertSrc[i]]] = 1;
  const pointMap = new Int32Array(src.pointCount).fill(-1);
  let n = 0;
  for (let i = 0; i < used.length; i++) if (used[i]) pointMap[i] = n++;
  const pointSrc = new Uint32Array(n);
  for (let i = 0; i < used.length; i++) if (used[i]) pointSrc[pointMap[i]] = i;
  return remesh(src, { vertSrc, primStart, primSrc, pointSrc, pointMap });
}

/** Merge points closer than `dist` (grid hash, first point wins). Primitives that collapse below 3 distinct points are removed. */
export function fusePoints(src: MeshData, dist: number): MeshData {
  const n = src.pointCount;
  const P = src.positions;
  const cell = Math.max(dist, 1e-9);
  const grid = new Map<string, number[]>();
  const rep = new Int32Array(n);
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(P[i * 3] / cell), cy = Math.floor(P[i * 3 + 1] / cell), cz = Math.floor(P[i * 3 + 2] / cell);
    let found = -1;
    search: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(key(cx + dx, cy + dy, cz + dz));
      if (!list) continue;
      for (const j of list) {
        if (Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]) <= dist) {
          found = j;
          break search;
        }
      }
    }
    if (found >= 0) rep[i] = found;
    else {
      rep[i] = i;
      const k = key(cx, cy, cz);
      const l = grid.get(k);
      if (l) l.push(i);
      else grid.set(k, [i]);
    }
  }
  const pointMap = new Int32Array(n).fill(-1);
  let np = 0;
  for (let i = 0; i < n; i++) if (rep[i] === i) pointMap[i] = np++;
  for (let i = 0; i < n; i++) if (rep[i] !== i) pointMap[i] = pointMap[rep[i]];
  const pointSrc = new Uint32Array(np);
  for (let i = 0; i < n; i++) if (rep[i] === i) pointSrc[pointMap[i]] = i;
  const topo = src.topology;
  // drop primitives with < 3 distinct points
  const keep = new Uint8Array(topo.primCount);
  for (let p = 0; p < topo.primCount; p++) {
    const set = new Set<number>();
    for (let k = topo.primStart[p]; k < topo.primStart[p + 1]; k++) set.add(pointMap[topo.vertPoint[k]]);
    keep[p] = set.size >= 3 || topo.primStart[p + 1] - topo.primStart[p] < 3 ? 1 : 0;
  }
  const mapped = remeshWithPoints(src, pointSrc, pointMap);
  return topo.primCount ? deletePrimitives(mapped, keep, false) : mapped;
}

function remeshWithPoints(src: MeshData, pointSrc: Uint32Array, pointMap: Int32Array): MeshData {
  const topo = src.topology;
  const vertSrc = new Uint32Array(topo.vertexCount);
  for (let i = 0; i < vertSrc.length; i++) vertSrc[i] = i;
  const primSrc = new Uint32Array(topo.primCount);
  for (let i = 0; i < primSrc.length; i++) primSrc[i] = i;
  return remesh(src, { vertSrc, primStart: topo.primStart, primSrc, pointSrc, pointMap });
}

/**
 * Simple subdivision: every triangle -> 4 triangles, every n-gon (n >= 4) -> n quads around a centre point. New points /
 * vertices interpolate every f32 attribute linearly (UVs, colours, custom); integer attributes copy the first source.
 * Positions are NOT smoothed (it is a tessellation tool: combine with Noise / Space Warp).
 */
export function subdivide(src: MeshData, iterations: number): MeshData {
  let cur = src;
  const its = Math.max(0, Math.min(5, Math.round(iterations)));
  for (let it = 0; it < its; it++) {
    const topo = cur.topology;
    let newPrims = 0, newVerts = 0, newPts = cur.pointCount;
    for (let p = 0; p < topo.primCount; p++) {
      const n = topo.primStart[p + 1] - topo.primStart[p];
      if (n < 3) continue;
      newPrims += n === 3 ? 4 : n;
      newVerts += n === 3 ? 12 : n * 4;
      newPts += n + (n === 3 ? 0 : 1);
    }
    checkMeshLimits(newPts, newVerts, newPrims, 'Subdivide');
    cur = subdivideOnce(cur);
  }
  return cur === src ? src.clone() : cur;
}

function subdivideOnce(src: MeshData): MeshData {
  const topo = src.topology;
  const vp = topo.vertPoint;
  // points: sources as CSR averages
  const ptList: number[][] = [];
  const midOf = new Map<number, number>();
  const KEY = 4_194_304 * 4;
  const mid = (a: number, b: number): number => {
    const k = a < b ? a * KEY + b : b * KEY + a;
    let id = midOf.get(k);
    if (id === undefined) {
      id = src.pointCount + ptList.length;
      ptList.push([a, b]);
      midOf.set(k, id);
    }
    return id;
  };
  const vList: number[][] = []; // new vertex -> list of OLD vertices (same primitive) to average
  const newVP: number[] = [];
  const newPS: number[] = [0];
  const primSrc: number[] = [];
  for (let p = 0; p < topo.primCount; p++) {
    const s = topo.primStart[p], n = topo.primStart[p + 1] - s;
    if (n < 3) continue;
    const corner = (k: number): [number, number[]] => [vp[s + k], [s + k]];
    const midv = (k: number): [number, number[]] => [mid(vp[s + k], vp[s + ((k + 1) % n)]), [s + k, s + ((k + 1) % n)]];
    const emit = (vs: [number, number[]][]): void => {
      for (const [pt, src2] of vs) {
        newVP.push(pt);
        vList.push(src2);
      }
      newPS.push(newVP.length);
      primSrc.push(p);
    };
    if (n === 3) {
      emit([corner(0), midv(0), midv(2)]);
      emit([corner(1), midv(1), midv(0)]);
      emit([corner(2), midv(2), midv(1)]);
      emit([midv(0), midv(1), midv(2)]);
    } else {
      const cpt = src.pointCount + ptList.length;
      ptList.push(Array.from({ length: n }, (_, k) => vp[s + k]));
      const all = Array.from({ length: n }, (_, k) => s + k);
      const centre: [number, number[]] = [cpt, all];
      for (let k = 0; k < n; k++) emit([corner(k), midv(k), centre, midv((k + n - 1) % n)]);
    }
  }
  const pointCount = src.pointCount + ptList.length;
  const out = new MeshData(pointCount, new Topology(Uint32Array.from(newVP), Uint32Array.from(newPS)));
  for (const a of src.list()) {
    const sz = a.size;
    if (a.element === 'detail') out.shareAttr(a);
    else if (a.element === 'point') {
      const d: AttrData = a.kind === 'f32' ? new Float32Array(pointCount * sz) : new Int32Array(pointCount * sz);
      d.set(a.data);
      for (let j = 0; j < ptList.length; j++) {
        const l = ptList[j];
        for (let c = 0; c < sz; c++) {
          if (a.kind === 'i32') d[(src.pointCount + j) * sz + c] = a.data[l[0] * sz + c];
          else {
            let t = 0;
            for (const q of l) t += a.data[q * sz + c];
            d[(src.pointCount + j) * sz + c] = t / l.length;
          }
        }
      }
      // keep unit normals unit
      if (a.name === STD.N && sz === 3) for (let j = src.pointCount; j < pointCount; j++) {
        const l = Math.hypot(d[j * 3], d[j * 3 + 1], d[j * 3 + 2]) || 1;
        d[j * 3] /= l; d[j * 3 + 1] /= l; d[j * 3 + 2] /= l;
      }
      out.setAttr({ ...a, data: d });
    } else if (a.element === 'vertex') {
      const d: AttrData = a.kind === 'f32' ? new Float32Array(vList.length * sz) : new Int32Array(vList.length * sz);
      for (let i = 0; i < vList.length; i++) {
        const l = vList[i];
        for (let c = 0; c < sz; c++) {
          if (a.kind === 'i32') d[i * sz + c] = a.data[l[0] * sz + c];
          else {
            let t = 0;
            for (const q of l) t += a.data[q * sz + c];
            d[i * sz + c] = t / l.length;
          }
        }
      }
      out.setAttr({ ...a, data: d });
    } else out.setAttr({ ...a, data: gather(a, primSrc, primSrc.length) });
  }
  return out;
}

/** Axis aligned box mesh around the bounds of `m` (with padding), UVs per face and flat normals. Empty mesh -> unit cube. */
export function boundsBox(m: MeshData, padding = 0): MeshData {
  const b = m.bounds();
  const lo = b.empty ? [-0.5, -0.5, -0.5] : b.min.map((v) => v - padding);
  const hi = b.empty ? [0.5, 0.5, 0.5] : b.max.map((v) => v + padding);
  const bl = new MeshBuilder('Bounds');
  const c = (x: number, y: number, z: number): number => bl.addPoint(x ? hi[0] : lo[0], y ? hi[1] : lo[1], z ? hi[2] : lo[2]);
  const q = [c(0, 0, 0), c(1, 0, 0), c(1, 1, 0), c(0, 1, 0), c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  for (const f of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]]) bl.addPrim(f.map((i) => q[i]), uv);
  const out = bl.build({ normals: false });
  computeNormalsAngle(out, 'flat');
  return out;
}

export type { Element };
