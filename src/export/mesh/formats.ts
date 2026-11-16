import { ByteBuilder, concatBytes, utf8 } from '../bytes';
import { exportBounds, type ExportMesh } from './build';

/**
 * Mesh writers: GLB / glTF 2.0, OBJ, PLY (binary little endian). All take an ExportMesh (already in the target
 * coordinate system, see build.ts). UV conversion: glTF flips v (v' = 1 - v, image origin top-left); OBJ / PLY keep v up.
 * Custom attributes are written as application-specific glTF attributes (`_NAME`, VEC1..VEC4 float) and ALSO described in
 * `meshes[0].extras.kekenik` so tools that ignore custom attributes can still read what they mean.
 */
export interface MeshMeta {
  name: string;
  generator?: string;
  /** Free-form metadata copied into glTF extras. */
  extras?: Record<string, unknown>;
}

const GL = { ARRAY: 34962, ELEMENT: 34963, F32: 5126, U16: 5123, U32: 5125 } as const;
const TYPE = ['', 'SCALAR', 'VEC2', 'VEC3', 'VEC4'];
export const gltfAttrName = (n: string): string => `_${n.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;

export interface GltfBuild {
  json: Record<string, unknown>;
  bin: Uint8Array;
}

export function buildGltf(m: ExportMesh, meta: MeshMeta, binUri?: string): GltfBuild {
  const views: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const addView = (data: Uint8Array, target: number): number => {
    const pad = (4 - (data.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target });
    chunks.push(data, new Uint8Array(pad));
    offset += data.length + pad;
    return views.length - 1;
  };
  const bytesOf = (f: Float32Array): Uint8Array => new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  const addAcc = (f: Float32Array, size: 1 | 2 | 3 | 4, extra: Record<string, unknown> = {}): number => {
    accessors.push({ bufferView: addView(bytesOf(f), GL.ARRAY), componentType: GL.F32, count: f.length / size, type: TYPE[size], ...extra });
    return accessors.length - 1;
  };
  const attrs: Record<string, number> = {};
  const b = exportBounds(m);
  attrs.POSITION = addAcc(m.positions, 3, { min: b.min, max: b.max });
  if (m.normals) attrs.NORMAL = addAcc(m.normals, 3);
  m.uvSets.forEach((u, i) => {
    const f = new Float32Array(u.data.length);
    for (let k = 0; k < f.length; k += 2) (f[k] = u.data[k], (f[k + 1] = 1 - u.data[k + 1]));
    attrs[`TEXCOORD_${i}`] = addAcc(f, 2);
  });
  if (m.colors) attrs.COLOR_0 = addAcc(m.colors, 4);
  const used = new Set<string>();
  const customDesc: Record<string, unknown>[] = [];
  for (const a of m.custom) {
    let n = gltfAttrName(a.name);
    while (used.has(n)) n += '_';
    used.add(n);
    attrs[n] = addAcc(a.data, a.size);
    customDesc.push({ name: a.name, gltf: n, components: a.size, source: a.source });
  }
  const useU16 = m.vertexCount <= 65535;
  const idxBytes = useU16 ? new Uint8Array(Uint16Array.from(m.indices).buffer) : new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength);
  accessors.push({ bufferView: addView(idxBytes, GL.ELEMENT), componentType: useU16 ? GL.U16 : GL.U32, count: m.indices.length, type: 'SCALAR' });
  const indicesAcc = accessors.length - 1;
  const bin = concatBytes(chunks);
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: meta.generator ?? 'Kekenik VFX' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: meta.name, mesh: 0 }],
    meshes: [{ name: meta.name, primitives: [{ attributes: attrs, indices: indicesAcc, mode: 4 }], extras: { kekenik: { uvFlip: 'v = 1 - v (glTF image origin top-left)', customAttributes: customDesc, uvSets: m.uvSets.map((u, i) => ({ index: i, name: u.name })), ...meta.extras } } }],
    accessors,
    bufferViews: views,
    buffers: [binUri ? { byteLength: bin.length, uri: binUri } : { byteLength: bin.length }],
  };
  return { json, bin };
}

/** Wrap a glTF JSON + binary payload into a GLB container (JSON chunk padded with spaces, BIN chunk with zeros). */
export function toGlb(g: GltfBuild): Uint8Array {
  const jsonBytes = utf8(JSON.stringify(g.json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  const bpad = (4 - (g.bin.length % 4)) % 4;
  const jlen = jsonBytes.length + jpad;
  const blen = g.bin.length + bpad;
  const total = 12 + 8 + jlen + 8 + blen;
  const b = new ByteBuilder(total);
  b.u32(0x46546c67).u32(2).u32(total); // 'glTF', version 2, length
  b.u32(jlen).u32(0x4e4f534a).bytes(jsonBytes);
  for (let i = 0; i < jpad; i++) b.u8(0x20);
  b.u32(blen).u32(0x004e4942).bytes(g.bin);
  for (let i = 0; i < bpad; i++) b.u8(0);
  return b.result();
}

/* ------------------------------------------------------------------------------------------------ OBJ */
/** OBJ as a list of UTF-8 parts (never one giant string). Only the first UV set is written (OBJ has one). */
export function buildObj(m: ExportMesh, meta: MeshMeta): Uint8Array[] {
  const parts: Uint8Array[] = [];
  const f = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''));
  parts.push(utf8(`# ${meta.generator ?? 'Kekenik VFX'} OBJ export: ${meta.name}\n# ${m.vertexCount} vertices, ${m.indices.length / 3} triangles${m.uvSets.length > 1 ? `\n# NOTE: OBJ stores one UV set; ${m.uvSets.length - 1} further set(s) were dropped (use GLB / PLY)` : ''}\no ${meta.name.replace(/\s+/g, '_')}\n`));
  const uv = m.uvSets[0]?.data;
  const BATCH = 20000;
  for (let s = 0; s < m.vertexCount; s += BATCH) {
    const e = Math.min(m.vertexCount, s + BATCH);
    const lines: string[] = [];
    for (let v = s; v < e; v++) lines.push(`v ${f(m.positions[v * 3])} ${f(m.positions[v * 3 + 1])} ${f(m.positions[v * 3 + 2])}${m.colors ? ` ${f(m.colors[v * 4])} ${f(m.colors[v * 4 + 1])} ${f(m.colors[v * 4 + 2])}` : ''}`);
    parts.push(utf8(`${lines.join('\n')}\n`));
  }
  if (uv) for (let s = 0; s < m.vertexCount; s += BATCH) {
    const e = Math.min(m.vertexCount, s + BATCH);
    const lines: string[] = [];
    for (let v = s; v < e; v++) lines.push(`vt ${f(uv[v * 2])} ${f(uv[v * 2 + 1])}`);
    parts.push(utf8(`${lines.join('\n')}\n`));
  }
  if (m.normals) for (let s = 0; s < m.vertexCount; s += BATCH) {
    const e = Math.min(m.vertexCount, s + BATCH);
    const lines: string[] = [];
    for (let v = s; v < e; v++) lines.push(`vn ${f(m.normals[v * 3])} ${f(m.normals[v * 3 + 1])} ${f(m.normals[v * 3 + 2])}`);
    parts.push(utf8(`${lines.join('\n')}\n`));
  }
  const ref = (i: number): string => (uv && m.normals ? `${i}/${i}/${i}` : uv ? `${i}/${i}` : m.normals ? `${i}//${i}` : `${i}`);
  for (let s = 0; s < m.indices.length; s += BATCH * 3) {
    const e = Math.min(m.indices.length, s + BATCH * 3);
    const lines: string[] = [];
    for (let t = s; t < e; t += 3) lines.push(`f ${ref(m.indices[t] + 1)} ${ref(m.indices[t + 1] + 1)} ${ref(m.indices[t + 2] + 1)}`);
    parts.push(utf8(`${lines.join('\n')}\n`));
  }
  return parts;
}

/* ------------------------------------------------------------------------------------------------ PLY */
/** Binary little-endian PLY: x y z, nx ny nz, s t (first UV set), red green blue alpha (uchar), custom float properties. */
export function buildPly(m: ExportMesh, meta: MeshMeta): Uint8Array {
  const props: string[] = ['float x', 'float y', 'float z'];
  if (m.normals) props.push('float nx', 'float ny', 'float nz');
  if (m.uvSets.length) props.push('float s', 'float t');
  if (m.colors) props.push('uchar red', 'uchar green', 'uchar blue', 'uchar alpha');
  const customNames: string[] = [];
  for (const a of m.custom) for (let c = 0; c < a.size; c++) {
    const n = a.size === 1 ? a.name : `${a.name}_${'xyzw'[c]}`;
    customNames.push(n);
    props.push(`float ${n.replace(/[^A-Za-z0-9_]/g, '_')}`);
  }
  const tris = m.indices.length / 3;
  const header = `ply\nformat binary_little_endian 1.0\ncomment ${meta.generator ?? 'Kekenik VFX'}: ${meta.name}\ncomment uv: v up (not flipped)\nelement vertex ${m.vertexCount}\n${props.map((p) => `property ${p}`).join('\n')}\nelement face ${tris}\nproperty list uchar int vertex_indices\nend_header\n`;
  const stride = props.reduce((n, p) => n + (p.startsWith('uchar') ? 1 : 4), 0);
  const body = new Uint8Array(m.vertexCount * stride + tris * 13);
  const dv = new DataView(body.buffer);
  let o = 0;
  const q = (v: number): number => Math.min(255, Math.max(0, Math.round(v * 255)));
  for (let v = 0; v < m.vertexCount; v++) {
    for (let c = 0; c < 3; c++, o += 4) dv.setFloat32(o, m.positions[v * 3 + c], true);
    if (m.normals) for (let c = 0; c < 3; c++, o += 4) dv.setFloat32(o, m.normals[v * 3 + c], true);
    if (m.uvSets.length) for (let c = 0; c < 2; c++, o += 4) dv.setFloat32(o, m.uvSets[0].data[v * 2 + c], true);
    if (m.colors) for (let c = 0; c < 4; c++) dv.setUint8(o++, q(m.colors[v * 4 + c]));
    for (const a of m.custom) for (let c = 0; c < a.size; c++, o += 4) dv.setFloat32(o, a.data[v * a.size + c], true);
  }
  for (let t = 0; t < tris; t++) {
    dv.setUint8(o++, 3);
    for (let c = 0; c < 3; c++, o += 4) dv.setInt32(o, m.indices[t * 3 + c], true);
  }
  return concatBytes([utf8(header), body.subarray(0, o)]);
}
