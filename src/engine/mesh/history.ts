import { computeIslands } from './builder';
import { MeshResource, meshAccounting } from './accounting';
import { primIslands } from './attrs';
import { checkMeshLimits, MeshData, STD, type Topology } from './mesh';
import type { V3 } from './math3';
import { mergeMeshes, transformMesh } from './ops';
import { pointNormals, pointUV, computeNormalsAngle } from './helpers';
import { sampleChannel, sampleTex, type CpuTexture } from './texsnap';

/* ------------------------------------------------------------------------------------------------
 * Stateful mesh nodes: ACCUMULATE (trails over time) and BAKE (freeze, texture -> vertex data, pivots, animation).
 *
 * State lives in module level maps keyed by node id (a node evaluation is a pure function of params + time, EXCEPT that these
 * nodes remember what they saw). Rules that keep this safe:
 *  - every history frame is a MeshResource (ref-counted, accounted in the shared memory budget; arrays shared with the source
 *    are counted once). Frames are dropped when `maxCount`, the per-node byte cap or the global budget (OutOfBudgetError) says so.
 *  - a rewind (time goes backwards), a long jump, or any parameter change resets the history: scrubbing is therefore
 *    deterministic AFTER a reset, play-from-start always reproduces the same trail.
 * ---------------------------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------------------------- accumulate */
export interface AccumulateParams {
  maxCount: number;
  /** Seconds between snapshots. */
  stepTime: number;
  /** Alpha fade per age step (0 = none, 0.2 = each older copy is 20 % more transparent). */
  decay: number;
  /** Uniform scale multiplier per age step (1 = none). */
  scalePerStep: number;
  /** Cumulative transform per age step (trails that drift / twist away). */
  translate: V3;
  rotate: V3;
  pivot: V3;
  maxBytes: number;
  includeCurrent: boolean;
}
export const defaultAccumulateParams = (): AccumulateParams => ({ maxCount: 12, stepTime: 0.05, decay: 0.15, scalePerStep: 1, translate: [0, 0, 0], rotate: [0, 0, 0], pivot: [0, 0, 0], maxBytes: 64 * 1024 * 1024, includeCurrent: true });

interface Frame {
  time: number;
  res: MeshResource;
}
export class AccumHistory {
  frames: Frame[] = [];
  key = '';
  lastTime = -Infinity;
  get bytes(): number {
    return this.frames.reduce((n, f) => n + f.res.mesh.bytes, 0);
  }
  drop(index: number): void {
    const [f] = this.frames.splice(index, 1);
    f?.res.release();
  }
  reset(): void {
    while (this.frames.length) this.drop(this.frames.length - 1);
    this.lastTime = -Infinity;
  }
}

const histories = new Map<string, AccumHistory>();
export function getHistory(nodeId: string): AccumHistory {
  let h = histories.get(nodeId);
  if (h) {
    histories.delete(nodeId); // LRU touch
  } else h = new AccumHistory();
  histories.set(nodeId, h);
  while (histories.size > 16) {
    const k = histories.keys().next().value as string;
    histories.get(k)?.reset();
    histories.delete(k);
  }
  return h;
}
export function clearHistories(): void {
  for (const h of histories.values()) h.reset();
  histories.clear();
  for (const f of freezeStore.values()) f.res.release();
  freezeStore.clear();
  recorders.clear();
}

/** Multiply the alpha of Cd by `f` (creates a white Cd when missing). Needs an unfrozen mesh. */
function fadeAlpha(m: MeshData, f: number): void {
  for (const el of ['point', 'vertex'] as const) {
    if (m.has(el, STD.Cd)) {
      const d = m.writable(el, STD.Cd);
      for (let i = 3; i < d.length; i += 4) d[i] *= f;
      return;
    }
  }
  const d = new Float32Array(m.pointCount * 4).fill(1);
  for (let i = 3; i < d.length; i += 4) d[i] = f;
  m.setAttr({ name: STD.Cd, element: 'point', size: 4, kind: 'f32', data: d });
}

/**
 * One evaluation of Accumulate. `key` identifies the parameter set (any change resets), `time` is the graph time in seconds.
 * Output = current mesh (age 0) + the stored snapshots, oldest transformed / faded the most. Point attribute `age` = step / maxCount.
 */
export function accumulateStep(h: AccumHistory, key: string, time: number, input: MeshData, p: AccumulateParams): MeshData {
  const maxCount = Math.max(1, Math.round(p.maxCount));
  const step = Math.max(1e-4, p.stepTime);
  if (h.key !== key || time < h.lastTime - 1e-9 || time - h.lastTime > Math.max(1, step * maxCount * 2)) h.reset();
  h.key = key;
  // the stored frames are PAST states: oldest first. Build the output before inserting the current state.
  const parts: MeshData[] = [];
  const n = h.frames.length;
  for (let i = 0; i < n; i++) {
    const a = n - i; // age in steps (newest stored frame = 1)
    parts.push(styleFrame(h.frames[i].res.mesh, a, maxCount, p));
  }
  if (p.includeCurrent) parts.push(styleFrame(input, 0, maxCount, p));
  let pc = 0, vc = 0, pr = 0;
  for (const m of parts) {
    pc += m.pointCount;
    vc += m.vertexCount;
    pr += m.primCount;
  }
  checkMeshLimits(pc, vc, pr, 'Accumulate');
  const out = parts.length ? mergeMeshes(parts) : input.clone();
  // snapshot when due
  const last = h.frames.length ? h.frames[h.frames.length - 1].time : -Infinity;
  if (time - last >= step - 1e-9) {
    const res = new MeshResource(input.clone(), meshAccounting()); // OutOfBudgetError propagates -> error badge (nothing leaked)
    res.retain();
    h.frames.push({ time, res });
    h.lastTime = time;
  }
  while (h.frames.length > maxCount - (p.includeCurrent ? 1 : 0) && h.frames.length > 0) h.drop(0);
  while (h.frames.length > 1 && h.bytes > p.maxBytes) h.drop(0);
  return out;
}

function styleFrame(m: MeshData, age: number, maxCount: number, p: AccumulateParams): MeshData {
  let out: MeshData;
  if (age > 0 && (p.translate.some((v) => v !== 0) || p.rotate.some((v) => v !== 0) || p.scalePerStep !== 1)) {
    out = transformMesh(m, { translate: [p.translate[0] * age, p.translate[1] * age, p.translate[2] * age], rotate: [p.rotate[0] * age, p.rotate[1] * age, p.rotate[2] * age], scale: [1, 1, 1], uniform: Math.pow(p.scalePerStep, age), pivot: p.pivot });
  } else out = m.clone();
  if (age > 0 && p.decay > 0) fadeAlpha(out, Math.pow(Math.max(0, 1 - p.decay), age));
  const ag = new Float32Array(out.pointCount).fill(age / maxCount);
  out.setAttr({ name: STD.age, element: 'point', size: 1, kind: 'f32', data: ag });
  return out;
}

/* ------------------------------------------------------------------------------------------------- bake */
export const freezeStore = new Map<string, { key: string; res: MeshResource }>();

/** Freeze: the first state at/after `freezeAt` is kept until `key` changes. Returns the frozen mesh (or the input before it). */
export function freezeStep(nodeId: string, key: string, time: number, freezeAt: number, input: MeshData): { mesh: MeshData; frozen: boolean } {
  const s = freezeStore.get(nodeId);
  if (s && s.key === key) return { mesh: s.res.mesh, frozen: true };
  if (s) {
    s.res.release();
    freezeStore.delete(nodeId);
  }
  if (time + 1e-9 >= freezeAt) {
    const res = new MeshResource(input.clone(), meshAccounting());
    res.retain();
    freezeStore.set(nodeId, { key, res });
    while (freezeStore.size > 16) {
      const k = freezeStore.keys().next().value as string;
      freezeStore.get(k)?.res.release();
      freezeStore.delete(k);
    }
    return { mesh: res.mesh, frozen: true };
  }
  return { mesh: input, frozen: false };
}

export interface BakeTextureParams {
  texture: CpuTexture | null;
  uvSet: number;
  attribute: string;
  /** r g b a luma | rgb | rgba */
  channels: 'r' | 'g' | 'b' | 'a' | 'luma' | 'rgb' | 'rgba';
  element: 'point' | 'vertex';
  scale: number;
  bias: number;
}
/** Bake a texture into vertex / point data (sampled at the mesh UVs). Returns the input unchanged while the snapshot is pending. */
export function bakeTexture(src: MeshData, p: BakeTextureParams): MeshData {
  if (!p.texture) return src.clone();
  const el = p.element === 'vertex' && src.primCount > 0 ? 'vertex' : 'point';
  const size = p.channels === 'rgb' ? 3 : p.channels === 'rgba' ? 4 : 1;
  const n = el === 'vertex' ? src.vertexCount : src.pointCount;
  const name = p.uvSet <= 0 ? 'uv' : `uv${p.uvSet}`;
  const uvv = el === 'vertex' ? src.resolveToVertex(name) : null;
  const uvp = el === 'point' ? pointUV(src, p.uvSet) : null;
  if (!uvv && !uvp) throw new Error(`Bake: the mesh has no "${name}" UVs`);
  const d = new Float32Array(n * size);
  const o = [0, 0, 0, 1];
  for (let i = 0; i < n; i++) {
    const u = uvv ? uvv.data[i * 2] : uvp![i * 2], v = uvv ? uvv.data[i * 2 + 1] : uvp![i * 2 + 1];
    if (size === 1) d[i] = sampleChannel(p.texture, u, v, { r: 0, g: 1, b: 2, a: 3, luma: 4 }[p.channels as 'r'], true) * p.scale + p.bias;
    else {
      sampleTex(p.texture, u, v, true, o);
      for (let c = 0; c < size; c++) d[i * size + c] = o[c] * p.scale + p.bias;
    }
  }
  const out = src.clone();
  out.removeAttr(el === 'point' ? 'vertex' : 'point', p.attribute);
  out.setAttr({ name: p.attribute, element: el, size: size as 1 | 3 | 4, kind: 'f32', data: d });
  return out;
}

export interface BakePivotParams {
  pivot: 'centroid' | 'bounds' | 'base' | 'top';
  /** Write the pivot (xy / z + island id) normalised to the mesh bounds into UV sets uv<set>, uv<set+1>. -1 = off. */
  toUvSet: number;
}
/**
 * Pivot baking for pivot-baked meshes / VAT: one pivot per connected island (or the `island` attribute). Writes
 * point `pivot` (vec3), point `pivot_offset` (P - pivot), point `id` (= island) and primitive `island`.
 */
export function bakePivots(src: MeshData, p: BakePivotParams): MeshData {
  const isl = primIslands(src);
  const nIsl = Math.max(1, isl.count);
  const lo = new Float64Array(nIsl * 3).fill(Infinity), hi = new Float64Array(nIsl * 3).fill(-Infinity), sum = new Float64Array(nIsl * 3), cnt = new Float64Array(nIsl);
  const P = src.positions;
  const ps = src.topology.primStart, vp = src.topology.vertPoint;
  const ptIsl = new Int32Array(src.pointCount).fill(-1);
  for (let q = 0; q < src.primCount; q++) {
    const k = isl.ids[q];
    if (k < 0) continue;
    for (let v = ps[q]; v < ps[q + 1]; v++) {
      const pt = vp[v];
      if (ptIsl[pt] === -1) {
        ptIsl[pt] = k;
        for (let c = 0; c < 3; c++) {
          const x = P[pt * 3 + c];
          lo[k * 3 + c] = Math.min(lo[k * 3 + c], x);
          hi[k * 3 + c] = Math.max(hi[k * 3 + c], x);
          sum[k * 3 + c] += x;
        }
        cnt[k]++;
      }
    }
  }
  const piv = new Float32Array(nIsl * 3);
  for (let k = 0; k < nIsl; k++) {
    if (cnt[k] === 0) continue;
    const cx = (lo[k * 3] + hi[k * 3]) / 2, cy = (lo[k * 3 + 1] + hi[k * 3 + 1]) / 2;
    if (p.pivot === 'centroid') piv.set([sum[k * 3] / cnt[k], sum[k * 3 + 1] / cnt[k], sum[k * 3 + 2] / cnt[k]], k * 3);
    else if (p.pivot === 'bounds') piv.set([cx, cy, (lo[k * 3 + 2] + hi[k * 3 + 2]) / 2], k * 3);
    else if (p.pivot === 'base') piv.set([cx, cy, lo[k * 3 + 2]], k * 3);
    else piv.set([cx, cy, hi[k * 3 + 2]], k * 3);
  }
  const out = src.clone();
  const n = src.pointCount;
  const pv = new Float32Array(n * 3), off = new Float32Array(n * 3), id = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.max(0, ptIsl[i]);
    for (let c = 0; c < 3; c++) {
      pv[i * 3 + c] = piv[k * 3 + c];
      off[i * 3 + c] = P[i * 3 + c] - piv[k * 3 + c];
    }
    id[i] = k;
  }
  out.setAttr({ name: STD.pivot, element: 'point', size: 3, kind: 'f32', data: pv });
  out.setAttr({ name: 'pivot_offset', element: 'point', size: 3, kind: 'f32', data: off });
  out.setAttr({ name: STD.id, element: 'point', size: 1, kind: 'i32', data: id });
  out.setAttr({ name: STD.island, element: 'primitive', size: 1, kind: 'i32', data: Int32Array.from(isl.ids) });
  if (p.toUvSet >= 0 && src.primCount > 0) {
    const b = src.bounds();
    const size = [0, 1, 2].map((c) => b.max[c] - b.min[c] || 1);
    const nv = src.vertexCount;
    const a = new Float32Array(nv * 2), c2 = new Float32Array(nv * 2);
    for (let v = 0; v < nv; v++) {
      const pt = vp[v];
      a[v * 2] = (piv[Math.max(0, ptIsl[pt]) * 3] - b.min[0]) / size[0];
      a[v * 2 + 1] = (piv[Math.max(0, ptIsl[pt]) * 3 + 1] - b.min[1]) / size[1];
      c2[v * 2] = (piv[Math.max(0, ptIsl[pt]) * 3 + 2] - b.min[2]) / size[2];
      c2[v * 2 + 1] = nIsl > 1 ? Math.max(0, ptIsl[pt]) / (nIsl - 1) : 0;
    }
    const s0 = p.toUvSet <= 0 ? 'uv' : `uv${p.toUvSet}`, s1 = `uv${Math.max(1, p.toUvSet) + (p.toUvSet <= 0 ? 0 : 1)}`;
    out.removeAttr('point', s0);
    out.removeAttr('point', s1);
    out.setAttr({ name: s0, element: 'vertex', size: 2, kind: 'f32', data: a });
    out.setAttr({ name: s1, element: 'vertex', size: 2, kind: 'f32', data: c2 });
  }
  void computeIslands;
  return out;
}

/* ------------------------------------------------------------------------------- animation (frame buffers) */
export interface BakedAnimation {
  fps: number;
  frameCount: number;
  pointCount: number;
  /** frame-major xyz positions: [frame][point][3] */
  positions: Float32Array;
  normals: Float32Array | null;
  boundsMin: V3;
  boundsMax: V3;
  /** Constant topology (+ UVs / colours) of the first recorded frame. */
  template: MeshData;
}

/**
 * Recorder for mesh animation. Frames are stored by slot = round(time * fps).
 * Constant point count is REQUIRED (VAT contract); the byte cap is checked against the shared memory budget before every frame.
 */
export class MeshFrameRecorder {
  private slots = new Map<number, { pos: Float32Array; nrm: Float32Array | null }>();
  template: MeshData | null = null;
  full = false;
  bytes = 0;
  constructor(
    public fps: number,
    public capBytes: number,
    public withNormals: boolean,
  ) {}
  get frameCount(): number {
    return this.slots.size;
  }
  clear(): void {
    this.slots.clear();
    this.template = null;
    this.full = false;
    this.releaseBytes();
  }
  private releaseBytes(): void {
    if (this.bytes > 0) meshAccounting()?.mm.removeExternal('mesh', this.bytes);
    this.bytes = 0;
  }
  /** Returns 'ok' | 'full' (cap reached) | 'topology' (point count changed: recorder was reset). */
  record(slot: number, mesh: MeshData): 'ok' | 'full' | 'topology' {
    if (this.template && this.template.pointCount !== mesh.pointCount) {
      this.clear();
      return 'topology';
    }
    const has = this.slots.get(slot);
    const per = mesh.pointCount * 3 * 4 * (this.withNormals ? 2 : 1);
    if (!has && this.bytes + per > this.capBytes) {
      this.full = true;
      return 'full';
    }
    if (!has) {
      const acct = meshAccounting();
      acct?.mm.ensureRoom(per, 'mesh animation frame'); // OutOfBudgetError -> error badge, no leak
      acct?.mm.addExternal('mesh', per);
      this.bytes += per;
    }
    if (!this.template) this.template = mesh;
    this.slots.set(slot, { pos: Float32Array.from(mesh.positions), nrm: this.withNormals ? Float32Array.from(pointNormals(mesh)) : null });
    return 'ok';
  }
  /** Frames in slot order as one contiguous buffer set (copying; call once per export). */
  finish(): BakedAnimation | null {
    if (!this.template || this.slots.size === 0) return null;
    const keys = [...this.slots.keys()].sort((a, b) => a - b);
    const n = this.template.pointCount;
    const positions = new Float32Array(keys.length * n * 3);
    const normals = this.withNormals ? new Float32Array(keys.length * n * 3) : null;
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    keys.forEach((k, f) => {
      const s = this.slots.get(k)!;
      positions.set(s.pos, f * n * 3);
      normals?.set(s.nrm!, f * n * 3);
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
        lo[c] = Math.min(lo[c], s.pos[i * 3 + c]);
        hi[c] = Math.max(hi[c], s.pos[i * 3 + c]);
      }
    });
    return { fps: this.fps, frameCount: keys.length, pointCount: n, positions, normals, boundsMin: lo, boundsMax: hi, template: this.template };
  }
}

const recorders = new Map<string, MeshFrameRecorder>();
export function getRecorder(nodeId: string, fps: number, capBytes: number, withNormals: boolean): MeshFrameRecorder {
  let r = recorders.get(nodeId);
  if (!r || r.fps !== fps || r.withNormals !== withNormals) {
    r?.clear();
    r = new MeshFrameRecorder(fps, capBytes, withNormals);
    recorders.set(nodeId, r);
    while (recorders.size > 8) {
      const k = recorders.keys().next().value as string;
      recorders.get(k)?.clear();
      recorders.delete(k);
    }
  }
  r.capBytes = capBytes;
  return r;
}
/** Recorder of a Bake node. */
export const recorderOf = (nodeId: string): MeshFrameRecorder | undefined => recorders.get(nodeId);

/** Synchronous bake helper for exporters: evaluate `evalAt(t)` for every frame (no graph state involved). */
export function bakeAnimation(evalAt: (time: number) => MeshData, o: { fps: number; frames: number; startTime?: number; capBytes?: number; normals?: boolean }): BakedAnimation {
  const rec = new MeshFrameRecorder(o.fps, o.capBytes ?? 512 * 1024 * 1024, o.normals ?? true);
  try {
    for (let f = 0; f < o.frames; f++) {
      const m = evalAt((o.startTime ?? 0) + f / o.fps);
      const st = rec.record(f, m);
      if (st === 'full') throw new Error(`Bake: memory cap reached after ${f} of ${o.frames} frames`);
      if (st === 'topology') throw new Error('Bake: the point count changed between frames (VAT needs constant topology)');
    }
    const r = rec.finish();
    if (!r) throw new Error('Bake: no frames');
    return r;
  } finally {
    rec.clear();
  }
}

export type { Topology };
export { computeNormalsAngle };
