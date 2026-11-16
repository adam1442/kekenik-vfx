/**
 * CPU reference of the Fluid 2D numerics on tiny grids. Mirrors fluid.wgsl rule by rule:
 *  - velocities in CELLS per step, central differences, collocated grid
 *  - pressure Poisson `L p = div`, L = 5-point Laplacian with the boundary rules: periodic wrap, closed = Neumann (neighbour replaced by the centre),
 *    open = Dirichlet 0 outside
 *  - Jacobi, red-black Gauss-Seidel, geometric multigrid V-cycle (2x2 restriction, bilinear prolongation, coarse rhs x4)
 *  - semi-Lagrangian + MacCormack advection with min/max clamping, RK2 back-trace
 * Used by tests/sim-fluid-ref.test.ts and (small sizes) by the GPU known-answer tests.
 */
export type Bmode = 0 | 1 | 2; // closed, open, periodic

export interface Field {
  n: number;
  m: number;
  d: Float64Array;
}
export const zeros = (n: number, m: number): Field => ({ n, m, d: new Float64Array(n * m) });
const wrapI = (i: number, n: number): number => ((i % n) + n) % n;

/** Neighbour value for pressure; `cnt.sub` counts neighbours replaced by the centre (Neumann). */
function pnb(f: Field, x: number, y: number, pc: number, b: Bmode, cnt: { sub: number }): number {
  if (x < 0 || y < 0 || x >= f.n || y >= f.m) {
    if (b === 2) return f.d[wrapI(y, f.m) * f.n + wrapI(x, f.n)];
    if (b === 0) {
      cnt.sub++;
      return pc;
    }
    return 0;
  }
  return f.d[y * f.n + x];
}

/** (L p)(x, y) = sum of neighbours - 4 p. */
export function laplacian(p: Field, x: number, y: number, b: Bmode): number {
  const pc = p.d[y * p.n + x];
  const c = { sub: 0 };
  return pnb(p, x + 1, y, pc, b, c) + pnb(p, x - 1, y, pc, b, c) + pnb(p, x, y + 1, pc, b, c) + pnb(p, x, y - 1, pc, b, c) - 4 * pc;
}

/** Central-difference divergence of (u, v) in cells / step, with the wall / outflow neighbour rules of the shader. */
export function divergence(u: Field, v: Field, b: Bmode): Field {
  const out = zeros(u.n, u.m);
  const ux = (x: number, y: number, vc: number, axisX: boolean, sign: number): number => {
    const outside = x < 0 || y < 0 || x >= u.n || y >= u.m;
    if (outside) {
      if (b === 2) return (axisX ? u : v).d[wrapI(y, u.m) * u.n + wrapI(x, u.n)];
      if (b === 0) return vc - sign * 2 * vc * 0 - 2 * vc; // reflect the normal component: -vc
      return vc;
    }
    return (axisX ? u : v).d[y * u.n + x];
  };
  for (let y = 0; y < u.m; y++) {
    for (let x = 0; x < u.n; x++) {
      const uc = u.d[y * u.n + x];
      const vc = v.d[y * u.n + x];
      const r = ux(x + 1, y, uc, true, 1);
      const l = ux(x - 1, y, uc, true, -1);
      const up = ux(x, y + 1, vc, false, 1);
      const dn = ux(x, y - 1, vc, false, -1);
      out.d[y * u.n + x] = 0.5 * (r - l + up - dn);
    }
  }
  return out;
}

export function removeMean(f: Field): void {
  let s = 0;
  for (const x of f.d) s += x;
  s /= f.d.length;
  for (let i = 0; i < f.d.length; i++) f.d[i] -= s;
}

function gather(p: Field, x: number, y: number, b: Bmode): { s: number; sub: number } {
  const pc = p.d[y * p.n + x];
  const c = { sub: 0 };
  const s = pnb(p, x + 1, y, pc, b, c) + pnb(p, x - 1, y, pc, b, c) + pnb(p, x, y + 1, pc, b, c) + pnb(p, x, y - 1, pc, b, c);
  return { s, sub: c.sub };
}

export function jacobi(p: Field, rhs: Field, b: Bmode, iters: number): Field {
  let cur = p;
  for (let it = 0; it < iters; it++) {
    const nx = zeros(p.n, p.m);
    for (let y = 0; y < p.m; y++)
      for (let x = 0; x < p.n; x++) {
        const g = gather(cur, x, y, b);
        const pc = cur.d[y * p.n + x];
        const dg = 4 - g.sub;
        nx.d[y * p.n + x] = dg > 0.5 ? (g.s - g.sub * pc - rhs.d[y * p.n + x]) / dg : 0;
      }
    cur = nx;
  }
  return cur;
}

/** One red-black Gauss-Seidel sweep (red then black half sweeps, each from the previous half's result like the 2 passes on the GPU). */
export function rbgs(p: Field, rhs: Field, b: Bmode, sweeps: number): Field {
  let cur = p;
  for (let s = 0; s < sweeps; s++)
    for (let color = 0; color < 2; color++) {
      const nx: Field = { n: p.n, m: p.m, d: Float64Array.from(cur.d) };
      for (let y = 0; y < p.m; y++)
        for (let x = 0; x < p.n; x++) {
          if (((x + y) & 1) !== color) continue;
          const g = gather(cur, x, y, b);
          const pc = cur.d[y * p.n + x];
          const dg = 4 - g.sub;
          nx.d[y * p.n + x] = dg > 0.5 ? (g.s - g.sub * pc - rhs.d[y * p.n + x]) / dg : 0;
        }
      cur = nx;
    }
  return cur;
}

export function residual(p: Field, rhs: Field, b: Bmode): Field {
  const r = zeros(p.n, p.m);
  for (let y = 0; y < p.m; y++) for (let x = 0; x < p.n; x++) r.d[y * p.n + x] = rhs.d[y * p.n + x] - laplacian(p, x, y, b);
  return r;
}

function restrict(f: Field): Field {
  const c = zeros(f.n >> 1, f.m >> 1);
  for (let y = 0; y < c.m; y++)
    for (let x = 0; x < c.n; x++) c.d[y * c.n + x] = 0.25 * (f.d[2 * y * f.n + 2 * x] + f.d[2 * y * f.n + 2 * x + 1] + f.d[(2 * y + 1) * f.n + 2 * x] + f.d[(2 * y + 1) * f.n + 2 * x + 1]) * 4;
  return c;
}
function prolongAdd(p: Field, e: Field, b: Bmode): Field {
  const out: Field = { n: p.n, m: p.m, d: Float64Array.from(p.d) };
  const at = (x: number, y: number): number => {
    if (b === 2) return e.d[wrapI(y, e.m) * e.n + wrapI(x, e.n)];
    return e.d[Math.max(0, Math.min(e.m - 1, y)) * e.n + Math.max(0, Math.min(e.n - 1, x))];
  };
  for (let y = 0; y < p.m; y++)
    for (let x = 0; x < p.n; x++) {
      const cx = (x + 0.5) * 0.5 - 0.5;
      const cy = (y + 0.5) * 0.5 - 0.5;
      const x0 = Math.floor(cx);
      const y0 = Math.floor(cy);
      const fx = cx - x0;
      const fy = cy - y0;
      const v = (1 - fy) * ((1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)) + fy * ((1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1));
      out.d[y * p.n + x] += v;
    }
  return out;
}

export function vcycle(p: Field, rhs: Field, b: Bmode, minSize = 8): Field {
  if (p.n <= minSize || p.m <= minSize || p.n % 2 || p.m % 2) return rbgs(p, rhs, b, 10);
  let q = rbgs(p, rhs, b, 2);
  const rc = restrict(residual(q, rhs, b));
  const e = vcycle(zeros(rc.n, rc.m), rc, b, minSize);
  q = prolongAdd(q, e, b);
  return rbgs(q, rhs, b, 2);
}

export interface ProjectOptions {
  bmode: Bmode;
  solver: 'jacobi' | 'mg';
  iters?: number;
  cycles?: number;
}
/** Full projection: u -= 0.5 grad p with L p = div (mean removed for closed / periodic). Returns the new velocity and the pressure. */
export function project(u: Field, v: Field, o: ProjectOptions): { u: Field; v: Field; p: Field } {
  const div = divergence(u, v, o.bmode);
  if (o.bmode !== 1) removeMean(div);
  let p = zeros(u.n, u.m);
  if (o.solver === 'jacobi') p = jacobi(p, div, o.bmode, o.iters ?? 50);
  else for (let c = 0; c < (o.cycles ?? 2); c++) p = vcycle(p, div, o.bmode);
  const nu = zeros(u.n, u.m);
  const nv = zeros(u.n, u.m);
  const c = { sub: 0 };
  for (let y = 0; y < u.m; y++)
    for (let x = 0; x < u.n; x++) {
      const pc = p.d[y * u.n + x];
      const pr = pnb(p, x + 1, y, pc, o.bmode, c);
      const pl = pnb(p, x - 1, y, pc, o.bmode, c);
      const pu = pnb(p, x, y + 1, pc, o.bmode, c);
      const pd = pnb(p, x, y - 1, pc, o.bmode, c);
      nu.d[y * u.n + x] = u.d[y * u.n + x] - 0.5 * (pr - pl);
      nv.d[y * u.n + x] = v.d[y * u.n + x] - 0.5 * (pu - pd);
    }
  return { u: nu, v: nv, p };
}

export const maxAbs = (f: Field): number => f.d.reduce((a, x) => Math.max(a, Math.abs(x)), 0);
export const l2 = (f: Field): number => Math.sqrt(f.d.reduce((a, x) => a + x * x, 0) / f.d.length);

/* ------------------------------------------------------------------------------ advection (periodic) */
function bilinearWrap(f: Field, px: number, py: number): number {
  const qx = px - 0.5;
  const qy = py - 0.5;
  const x0 = Math.floor(qx);
  const y0 = Math.floor(qy);
  const fx = qx - x0;
  const fy = qy - y0;
  const g = (x: number, y: number): number => f.d[wrapI(y, f.m) * f.n + wrapI(x, f.n)];
  return (1 - fy) * ((1 - fx) * g(x0, y0) + fx * g(x0 + 1, y0)) + fy * ((1 - fx) * g(x0, y0 + 1) + fx * g(x0 + 1, y0 + 1));
}
/** Semi-Lagrangian step with velocity in cells / step (RK2 mid-point back-trace). dir = +1 backward, -1 forward. */
export function advectSL(q: Field, u: Field, v: Field, dir = 1): Field {
  const out = zeros(q.n, q.m);
  for (let y = 0; y < q.m; y++)
    for (let x = 0; x < q.n; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const k1x = bilinearWrap(u, px, py);
      const k1y = bilinearWrap(v, px, py);
      const mx = px - 0.5 * dir * k1x;
      const my = py - 0.5 * dir * k1y;
      const k2x = bilinearWrap(u, mx, my);
      const k2y = bilinearWrap(v, mx, my);
      out.d[y * q.n + x] = bilinearWrap(q, px - dir * k2x, py - dir * k2y);
    }
  return out;
}
/** MacCormack: R0 + 0.5 (q - R1) clamped to the min / max of q around the departure point. */
export function advectMacCormack(q: Field, u: Field, v: Field): Field {
  const r0 = advectSL(q, u, v, 1);
  const r1 = advectSL(r0, u, v, -1);
  const out = zeros(q.n, q.m);
  for (let y = 0; y < q.m; y++)
    for (let x = 0; x < q.n; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const k1x = bilinearWrap(u, px, py);
      const k1y = bilinearWrap(v, px, py);
      const k2x = bilinearWrap(u, px - 0.5 * k1x, py - 0.5 * k1y);
      const k2y = bilinearWrap(v, px - 0.5 * k1x, py - 0.5 * k1y);
      const dx = px - k2x - 0.5;
      const dy = py - k2y - 0.5;
      const x0 = Math.floor(dx);
      const y0 = Math.floor(dy);
      const vals = [0, 1].flatMap((j) => [0, 1].map((i) => q.d[wrapI(y0 + j, q.m) * q.n + wrapI(x0 + i, q.n)]));
      const i = y * q.n + x;
      out.d[i] = Math.min(Math.max(r0.d[i] + 0.5 * (q.d[i] - r1.d[i]), Math.min(...vals)), Math.max(...vals));
    }
  return out;
}
