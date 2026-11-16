import { quatIdentity, type V3 } from './math3';

/* ------------------------------------------------------------------------------------------------
 * MESH DATA MODEL. Attribute based:
 *   elements : point | vertex | primitive | detail
 *   topology : `vertPoint[v]` = point of vertex v; primitive p owns the CONTIGUOUS vertices
 *              primStart[p] .. primStart[p+1]-1 (so a vertex belongs to exactly one primitive; points are shared).
 *   attributes: typed arrays per element. Standard names in `STD`.
 * A MeshData with `primCount === 0` is a point cloud and travels on the `points` pin.
 * Copy-on-write: arrays are shared between meshes; a mesh may only mutate arrays it OWNS (`writable()`), `clone()` shares
 * everything and owns nothing, `freeze()` is applied to every mesh that leaves a node (meshValue()).
 * CPU (TypedArray) is the source of truth; GPU buffers are lazy mirrors (gpu-mirror.ts). See docs for limits.
 * ---------------------------------------------------------------------------------------------- */

export type Element = 'point' | 'vertex' | 'primitive' | 'detail';
export type AttrKind = 'f32' | 'i32';
export type AttrData = Float32Array | Int32Array;
export interface Attribute {
  name: string;
  element: Element;
  /** Components per element: 1 float/int, 2 uv, 3 vec3, 4 vec4/quat/rgba. */
  size: 1 | 2 | 3 | 4;
  kind: AttrKind;
  data: AttrData;
}

/** Standard attribute names. */
export const STD = {
  P: 'P', // point vec3 position
  N: 'N', // point|vertex vec3 normal
  uv: 'uv', // vertex (or point) vec2, additional sets: uv1, uv2, ...
  Cd: 'Cd', // point|vertex vec4 RGBA (alpha is an ordinary channel)
  pscale: 'pscale', // point float uniform scale
  scale: 'scale', // point vec3 non-uniform scale
  orient: 'orient', // point vec4 quaternion xyzw
  pivot: 'pivot', // point vec3 pivot position (pivot-baked meshes / VAT)
  id: 'id', // point|primitive int id
  island: 'island', // primitive int island id
  age: 'age', // point float 0..1 (or seconds)
} as const;
export const uvName = (set: number): string => (set <= 0 ? 'uv' : `uv${set}`);

/** Hard caps (acceptance criterion: degrade, never crash). Interactive target: 1M points for point-wise math. */
export const MESH_LIMITS = {
  /** Above this a node refuses to build (error badge). */
  maxPoints: 4_000_000,
  maxVertices: 16_000_000,
  maxPrimitives: 8_000_000,
  /** Interactive target for per-point CPU math (documented, not enforced). */
  interactivePoints: 1_000_000,
  /** Per-mesh CPU byte cap. */
  maxBytes: 768 * 1024 * 1024,
} as const;

export class MeshLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeshLimitError';
  }
}
export function checkMeshLimits(points: number, vertices: number, prims: number, what: string): void {
  if (!(points >= 0) || !(vertices >= 0) || !(prims >= 0) || !Number.isFinite(points + vertices + prims)) throw new MeshLimitError(`${what}: invalid element counts`);
  if (points > MESH_LIMITS.maxPoints) throw new MeshLimitError(`${what}: ${points.toLocaleString()} points exceed the cap of ${MESH_LIMITS.maxPoints.toLocaleString()}. Reduce the counts.`);
  if (vertices > MESH_LIMITS.maxVertices) throw new MeshLimitError(`${what}: ${vertices.toLocaleString()} vertices exceed the cap of ${MESH_LIMITS.maxVertices.toLocaleString()}.`);
  if (prims > MESH_LIMITS.maxPrimitives) throw new MeshLimitError(`${what}: ${prims.toLocaleString()} primitives exceed the cap of ${MESH_LIMITS.maxPrimitives.toLocaleString()}.`);
  const bytes = points * 12 + vertices * 24 + prims * 4;
  if (bytes > MESH_LIMITS.maxBytes) throw new MeshLimitError(`${what}: about ${(bytes / 1048576).toFixed(0)} MB exceeds the per-mesh cap of ${MESH_LIMITS.maxBytes / 1048576} MB.`);
}

export interface Bounds {
  min: V3;
  max: V3;
  center: V3;
  /** Half diagonal length. */
  radius: number;
  empty: boolean;
}

/** Immutable, shareable topology + lazily built triangulation / edge caches. */
export class Topology {
  readonly vertPoint: Uint32Array;
  readonly primStart: Uint32Array;
  private triCache: { verts: Uint32Array; prim: Uint32Array } | null = null;
  private edgeCache: Uint32Array | null = null;
  constructor(vertPoint: Uint32Array, primStart: Uint32Array) {
    if (primStart.length < 1 || primStart[0] !== 0 || primStart[primStart.length - 1] !== vertPoint.length) throw new Error('Topology: primStart must start at 0 and end at vertexCount');
    this.vertPoint = vertPoint;
    this.primStart = primStart;
  }
  static empty(): Topology {
    return new Topology(new Uint32Array(0), new Uint32Array(1));
  }
  get vertexCount(): number {
    return this.vertPoint.length;
  }
  get primCount(): number {
    return this.primStart.length - 1;
  }
  /** Primitive of every vertex (built on demand, not cached: callers cache it if needed). */
  vertexPrimitives(): Uint32Array {
    const out = new Uint32Array(this.vertexCount);
    for (let p = 0; p < this.primCount; p++) out.fill(p, this.primStart[p], this.primStart[p + 1]);
    return out;
  }
  /**
   * Triangulation cache: fan triangulation per primitive (exact for triangles, quads and CONVEX n-gons).
   * `verts` holds VERTEX indices (3 per triangle) so per-vertex attributes (uv, hard normals) stay correct;
   * `prim[t]` = owning primitive. Primitives with < 3 vertices produce nothing.
   */
  triangles(): { verts: Uint32Array; prim: Uint32Array } {
    if (this.triCache) return this.triCache;
    let tris = 0;
    for (let p = 0; p < this.primCount; p++) tris += Math.max(0, this.primStart[p + 1] - this.primStart[p] - 2);
    const verts = new Uint32Array(tris * 3);
    const prim = new Uint32Array(tris);
    let t = 0;
    for (let p = 0; p < this.primCount; p++) {
      const s = this.primStart[p];
      const n = this.primStart[p + 1] - s;
      for (let k = 1; k + 1 < n; k++) {
        verts[t * 3] = s;
        verts[t * 3 + 1] = s + k;
        verts[t * 3 + 2] = s + k + 1;
        prim[t++] = p;
      }
    }
    this.triCache = { verts, prim };
    return this.triCache;
  }
  /** Unique POINT edges (pairs of point indices) of all primitives (n-gon boundary edges, not triangulation diagonals). */
  edges(): Uint32Array {
    if (this.edgeCache) return this.edgeCache;
    const seen = new Set<number>();
    const out: number[] = [];
    // key = min * 2^26 ... could overflow for > 67M points; caps keep us far below (4M points)
    const KEY = 4_194_304 * 4;
    for (let p = 0; p < this.primCount; p++) {
      const s = this.primStart[p];
      const n = this.primStart[p + 1] - s;
      if (n < 2) continue;
      for (let k = 0; k < n; k++) {
        if (n === 2 && k === 1) break;
        const a = this.vertPoint[s + k];
        const b = this.vertPoint[s + ((k + 1) % n)];
        if (a === b) continue;
        const key = a < b ? a * KEY + b : b * KEY + a;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(a, b);
        }
      }
    }
    this.edgeCache = Uint32Array.from(out);
    return this.edgeCache;
  }
  get bytes(): number {
    return this.vertPoint.byteLength + this.primStart.byteLength;
  }
  /** Cache bytes are CPU-only extras (not counted as the mesh payload). */
  get cacheBytes(): number {
    return (this.triCache ? this.triCache.verts.byteLength + this.triCache.prim.byteLength : 0) + (this.edgeCache?.byteLength ?? 0);
  }
}

let versionCounter = 1;
let idCounter = 1;
const key = (el: Element, name: string): string => `${el}/${name}`;
const countOf = (m: MeshData, el: Element): number => (el === 'point' ? m.pointCount : el === 'vertex' ? m.vertexCount : el === 'primitive' ? m.primCount : 1);

export class MeshData {
  readonly uid = idCounter++;
  /** Changes whenever content changes (cache key for GPU mirrors / viewport geometry). Globally unique per content state. */
  version = versionCounter++;
  readonly pointCount: number;
  private topo: Topology;
  private attrs = new Map<string, Attribute>();
  /** Arrays this mesh created itself and nobody else references: only these may be mutated in place. */
  private owned = new Set<AttrData>();
  private boundsCache: Bounds | null = null;
  private boundsVersion = -1;
  frozen = false;

  constructor(pointCount: number, topo: Topology = Topology.empty()) {
    this.pointCount = pointCount;
    this.topo = topo;
  }

  /** A mesh with positions only, `positions.length === 3 * n`. Takes ownership of the array. */
  static fromPositions(positions: Float32Array, topo: Topology = Topology.empty()): MeshData {
    const m = new MeshData(positions.length / 3, topo);
    m.setAttr({ name: STD.P, element: 'point', size: 3, kind: 'f32', data: positions });
    return m;
  }

  get topology(): Topology {
    return this.topo;
  }
  get vertexCount(): number {
    return this.topo.vertexCount;
  }
  get primCount(): number {
    return this.topo.primCount;
  }
  get isPointCloud(): boolean {
    return this.primCount === 0;
  }
  count(el: Element): number {
    return countOf(this, el);
  }

  /* ----------------------------------------------------------------------------------------- attributes */
  attr(el: Element, name: string): Attribute | undefined {
    return this.attrs.get(key(el, name));
  }
  has(el: Element, name: string): boolean {
    return this.attrs.has(key(el, name));
  }
  list(el?: Element): Attribute[] {
    return [...this.attrs.values()].filter((a) => !el || a.element === el);
  }
  /** Point positions (xyz interleaved). Always present on a valid mesh. */
  get positions(): Float32Array {
    const a = this.attr('point', STD.P);
    return a ? (a.data as Float32Array) : new Float32Array(this.pointCount * 3);
  }

  private assertMutable(): void {
    if (this.frozen) throw new Error('MeshData is frozen (it already left its node): call clone() before editing.');
  }
  private touch(): void {
    this.version = versionCounter++;
    this.boundsCache = null;
  }

  /** Insert/replace an attribute (the array is adopted and becomes OWNED by this mesh). Validates the length. */
  setAttr(a: Attribute): this {
    this.assertMutable();
    const n = countOf(this, a.element);
    if (a.data.length !== n * a.size) throw new Error(`Attribute ${a.element}/${a.name}: expected ${n * a.size} values, got ${a.data.length}`);
    this.attrs.set(key(a.element, a.name), a);
    this.owned.add(a.data);
    this.touch();
    return this;
  }
  /** Adopt an attribute that SHARES an array with another mesh (no copy, not owned: copy-on-write applies). */
  shareAttr(a: Attribute): this {
    this.assertMutable();
    const n = countOf(this, a.element);
    if (a.data.length !== n * a.size) throw new Error(`Attribute ${a.element}/${a.name}: expected ${n * a.size} values, got ${a.data.length}`);
    this.attrs.set(key(a.element, a.name), a);
    this.owned.delete(a.data);
    this.touch();
    return this;
  }
  /** Create a new zero-filled (or `fill`ed) attribute. */
  addAttr(el: Element, name: string, size: 1 | 2 | 3 | 4, kind: AttrKind = 'f32', fill?: ArrayLike<number>): Attribute {
    const n = countOf(this, el);
    const data: AttrData = kind === 'f32' ? new Float32Array(n * size) : new Int32Array(n * size);
    if (fill) for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) data[i * size + c] = fill[c] ?? 0;
    const a: Attribute = { name, element: el, size, kind, data };
    this.setAttr(a);
    return a;
  }
  removeAttr(el: Element, name: string): this {
    this.assertMutable();
    const a = this.attrs.get(key(el, name));
    if (a) {
      this.attrs.delete(key(el, name));
      this.owned.delete(a.data);
      this.touch();
    }
    return this;
  }
  /**
   * Copy-on-write access: returns an array that may be mutated in place. If the array is shared (with an input mesh or a
   * clone) it is copied first. Call `commit()` (or any setAttr) afterwards is NOT required; version bumps here.
   */
  writable(el: Element, name: string): AttrData {
    this.assertMutable();
    const a = this.attrs.get(key(el, name));
    if (!a) throw new Error(`No attribute ${el}/${name}`);
    if (!this.owned.has(a.data)) {
      const copy = a.data instanceof Float32Array ? new Float32Array(a.data) : new Int32Array(a.data);
      this.attrs.set(key(el, name), { ...a, data: copy });
      this.owned.add(copy);
      this.touch();
      return copy;
    }
    this.touch();
    return a.data;
  }
  isShared(el: Element, name: string): boolean {
    const a = this.attrs.get(key(el, name));
    return !!a && !this.owned.has(a.data);
  }
  /** Replace topology (point count must stay): used by ops that rebuild primitives but keep point attributes. */
  withTopology(topo: Topology): MeshData {
    const m = new MeshData(this.pointCount, topo);
    for (const a of this.attrs.values()) if (a.element === 'point' || a.element === 'detail') m.shareAttr(a);
    return m;
  }

  /** Structural-sharing clone: shares ALL arrays, owns none (the source also stops owning them: both are copy-on-write now). */
  clone(): MeshData {
    const m = new MeshData(this.pointCount, this.topo);
    this.owned.clear();
    for (const a of this.attrs.values()) m.attrs.set(key(a.element, a.name), a);
    m.version = versionCounter++;
    return m;
  }
  /** Make immutable (called when the mesh becomes a node output). Idempotent. */
  freeze(): this {
    this.frozen = true;
    this.owned.clear();
    return this;
  }

  /* ----------------------------------------------------------------------------------------- derived data */
  bounds(): Bounds {
    if (this.boundsCache && this.boundsVersion === this.version) return this.boundsCache;
    const P = this.positions;
    const n = this.pointCount;
    let b: Bounds;
    if (n === 0) b = { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 0, empty: true };
    else {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        if (!Number.isFinite(x + y + z)) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
      if (x0 > x1) b = { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 0, empty: true };
      else b = { min: [x0, y0, z0], max: [x1, y1, z1], center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], radius: Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2, empty: false };
    }
    this.boundsCache = b;
    this.boundsVersion = this.version;
    return b;
  }

  /** Unique typed arrays referenced by this mesh (topology + attributes). */
  arrays(): ArrayBufferView[] {
    const s = new Set<ArrayBufferView>([this.topo.vertPoint, this.topo.primStart]);
    for (const a of this.attrs.values()) s.add(a.data);
    return [...s];
  }
  /** CPU payload bytes of this mesh (counting shared arrays fully; exact deduplicated accounting is MeshAccounting's job). */
  get bytes(): number {
    return this.arrays().reduce((n, a) => n + a.byteLength, 0);
  }

  /**
   * Value of attribute `name` for every VERTEX (size components each), resolving point / primitive / detail attributes
   * through the topology. Returns null when the attribute does not exist at any level. Vertex attributes win over point
   * attributes. Allocates a new array unless the attribute is already per-vertex.
   */
  resolveToVertex(name: string): { data: Float32Array; size: number } | null {
    const nv = this.vertexCount;
    const v = this.attr('vertex', name);
    if (v) return { data: v.data instanceof Float32Array ? v.data : Float32Array.from(v.data), size: v.size };
    const p = this.attr('point', name);
    if (p) {
      const out = new Float32Array(nv * p.size);
      const vp = this.topo.vertPoint;
      for (let i = 0; i < nv; i++) for (let c = 0; c < p.size; c++) out[i * p.size + c] = p.data[vp[i] * p.size + c];
      return { data: out, size: p.size };
    }
    const q = this.attr('primitive', name);
    if (q) {
      const out = new Float32Array(nv * q.size);
      const ps = this.topo.primStart;
      for (let k = 0; k < this.primCount; k++) for (let i = ps[k]; i < ps[k + 1]; i++) for (let c = 0; c < q.size; c++) out[i * q.size + c] = q.data[k * q.size + c];
      return { data: out, size: q.size };
    }
    const d = this.attr('detail', name);
    if (d) {
      const out = new Float32Array(nv * d.size);
      for (let i = 0; i < nv; i++) for (let c = 0; c < d.size; c++) out[i * d.size + c] = d.data[c];
      return { data: out, size: d.size };
    }
    return null;
  }

  /** Human readable summary (UI stats, tests). */
  summary(): string {
    const names = [...this.attrs.values()].map((a) => `${a.element[0]}:${a.name}`).join(' ');
    return `${this.pointCount} pts, ${this.vertexCount} verts, ${this.primCount} prims [${names}]`;
  }
}

/** Per-point orientation fallback used by instancing code. */
export const IDENTITY_QUAT = quatIdentity();
export { countOf as elementCount };
