import { computeIslands, flipWinding, primNormal } from './builder';
import { checkMeshLimits, MeshData, STD, Topology, type Attribute, type AttrData } from './mesh';
import {
  mat4Compose, mat4Det3, mat4Identity, mat4Invert, mat4Mul, mat4Translate, quatFromEulerDeg, quatMul, quatNormalize, rng, v3,
  type Mat4, type Quat, type V3,
} from './math3';
import { orientFromNormal } from './points';

/* ------------------------------------------------------------------------------------------------
 * Geometry operations (CPU, TypedArray). Every op takes frozen inputs and returns a NEW mesh; unchanged arrays are SHARED
 * (copy-on-write), e.g. Transform shares uv / Cd / topology with its input. Point-wise loops are plain for-loops over typed
 * arrays: ~1M points / transform in the low tens of ms; hard caps in mesh.ts keep worst cases bounded.
 * ---------------------------------------------------------------------------------------------- */

export interface Xf {
  m: Mat4;
  q: Quat;
  /** Per-axis scale (for `scale` / `pscale` attributes). */
  sc: V3;
}

/** Transform a mesh by `xf`: P, N (inverse transpose), orient, scale, pscale, pivot. Flips winding on mirroring. */
export function applyXf(src: MeshData, xf: Xf): MeshData {
  const out = src.clone();
  const { m } = xf;
  const P = out.writable('point', STD.P) as Float32Array;
  for (let i = 0; i < out.pointCount; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    P[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    P[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    P[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  const inv = mat4Invert(m);
  for (const el of ['point', 'vertex'] as const) {
    if (!out.has(el, STD.N)) continue;
    const N = out.writable(el, STD.N) as Float32Array;
    for (let i = 0; i < N.length / 3; i++) {
      const x = N[i * 3], y = N[i * 3 + 1], z = N[i * 3 + 2];
      const nx = inv[0] * x + inv[1] * y + inv[2] * z, ny = inv[4] * x + inv[5] * y + inv[6] * z, nz = inv[8] * x + inv[9] * y + inv[10] * z;
      const l = Math.hypot(nx, ny, nz) || 1;
      N[i * 3] = nx / l;
      N[i * 3 + 1] = ny / l;
      N[i * 3 + 2] = nz / l;
    }
  }
  if (out.has('point', STD.orient)) {
    const Q = out.writable('point', STD.orient) as Float32Array;
    for (let i = 0; i < out.pointCount; i++) {
      const r = quatNormalize(quatMul(xf.q, [Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]]));
      Q.set(r, i * 4);
    }
  }
  if (out.has('point', STD.scale)) {
    const S = out.writable('point', STD.scale) as Float32Array;
    for (let i = 0; i < out.pointCount; i++) {
      S[i * 3] *= xf.sc[0];
      S[i * 3 + 1] *= xf.sc[1];
      S[i * 3 + 2] *= xf.sc[2];
    }
  }
  if (out.has('point', STD.pscale)) {
    const k = Math.cbrt(Math.abs(xf.sc[0] * xf.sc[1] * xf.sc[2]));
    const S = out.writable('point', STD.pscale) as Float32Array;
    for (let i = 0; i < S.length; i++) S[i] *= k;
  }
  if (out.has('point', STD.pivot)) {
    const V = out.writable('point', STD.pivot) as Float32Array;
    for (let i = 0; i < out.pointCount; i++) {
      const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
      V[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      V[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      V[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
  }
  return mat4Det3(m) < 0 && out.primCount > 0 ? flipWinding(out) : out;
}

export interface TransformParams {
  translate: V3;
  /** Euler degrees, order X then Y then Z. */
  rotate: V3;
  scale: V3;
  uniform: number;
  pivot: V3;
}
export const defaultTransformParams = (): TransformParams => ({ translate: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1], uniform: 1, pivot: [0, 0, 0] });

/** Matrix of the Transform node: M = T(translate) * T(pivot) * R * S * T(-pivot). */
export function transformXf(p: TransformParams): Xf {
  const q = quatFromEulerDeg(p.rotate[0], p.rotate[1], p.rotate[2]);
  const sc: V3 = [p.scale[0] * p.uniform, p.scale[1] * p.uniform, p.scale[2] * p.uniform];
  const rs = mat4Compose([0, 0, 0], q, sc);
  const m = mat4Mul(mat4Translate(v3.add(p.translate, p.pivot)), mat4Mul(rs, mat4Translate(v3.scale(p.pivot, -1))));
  return { m, q, sc };
}
export const transformMesh = (src: MeshData, p: TransformParams): MeshData => applyXf(src, transformXf(p));

/* ------------------------------------------------------------------------------------------------ merge */
const DEFAULT_FILL: Record<string, number[]> = { [STD.orient]: [0, 0, 0, 1], [STD.scale]: [1, 1, 1], [STD.pscale]: [1], [STD.Cd]: [1, 1, 1, 1], [STD.N]: [0, 0, 1] };

/**
 * Merge meshes: points / vertices / primitives are concatenated; attributes are united (missing values get a sensible
 * default: orient identity, scale / pscale 1, Cd white, zero otherwise). An attribute whose size differs between inputs is
 * kept from the first input that has it; the others contribute defaults.
 */
export function mergeMeshes(list: MeshData[]): MeshData {
  const inputs = list.filter((m) => m.pointCount > 0 || m.primCount > 0);
  if (inputs.length === 0) return new MeshData(0).setAttr({ name: STD.P, element: 'point', size: 3, kind: 'f32', data: new Float32Array(0) });
  if (inputs.length === 1) return inputs[0].clone();
  let pc = 0, vc = 0, prc = 0;
  for (const m of inputs) {
    pc += m.pointCount;
    vc += m.vertexCount;
    prc += m.primCount;
  }
  checkMeshLimits(pc, vc, prc, 'Merge');
  const vertPoint = new Uint32Array(vc);
  const primStart = new Uint32Array(prc + 1);
  let po = 0, vo = 0, ro = 0;
  for (const m of inputs) {
    const t = m.topology;
    for (let i = 0; i < t.vertPoint.length; i++) vertPoint[vo + i] = t.vertPoint[i] + po;
    for (let p = 1; p <= t.primCount; p++) primStart[ro + p] = t.primStart[p] + vo;
    po += m.pointCount;
    vo += m.vertexCount;
    ro += m.primCount;
  }
  const out = new MeshData(pc, new Topology(vertPoint, primStart));
  const specs = new Map<string, Attribute>();
  for (const m of inputs) for (const a of m.list()) if (!specs.has(`${a.element}/${a.name}`)) specs.set(`${a.element}/${a.name}`, a);
  const counts = { point: pc, vertex: vc, primitive: prc, detail: 1 } as const;
  for (const spec of specs.values()) {
    if (spec.element === 'detail') {
      out.shareAttr(spec);
      continue;
    }
    const n = counts[spec.element];
    const data: AttrData = spec.kind === 'f32' ? new Float32Array(n * spec.size) : new Int32Array(n * spec.size);
    const def = DEFAULT_FILL[spec.name];
    let off = 0;
    for (const m of inputs) {
      const cnt = m.count(spec.element);
      const a = m.attr(spec.element, spec.name);
      if (a && a.size === spec.size) data.set(a.data, off * spec.size);
      else if (def && def.length === spec.size) for (let i = 0; i < cnt; i++) for (let c = 0; c < spec.size; c++) data[(off + i) * spec.size + c] = def[c];
      off += cnt;
    }
    out.setAttr({ ...spec, data });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ instancing */
export interface InstanceExtras {
  /** Point attributes of the Points input transferred onto every copied point (non-reserved names, size n). */
  pointAttrs?: Attribute[];
  /** Per-instance RGBA multiplied into Cd (creates Cd when missing). */
  cd?: (i: number) => ArrayLike<number> | null;
  /** Write `pivot` = this per-instance origin. */
  pivot?: (i: number) => V3;
  /** Write `id` (int) = this, unless a pointAttr named id is provided. */
  id?: (i: number) => number;
  age?: (i: number) => number;
  /** Per-instance uniform attribute `pscale` multiplier written (attribute only, geometry untouched). */
  pscale?: (i: number) => number;
}

/** Replicate `src` n times with per-instance affine transforms and attributes. */
export function instantiate(src: MeshData, n: number, xf: (i: number) => Xf, ex: InstanceExtras = {}): MeshData {
  const pc = src.pointCount, vc = src.vertexCount, prc = src.primCount;
  checkMeshLimits(pc * n, vc * n, prc * n, 'Copy');
  const t = src.topology;
  const vertPoint = new Uint32Array(vc * n);
  const primStart = new Uint32Array(prc * n + 1);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < vc; k++) vertPoint[i * vc + k] = t.vertPoint[k] + i * pc;
    for (let p = 1; p <= prc; p++) primStart[i * prc + p] = t.primStart[p] + i * vc;
  }
  const out = new MeshData(pc * n, new Topology(vertPoint, primStart));
  const counts = { point: pc * n, vertex: vc * n, primitive: prc * n } as const;
  for (const a of src.list()) {
    if (a.element === 'detail') {
      out.shareAttr(a);
      continue;
    }
    const len = a.data.length;
    const data: AttrData = a.kind === 'f32' ? new Float32Array(len * n) : new Int32Array(len * n);
    for (let i = 0; i < n; i++) data.set(a.data, i * len);
    out.setAttr({ ...a, data });
  }
  const ensure = (name: string, size: 1 | 2 | 3 | 4, kind: 'f32' | 'i32', fill?: number[]): AttrData => {
    const ex0 = out.attr('point', name);
    if (ex0 && ex0.size === size) return ex0.data;
    const data: AttrData = kind === 'f32' ? new Float32Array(counts.point * size) : new Int32Array(counts.point * size);
    if (fill) for (let i = 0; i < counts.point; i++) for (let c = 0; c < size; c++) data[i * size + c] = fill[c];
    out.setAttr({ name, element: 'point', size, kind, data });
    return data;
  };
  const P = out.writable('point', STD.P) as Float32Array;
  const hasQ = out.has('point', STD.orient), hasS = out.has('point', STD.scale), hasPS = out.has('point', STD.pscale), hasPiv = out.has('point', STD.pivot);
  const Qd = hasQ ? (out.writable('point', STD.orient) as Float32Array) : null;
  const Sd = hasS ? (out.writable('point', STD.scale) as Float32Array) : null;
  const PSd = hasPS ? (out.writable('point', STD.pscale) as Float32Array) : null;
  const Vd = hasPiv ? (out.writable('point', STD.pivot) as Float32Array) : null;
  const nEls: { el: 'point' | 'vertex'; data: Float32Array }[] = [];
  for (const el of ['point', 'vertex'] as const) if (out.has(el, STD.N)) nEls.push({ el, data: out.writable(el, STD.N) as Float32Array });
  let cdPoint: Float32Array | null = null;
  let cdVertex: Float32Array | null = null;
  const wantCd = !!ex.cd;
  if (wantCd) {
    if (out.has('vertex', STD.Cd)) cdVertex = out.writable('vertex', STD.Cd) as Float32Array;
    if (out.has('point', STD.Cd) || !cdVertex) cdPoint = ensure(STD.Cd, 4, 'f32', [1, 1, 1, 1]) as Float32Array;
    if (cdPoint && out.isShared('point', STD.Cd)) cdPoint = out.writable('point', STD.Cd) as Float32Array;
  }
  const extraPoint = new Map<string, AttrData>();
  for (const a of ex.pointAttrs ?? []) {
    if (a.element !== 'point' || a.data.length !== n * a.size) continue;
    extraPoint.set(a.name, ensure(a.name, a.size, a.kind));
  }
  const idArr = !extraPoint.has(STD.id) && ex.id ? (ensure(STD.id, 1, 'i32') as Int32Array) : null;
  const ageArr = !extraPoint.has(STD.age) && ex.age ? (ensure(STD.age, 1, 'f32') as Float32Array) : null;
  const pivArr = ex.pivot ? (ensure(STD.pivot, 3, 'f32') as Float32Array) : null;
  const psArr = ex.pscale ? (ensure(STD.pscale, 1, 'f32', [1]) as Float32Array) : null;

  for (let i = 0; i < n; i++) {
    const x = xf(i);
    const m = x.m;
    const inv = mat4Invert(m);
    const p0 = i * pc;
    for (let j = 0; j < pc; j++) {
      const o = (p0 + j) * 3;
      const px = P[o], py = P[o + 1], pz = P[o + 2];
      P[o] = m[0] * px + m[4] * py + m[8] * pz + m[12];
      P[o + 1] = m[1] * px + m[5] * py + m[9] * pz + m[13];
      P[o + 2] = m[2] * px + m[6] * py + m[10] * pz + m[14];
      if (Vd) {
        const vx = Vd[o], vy = Vd[o + 1], vz = Vd[o + 2];
        Vd[o] = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
        Vd[o + 1] = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
        Vd[o + 2] = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
      }
      if (Qd) Qd.set(quatNormalize(quatMul(x.q, [Qd[(p0 + j) * 4], Qd[(p0 + j) * 4 + 1], Qd[(p0 + j) * 4 + 2], Qd[(p0 + j) * 4 + 3]])), (p0 + j) * 4);
      if (Sd) {
        Sd[o] *= x.sc[0];
        Sd[o + 1] *= x.sc[1];
        Sd[o + 2] *= x.sc[2];
      }
      if (PSd) PSd[p0 + j] *= Math.cbrt(Math.abs(x.sc[0] * x.sc[1] * x.sc[2]));
    }
    for (const ne of nEls) {
      const cnt = ne.el === 'point' ? pc : vc;
      const base = i * cnt;
      for (let j = 0; j < cnt; j++) {
        const o = (base + j) * 3;
        const a = ne.data[o], b = ne.data[o + 1], c = ne.data[o + 2];
        const nx = inv[0] * a + inv[1] * b + inv[2] * c, ny = inv[4] * a + inv[5] * b + inv[6] * c, nz = inv[8] * a + inv[9] * b + inv[10] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        ne.data[o] = nx / l;
        ne.data[o + 1] = ny / l;
        ne.data[o + 2] = nz / l;
      }
    }
    if (ex.cd) {
      const c = ex.cd(i);
      if (c) {
        if (cdPoint) for (let j = 0; j < pc; j++) for (let k = 0; k < 4; k++) cdPoint[(p0 + j) * 4 + k] *= c[k] ?? 1;
        if (cdVertex) for (let j = 0; j < vc; j++) for (let k = 0; k < 4; k++) cdVertex[(i * vc + j) * 4 + k] *= c[k] ?? 1;
      }
    }
    for (const a of ex.pointAttrs ?? []) {
      const d = extraPoint.get(a.name);
      if (!d) continue;
      for (let j = 0; j < pc; j++) for (let k = 0; k < a.size; k++) d[(p0 + j) * a.size + k] = a.data[i * a.size + k];
    }
    if (idArr && ex.id) idArr.fill(ex.id(i), p0, p0 + pc);
    if (ageArr && ex.age) ageArr.fill(ex.age(i), p0, p0 + pc);
    if (psArr && ex.pscale) {
      const s = ex.pscale(i);
      for (let j = 0; j < pc; j++) psArr[p0 + j] *= s;
    }
    if (pivArr && ex.pivot) {
      const pv = ex.pivot(i);
      for (let j = 0; j < pc; j++) pivArr.set(pv, (p0 + j) * 3);
    }
  }
  return out;
}

export interface CopyToPointsParams {
  use_orient: boolean;
  align_normal: boolean;
  use_pscale: boolean;
  use_scale: boolean;
  use_color: boolean;
  /** Global scale of every copy. */
  scale: number;
  /** Extra local rotation (Euler degrees) applied before the point's orientation. */
  rotate: V3;
}
export const defaultCopyToPointsParams = (): CopyToPointsParams => ({ use_orient: true, align_normal: true, use_pscale: true, use_scale: true, use_color: true, scale: 1, rotate: [0, 0, 0] });
const RESERVED = new Set<string>([STD.P, STD.N, STD.orient, STD.scale, STD.pscale, STD.Cd, STD.pivot, STD.uv]);

/** Instance `src` on every point of `pts` using orient / N, pscale / scale / `scale` param and Cd. Other point attributes are transferred. */
export function copyToPoints(src: MeshData, pts: MeshData, p: CopyToPointsParams): MeshData {
  const n = pts.pointCount;
  if (n === 0 || src.pointCount === 0) return new MeshData(0).setAttr({ name: STD.P, element: 'point', size: 3, kind: 'f32', data: new Float32Array(0) });
  const P = pts.positions;
  const Qa = pts.attr('point', STD.orient);
  const Na = pts.attr('point', STD.N);
  const PSa = pts.attr('point', STD.pscale);
  const Sa = pts.attr('point', STD.scale);
  const Ca = pts.attr('point', STD.Cd);
  const qOff = quatFromEulerDeg(p.rotate[0], p.rotate[1], p.rotate[2]);
  const xfOf = (i: number): Xf => {
    let q: Quat = [0, 0, 0, 1];
    if (p.use_orient && Qa && Qa.size === 4) q = quatNormalize([Qa.data[i * 4], Qa.data[i * 4 + 1], Qa.data[i * 4 + 2], Qa.data[i * 4 + 3]]);
    else if (p.align_normal && Na && Na.size === 3) q = orientFromNormal([Na.data[i * 3], Na.data[i * 3 + 1], Na.data[i * 3 + 2]]);
    q = quatMul(q, qOff);
    const k = p.scale * (p.use_pscale && PSa ? PSa.data[i] : 1);
    const s: V3 = p.use_scale && Sa && Sa.size === 3 ? [Sa.data[i * 3] * k, Sa.data[i * 3 + 1] * k, Sa.data[i * 3 + 2] * k] : [k, k, k];
    return { m: mat4Compose([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], q, s), q, sc: s };
  };
  const pointAttrs = pts.list('point').filter((a) => !RESERVED.has(a.name));
  const idA = pts.attr('point', STD.id);
  return instantiate(src, n, xfOf, {
    pointAttrs,
    cd: p.use_color && Ca && Ca.size === 4 ? (i) => [Ca.data[i * 4], Ca.data[i * 4 + 1], Ca.data[i * 4 + 2], Ca.data[i * 4 + 3]] : undefined,
    pivot: (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]],
    id: idA ? undefined : (i) => i,
  });
}

export interface CopyTransformParams {
  copies: number;
  translate: V3;
  rotate: V3;
  scale: V3;
  pivot: V3;
  jitter_translate: V3;
  jitter_rotate: V3;
  jitter_scale: number;
  seed: number;
  /** Attribute ranges across the copies (i = 0 .. n-1). */
  color_start: [number, number, number, number];
  color_end: [number, number, number, number];
  pscale_start: number;
  pscale_end: number;
  age_start: number;
  age_end: number;
}
export const defaultCopyTransformParams = (): CopyTransformParams => ({
  copies: 4, translate: [0, 0, 0.5], rotate: [0, 0, 15], scale: [1, 1, 1], pivot: [0, 0, 0], jitter_translate: [0, 0, 0], jitter_rotate: [0, 0, 0], jitter_scale: 0, seed: 1,
  color_start: [1, 1, 1, 1], color_end: [1, 1, 1, 1], pscale_start: 1, pscale_end: 1, age_start: 0, age_end: 1,
});

/** N copies; copy i = step^i about the pivot (matrices are composed exactly, shear included), plus optional seeded jitter. */
export function copyAndTransform(src: MeshData, p: CopyTransformParams): MeshData {
  const n = Math.max(1, Math.round(p.copies));
  const qs = quatFromEulerDeg(p.rotate[0], p.rotate[1], p.rotate[2]);
  const stepRS = mat4Compose([0, 0, 0], qs, p.scale);
  const step = mat4Mul(mat4Translate(v3.add(p.translate, p.pivot)), mat4Mul(stepRS, mat4Translate(v3.scale(p.pivot, -1))));
  const xfs: Xf[] = [];
  const rand = rng(p.seed);
  let cur = mat4Identity();
  let q: Quat = [0, 0, 0, 1];
  let sc: V3 = [1, 1, 1];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      cur = mat4Mul(step, cur);
      q = quatNormalize(quatMul(qs, q));
      sc = v3.mul(sc, p.scale);
    }
    let m = cur, qq = q, ss = sc;
    if (p.jitter_translate.some((x) => x) || p.jitter_rotate.some((x) => x) || p.jitter_scale) {
      const jt: V3 = [(rand() * 2 - 1) * p.jitter_translate[0], (rand() * 2 - 1) * p.jitter_translate[1], (rand() * 2 - 1) * p.jitter_translate[2]];
      const jq = quatFromEulerDeg((rand() * 2 - 1) * p.jitter_rotate[0], (rand() * 2 - 1) * p.jitter_rotate[1], (rand() * 2 - 1) * p.jitter_rotate[2]);
      const js = 1 + (rand() * 2 - 1) * p.jitter_scale;
      // jitter acts on the copy's local frame about the pivot
      const J = mat4Mul(mat4Translate(v3.add(jt, p.pivot)), mat4Mul(mat4Compose([0, 0, 0], jq, [js, js, js]), mat4Translate(v3.scale(p.pivot, -1))));
      m = mat4Mul(cur, J);
      qq = quatNormalize(quatMul(q, jq));
      ss = v3.scale(sc, js);
    }
    xfs.push({ m, q: qq, sc: ss });
  }
  const t = (i: number): number => (n > 1 ? i / (n - 1) : 0);
  const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
  const cs = p.color_start, ce = p.color_end;
  const colored = cs.some((x, k) => x !== 1 || ce[k] !== 1);
  return instantiate(src, n, (i) => xfs[i], {
    id: (i) => i,
    age: (i) => lerp(p.age_start, p.age_end, t(i)),
    pivot: (i) => [xfs[i].m[12], xfs[i].m[13], xfs[i].m[14]],
    cd: colored ? (i) => [lerp(cs[0], ce[0], t(i)), lerp(cs[1], ce[1], t(i)), lerp(cs[2], ce[2], t(i)), lerp(cs[3], ce[3], t(i))] : undefined,
    pscale: p.pscale_start !== 1 || p.pscale_end !== 1 ? (i) => lerp(p.pscale_start, p.pscale_end, t(i)) : undefined,
  });
}

/* ------------------------------------------------------------------------------------------------ UV projection */
export const UV_MODES = ['planar', 'cylindrical', 'spherical', 'box', 'island'] as const;
export type UvMode = (typeof UV_MODES)[number];
export interface UvParams {
  mode: UvMode;
  /** planar projection axis */
  axis: 'x' | 'y' | 'z';
  /** Projection volume: centre, rotation (Euler degrees), size. uv = local / size + 0.5 */
  position: V3;
  rotation: V3;
  size: V3;
  uv_set: number;
  /** Post transform in uv space about (0.5, 0.5). */
  uv_scale: [number, number];
  uv_offset: [number, number];
  uv_rotation: number;
  /** island mode: gap between packed islands (fraction of a cell). */
  margin: number;
}
export const defaultUvParams = (): UvParams => ({ mode: 'planar', axis: 'z', position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1], uv_set: 0, uv_scale: [1, 1], uv_offset: [0, 0], uv_rotation: 0, margin: 0.05 });

/**
 * Generate per-vertex UVs. planar / cylindrical / spherical / box project inside the (transformable) projection volume; box
 * picks the dominant axis per primitive; island = every connected island is projected along its own dominant normal axis and
 * packed into a grid cell (a layout tool, NOT a flattening unwrapper: curved islands keep their projection distortion).
 */
export function projectUV(src: MeshData, p: UvParams): MeshData {
  const out = src.clone();
  const topo = out.topology;
  const nv = out.vertexCount;
  const P = out.positions;
  const vp = topo.vertPoint;
  const ps = topo.primStart;
  const q = quatFromEulerDeg(p.rotation[0], p.rotation[1], p.rotation[2]);
  const inv = mat4Invert(mat4Compose(p.position, q, [1, 1, 1]));
  const sx = p.size[0] || 1, sy = p.size[1] || 1, sz = p.size[2] || 1;
  // local (volume) coordinates per point
  const L = new Float64Array(out.pointCount * 3);
  for (let i = 0; i < out.pointCount; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    L[i * 3] = (inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) / sx;
    L[i * 3 + 1] = (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) / sy;
    L[i * 3 + 2] = (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) / sz;
  }
  const uv = new Float32Array(nv * 2);
  const axisUV = (ax: number, sgn: number, l: ArrayLike<number>, o: number): [number, number] => {
    // dominant axis ax: 0 -> (y,z), 1 -> (x,z), 2 -> (x,y); sign mirrors u so faces never read mirrored from outside
    if (ax === 0) return [sgn * l[o + 1], l[o + 2]];
    if (ax === 1) return [-sgn * l[o], l[o + 2]];
    return [sgn * l[o], l[o + 1]];
  };
  const domAxis = (n: ArrayLike<number>): [number, number] => {
    const ax = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
    return [ax, n[ax] < 0 ? -1 : 1];
  };
  if (p.mode === 'planar') {
    const ax = p.axis === 'x' ? 0 : p.axis === 'y' ? 1 : 2;
    for (let k = 0; k < nv; k++) {
      const [u, v] = axisUV(ax, 1, L, vp[k] * 3);
      uv[k * 2] = u + 0.5;
      uv[k * 2 + 1] = v + 0.5;
    }
  } else if (p.mode === 'cylindrical' || p.mode === 'spherical') {
    for (let pr = 0; pr < topo.primCount; pr++) {
      let u0 = 0;
      for (let k = ps[pr]; k < ps[pr + 1]; k++) {
        const o = vp[k] * 3;
        let u = Math.atan2(L[o + 1], L[o]) / (2 * Math.PI) + 0.5;
        if (k === ps[pr]) u0 = u;
        else if (u - u0 > 0.5) u -= 1;
        else if (u - u0 < -0.5) u += 1;
        const v = p.mode === 'cylindrical' ? L[o + 2] + 0.5 : Math.asin(Math.max(-1, Math.min(1, L[o + 2] / (Math.hypot(L[o], L[o + 1], L[o + 2]) || 1)))) / Math.PI + 0.5;
        uv[k * 2] = u;
        uv[k * 2 + 1] = v;
      }
    }
  } else if (p.mode === 'box') {
    for (let pr = 0; pr < topo.primCount; pr++) {
      const n = primNormal(L as unknown as Float32Array, vp, ps[pr], ps[pr + 1]);
      const [ax, sgn] = domAxis(n);
      for (let k = ps[pr]; k < ps[pr + 1]; k++) {
        const [u, v] = axisUV(ax, sgn, L, vp[k] * 3);
        uv[k * 2] = u + 0.5;
        uv[k * 2 + 1] = v + 0.5;
      }
    }
  } else {
    // island: world-space projection per island, packed on a grid
    const { ids, count } = computeIslands(out);
    const nrm = new Float64Array(count * 3);
    for (let pr = 0; pr < topo.primCount; pr++) {
      if (ids[pr] < 0) continue;
      const n = primNormal(P, vp, ps[pr], ps[pr + 1]);
      nrm[ids[pr] * 3] += n[0];
      nrm[ids[pr] * 3 + 1] += n[1];
      nrm[ids[pr] * 3 + 2] += n[2];
    }
    const bb = new Float64Array(count * 4).map((_, i) => (i % 4 < 2 ? Infinity : -Infinity));
    for (let pr = 0; pr < topo.primCount; pr++) {
      const id = ids[pr];
      if (id < 0) continue;
      const [ax, sgn] = domAxis([nrm[id * 3], nrm[id * 3 + 1], nrm[id * 3 + 2]]);
      for (let k = ps[pr]; k < ps[pr + 1]; k++) {
        const [u, v] = axisUV(ax, sgn, P, vp[k] * 3);
        uv[k * 2] = u;
        uv[k * 2 + 1] = v;
        bb[id * 4] = Math.min(bb[id * 4], u);
        bb[id * 4 + 1] = Math.min(bb[id * 4 + 1], v);
        bb[id * 4 + 2] = Math.max(bb[id * 4 + 2], u);
        bb[id * 4 + 3] = Math.max(bb[id * 4 + 3], v);
      }
    }
    const cells = Math.max(1, Math.ceil(Math.sqrt(count)));
    const cell = 1 / cells;
    for (let pr = 0; pr < topo.primCount; pr++) {
      const id = ids[pr];
      if (id < 0) continue;
      const w = bb[id * 4 + 2] - bb[id * 4], h = bb[id * 4 + 3] - bb[id * 4 + 1];
      const avail = cell * (1 - 2 * Math.max(0, Math.min(0.45, p.margin)));
      const k = avail / (Math.max(w, h) || 1);
      const cx = (id % cells) * cell + cell / 2, cy = Math.floor(id / cells) * cell + cell / 2;
      for (let c = ps[pr]; c < ps[pr + 1]; c++) {
        uv[c * 2] = cx + (uv[c * 2] - (bb[id * 4] + bb[id * 4 + 2]) / 2) * k;
        uv[c * 2 + 1] = cy + (uv[c * 2 + 1] - (bb[id * 4 + 1] + bb[id * 4 + 3]) / 2) * k;
      }
    }
    out.removeAttr('primitive', STD.island);
    out.setAttr({ name: STD.island, element: 'primitive', size: 1, kind: 'i32', data: Int32Array.from(ids) });
  }
  // uv-space post transform about the centre
  if (p.mode !== 'island' || p.uv_scale[0] !== 1 || p.uv_scale[1] !== 1 || p.uv_rotation !== 0 || p.uv_offset[0] !== 0 || p.uv_offset[1] !== 0) {
    const a = (p.uv_rotation * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    for (let k = 0; k < nv; k++) {
      const x = (uv[k * 2] - 0.5) * p.uv_scale[0], y = (uv[k * 2 + 1] - 0.5) * p.uv_scale[1];
      uv[k * 2] = c * x - s * y + 0.5 + p.uv_offset[0];
      uv[k * 2 + 1] = s * x + c * y + 0.5 + p.uv_offset[1];
    }
  }
  const name = p.uv_set <= 0 ? STD.uv : `uv${p.uv_set}`;
  out.removeAttr('point', name);
  out.setAttr({ name, element: 'vertex', size: 2, kind: 'f32', data: uv });
  return out;
}
