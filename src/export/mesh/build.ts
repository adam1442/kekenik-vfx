import { computeNormalsAngle } from '../../engine/mesh/helpers';
import { MeshData, STD } from '../../engine/mesh/mesh';
import { AXIS_MATRICES, matDet3, type MeshAxis } from '../engines';

/**
 * ExportMesh: flat, per-VERTEX, triangulated, coordinate-converted copy of a MeshData, the common input of every
 * mesh writer (GLB / glTF / OBJ / PLY), mesh flipbooks, VAT and pivot-baked exports.
 *
 *  - Authoring space is Z up, +Y forward, right handed, UVs v-UP. `axis` / `scale` convert positions and normals; when the
 *    conversion mirrors the space (det < 0: Unity, Unreal) the triangle winding is reversed so the faces keep pointing outward.
 *  - UV sets stay in the authoring convention (v up) here; each format converts (glTF / DDS-style: v = 1 - v; OBJ / PLY keep v up).
 *  - Point / primitive / detail attributes are resolved to vertices (`MeshData.resolveToVertex`). Integer attributes become floats.
 */
export interface ExportAttr {
  name: string;
  size: 1 | 2 | 3 | 4;
  data: Float32Array;
  /** Element the attribute lived on in the source mesh. */
  source: string;
}
export interface ExportMesh {
  vertexCount: number;
  positions: Float32Array;
  normals: Float32Array | null;
  /** UV sets in order (uv, uv1, uv2 ...): 2 floats per vertex, v up. */
  uvSets: { name: string; data: Float32Array }[];
  /** RGBA, 4 floats per vertex (linear). */
  colors: Float32Array | null;
  custom: ExportAttr[];
  indices: Uint32Array;
  /** Point index of every vertex in the source mesh (VAT needs the per-point animation). */
  vertexPoint: Uint32Array;
}

export interface BuildOptions {
  axis: MeshAxis;
  scale: number;
  normals: boolean;
  /** Export custom attributes (pscale, pivot, id, age, ...). */
  custom: boolean;
  maxCustom?: number;
}

const STD_SKIP = new Set<string>([STD.P, STD.N, STD.Cd]);
const isUv = (n: string): boolean => /^uv\d*$/.test(n);

/** Rotate a vec3 array by the axis matrix and scale. */
export function transformVec3(src: Float32Array, m: number[], scale: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i] = (m[0] * x + m[1] * y + m[2] * z) * scale;
    out[i + 1] = (m[3] * x + m[4] * y + m[5] * z) * scale;
    out[i + 2] = (m[6] * x + m[7] * y + m[8] * z) * scale;
  }
  return out;
}

export function buildExportMesh(mesh: MeshData, o: BuildOptions): ExportMesh {
  const nv = mesh.vertexCount;
  if (nv === 0 || mesh.primCount === 0) throw new Error('The mesh has no faces to export (point clouds cannot be exported as meshes).');
  const m = AXIS_MATRICES[o.axis];
  const flip = matDet3(m) < 0;
  const vp = mesh.topology.vertPoint;
  const P = mesh.positions;
  const vpos = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    vpos[v * 3] = P[vp[v] * 3];
    vpos[v * 3 + 1] = P[vp[v] * 3 + 1];
    vpos[v * 3 + 2] = P[vp[v] * 3 + 2];
  }
  const positions = transformVec3(vpos, m, o.scale);

  let normals: Float32Array | null = null;
  if (o.normals) {
    let src = mesh.resolveToVertex(STD.N);
    if (!src || src.size !== 3) src = computeNormalsAngle(mesh, 'smooth').resolveToVertex(STD.N);
    if (src && src.size === 3) normals = transformVec3(src.data, m, 1);
  }

  const uvSets: ExportMesh['uvSets'] = [];
  const names = new Set<string>();
  for (const a of mesh.list()) if (isUv(a.name) && a.size === 2) names.add(a.name);
  const ordered = [...names].sort((a, b) => (a === 'uv' ? -1 : b === 'uv' ? 1 : parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10)));
  for (const n of ordered) {
    const r = mesh.resolveToVertex(n);
    if (r && r.size === 2) uvSets.push({ name: n, data: r.data.slice() });
  }

  let colors: Float32Array | null = null;
  const cd = mesh.resolveToVertex(STD.Cd);
  if (cd) {
    colors = new Float32Array(nv * 4);
    for (let v = 0; v < nv; v++) for (let c = 0; c < 4; c++) colors[v * 4 + c] = c < cd.size ? cd.data[v * cd.size + c] : c === 3 ? 1 : cd.size === 1 ? cd.data[v] : 0;
  }

  const custom: ExportAttr[] = [];
  if (o.custom) {
    const seen = new Set<string>();
    for (const a of mesh.list()) {
      if (a.element === 'detail' || STD_SKIP.has(a.name) || isUv(a.name) || seen.has(a.name) || (a.size as number) > 4) continue;
      seen.add(a.name);
      const r = mesh.resolveToVertex(a.name);
      if (!r) continue;
      const data = r.size === 3 && /^(pivot|pivot_offset|scale)$/.test(a.name) ? transformVec3(r.data, m, a.name === 'scale' ? 1 : o.scale) : r.data.slice();
      custom.push({ name: a.name, size: r.size as 1 | 2 | 3 | 4, data, source: a.element });
      if (custom.length >= (o.maxCustom ?? 12)) break;
    }
  }

  const tri = mesh.topology.triangles().verts;
  const indices = new Uint32Array(tri.length);
  if (flip) for (let t = 0; t < tri.length; t += 3) (indices[t] = tri[t], (indices[t + 1] = tri[t + 2]), (indices[t + 2] = tri[t + 1]));
  else indices.set(tri);
  return { vertexCount: nv, positions, normals, uvSets, colors, custom, indices, vertexPoint: vp.slice() };
}

/** Axis-aligned bounds of an ExportMesh. */
export function exportBounds(m: ExportMesh): { min: [number, number, number]; max: [number, number, number] } {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) for (let c = 0; c < 3; c++) {
    const v = m.positions[i + c];
    if (v < lo[c]) lo[c] = v;
    if (v > hi[c]) hi[c] = v;
  }
  return { min: lo, max: hi };
}

/**
 * MESH FLIPBOOK: the geometry of every frame in ONE mesh. Frame i occupies vertices [i * n, (i + 1) * n) only when the topology is
 * constant; in general the ranges are recorded in the returned `ranges`. Each vertex also gets
 *   - custom attribute `frame` (float frame index), custom `frame_t` (0..1 over the loop, i / count)
 *   - an extra UV set `uv_frame` = ((index + 0.5) / count, 0.5), so a material can select a frame by UV without custom attributes.
 */
export interface FlipbookRange {
  frame: number;
  firstVertex: number;
  vertexCount: number;
  firstIndex: number;
  indexCount: number;
}
export function mergeFrames(frames: ExportMesh[]): { mesh: ExportMesh; ranges: FlipbookRange[] } {
  if (!frames.length) throw new Error('No frames to merge');
  let nv = 0;
  let ni = 0;
  for (const f of frames) (nv += f.vertexCount), (ni += f.indices.length);
  const withN = frames.every((f) => f.normals);
  const withC = frames.every((f) => f.colors);
  const uvCount = Math.min(...frames.map((f) => f.uvSets.length));
  const positions = new Float32Array(nv * 3);
  const normals = withN ? new Float32Array(nv * 3) : null;
  const colors = withC ? new Float32Array(nv * 4) : null;
  const uvs = Array.from({ length: uvCount }, (_, k) => ({ name: frames[0].uvSets[k].name, data: new Float32Array(nv * 2) }));
  const frameAttr = new Float32Array(nv);
  const frameT = new Float32Array(nv);
  const uvFrame = new Float32Array(nv * 2);
  const indices = new Uint32Array(ni);
  const vertexPoint = new Uint32Array(nv);
  const ranges: FlipbookRange[] = [];
  let vo = 0;
  let io = 0;
  frames.forEach((f, i) => {
    positions.set(f.positions, vo * 3);
    normals?.set(f.normals!, vo * 3);
    colors?.set(f.colors!, vo * 4);
    uvs.forEach((u, k) => u.data.set(f.uvSets[k].data, vo * 2));
    for (let v = 0; v < f.vertexCount; v++) {
      frameAttr[vo + v] = i;
      frameT[vo + v] = i / frames.length;
      uvFrame[(vo + v) * 2] = (i + 0.5) / frames.length;
      uvFrame[(vo + v) * 2 + 1] = 0.5;
    }
    for (let t = 0; t < f.indices.length; t++) indices[io + t] = f.indices[t] + vo;
    vertexPoint.set(f.vertexPoint, vo);
    ranges.push({ frame: i, firstVertex: vo, vertexCount: f.vertexCount, firstIndex: io, indexCount: f.indices.length });
    vo += f.vertexCount;
    io += f.indices.length;
  });
  const custom: ExportAttr[] = [{ name: 'frame', size: 1, data: frameAttr, source: 'vertex' }, { name: 'frame_t', size: 1, data: frameT, source: 'vertex' }];
  uvs.push({ name: `uv${uvs.length}`, data: uvFrame });
  return { mesh: { vertexCount: nv, positions, normals, uvSets: uvs, colors, custom, indices, vertexPoint }, ranges };
}

/** Stable pseudo-random 0..1 from an integer id (pivot / VAT random id). */
export function hashId01(id: number): number {
  let h = (id | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type PivotEncoding = 'attributes' | 'uv' | 'vertex_color';
/**
 * PIVOT-BAKED mesh data (documented in docs/EXPORT_GUIDE.md). `m` must carry per-vertex `pivot` (vec3, already in export
 * space), `id` (island / piece index) as custom attributes (written by geometry.bake "pivots" / bakePivots).
 *  - attributes   : custom `pivot` (VEC3), `pivot_offset`, `id`, plus `rand_id` (0..1) and `age` (0..1 normalised id) are exported.
 *  - uv           : adds UV sets  P1 = (pivot.x, pivot.y) and P2 = (pivot.z, rand_id), each normalised to the mesh bounds (min..max -> 0..1).
 *  - vertex_color : replaces Cd with (pivot.xyz normalised to bounds, rand_id). Original colours are dropped (documented).
 * `bounds` of the normalisation are returned for the JSON sidecar.
 */
export function encodePivots(m: ExportMesh, enc: PivotEncoding): { bounds: { min: number[]; max: number[] }; pieces: number } {
  const piv = m.custom.find((a) => a.name === 'pivot');
  const idA = m.custom.find((a) => a.name === 'id');
  if (!piv || piv.size !== 3) throw new Error('Pivot export needs a `pivot` attribute: put a Bake node (mode "Pivots per island") before the export.');
  const n = m.vertexCount;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) for (let c = 0; c < 3; c++) {
    lo[c] = Math.min(lo[c], piv.data[v * 3 + c]);
    hi[c] = Math.max(hi[c], piv.data[v * 3 + c]);
  }
  const span = [0, 1, 2].map((c) => hi[c] - lo[c] || 1);
  let maxId = 0;
  const ids = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    ids[v] = idA ? idA.data[v] : 0;
    maxId = Math.max(maxId, ids[v]);
  }
  const rand = new Float32Array(n);
  const age = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    rand[v] = hashId01(ids[v]);
    age[v] = maxId > 0 ? ids[v] / maxId : 0;
  }
  m.custom.push({ name: 'rand_id', size: 1, data: rand, source: 'vertex' }, { name: 'age', size: 1, data: age, source: 'vertex' });
  const norm = (v: number, c: number): number => (piv.data[v * 3 + c] - lo[c]) / span[c];
  if (enc === 'uv') {
    const a = new Float32Array(n * 2), b = new Float32Array(n * 2);
    for (let v = 0; v < n; v++) (a.set([norm(v, 0), norm(v, 1)], v * 2), b.set([norm(v, 2), rand[v]], v * 2));
    m.uvSets.push({ name: `uv${m.uvSets.length}`, data: a }, { name: `uv${m.uvSets.length + 1}`, data: b });
  } else if (enc === 'vertex_color') {
    const c = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) c.set([norm(v, 0), norm(v, 1), norm(v, 2), rand[v]], v * 4);
    m.colors = c;
  }
  return { bounds: { min: lo, max: hi }, pieces: Math.round(maxId) + 1 };
}
