/**
 * Vertex Animated Textures. Pure math + encoding, unit-tested.
 *
 * LAYOUT  (width = frame count, height = row count; rows run TOP-DOWN in image space):
 *     pixel (x = frame, y = row)           row = vertex index (soft body) or piece index (rigid body)
 * ROW UV  A vertex samples row `r` at v_image = (r + 0.5) / rows. The mesh UV set is in authoring convention (v up), so it stores
 *         u = 0.5 / frames and v = 1 - (r + 0.5) / rows; the glTF writer flips v and the resulting TEXCOORD equals the image row
 *         fraction directly. A shader adds `frame / frames` to u (nearest filtering, repeat wrap = loop).
 * SOFT    position texture RGB = vertex position (export space, after axis / unit conversion) or its offset from frame 0,
 *         normalised to [0,1] by the bounds when `normalize` (else raw floats: use EXR); normal texture RGB = n * 0.5 + 0.5.
 * RIGID   one row per piece: position texture RGB = displacement D of the piece pivot (normalised by bounds or raw),
 *         rotation texture RGBA = unit quaternion (x,y,z,w) * 0.5 + 0.5. Engine reconstruction:
 *             p' = pivot + D + R(q) * (p - pivot)
 */
export type V3 = [number, number, number];

export interface VatBounds {
  min: V3;
  max: V3;
}

/** Component-wise bounds of a vec3 array. Degenerate ranges are widened so normalisation never divides by zero. */
export function vec3Bounds(a: Float32Array): VatBounds {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) {
    const v = a[i + c];
    if (!Number.isFinite(v)) continue;
    if (v < lo[c]) lo[c] = v;
    if (v > hi[c]) hi[c] = v;
  }
  for (let c = 0; c < 3; c++) {
    if (lo[c] > hi[c]) (lo[c] = 0), (hi[c] = 0);
    if (hi[c] - lo[c] < 1e-9) (lo[c] -= 5e-7), (hi[c] += 5e-7);
  }
  return { min: lo, max: hi };
}
export const mergeBounds = (a: VatBounds, b: VatBounds): VatBounds => ({ min: [0, 1, 2].map((c) => Math.min(a.min[c], b.min[c])) as V3, max: [0, 1, 2].map((c) => Math.max(a.max[c], b.max[c])) as V3 });

export const vatNormalize = (v: number, lo: number, hi: number): number => (v - lo) / (hi - lo);
export const vatDenormalize = (t: number, lo: number, hi: number): number => lo + t * (hi - lo);

export interface SoftEncoding {
  normalize: boolean;
  /** Store (position - position at frame 0). */
  offset: boolean;
}

/** Frame-major data: value of (frame f, row i, component c) = data[(f * rows + i) * 3 + c]. */
export interface VatSource {
  frames: number;
  rows: number;
  positions: Float32Array;
  normals: Float32Array | null;
}

/** Bounds over all frames (and rows) of the values that will be stored (positions or offsets). */
export function softBounds(src: VatSource, offset: boolean): VatBounds {
  if (!offset) return vec3Bounds(src.positions);
  const tmp = new Float32Array(src.frames * src.rows * 3);
  for (let f = 0; f < src.frames; f++) for (let i = 0; i < src.rows; i++) for (let c = 0; c < 3; c++) tmp[(f * src.rows + i) * 3 + c] = src.positions[(f * src.rows + i) * 3 + c] - src.positions[i * 3 + c];
  return vec3Bounds(tmp);
}

/**
 * Build RGBA float rows [r0, r0 + count) of the position texture (and normal texture when present). Output row layout:
 * `frames` pixels per row, 4 floats each (alpha = 1).
 */
export function softVatRows(src: VatSource, r0: number, count: number, enc: SoftEncoding, bounds: VatBounds): { pos: Float32Array; nrm: Float32Array | null } {
  const F = src.frames;
  const pos = new Float32Array(F * count * 4);
  const nrm = src.normals ? new Float32Array(F * count * 4) : null;
  for (let r = 0; r < count; r++) {
    const i = r0 + r;
    for (let f = 0; f < F; f++) {
      const s = (f * src.rows + i) * 3;
      const d = (r * F + f) * 4;
      for (let c = 0; c < 3; c++) {
        let v = src.positions[s + c];
        if (enc.offset) v -= src.positions[i * 3 + c];
        pos[d + c] = enc.normalize ? vatNormalize(v, bounds.min[c], bounds.max[c]) : v;
        if (nrm) nrm[d + c] = enc.normalize ? src.normals![s + c] * 0.5 + 0.5 : src.normals![s + c];
      }
      pos[d + 3] = 1;
      if (nrm) nrm[d + 3] = 1;
    }
  }
  return { pos, nrm };
}

/** Decode one texel back to a position (the formula shaders implement). Used by the round-trip tests. */
export function softVatDecode(texel: ArrayLike<number>, bounds: VatBounds, enc: SoftEncoding, rest: V3): V3 {
  const p = [0, 1, 2].map((c) => (enc.normalize ? vatDenormalize(texel[c], bounds.min[c], bounds.max[c]) : texel[c])) as V3;
  return enc.offset ? ([p[0] + rest[0], p[1] + rest[1], p[2] + rest[2]] as V3) : p;
}

/** Row UV (mesh convention, v up) of row `r` of `rows`, `frames` columns: see the header comment. */
export const vatRowUv = (r: number, rows: number, frames: number): [number, number] => [0.5 / frames, 1 - (r + 0.5) / rows];

/* ------------------------------------------------------------------------------------------------ rigid body */
export type Quat = [number, number, number, number]; // x y z w

export function quatRotate(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Jacobi eigen decomposition of a symmetric 4x4 matrix (row-major 16): returns the eigenvector of the largest eigenvalue. */
export function largestEigenvector4(m16: number[]): number[] {
  const n = 4;
  const a = m16.slice();
  const v = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i * n + j] * a[i * n + j];
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p * n + q];
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k * n + p], akq = a[k * n + q];
        a[k * n + p] = c * akp - s * akq;
        a[k * n + q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p * n + k], aqk = a[q * n + k];
        a[p * n + k] = c * apk - s * aqk;
        a[q * n + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = v[k * n + p], vkq = v[k * n + q];
        v[k * n + p] = c * vkp - s * vkq;
        v[k * n + q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (a[i * n + i] > a[best * n + best]) best = i;
  return [v[best], v[n + best], v[2 * n + best], v[3 * n + best]];
}

/**
 * Best rigid motion (Horn 1987, unit quaternion) taking `rest` points to `cur` points (both vec3 arrays, same length):
 * returns rotation q and the centroids. p' = R (p - c0) + c1.
 */
export function fitRigid(rest: Float32Array, cur: Float32Array): { q: Quat; c0: V3; c1: V3 } {
  const n = rest.length / 3;
  const c0: V3 = [0, 0, 0], c1: V3 = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) (c0[c] += rest[i * 3 + c] / n), (c1[c] += cur[i * 3 + c] / n);
  let sxx = 0, sxy = 0, sxz = 0, syx = 0, syy = 0, syz = 0, szx = 0, szy = 0, szz = 0;
  for (let i = 0; i < n; i++) {
    const ax = rest[i * 3] - c0[0], ay = rest[i * 3 + 1] - c0[1], az = rest[i * 3 + 2] - c0[2];
    const bx = cur[i * 3] - c1[0], by = cur[i * 3 + 1] - c1[1], bz = cur[i * 3 + 2] - c1[2];
    sxx += ax * bx; sxy += ax * by; sxz += ax * bz;
    syx += ay * bx; syy += ay * by; syz += ay * bz;
    szx += az * bx; szy += az * by; szz += az * bz;
  }
  const N = [
    sxx + syy + szz, syz - szy, szx - sxz, sxy - syx,
    syz - szy, sxx - syy - szz, sxy + syx, szx + sxz,
    szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy,
    sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz,
  ];
  const e = largestEigenvector4(N); // (w, x, y, z)
  let q: Quat = [e[1], e[2], e[3], e[0]];
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q = [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  return { q, c0, c1 };
}

export interface RigidVat {
  frames: number;
  pieces: number;
  /** Pivot displacement D per (frame, piece): [(f * pieces + k) * 3]. */
  displacement: Float32Array;
  /** Quaternion per (frame, piece): [(f * pieces + k) * 4], sign-continuous over time, w >= 0 on frame 0. */
  rotation: Float32Array;
}

/**
 * Rigid-body VAT data. `restPoints[k]` = rest positions of piece k (vec3 array), `framePoints[f][k]` = the same points at frame f,
 * `pivots[k]` = pivot of piece k (rest space). D = R * pivot + (c1 - R * c0) - pivot = where the pivot went, minus the pivot.
 */
export function buildRigidVat(restPoints: Float32Array[], framePoints: Float32Array[][], pivots: V3[]): RigidVat {
  const pieces = restPoints.length;
  const frames = framePoints.length;
  const displacement = new Float32Array(frames * pieces * 3);
  const rotation = new Float32Array(frames * pieces * 4);
  for (let k = 0; k < pieces; k++) {
    let prev: Quat | null = null;
    for (let f = 0; f < frames; f++) {
      const fit = fitRigid(restPoints[k], framePoints[f][k]);
      let q = fit.q;
      if ((prev ? q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] : q[3]) < 0) q = [-q[0], -q[1], -q[2], -q[3]];
      prev = q;
      const rp = quatRotate(q, pivots[k]);
      const rc = quatRotate(q, fit.c0);
      for (let c = 0; c < 3; c++) displacement[(f * pieces + k) * 3 + c] = rp[c] + (fit.c1[c] - rc[c]) - pivots[k][c];
      rotation.set(q, (f * pieces + k) * 4);
    }
  }
  return { frames, pieces, displacement, rotation };
}

/** RGBA rows [r0, r0 + count) of the rigid position texture (D normalised by `bounds` when `normalize`) and rotation texture (q*0.5+0.5). */
export function rigidVatRows(v: RigidVat, r0: number, count: number, normalize: boolean, bounds: VatBounds): { pos: Float32Array; rot: Float32Array } {
  const F = v.frames;
  const pos = new Float32Array(F * count * 4);
  const rot = new Float32Array(F * count * 4);
  for (let r = 0; r < count; r++) for (let f = 0; f < F; f++) {
    const k = r0 + r;
    const d = (r * F + f) * 4;
    for (let c = 0; c < 3; c++) {
      const x = v.displacement[(f * v.pieces + k) * 3 + c];
      pos[d + c] = normalize ? vatNormalize(x, bounds.min[c], bounds.max[c]) : x;
    }
    pos[d + 3] = 1;
    for (let c = 0; c < 4; c++) rot[d + c] = v.rotation[(f * v.pieces + k) * 4 + c] * 0.5 + 0.5;
  }
  return { pos, rot };
}

/* ------------------------------------------------------------------------------------------------ metadata */
export interface VatMetaInput {
  type: 'soft' | 'rigid';
  frames: number;
  rows: number;
  fps: number;
  bounds: VatBounds;
  normalize: boolean;
  offset: boolean;
  uvChannel: number;
  uvName: string;
  axis: string;
  scale: number;
  files: Record<string, string>;
  depth: string;
  vertexCount: number;
  pieceCount?: number;
  loop: boolean;
}

export function vatMetadata(i: VatMetaInput): Record<string, unknown> {
  return {
    format: 'kekenik-vat',
    version: 1,
    type: i.type,
    frames: i.frames,
    fps: i.fps,
    duration: i.frames / i.fps,
    loop: i.loop,
    rows: i.rows,
    vertexCount: i.vertexCount,
    ...(i.type === 'rigid' ? { pieceCount: i.pieceCount } : {}),
    textureSize: [i.frames, i.rows],
    layout: 'x = frame, y = row (top-down in image space); soft: row = vertex index, rigid: row = piece index',
    uv: { channel: i.uvChannel, gltfAttribute: `TEXCOORD_${i.uvChannel}`, name: i.uvName, encoding: 'u = 0.5 / frames; v (authoring, v up) = 1 - (row + 0.5) / rows; in glTF TEXCOORD v equals the image row fraction. Sample at u + frame / frames (nearest, repeat).' },
    bounds: { min: i.bounds.min, max: i.bounds.max },
    positionEncoding: i.normalize ? 'normalized: value = min + texel * (max - min)' : 'raw floats (use a float / half EXR)',
    positionMode: i.type === 'rigid' ? 'pivot displacement D' : i.offset ? 'offset from frame 0 (add the rest position)' : 'absolute',
    normalEncoding: i.normalize ? 'n = texel * 2 - 1' : 'raw',
    rotationEncoding: i.type === 'rigid' ? 'quaternion xyzw = texel * 2 - 1' : undefined,
    reconstruct: i.type === 'rigid' ? 'p = pivot + D + rotate(q, p_rest - pivot)' : 'p = decoded position (+ rest position when positionMode is offset)',
    coordinateSystem: i.axis,
    unitScale: i.scale,
    sampleDepth: i.depth,
    files: i.files,
    generator: 'Kekenik VFX',
  };
}
