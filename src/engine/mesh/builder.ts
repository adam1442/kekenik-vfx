import { MESH_LIMITS, MeshData, MeshLimitError, STD, Topology, type Element } from './mesh';

/** Growable typed array (amortised doubling) used by builders; avoids huge JS number[]s. */
export class GrowF32 {
  data: Float32Array;
  length = 0;
  constructor(cap = 256) {
    this.data = new Float32Array(cap);
  }
  push(...v: number[]): void {
    if (this.length + v.length > this.data.length) this.grow(this.length + v.length);
    for (let i = 0; i < v.length; i++) this.data[this.length++] = v[i];
  }
  private grow(min: number): void {
    const n = new Float32Array(Math.max(min, this.data.length * 2));
    n.set(this.data.subarray(0, this.length));
    this.data = n;
  }
  done(): Float32Array {
    return this.data.slice(0, this.length);
  }
}
export class GrowU32 {
  data: Uint32Array;
  length = 0;
  constructor(cap = 256) {
    this.data = new Uint32Array(cap);
  }
  push(v: number): void {
    if (this.length >= this.data.length) {
      const n = new Uint32Array(this.data.length * 2);
      n.set(this.data);
      this.data = n;
    }
    this.data[this.length++] = v;
  }
  done(): Uint32Array {
    return this.data.slice(0, this.length);
  }
}

/**
 * MeshBuilder: points + primitives (n-gons) with optional per-vertex uv. Enforces the hard caps while building (so a runaway
 * parameter throws MeshLimitError instead of exhausting memory). `build()` returns an UNFROZEN mesh with smooth point normals.
 */
export class MeshBuilder {
  private pos = new GrowF32(1024);
  private vp = new GrowU32(1024);
  private ps = new GrowU32(256);
  private uv = new GrowF32(1024);
  private hasUv = false;
  pointCount = 0;
  constructor(private what = 'mesh') {
    this.ps.push(0);
  }
  get primCount(): number {
    return this.ps.length - 1;
  }
  get vertexCount(): number {
    return this.vp.length;
  }
  addPoint(x: number, y: number, z: number): number {
    if (this.pointCount >= MESH_LIMITS.maxPoints) throw new MeshLimitError(`${this.what}: point cap (${MESH_LIMITS.maxPoints.toLocaleString()}) exceeded. Reduce the subdivision counts.`);
    this.pos.push(x, y, z);
    return this.pointCount++;
  }
  /** `uvs` = 2 numbers per corner (optional). */
  addPrim(points: ArrayLike<number>, uvs?: ArrayLike<number>): number {
    if (this.vp.length + points.length > MESH_LIMITS.maxVertices || this.primCount >= MESH_LIMITS.maxPrimitives) throw new MeshLimitError(`${this.what}: primitive/vertex cap exceeded. Reduce the subdivision counts.`);
    if (uvs && !this.hasUv) {
      this.hasUv = true; // back-fill zeros for earlier vertices
      for (let i = 0; i < this.vp.length; i++) this.uv.push(0, 0);
    }
    for (let i = 0; i < points.length; i++) {
      this.vp.push(points[i]);
      if (this.hasUv) this.uv.push(uvs ? uvs[i * 2] : 0, uvs ? uvs[i * 2 + 1] : 0);
    }
    this.ps.push(this.vp.length);
    return this.primCount - 1;
  }
  quad(a: number, b: number, c: number, d: number, uvs?: ArrayLike<number>): number {
    return this.addPrim([a, b, c, d], uvs);
  }
  tri(a: number, b: number, c: number, uvs?: ArrayLike<number>): number {
    return this.addPrim([a, b, c], uvs);
  }
  /** Read back a point already added (for shapes that post-process, e.g. pivot shifts). */
  position(i: number): [number, number, number] {
    return [this.pos.data[i * 3], this.pos.data[i * 3 + 1], this.pos.data[i * 3 + 2]];
  }
  build(opts: { normals?: boolean } = {}): MeshData {
    const topo = new Topology(this.vp.done(), this.ps.done());
    const m = MeshData.fromPositions(this.pos.done(), topo);
    if (this.hasUv) m.setAttr({ name: STD.uv, element: 'vertex', size: 2, kind: 'f32', data: this.uv.done() });
    if (opts.normals !== false && topo.primCount > 0) computeNormals(m, 'smooth');
    return m;
  }
}

/** Newell normal of one primitive (unnormalised length = 2 * area). */
export function primNormal(P: Float32Array, vp: Uint32Array, s: number, e: number): [number, number, number] {
  let nx = 0, ny = 0, nz = 0;
  for (let k = s; k < e; k++) {
    const a = vp[k] * 3;
    const b = vp[k + 1 < e ? k + 1 : s] * 3;
    nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
    ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
    nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
  }
  return [nx, ny, nz];
}

/**
 * Normals. 'smooth' = area-weighted point normals (attribute point/N, vertex/N removed);
 * 'flat' = one normal per primitive written as a vertex attribute (vertex/N, point/N removed). Needs an unfrozen mesh.
 */
export function computeNormals(m: MeshData, mode: 'smooth' | 'flat'): MeshData {
  const P = m.positions;
  const topo = m.topology;
  const vp = topo.vertPoint;
  const ps = topo.primStart;
  if (mode === 'flat') {
    const N = new Float32Array(m.vertexCount * 3);
    for (let p = 0; p < m.primCount; p++) {
      const n = primNormal(P, vp, ps[p], ps[p + 1]);
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      for (let k = ps[p]; k < ps[p + 1]; k++) {
        N[k * 3] = n[0] / l;
        N[k * 3 + 1] = n[1] / l;
        N[k * 3 + 2] = n[2] / l;
      }
    }
    m.removeAttr('point', STD.N);
    m.setAttr({ name: STD.N, element: 'vertex', size: 3, kind: 'f32', data: N });
    return m;
  }
  const N = new Float32Array(m.pointCount * 3);
  for (let p = 0; p < m.primCount; p++) {
    const n = primNormal(P, vp, ps[p], ps[p + 1]); // area weighted by construction
    for (let k = ps[p]; k < ps[p + 1]; k++) {
      const i = vp[k] * 3;
      N[i] += n[0];
      N[i + 1] += n[1];
      N[i + 2] += n[2];
    }
  }
  for (let i = 0; i < m.pointCount; i++) {
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    if (l > 1e-20) {
      N[i * 3] /= l;
      N[i * 3 + 1] /= l;
      N[i * 3 + 2] /= l;
    } else N[i * 3 + 2] = 1;
  }
  m.removeAttr('vertex', STD.N);
  m.setAttr({ name: STD.N, element: 'point', size: 3, kind: 'f32', data: N });
  return m;
}

/** Connected islands of primitives (primitives that share a point). Returns per-primitive island ids 0..count-1 (ordered by first primitive). */
export function computeIslands(m: MeshData): { ids: Int32Array; count: number } {
  const topo = m.topology;
  const parent = new Int32Array(m.pointCount);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let p = 0; p < topo.primCount; p++) {
    const s = topo.primStart[p];
    const e = topo.primStart[p + 1];
    if (e <= s) continue;
    const r = find(topo.vertPoint[s]);
    for (let k = s + 1; k < e; k++) {
      const q = find(topo.vertPoint[k]);
      if (q !== r) parent[q] = r;
    }
  }
  const ids = new Int32Array(topo.primCount);
  const map = new Map<number, number>();
  for (let p = 0; p < topo.primCount; p++) {
    if (topo.primStart[p + 1] <= topo.primStart[p]) {
      ids[p] = -1;
      continue;
    }
    const r = find(topo.vertPoint[topo.primStart[p]]);
    let id = map.get(r);
    if (id === undefined) map.set(r, (id = map.size));
    ids[p] = id;
  }
  return { ids, count: map.size };
}

export type PromoteMode = 'average' | 'first' | 'sum' | 'min' | 'max';
/**
 * Move an attribute between elements. from/to: point | vertex | primitive | detail.
 * Point->vertex and primitive->vertex/point copy; many->one uses `mode`. Returns a NEW mesh (input untouched).
 */
export function promoteAttr(src: MeshData, name: string, from: Element, to: Element, mode: PromoteMode = 'average', keepOriginal = false): MeshData {
  const a = src.attr(from, name);
  if (!a) throw new Error(`promote: no ${from} attribute "${name}"`);
  if (from === to) return src.clone();
  const out = src.clone();
  const sz = a.size;
  // 1. expand to per-vertex
  const nv = src.vertexCount;
  const vp = src.topology.vertPoint;
  const ps = src.topology.primStart;
  const perVertex = new Float32Array(nv * sz);
  if (from === 'vertex') perVertex.set(a.data);
  else if (from === 'point') for (let i = 0; i < nv; i++) for (let c = 0; c < sz; c++) perVertex[i * sz + c] = a.data[vp[i] * sz + c];
  else if (from === 'primitive') for (let p = 0; p < src.primCount; p++) for (let i = ps[p]; i < ps[p + 1]; i++) for (let c = 0; c < sz; c++) perVertex[i * sz + c] = a.data[p * sz + c];
  else for (let i = 0; i < nv; i++) for (let c = 0; c < sz; c++) perVertex[i * sz + c] = a.data[c];
  // 2. reduce into the target element
  const reduce = (groups: number, groupOf: (v: number) => number): Float32Array => {
    const res = new Float32Array(groups * sz);
    const cnt = new Uint32Array(groups);
    for (let v = 0; v < nv; v++) {
      const g = groupOf(v);
      for (let c = 0; c < sz; c++) {
        const x = perVertex[v * sz + c];
        const k = g * sz + c;
        if (cnt[g] === 0) res[k] = x;
        else if (mode === 'sum' || mode === 'average') res[k] += x;
        else if (mode === 'min') res[k] = Math.min(res[k], x);
        else if (mode === 'max') res[k] = Math.max(res[k], x);
      }
      cnt[g]++;
    }
    if (mode === 'average') for (let g = 0; g < groups; g++) if (cnt[g] > 1) for (let c = 0; c < sz; c++) res[g * sz + c] /= cnt[g];
    return res;
  };
  let data: Float32Array;
  if (to === 'vertex') data = perVertex;
  else if (to === 'point') {
    data = reduce(src.pointCount, (v) => vp[v]);
    if (from === 'point') data = Float32Array.from(a.data);
  } else if (to === 'primitive') {
    const primOf = src.topology.vertexPrimitives();
    data = reduce(src.primCount, (v) => primOf[v]);
  } else data = reduce(1, () => 0);
  if (!keepOriginal) out.removeAttr(from, name);
  out.setAttr({ name, element: to, size: sz, kind: a.kind, data: a.kind === 'i32' ? Int32Array.from(data) : data });
  return out;
}

/** Reverse the vertex order of every primitive (and every per-vertex attribute): flips face orientation. */
export function flipWinding(src: MeshData): MeshData {
  const topo = src.topology;
  const vp = new Uint32Array(topo.vertPoint.length);
  const remap = new Uint32Array(vp.length); // new vertex index -> old vertex index
  for (let p = 0; p < topo.primCount; p++) {
    const s = topo.primStart[p];
    const e = topo.primStart[p + 1];
    for (let k = s; k < e; k++) {
      remap[k] = e - 1 - (k - s);
      vp[k] = topo.vertPoint[remap[k]];
    }
  }
  const m = new MeshData(src.pointCount, new Topology(vp, topo.primStart));
  for (const a of src.list()) {
    if (a.element !== 'vertex') {
      m.shareAttr(a);
      continue;
    }
    const d = a.data instanceof Float32Array ? new Float32Array(a.data.length) : new Int32Array(a.data.length);
    for (let k = 0; k < remap.length; k++) for (let c = 0; c < a.size; c++) d[k * a.size + c] = a.data[remap[k] * a.size + c];
    m.setAttr({ ...a, data: d });
  }
  // normals flip with the winding
  for (const el of ['point', 'vertex'] as const) {
    const n = m.attr(el, STD.N);
    if (n) {
      const w = m.writable(el, STD.N);
      for (let i = 0; i < w.length; i++) w[i] = -w[i];
    }
  }
  return m;
}
