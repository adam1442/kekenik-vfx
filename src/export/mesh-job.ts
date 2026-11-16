import { asMesh } from '../engine/mesh/accounting';
import { bakePivots } from '../engine/mesh/history';
import type { MeshData } from '../engine/mesh/mesh';
import { delay } from '../shared/util';
import { concatBytes } from './bytes';
import { imageFormat, type ImageSpec } from './encoders';
import { AXIS_MATRICES, ENGINE_PRESETS, type EngineId, type MeshAxis } from './engines';
import { CancelledExport, producerTarget, resolveNodeParams, type JobEnv, type JobResult } from './job-env';
import { buildExportMesh, encodePivots, mergeFrames, type ExportMesh, type PivotEncoding } from './mesh/build';
import { buildGltf, buildObj, buildPly, toGlb } from './mesh/formats';
import { buildRigidVat, rigidVatRows, softBounds, softVatRows, vatMetadata, vatRowUv, vec3Bounds, type VatBounds } from './mesh/vat';
import { expandTemplate } from './naming';

/**
 * MESH EXPORT JOB: single mesh, mesh flipbook, VAT (soft / rigid), pivot-baked mesh. The mesh is evaluated through the
 * normal evaluator (`engine.evaluator.evaluate`, animation applied by the time), converted to an ExportMesh and written by the
 * format writers. VAT needs constant topology; the all-frames buffers are capped (512 MB) with a clear error.
 */
export type MeshMode = 'mesh' | 'flipbook' | 'vat_soft' | 'vat_rigid' | 'pivot';
const FRAME_CAP_BYTES = 512 * 1024 * 1024;

export interface MeshJobSettings {
  mode: MeshMode;
  format: 'glb' | 'gltf' | 'obj' | 'ply';
  engine: EngineId;
  axis: MeshAxis;
  scale: number;
  normals: boolean;
  custom: boolean;
  frameStart: number;
  frameCount: number;
  fps: number;
  template: string;
  vatFormat: 'exr_half' | 'exr_float' | 'png16' | 'png8';
  vatOffset: boolean;
  vatNormals: boolean;
  vatLoop: boolean;
  pivotMode: 'centroid' | 'bounds' | 'base' | 'top';
  pivotEncoding: PivotEncoding;
}

export function resolveMeshSettings(p: Record<string, unknown>, g: { fps: number; loopLength: number }): MeshJobSettings {
  const preset = ENGINE_PRESETS[(String(p.engine) in ENGINE_PRESETS ? String(p.engine) : 'none') as EngineId];
  const axisP = String(p.axis ?? 'engine');
  const axis: MeshAxis = axisP in AXIS_MATRICES ? (axisP as MeshAxis) : preset.meshAxis;
  const us = typeof p.unit_scale === 'number' ? p.unit_scale : 0;
  const mode = (['mesh', 'flipbook', 'vat_soft', 'vat_rigid', 'pivot'].includes(String(p.mode)) ? String(p.mode) : 'mesh') as MeshMode;
  const fc = typeof p.frame_count === 'number' && p.frame_count > 0 ? p.frame_count : g.loopLength;
  return {
    mode,
    format: (['glb', 'gltf', 'obj', 'ply'].includes(String(p.mesh_format)) ? String(p.mesh_format) : 'glb') as MeshJobSettings['format'],
    engine: preset.id,
    axis,
    scale: us > 0 ? us : preset.meshScale,
    normals: p.normals !== false,
    custom: p.custom_attrs !== false || mode === 'vat_rigid' || mode === 'pivot',
    frameStart: typeof p.frame_start === 'number' ? p.frame_start : 0,
    frameCount: mode === 'flipbook' || mode === 'vat_soft' || mode === 'vat_rigid' ? Math.max(1, Math.min(4096, fc)) : 1,
    fps: g.fps,
    template: typeof p.file_name === 'string' && p.file_name ? p.file_name : '{graph}_{node}',
    vatFormat: (['exr_half', 'exr_float', 'png16', 'png8'].includes(String(p.vat_format)) ? String(p.vat_format) : 'exr_half') as MeshJobSettings['vatFormat'],
    vatOffset: p.vat_offset === true,
    vatNormals: p.vat_normals !== false,
    vatLoop: p.vat_loop !== false,
    pivotMode: (['centroid', 'bounds', 'base', 'top'].includes(String(p.pivot_mode)) ? String(p.pivot_mode) : 'bounds') as MeshJobSettings['pivotMode'],
    pivotEncoding: (['attributes', 'uv', 'vertex_color'].includes(String(p.pivot_encoding)) ? String(p.pivot_encoding) : 'uv') as PivotEncoding,
  };
}

async function evalMesh(env: JobEnv, nodeId: string, time: number): Promise<MeshData> {
  const t = producerTarget(env.graph, nodeId, 'input');
  if (!t) throw new Error('Export Mesh has no input connected');
  const res = await env.engine.evaluator.evaluate(env.graph, [t], { time, scale: 1, token: env.gate, useCache: true });
  try {
    if (res.cancelled) throw new CancelledExport();
    const err = res.errors.get(t.nodeId) ?? [...res.errors.values()][0];
    if (err) throw new Error(err);
    const v = [...res.values.values()][0];
    const m = asMesh(v);
    if (!m) throw new Error('The connected node did not produce a mesh');
    return m;
  } finally {
    // The MeshData stays valid (plain CPU arrays); we only drop the evaluator's reference counts.
    res.release();
  }
}

export function meshFileSet(s: MeshJobSettings, base: string): { main: string[]; json: string } {
  const ext = s.format;
  const suffix = s.mode === 'vat_soft' || s.mode === 'vat_rigid' ? '.vat.json' : s.mode === 'flipbook' ? '.meshflipbook.json' : s.mode === 'pivot' ? '.pivot.json' : '.json';
  return { main: s.format === 'gltf' ? [`${base}.gltf`, `${base}.bin`] : [`${base}.${ext}`], json: `${base}${suffix}` };
}

async function writeMesh(env: JobEnv, em: ExportMesh, s: MeshJobSettings, base: string, extras: Record<string, unknown>, files: string[]): Promise<void> {
  const meta = { name: base.split('/').pop() ?? 'mesh', extras };
  const set = meshFileSet(s, base).main;
  if (s.format === 'glb') await env.target.writeFile(set[0], toGlb(buildGltf(em, meta)), 'model/gltf-binary');
  else if (s.format === 'gltf') {
    const g = buildGltf(em, meta, set[1].split('/').pop());
    await env.target.writeFile(set[0], JSON.stringify(g.json), 'model/gltf+json');
    await env.target.writeFile(set[1], g.bin, 'application/octet-stream');
  } else if (s.format === 'obj') await env.target.writeFile(set[0], concatBytes(buildObj(em, meta)), 'text/plain');
  else await env.target.writeFile(set[0], buildPly(em, meta), 'application/octet-stream');
  files.push(...set);
}

const frameBytes = (m: ExportMesh): number => m.vertexCount * 4 * (3 + (m.normals ? 3 : 0) + 2 * m.uvSets.length + (m.colors ? 4 : 0) + m.custom.reduce((n, a) => n + a.size, 0)) + m.indices.byteLength;

export async function runMeshJob(env: JobEnv, nodeId: string): Promise<JobResult> {
  const node = env.graph.nodes.get(nodeId);
  if (!node) throw new Error('Export node no longer exists');
  const p = resolveNodeParams(env, nodeId);
  const s = resolveMeshSettings(p, env.graph.settings);
  const base = expandTemplate(s.template.replace(/_?\{frame(:\d+)?\}/g, ''), { graph: env.graphName, node: node.name, engine: s.engine, format: s.format, frame: s.frameStart, now: env.now }).path;
  const files: string[] = [];
  const opts = { axis: s.axis, scale: s.scale, normals: s.normals, custom: s.custom };
  const coord = { coordinateSystem: s.axis, unitScale: s.scale, engine: s.engine, uvConvention: 'glTF: v flipped; OBJ / PLY: v up' };
  const at = (i: number): number => (s.frameStart + i) / s.fps;
  const first = await evalMesh(env, nodeId, at(0));
  await delay(60); // CPU texture snapshots (Bake: texture -> vertex data) arrive asynchronously: evaluate once more
  const mesh0 = await evalMesh(env, nodeId, at(0));
  void first;

  /* ---------------------------------------------------------------------------------------- single mesh / pivot */
  if (s.mode === 'mesh' || s.mode === 'pivot') {
    let m = mesh0;
    if (s.mode === 'pivot' && !m.has('point', 'pivot')) {
      env.log('info', `No pivot attribute found: baking pivots (${s.pivotMode}) per island`);
      m = bakePivots(m, { pivot: s.pivotMode, toUvSet: -1 });
    }
    const em = buildExportMesh(m, opts);
    let extra: Record<string, unknown> = {};
    if (s.mode === 'pivot') {
      const info = encodePivots(em, s.pivotEncoding);
      extra = {
        pivot: {
          encoding: s.pivotEncoding,
          pieces: info.pieces,
          boundsMin: info.bounds.min,
          boundsMax: info.bounds.max,
          layout: { attributes: 'custom attributes `pivot` (VEC3, export space), `pivot_offset`, `id`, `rand_id` (0..1), `age` (id / maxId)', uv: `UV set ${em.uvSets.length - 2}: (pivot.x, pivot.y) normalised to the bounds; UV set ${em.uvSets.length - 1}: (pivot.z normalised, rand_id)`, vertex_color: 'COLOR_0 = (pivot.xyz normalised to the bounds, rand_id)' }[s.pivotEncoding],
          decode: 'pivot = boundsMin + encoded * (boundsMax - boundsMin)',
        },
      };
    }
    await writeMesh(env, em, s, base, { ...coord, ...extra }, files);
    if (s.mode === 'pivot') {
      const jp = meshFileSet(s, base).json;
      await env.target.writeFile(jp, JSON.stringify({ format: 'kekenik-pivot-mesh', version: 1, mesh: files[0], ...coord, ...extra, vertexCount: em.vertexCount, generator: 'Kekenik VFX' }, null, 2), 'application/json');
      files.push(jp);
    }
    env.onProgress(1);
    env.log('info', `wrote ${files.join(', ')} (${em.vertexCount} vertices, ${em.indices.length / 3} triangles)`);
    return { files, bytes: env.target.files.reduce((n, f) => n + f.bytes, 0) };
  }

  /* ---------------------------------------------------------------------------------------- frames */
  const F = s.frameCount;
  const frames: ExportMesh[] = [];
  let total = 0;
  for (let i = 0; i < F; i++) {
    await env.gate.checkpoint();
    const m = i === 0 ? mesh0 : await evalMesh(env, nodeId, at(i));
    const em = buildExportMesh(m, { ...opts, normals: s.mode === 'flipbook' ? s.normals : s.mode === 'vat_soft' ? s.vatNormals : false });
    if (i > 0 && (s.mode === 'vat_soft' || s.mode === 'vat_rigid') && em.vertexCount !== frames[0].vertexCount) throw new Error(`VAT needs constant topology: frame ${s.frameStart + i} has ${em.vertexCount} vertices, frame ${s.frameStart} has ${frames[0].vertexCount}.`);
    total += s.mode === 'flipbook' ? frameBytes(em) : em.vertexCount * 24;
    if (total > FRAME_CAP_BYTES) throw new Error(`The frames need more than ${FRAME_CAP_BYTES / 1048576} MB of RAM (${i + 1} of ${F} frames read). Reduce the frame count or the vertex count.`);
    if (s.mode === 'vat_soft' || s.mode === 'vat_rigid') {
      // keep only what the VAT needs for frames > 0 (positions, normals): topology / uv / colour come from frame 0
      if (i > 0) Object.assign(em, { uvSets: [], colors: null, custom: [], indices: new Uint32Array(0) });
    }
    frames.push(em);
    env.onProgress(((i + 1) / F) * (s.mode === 'flipbook' ? 0.9 : 0.5), `frame ${s.frameStart + i}`);
  }

  if (s.mode === 'flipbook') {
    const { mesh, ranges } = mergeFrames(frames);
    await writeMesh(env, mesh, s, base, { ...coord, meshFlipbook: { frames: F, fps: s.fps, firstFrame: s.frameStart, frameAttribute: 'frame / frame_t (custom, per vertex)', uvSet: `UV set ${mesh.uvSets.length - 1}: u = (frame + 0.5) / frames, v = 0.5`, ranges } }, files);
    const jp = meshFileSet(s, base).json;
    await env.target.writeFile(jp, JSON.stringify({ format: 'kekenik-mesh-flipbook', version: 1, mesh: files[0], frames: F, fps: s.fps, duration: F / s.fps, loop: true, vertexCount: mesh.vertexCount, indexCount: mesh.indices.length, frameAttribute: 'custom attribute "frame" (float index) and "frame_t" (0..1)', frameUv: `UV set ${mesh.uvSets.length - 1} (u = (frame + 0.5) / frames)`, ranges, ...coord, generator: 'Kekenik VFX' }, null, 2), 'application/json');
    files.push(jp);
    env.onProgress(1);
    return { files, bytes: env.target.files.reduce((n, f) => n + f.bytes, 0) };
  }

  /* ---------------------------------------------------------------------------------------- VAT */
  const maxDim = env.engine.gpu.caps.limits.maxTextureDimension2D ?? 8192;
  const rest = frames[0];
  const isExr = s.vatFormat.startsWith('exr');
  const normalize = !isExr;
  const depth = s.vatFormat === 'exr_half' ? 'half' : s.vatFormat === 'exr_float' ? 'float' : s.vatFormat === 'png16' ? 16 : 8;
  const fmt = imageFormat(isExr ? 'exr' : 'png');
  const suffix = (k: string): string => `${base}_${k}.${fmt.ext}`;
  const writeTex = async (path: string, rowsAt: (r0: number, n: number) => Float32Array, rows: number): Promise<void> => {
    const spec: ImageSpec = { width: F, height: rows, channels: isExr ? 4 : 3, depth, colorSpace: 'linear', software: 'Kekenik VFX', comment: 'Kekenik VAT' };
    const sink = await env.target.openFile(path, fmt.mime);
    const enc = await fmt.create(spec, sink, { exrCompression: 'zip' });
    try {
      for (let r0 = 0; r0 < rows; r0 += 128) {
        await env.gate.checkpoint();
        const n = Math.min(128, rows - r0);
        const rgba = rowsAt(r0, n);
        if (isExr) await enc.writeRows(rgba, n);
        else {
          const rgb = new Float32Array(F * n * 3);
          for (let i = 0; i < F * n; i++) (rgb[i * 3] = rgba[i * 4], (rgb[i * 3 + 1] = rgba[i * 4 + 1]), (rgb[i * 3 + 2] = rgba[i * 4 + 2]));
          await enc.writeRows(rgb, n);
        }
      }
      await enc.finish();
    } catch (e) {
      await enc.abort().catch(() => undefined);
      throw e;
    }
    files.push(path);
  };
  if (F > maxDim) throw new Error(`VAT: ${F} frames exceed the texture width limit (${maxDim}).`);

  if (s.mode === 'vat_soft') {
    const N = rest.vertexCount;
    if (N > maxDim) throw new Error(`VAT: ${N} vertices exceed the texture height limit (${maxDim}). Reduce the vertex count (Subdivide / Delete By Mask) or export in parts.`);
    const positions = new Float32Array(F * N * 3);
    const normals = s.vatNormals && rest.normals ? new Float32Array(F * N * 3) : null;
    frames.forEach((f, i) => {
      positions.set(f.positions, i * N * 3);
      normals?.set(f.normals ?? new Float32Array(N * 3), i * N * 3);
    });
    const src = { frames: F, rows: N, positions, normals };
    const enc = { normalize, offset: s.vatOffset };
    const bounds = softBounds(src, s.vatOffset);
    await writeTex(suffix('pos'), (r0, n) => softVatRows(src, r0, n, enc, bounds).pos, N);
    env.onProgress(0.7);
    if (normals) await writeTex(suffix('nrm'), (r0, n) => softVatRows(src, r0, n, enc, bounds).nrm!, N);
    const uv = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) uv.set(vatRowUv(i, N, F), i * 2);
    const uvChannel = rest.uvSets.length;
    rest.uvSets.push({ name: `uv${uvChannel}`, data: uv });
    const meshPath = await writeVatMesh(env, rest, s, base, { ...coord, vat: { type: 'soft', uvChannel } }, files);
    const jsonPath = meshFileSet(s, base).json;
    const meta = vatMetadata({ type: 'soft', frames: F, rows: N, fps: s.fps, bounds, normalize, offset: s.vatOffset, uvChannel, uvName: `uv${uvChannel}`, axis: s.axis, scale: s.scale, files: { mesh: meshPath, position: suffix('pos'), ...(normals ? { normal: suffix('nrm') } : {}) }, depth: String(depth), vertexCount: N, loop: s.vatLoop });
    await env.target.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'application/json');
    files.push(jsonPath);
    env.onProgress(1);
    env.log('info', `VAT soft body: ${F} frames x ${N} vertices -> ${F}x${N} textures (${String(depth)}${isExr ? ' EXR' : ' PNG'}), bounds ${JSON.stringify(bounds)}`);
    return { files, bytes: env.target.files.reduce((n, f) => n + f.bytes, 0) };
  }

  // rigid body: pieces from the pivot bake of frame 0
  const baked = bakePivots(mesh0, { pivot: s.pivotMode, toUvSet: -1 });
  const em0 = buildExportMesh(baked, { ...opts, custom: true, normals: s.normals });
  const idA = em0.custom.find((a) => a.name === 'id');
  const pivA = em0.custom.find((a) => a.name === 'pivot');
  if (!idA || !pivA) throw new Error('Rigid VAT needs piece ids and pivots (island attribute or connected pieces)');
  const pieces = Math.round(idA.data.reduce((m, v) => Math.max(m, v), 0)) + 1;
  if (pieces > maxDim) throw new Error(`Rigid VAT: ${pieces} pieces exceed the texture height limit (${maxDim}).`);
  const N = em0.vertexCount;
  const verts: number[][] = Array.from({ length: pieces }, () => []);
  for (let v = 0; v < N; v++) verts[Math.round(idA.data[v])].push(v);
  const gather = (pos: Float32Array, k: number): Float32Array => {
    const out = new Float32Array(verts[k].length * 3);
    verts[k].forEach((v, i) => out.set(pos.subarray(v * 3, v * 3 + 3), i * 3));
    return out;
  };
  const restPts = verts.map((_, k) => gather(em0.positions, k));
  const framePts = frames.map((f, i) => verts.map((_, k) => gather(i === 0 ? em0.positions : f.positions, k)));
  const pivots = verts.map((vs) => (vs.length ? ([pivA.data[vs[0] * 3], pivA.data[vs[0] * 3 + 1], pivA.data[vs[0] * 3 + 2]] as [number, number, number]) : ([0, 0, 0] as [number, number, number])));
  const vat = buildRigidVat(restPts, framePts, pivots);
  const bounds: VatBounds = vec3Bounds(vat.displacement);
  await writeTex(suffix('pos'), (r0, n) => rigidVatRows(vat, r0, n, normalize, bounds).pos, pieces);
  await writeTex(suffix('rot'), (r0, n) => rigidVatRows(vat, r0, n, normalize, bounds).rot, pieces);
  const uv = new Float32Array(N * 2);
  for (let v = 0; v < N; v++) uv.set(vatRowUv(Math.round(idA.data[v]), pieces, F), v * 2);
  const uvChannel = em0.uvSets.length;
  em0.uvSets.push({ name: `uv${uvChannel}`, data: uv });
  const meshPath = await writeVatMesh(env, em0, s, base, { ...coord, vat: { type: 'rigid', uvChannel, pieces } }, files);
  const jsonPath = meshFileSet(s, base).json;
  const meta = vatMetadata({ type: 'rigid', frames: F, rows: pieces, fps: s.fps, bounds, normalize, offset: false, uvChannel, uvName: `uv${uvChannel}`, axis: s.axis, scale: s.scale, files: { mesh: meshPath, position: suffix('pos'), rotation: suffix('rot') }, depth: String(depth), vertexCount: N, pieceCount: pieces, loop: s.vatLoop });
  await env.target.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'application/json');
  files.push(jsonPath);
  env.onProgress(1);
  env.log('info', `VAT rigid body: ${F} frames x ${pieces} pieces`);
  return { files, bytes: env.target.files.reduce((n, f) => n + f.bytes, 0) };
}

async function writeVatMesh(env: JobEnv, em: ExportMesh, s: MeshJobSettings, base: string, extras: Record<string, unknown>, files: string[]): Promise<string> {
  const before = files.length;
  await writeMesh(env, em, s, base, extras, files);
  return files[before];
}

