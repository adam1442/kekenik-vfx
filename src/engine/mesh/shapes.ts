import { MeshBuilder } from './builder';
import type { MeshData } from './mesh';
import { DEG2RAD, type V3 } from './math3';

/**
 * Parametric VFX shapes (Z up, centred at the origin unless `pivot: 'base'`). All shapes are quad/triangle meshes with
 * per-vertex UVs (v up) and smooth point normals; hard edges (cube, caps) use separate points so normals stay crisp.
 */
export const SHAPE_KINDS = ['plane', 'grid', 'quad', 'disc', 'ring', 'cylinder', 'cone', 'tube', 'sphere', 'hemisphere', 'cube', 'torus', 'arc_strip', 'spiral', 'cross_plane', 'crater'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface ShapeParams {
  shape: ShapeKind;
  /** Extents x/y/z (plane: x,y; cube: x,y,z; cylinder/cone/tube/crater: z = height / depth; strips: x = width, z = rise). */
  size: V3;
  /** Outer radius for radial shapes (torus: major radius). */
  radius: number;
  /** Inner radius (ring, tube, spiral start) / minor radius (torus). */
  inner_radius: number;
  /** Top radius multiplier of cylinders (cone uses 0). */
  taper: number;
  /** Subdivisions along x / y (plane, grid, cube, strips: rows = across). */
  cols: number;
  rows: number;
  /** Around the axis. */
  segments: number;
  /** Radial / height / latitude divisions. */
  rings: number;
  /** Arc length in degrees (disc, ring, arc strip). */
  sweep: number;
  turns: number;
  /** Number of crossing planes (cross_plane). */
  count: number;
  caps: boolean;
  /** Crater depth and rim height. */
  depth: number;
  rim: number;
  uv_mode: 'planar' | 'polar';
  pivot: 'center' | 'base';
  center: V3;
}

export const defaultShapeParams = (): ShapeParams => ({
  shape: 'plane', size: [1, 1, 1], radius: 0.5, inner_radius: 0.25, taper: 1, cols: 1, rows: 1, segments: 32, rings: 8, sweep: 360, turns: 2, count: 2, caps: true, depth: 0.25, rim: 0.08, uv_mode: 'polar', pivot: 'center', center: [0, 0, 0],
});

const TAU = Math.PI * 2;
const clampI = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

/** Parallelogram grid: origin + ax*u + ay*v, quads wound so the normal is ax x ay. */
function grid(b: MeshBuilder, o: V3, ax: V3, ay: V3, nu: number, nv: number): void {
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    idx.push(b.addPoint(o[0] + ax[0] * u + ay[0] * v, o[1] + ax[1] * u + ay[1] * v, o[2] + ax[2] * u + ay[2] * v));
  }
  const W = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    b.quad(idx[j * W + i], idx[j * W + i + 1], idx[(j + 1) * W + i + 1], idx[(j + 1) * W + i], [i / nu, j / nv, (i + 1) / nu, j / nv, (i + 1) / nu, (j + 1) / nv, i / nu, (j + 1) / nv]);
  }
}

/** Polar grid from r0 to r1 (r0 = 0 collapses to the centre), facing +Z. `zfn(t)` lifts rings (crater). */
function radialGrid(b: MeshBuilder, r0: number, r1: number, rings: number, segs: number, sweepDeg: number, uvMode: 'planar' | 'polar', zfn?: (t: number) => number, flip = false): void {
  const sweep = Math.max(1, Math.min(360, sweepDeg)) * DEG2RAD;
  const full = sweepDeg >= 359.999;
  const centre = r0 <= 1e-9;
  const pts: number[][] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = r0 + (r1 - r0) * t;
    const row: number[] = [];
    if (r === 0 && centre) {
      const c = b.addPoint(0, 0, zfn ? zfn(0) : 0);
      for (let k = 0; k <= segs; k++) row.push(c);
    } else {
      for (let k = 0; k <= segs; k++) {
        if (full && k === segs) row.push(row[0]);
        else {
          const a = (sweep * k) / segs;
          row.push(b.addPoint(Math.cos(a) * rad, Math.sin(a) * rad, zfn ? zfn(rad / r1) : 0));
        }
      }
    }
    pts.push(row);
  }
  const uv = (r: number, k: number): [number, number] => {
    if (uvMode === 'polar') return [k / segs, r / rings];
    const rad = r0 + (r1 - r0) * (r / rings);
    const a = (sweep * k) / segs;
    return [0.5 + (Math.cos(a) * rad) / (2 * r1), 0.5 + (Math.sin(a) * rad) / (2 * r1)];
  };
  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < segs; k++) {
      const a = pts[r][k], bb = pts[r][k + 1], cc = pts[r + 1][k + 1], d = pts[r + 1][k];
      const ua = uv(r, k), ub = uv(r, k + 1), uc = uv(r + 1, k + 1), ud = uv(r + 1, k);
      if (r === 0 && centre) {
        // centre fan: apex corner uv sits in the middle of the segment in polar mode
        const apex: [number, number] = uvMode === 'polar' ? [(k + 0.5) / segs, 0] : ua;
        if (flip) b.tri(a, cc, d, [apex[0], apex[1], uc[0], uc[1], ud[0], ud[1]]);
        else b.tri(a, d, cc, [apex[0], apex[1], ud[0], ud[1], uc[0], uc[1]]);
      } else if (flip) b.quad(a, bb, cc, d, [ua[0], ua[1], ub[0], ub[1], uc[0], uc[1], ud[0], ud[1]]);
      else b.quad(a, d, cc, bb, [ua[0], ua[1], ud[0], ud[1], uc[0], uc[1], ub[0], ub[1]]);
    }
  }
}

/** Open surface of revolution: ring j (0..rows) has radius rad(j) at height z(j). `outward` = normals face away from the axis. */
function revolve(b: MeshBuilder, rows: number, segs: number, rad: (t: number) => number, z: (t: number) => number, outward: boolean): void {
  const idx: number[][] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const r = rad(t);
    const row: number[] = [];
    if (r <= 1e-9) {
      const p = b.addPoint(0, 0, z(t));
      for (let k = 0; k <= segs; k++) row.push(p);
    } else {
      for (let k = 0; k < segs; k++) row.push(b.addPoint(Math.cos((TAU * k) / segs) * r, Math.sin((TAU * k) / segs) * r, z(t)));
      row.push(row[0]);
    }
    idx.push(row);
  }
  for (let j = 0; j < rows; j++) for (let k = 0; k < segs; k++) {
    const a = idx[j][k], bb = idx[j][k + 1], c = idx[j + 1][k + 1], d = idx[j + 1][k];
    const uv = [k / segs, j / rows, (k + 1) / segs, j / rows, (k + 1) / segs, (j + 1) / rows, k / segs, (j + 1) / rows];
    const degenerateTop = a === bb, degenerateBottom = d === c;
    if (degenerateTop && degenerateBottom) continue;
    if (degenerateTop) {
      if (outward) b.tri(a, d, c, [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5]]);
      else b.tri(a, c, d, [uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]]);
    } else if (degenerateBottom) {
      if (outward) b.tri(a, c, bb, [uv[0], uv[1], uv[4], uv[5], uv[2], uv[3]]);
      else b.tri(a, bb, c, [uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]]);
    }
    else if (outward) b.quad(a, bb, c, d, uv);
    else b.quad(a, d, c, bb, [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]]);
  }
}

/** Flat annulus / disc at height z with its own points (hard edge), facing +Z or -Z. */
function cap(b: MeshBuilder, r0: number, r1: number, z: number, segs: number, up: boolean): void {
  const lift = (zz: number) => () => zz;
  const zf = lift(z);
  radialGrid(b, r0, r1, 1, segs, 360, 'planar', zf, !up);
}

/** Camera-facing-agnostic strip along a path (arc strip, spiral): centre(t) and unit radial direction(t). */
function strip(b: MeshBuilder, n: number, rows: number, centre: (t: number) => V3, dir: (t: number) => [number, number], width: (t: number) => number): void {
  const idx: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = centre(t), d = dir(t), w = width(t);
    const row: number[] = [];
    for (let j = 0; j <= rows; j++) {
      const s = (j / rows - 0.5) * w;
      row.push(b.addPoint(c[0] + d[0] * s, c[1] + d[1] * s, c[2]));
    }
    idx.push(row);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) {
    b.quad(idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j], [i / n, j / rows, i / n, (j + 1) / rows, (i + 1) / n, (j + 1) / rows, (i + 1) / n, j / rows]);
  }
}

export function makeShape(p: ShapeParams): MeshData {
  const b = new MeshBuilder(`Shape ${p.shape}`);
  const segs = clampI(p.segments, 3, 2048);
  const rings = clampI(p.rings, 1, 1024);
  const cols = clampI(p.cols, 1, 1024);
  const rows = clampI(p.rows, 1, 1024);
  const [sx, sy, sz] = p.size;
  const R = Math.max(1e-6, p.radius);
  switch (p.shape) {
    case 'plane':
    case 'grid':
      grid(b, [-sx / 2, -sy / 2, 0], [sx, 0, 0], [0, sy, 0], cols, rows);
      break;
    case 'quad':
      grid(b, [-sx / 2, -sy / 2, 0], [sx, 0, 0], [0, sy, 0], 1, 1);
      break;
    case 'disc':
      radialGrid(b, 0, R, rings, segs, p.sweep, p.uv_mode);
      break;
    case 'ring':
      radialGrid(b, Math.min(p.inner_radius, R * 0.999), R, rings, segs, p.sweep, p.uv_mode);
      break;
    case 'crater': {
      const ss = (a: number, c: number, x: number): number => {
        const t = Math.max(0, Math.min(1, (x - a) / (c - a)));
        return t * t * (3 - 2 * t);
      };
      radialGrid(b, 0, R, Math.max(rings, 2), segs, 360, p.uv_mode, (t) => -p.depth * (1 - ss(0, 0.75, t)) + p.rim * Math.sin(Math.PI * ss(0.55, 1, t)));
      break;
    }
    case 'cylinder':
    case 'cone': {
      const top = p.shape === 'cone' ? 0 : Math.max(0, p.taper);
      revolve(b, rings, segs, (t) => R * (1 + (top - 1) * t), (t) => -sz / 2 + sz * t, true);
      if (p.caps) {
        cap(b, 0, R, -sz / 2, segs, false);
        if (top > 1e-6) cap(b, 0, R * top, sz / 2, segs, true);
      }
      break;
    }
    case 'tube': {
      const ri = Math.min(Math.max(1e-6, p.inner_radius), R * 0.999);
      revolve(b, rings, segs, () => R, (t) => -sz / 2 + sz * t, true);
      revolve(b, rings, segs, () => ri, (t) => -sz / 2 + sz * t, false);
      if (p.caps) {
        cap(b, ri, R, -sz / 2, segs, false);
        cap(b, ri, R, sz / 2, segs, true);
      }
      break;
    }
    case 'sphere':
    case 'hemisphere': {
      const hemi = p.shape === 'hemisphere';
      const L = hemi ? rings : rings * 2;
      const maxPhi = hemi ? Math.PI / 2 : Math.PI;
      const top = b.addPoint(0, 0, R);
      const ringPts: number[][] = [];
      for (let j = 1; j <= L; j++) {
        const phi = (maxPhi * j) / L;
        if (!hemi && j === L) break;
        const row: number[] = [];
        for (let k = 0; k < segs; k++) row.push(b.addPoint(Math.sin(phi) * Math.cos((TAU * k) / segs) * R, Math.sin(phi) * Math.sin((TAU * k) / segs) * R, Math.cos(phi) * R));
        row.push(row[0]);
        ringPts.push(row);
      }
      const bottom = hemi ? -1 : b.addPoint(0, 0, -R);
      const vOf = (j: number): number => 1 - j / L; // v up
      for (let k = 0; k < segs; k++) b.tri(top, ringPts[0][k], ringPts[0][k + 1], [(k + 0.5) / segs, 1, k / segs, vOf(1), (k + 1) / segs, vOf(1)]);
      for (let j = 0; j + 1 < ringPts.length; j++) for (let k = 0; k < segs; k++) {
        b.quad(ringPts[j][k], ringPts[j + 1][k], ringPts[j + 1][k + 1], ringPts[j][k + 1], [k / segs, vOf(j + 1), k / segs, vOf(j + 2), (k + 1) / segs, vOf(j + 2), (k + 1) / segs, vOf(j + 1)]);
      }
      if (!hemi) {
        const last = ringPts[ringPts.length - 1];
        for (let k = 0; k < segs; k++) b.tri(bottom, last[k + 1], last[k], [(k + 0.5) / segs, 0, (k + 1) / segs, vOf(L - 1), k / segs, vOf(L - 1)]);
      } else if (p.caps) cap(b, 0, R, 0, segs, false);
      break;
    }
    case 'cube': {
      const hx = sx / 2, hy = sy / 2, hz = sz / 2;
      grid(b, [-hx, -hy, hz], [sx, 0, 0], [0, sy, 0], cols, rows);
      grid(b, [-hx, hy, -hz], [sx, 0, 0], [0, -sy, 0], cols, rows);
      grid(b, [hx, -hy, -hz], [0, sy, 0], [0, 0, sz], rows, rows);
      grid(b, [-hx, hy, -hz], [0, -sy, 0], [0, 0, sz], rows, rows);
      grid(b, [hx, hy, -hz], [-sx, 0, 0], [0, 0, sz], cols, rows);
      grid(b, [-hx, -hy, -hz], [sx, 0, 0], [0, 0, sz], cols, rows);
      break;
    }
    case 'torus': {
      const r = Math.max(1e-6, p.inner_radius);
      const minor = Math.max(3, Math.min(1024, rings * 2));
      const idx: number[][] = [];
      for (let i = 0; i < segs; i++) {
        const row: number[] = [];
        const th = (TAU * i) / segs;
        for (let j = 0; j < minor; j++) {
          const ph = (TAU * j) / minor;
          row.push(b.addPoint((R + r * Math.cos(ph)) * Math.cos(th), (R + r * Math.cos(ph)) * Math.sin(th), r * Math.sin(ph)));
        }
        idx.push(row);
      }
      for (let i = 0; i < segs; i++) for (let j = 0; j < minor; j++) {
        const i1 = (i + 1) % segs, j1 = (j + 1) % minor;
        b.quad(idx[i][j], idx[i1][j], idx[i1][j1], idx[i][j1], [i / segs, j / minor, (i + 1) / segs, j / minor, (i + 1) / segs, (j + 1) / minor, i / segs, (j + 1) / minor]);
      }
      break;
    }
    case 'arc_strip': {
      const sweep = Math.max(1, Math.min(360, p.sweep)) * DEG2RAD;
      const a0 = -sweep / 2;
      const w = Math.min(Math.max(1e-6, sx), R * 1.98); // never reach the axis (degenerate inner edge)
      strip(b, segs, rows, (t) => [Math.cos(a0 + sweep * t) * R, Math.sin(a0 + sweep * t) * R, sz * (t - 0.5) * 0], (t) => [Math.cos(a0 + sweep * t), Math.sin(a0 + sweep * t)], (t) => w * (1 + (p.taper - 1) * t));
      break;
    }
    case 'spiral': {
      const turns = Math.max(0.05, p.turns);
      const n = Math.max(2, Math.min(4096, Math.ceil(segs * turns)));
      const r0 = Math.max(0, p.inner_radius);
      strip(b, n, rows, (t) => [Math.cos(TAU * turns * t) * (r0 + (R - r0) * t), Math.sin(TAU * turns * t) * (r0 + (R - r0) * t), sz * (t - 0.5)], (t) => [Math.cos(TAU * turns * t), Math.sin(TAU * turns * t)], (t) => Math.max(1e-6, sx) * (1 + (p.taper - 1) * t));
      break;
    }
    case 'cross_plane': {
      const n = clampI(p.count, 1, 64);
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * i) / n;
        const c = Math.cos(a), s = Math.sin(a);
        grid(b, [(-sx / 2) * c, (-sx / 2) * s, -sz / 2], [sx * c, sx * s, 0], [0, 0, sz], cols, rows);
      }
      break;
    }
  }
  const m = b.build();
  // pivot + centre offset (post pass on an owned array)
  let dz = 0;
  if (p.pivot === 'base') dz = -m.bounds().min[2];
  const [cx, cy, cz] = p.center;
  if (dz !== 0 || cx !== 0 || cy !== 0 || cz !== 0) {
    const P = m.writable('point', 'P') as Float32Array;
    for (let i = 0; i < m.pointCount; i++) {
      P[i * 3] += cx;
      P[i * 3 + 1] += cy;
      P[i * 3 + 2] += cz + dz;
    }
  }
  return m;
}
