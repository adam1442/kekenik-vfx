import { MESH_LIMITS, MeshData, MeshLimitError, STD } from '../mesh/mesh';
import { MeshBuilder } from '../mesh/builder';
import { getPool } from '../../workers';

/**
 * Model import: OBJ, GLB and glTF (embedded buffers). Own small parsers (no DOM, no three.js loaders): they run in
 * unit tests and never block on textures. Only GEOMETRY is imported: positions, normals, UV0, vertex colours (COLOR_0 / OBJ `v x y z r g b`).
 * Skinning, morph targets and animation are not imported (documented limitation); Draco / meshopt compressed primitives are skipped with a warning.
 */
export interface ParsedPrim {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  /** RGBA, 4 floats per vertex. */
  colors?: Float32Array;
  /** Triangle list. */
  indices: Uint32Array;
}
export interface ParsedModel {
  format: 'obj' | 'glb' | 'gltf';
  prims: ParsedPrim[];
  vertexCount: number;
  triangleCount: number;
  warnings: string[];
}
export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}
export const MODEL_LIMITS = { maxFileBytes: 256 * 1024 * 1024, maxTriangles: 4_000_000 } as const;

const finish = (format: ParsedModel['format'], prims: ParsedPrim[], warnings: string[]): ParsedModel => {
  let v = 0;
  let t = 0;
  for (const p of prims) {
    v += p.positions.length / 3;
    t += p.indices.length / 3;
  }
  if (t > MODEL_LIMITS.maxTriangles) throw new ModelError(`Model has ${t.toLocaleString()} triangles (limit ${MODEL_LIMITS.maxTriangles.toLocaleString()}). Decimate it first.`);
  return { format, prims, vertexCount: v, triangleCount: t, warnings };
};

/* ------------------------------------------------------------------------------------------------ OBJ */
/** Plain-data result of the OBJ core parser (structured-clone friendly: it can come back from a worker). */
export type ObjCoreResult =
  | { ok: true; prim: ParsedPrim; warnings: string[] }
  | { ok: false; error: string };

/**
 * OBJ parser core. MUST stay self-contained (no imports, no module-level references): `parseObjOffThread` serialises it with
 * `Function.prototype.toString` and runs the very same code in a Worker, so there is exactly one implementation.
 * Errors are returned as data (`ok: false`) so they survive the worker boundary; `parseObj` turns them into `ModelError`.
 */
export function objParseCore(arg: { text: string; maxTriangles: number }): ObjCoreResult {
  const { text, maxTriangles } = arg;
  const P: number[] = [];
  const C: number[] = [];
  let hasColor = false;
  const T: number[] = [];
  const N: number[] = [];
  const warnings: string[] = [];
  const map = new Map<string, number>();
  const outP: number[] = [];
  const outN: number[] = [];
  const outT: number[] = [];
  const outC: number[] = [];
  const idx: number[] = [];
  let hasN = true;
  let hasT = true;
  let failure: string | null = null;
  const vert = (tok: string): number => {
    const hit = map.get(tok);
    if (hit !== undefined) return hit;
    const parts = tok.split('/');
    const rel = (s: string, count: number): number => {
      const i = parseInt(s, 10);
      return i < 0 ? count + i : i - 1;
    };
    const pi = rel(parts[0], P.length / 3);
    if (!(pi >= 0 && pi < P.length / 3)) {
      failure ??= `OBJ: face references vertex ${parts[0]} which does not exist.`;
      return 0;
    }
    const ti = parts[1] ? rel(parts[1], T.length / 2) : -1;
    const ni = parts[2] ? rel(parts[2], N.length / 3) : -1;
    const o = outP.length / 3;
    outP.push(P[pi * 3], P[pi * 3 + 1], P[pi * 3 + 2]);
    if (ti >= 0 && ti < T.length / 2) outT.push(T[ti * 2], T[ti * 2 + 1]);
    else {
      outT.push(0, 0);
      hasT = false;
    }
    if (ni >= 0 && ni < N.length / 3) outN.push(N[ni * 3], N[ni * 3 + 1], N[ni * 3 + 2]);
    else {
      outN.push(0, 0, 1);
      hasN = false;
    }
    outC.push(C[pi * 4], C[pi * 4 + 1], C[pi * 4 + 2], C[pi * 4 + 3]);
    map.set(tok, o);
    return o;
  };
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.charCodeAt(0) === 35) continue;
    const s = l.split(/\s+/);
    switch (s[0]) {
      case 'v': {
        P.push(+s[1], +s[2], +s[3]);
        if (s.length >= 7) {
          hasColor = true;
          C.push(+s[4], +s[5], +s[6], 1);
        } else C.push(1, 1, 1, 1);
        break;
      }
      case 'vt':
        T.push(+s[1], +(s[2] ?? 0));
        break;
      case 'vn':
        N.push(+s[1], +s[2], +s[3]);
        break;
      case 'f': {
        const vs = s.slice(1).map(vert);
        if (failure) return { ok: false, error: failure };
        for (let i = 1; i + 1 < vs.length; i++) idx.push(vs[0], vs[i], vs[i + 1]);
        if (idx.length / 3 > maxTriangles) return { ok: false, error: 'OBJ: triangle limit exceeded.' };
        break;
      }
      default:
    }
  }
  if (!idx.length) return { ok: false, error: 'OBJ: the file contains no faces.' };
  if (P.some((x) => !Number.isFinite(x))) return { ok: false, error: 'OBJ: non-finite vertex coordinates.' };
  if (!hasN) warnings.push('OBJ: some faces have no normals; normals are recomputed.');
  const prim: ParsedPrim = { positions: new Float32Array(outP), indices: new Uint32Array(idx) };
  if (hasN) prim.normals = new Float32Array(outN);
  if (hasT) prim.uvs = new Float32Array(outT);
  if (hasColor) prim.colors = new Float32Array(outC);
  return { ok: true, prim, warnings };
}

const objResult = (r: ObjCoreResult): ParsedModel => {
  if (!r.ok) throw new ModelError(r.error);
  return finish('obj', [r.prim], r.warnings);
};

export function parseObj(text: string): ParsedModel {
  return objResult(objParseCore({ text, maxTriangles: MODEL_LIMITS.maxTriangles }));
}

/** OBJ texts above this size are parsed in a Worker (a 100 MB OBJ would otherwise freeze the UI for seconds). */
export const OBJ_WORKER_THRESHOLD_CHARS = 4_000_000;

/** Same result as `parseObj`, but big files are parsed off the main thread (falls back to the calling thread without Workers). */
export async function parseObjOffThread(text: string): Promise<ParsedModel> {
  if (text.length < OBJ_WORKER_THRESHOLD_CHARS) return parseObj(text);
  // the shared worker pool (typed protocol, crash fallback to the very same function on the calling thread).
  return objResult((await getPool().submit('obj.parse', { text, maxTriangles: MODEL_LIMITS.maxTriangles }, [], { key: 'obj-import' })) as ObjCoreResult);
}

/* ------------------------------------------------------------------------------------------------ glTF / GLB */
interface GltfJson {
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string; sparse?: unknown }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number; extensions?: Record<string, unknown> }[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  extensionsRequired?: string[];
}
const COMP: Record<number, { size: number; read: (v: DataView, o: number) => number; max: number }> = {
  5120: { size: 1, read: (v, o) => v.getInt8(o), max: 127 },
  5121: { size: 1, read: (v, o) => v.getUint8(o), max: 255 },
  5122: { size: 2, read: (v, o) => v.getInt16(o, true), max: 32767 },
  5123: { size: 2, read: (v, o) => v.getUint16(o, true), max: 65535 },
  5125: { size: 4, read: (v, o) => v.getUint32(o, true), max: 4294967295 },
  5126: { size: 4, read: (v, o) => v.getFloat32(o, true), max: 1 },
};
const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

type Mat4 = number[];
const IDENT: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a: Mat4, b: Mat4): Mat4 => {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const trs = (t: number[] = [0, 0, 0], q: number[] = [0, 0, 0, 1], s: number[] = [1, 1, 1]): Mat4 => {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0, 2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0, 2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
};
/** Inverse-transpose of the upper 3x3 (normal matrix), row-major 9 values. */
function normalMatrix(m: Mat4): number[] {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
}

export function parseGltf(json: GltfJson, buffers: (ArrayBuffer | null)[]): ParsedModel {
  const warnings: string[] = [];
  if (json.extensionsRequired?.some((e) => /draco|meshopt/i.test(e))) warnings.push(`glTF requires ${json.extensionsRequired.join(', ')}: compressed primitives are skipped.`);
  const readAccessor = (ai: number): { data: Float32Array | Uint32Array; n: number; comps: number } | null => {
    const a = json.accessors?.[ai];
    if (!a) return null;
    if (a.sparse) warnings.push('Sparse accessors are not supported (ignored).');
    const comps = NCOMP[a.type];
    const ct = COMP[a.componentType];
    if (!comps || !ct) return null;
    const isF = a.componentType === 5126;
    const out = isF ? new Float32Array(a.count * comps) : a.type === 'SCALAR' ? new Uint32Array(a.count) : new Float32Array(a.count * comps);
    if (a.bufferView === undefined) return { data: out, n: a.count, comps };
    const bv = json.bufferViews?.[a.bufferView];
    const buf = bv ? buffers[bv.buffer] : null;
    if (!bv || !buf) return null;
    const stride = bv.byteStride || ct.size * comps;
    const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (base + (a.count - 1) * stride + ct.size * comps > buf.byteLength) throw new ModelError('glTF: accessor reads past the end of its buffer.');
    const view = new DataView(buf);
    const norm = !isF && a.normalized;
    for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
      const v = ct.read(view, base + i * stride + c * ct.size);
      out[i * comps + c] = norm ? Math.max(v / ct.max, -1) : v;
    }
    return { data: out, n: a.count, comps };
  };

  const prims: ParsedPrim[] = [];
  let triTotal = 0;
  const visit = (ni: number, parent: Mat4, depth: number): void => {
    const node = json.nodes?.[ni];
    if (!node || depth > 64) return;
    const local = node.matrix && node.matrix.length === 16 ? node.matrix : trs(node.translation, node.rotation, node.scale);
    const world = mul(parent, local);
    if (node.mesh !== undefined) {
      const nm = normalMatrix(world);
      for (const pr of json.meshes?.[node.mesh]?.primitives ?? []) {
        const mode = pr.mode ?? 4;
        if (pr.extensions && ('KHR_draco_mesh_compression' in pr.extensions || 'EXT_meshopt_compression' in pr.extensions)) continue;
        if (![4, 5, 6].includes(mode)) {
          warnings.push(`glTF primitive mode ${mode} (points / lines) skipped.`);
          continue;
        }
        const pos = pr.attributes.POSITION !== undefined ? readAccessor(pr.attributes.POSITION) : null;
        if (!pos) continue;
        const vc = pos.n;
        const positions = new Float32Array(vc * 3);
        for (let i = 0; i < vc; i++) {
          const x = pos.data[i * 3], y = pos.data[i * 3 + 1], z = pos.data[i * 3 + 2];
          positions[i * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
          positions[i * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
          positions[i * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
        }
        const prim: ParsedPrim = { positions, indices: new Uint32Array(0) };
        const nrm = pr.attributes.NORMAL !== undefined ? readAccessor(pr.attributes.NORMAL) : null;
        if (nrm) {
          const o = new Float32Array(vc * 3);
          for (let i = 0; i < vc; i++) {
            const x = nrm.data[i * 3], y = nrm.data[i * 3 + 1], z = nrm.data[i * 3 + 2];
            const nx = nm[0] * x + nm[1] * y + nm[2] * z, ny = nm[3] * x + nm[4] * y + nm[5] * z, nz = nm[6] * x + nm[7] * y + nm[8] * z;
            const l = Math.hypot(nx, ny, nz) || 1;
            o[i * 3] = nx / l;
            o[i * 3 + 1] = ny / l;
            o[i * 3 + 2] = nz / l;
          }
          prim.normals = o;
        }
        const uv = pr.attributes.TEXCOORD_0 !== undefined ? readAccessor(pr.attributes.TEXCOORD_0) : null;
        if (uv) prim.uvs = uv.data as Float32Array;
        const col = pr.attributes.COLOR_0 !== undefined ? readAccessor(pr.attributes.COLOR_0) : null;
        if (col) {
          const o = new Float32Array(vc * 4);
          for (let i = 0; i < vc; i++) for (let c = 0; c < 4; c++) o[i * 4 + c] = c < col.comps ? col.data[i * col.comps + c] : 1;
          prim.colors = o;
        }
        let ind: number[];
        if (pr.indices !== undefined) {
          const a = readAccessor(pr.indices);
          if (!a) continue;
          ind = Array.from(a.data as Uint32Array);
        } else ind = Array.from({ length: vc }, (_, i) => i);
        const tri: number[] = [];
        if (mode === 4) for (let i = 0; i + 2 < ind.length; i += 3) tri.push(ind[i], ind[i + 1], ind[i + 2]);
        else if (mode === 5) for (let i = 0; i + 2 < ind.length; i++) {
          if (i % 2) tri.push(ind[i + 1], ind[i], ind[i + 2]);
          else tri.push(ind[i], ind[i + 1], ind[i + 2]);
        }
        else for (let i = 1; i + 1 < ind.length; i++) tri.push(ind[0], ind[i], ind[i + 1]);
        if (tri.some((i) => i >= vc)) throw new ModelError('glTF: index out of range.');
        // mirrored transforms flip the winding
        const det = world[0] * (world[5] * world[10] - world[6] * world[9]) - world[4] * (world[1] * world[10] - world[2] * world[9]) + world[8] * (world[1] * world[6] - world[2] * world[5]);
        if (det < 0) for (let i = 0; i + 2 < tri.length; i += 3) [tri[i + 1], tri[i + 2]] = [tri[i + 2], tri[i + 1]];
        prim.indices = Uint32Array.from(tri);
        triTotal += tri.length / 3;
        if (triTotal > MODEL_LIMITS.maxTriangles) throw new ModelError(`Model exceeds ${MODEL_LIMITS.maxTriangles.toLocaleString()} triangles. Decimate it first.`);
        prims.push(prim);
      }
    }
    for (const c of node.children ?? []) visit(c, world, depth + 1);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, IDENT, 0);
  if (!prims.length) throw new ModelError('glTF: no triangle meshes found.');
  return finish('gltf', prims, warnings);
}

const b64 = (s: string): ArrayBuffer => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

export function parseGlb(buf: ArrayBuffer): ParsedModel {
  const v = new DataView(buf);
  if (buf.byteLength < 20 || v.getUint32(0, true) !== 0x46546c67) throw new ModelError('GLB: bad magic number.');
  if (v.getUint32(4, true) !== 2) throw new ModelError('GLB: only version 2 is supported.');
  let p = 12;
  let json: GltfJson | null = null;
  let bin: ArrayBuffer | null = null;
  while (p + 8 <= buf.byteLength) {
    const len = v.getUint32(p, true);
    const type = v.getUint32(p + 4, true);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
    else if (type === 0x004e4942 && !bin) bin = data;
    p += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new ModelError('GLB: missing JSON chunk.');
  const buffers = (json.buffers ?? []).map((b, i) => (b.uri ? (b.uri.startsWith('data:') ? b64(b.uri.slice(b.uri.indexOf(',') + 1)) : null) : i === 0 ? bin : null));
  const m = parseGltf(json, buffers);
  return { ...m, format: 'glb' };
}

/** glTF JSON text with embedded (data URI) buffers. */
export function parseGltfText(text: string): ParsedModel {
  const json = JSON.parse(text) as GltfJson;
  const missing: string[] = [];
  const buffers = (json.buffers ?? []).map((b) => {
    if (b.uri?.startsWith('data:')) return b64(b.uri.slice(b.uri.indexOf(',') + 1));
    if (b.uri) missing.push(b.uri);
    return null;
  });
  if (missing.length) throw new ModelError(`glTF references external files (${missing.slice(0, 2).join(', ')}). Use a .glb or embed the buffers.`);
  return parseGltf(json, buffers);
}

export function parseModel(bytes: Uint8Array, name: string): ParsedModel {
  if (bytes.byteLength > MODEL_LIMITS.maxFileBytes) throw new ModelError('Model file is too large.');
  const ext = name.split('.').pop()?.toLowerCase();
  const isGlb = bytes.byteLength > 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
  if (isGlb) return parseGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const text = new TextDecoder().decode(bytes);
  if (ext === 'gltf' || text.trimStart().startsWith('{')) return parseGltfText(text);
  if (ext === 'obj' || /^\s*(v|vn|vt|f|o|g|#|mtllib)\s/m.test(text)) return parseObj(text);
  throw new ModelError(`Unsupported model format ".${ext}". Use GLB, glTF or OBJ.`);
}

/** `parseModel` that keeps the UI responsive for big OBJ files (other formats are binary and already fast). */
export async function parseModelAsync(bytes: Uint8Array, name: string): Promise<ParsedModel> {
  const isObj = name.toLowerCase().endsWith('.obj') && bytes.byteLength >= OBJ_WORKER_THRESHOLD_CHARS;
  if (!isObj) return parseModel(bytes, name);
  if (bytes.byteLength > MODEL_LIMITS.maxFileBytes) throw new ModelError('Model file is too large.');
  return parseObjOffThread(new TextDecoder().decode(bytes));
}

/* ------------------------------------------------------------------------------------------------ -> MeshData */
export interface ModelOptions {
  scale: number;
  axis: 'none' | 'y_up_to_z_up' | 'z_up_to_y_up';
  uvFlip: 'auto' | 'on' | 'off';
  pivot: 'none' | 'center' | 'base';
}
export const defaultModelOptions = (): ModelOptions => ({ scale: 1, axis: 'y_up_to_z_up', uvFlip: 'auto', pivot: 'none' });

export function modelToMesh(m: ParsedModel, o: ModelOptions): MeshData {
  if (m.vertexCount > MESH_LIMITS.maxPoints) throw new MeshLimitError(`Model has ${m.vertexCount.toLocaleString()} vertices (cap ${MESH_LIMITS.maxPoints.toLocaleString()}).`);
  const flip = o.uvFlip === 'on' || (o.uvFlip === 'auto' && m.format !== 'obj'); // glTF v runs downwards, OBJ upwards
  const allN = m.prims.every((p) => p.normals);
  const anyC = m.prims.some((p) => p.colors);
  const b = new MeshBuilder('import');
  const N: number[] = [];
  const C: number[] = [];
  const xf = (x: number, y: number, z: number): [number, number, number] => {
    const s = o.scale;
    if (o.axis === 'y_up_to_z_up') return [x * s, -z * s, y * s];
    if (o.axis === 'z_up_to_y_up') return [x * s, z * s, -y * s];
    return [x * s, y * s, z * s];
  };
  for (const p of m.prims) {
    const base = b.pointCount;
    const n = p.positions.length / 3;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = xf(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]);
      b.addPoint(x, y, z);
      if (allN) {
        const [nx, ny, nz] = xf(p.normals![i * 3], p.normals![i * 3 + 1], p.normals![i * 3 + 2]);
        const l = Math.hypot(nx, ny, nz) || 1;
        N.push(nx / l, ny / l, nz / l);
      }
      if (anyC) C.push(p.colors ? p.colors[i * 4] : 1, p.colors ? p.colors[i * 4 + 1] : 1, p.colors ? p.colors[i * 4 + 2] : 1, p.colors ? p.colors[i * 4 + 3] : 1);
    }
    const uv = (i: number): [number, number] => (p.uvs ? [p.uvs[i * 2], flip ? 1 - p.uvs[i * 2 + 1] : p.uvs[i * 2 + 1]] : [0, 0]);
    // The axis swap y_up_to_z_up is a proper rotation; z_up_to_y_up too: winding is preserved.
    for (let t = 0; t < p.indices.length; t += 3) {
      const a = p.indices[t], c = p.indices[t + 1], d = p.indices[t + 2];
      b.tri(base + a, base + c, base + d, [...uv(a), ...uv(c), ...uv(d)]);
    }
  }
  const mesh = b.build({ normals: !allN });
  if (allN) mesh.setAttr({ name: STD.N, element: 'point', size: 3, kind: 'f32', data: new Float32Array(N) });
  if (anyC) mesh.setAttr({ name: STD.Cd, element: 'point', size: 4, kind: 'f32', data: new Float32Array(C) });
  if (o.pivot !== 'none') {
    const P = mesh.positions;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      mnx = Math.min(mnx, P[i]); mxx = Math.max(mxx, P[i]);
      mny = Math.min(mny, P[i + 1]); mxy = Math.max(mxy, P[i + 1]);
      mnz = Math.min(mnz, P[i + 2]); mxz = Math.max(mxz, P[i + 2]);
    }
    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = o.pivot === 'base' ? mnz : (mnz + mxz) / 2;
    const out = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      out[i] = P[i] - cx;
      out[i + 1] = P[i + 1] - cy;
      out[i + 2] = P[i + 2] - cz;
    }
    mesh.setAttr({ name: STD.P, element: 'point', size: 3, kind: 'f32', data: out });
  }
  return mesh;
}
