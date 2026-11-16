/**
 * CPU references of the grid simulations: Gray-Scott (`simulation/reaction_diffusion/sim.wgsl`), 2D wave equation
 * (`simulation/wave/sim.wgsl`) and anisotropic diffusion (`simulation/diffusion/sim.wgsl`), periodic boundaries. Same formulas as the shaders;
 * used for the stability / energy tests and the GPU known-answer self-test.
 */
export interface Grid { w: number; h: number; a: Float32Array; b: Float32Array }
export const makeGrid = (w: number, h: number, f: (x: number, y: number) => [number, number]): Grid => {
  const a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) [a[y * w + x], b[y * w + x]] = f(x, y);
  return { w, h, a, b };
};
const wrapI = (i: number, n: number): number => ((i % n) + n) % n;
const at = (g: Grid, arr: Float32Array, x: number, y: number): number => arr[wrapI(y, g.h) * g.w + wrapI(x, g.w)];
/** `sg_lap9`: 0.2 * edge + 0.05 * diagonal - centre. */
export function lap9(g: Grid, arr: Float32Array, x: number, y: number): number {
  const e = at(g, arr, x + 1, y) + at(g, arr, x - 1, y) + at(g, arr, x, y + 1) + at(g, arr, x, y - 1);
  const d = at(g, arr, x + 1, y + 1) + at(g, arr, x - 1, y - 1) + at(g, arr, x + 1, y - 1) + at(g, arr, x - 1, y + 1);
  return 0.2 * e + 0.05 * d - arr[y * g.w + x];
}
export interface GrayScottParams { feed: number; kill: number; diffA: number; diffB: number; dt: number }
export function grayScottStep(g: Grid, p: GrayScottParams): Grid {
  const out = makeGrid(g.w, g.h, () => [0, 0]);
  const dt = Math.min(p.dt, 1.2 / Math.max(Math.max(p.diffA, p.diffB), 1e-3));
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    const a = g.a[i], b = g.b[i], abb = a * b * b;
    const na = a + dt * (p.diffA * lap9(g, g.a, x, y) - abb + p.feed * (1 - a));
    const nb = b + dt * (p.diffB * lap9(g, g.b, x, y) + abb - (p.feed + p.kill) * b);
    out.a[i] = Math.min(1, Math.max(0, na));
    out.b[i] = Math.min(1, Math.max(0, nb));
  }
  return out;
}

export interface WaveParams { speedCells: number; damping: number; dt: number }
/** Wave state: `a` = height, `b` = velocity (periodic). Semi-implicit damping, CFL clamp c dt <= 0.7 cells. */
export function waveStep(g: Grid, p: WaveParams): Grid {
  const out = makeGrid(g.w, g.h, () => [0, 0]);
  const ce = Math.min(p.speedCells, 0.7 / Math.max(p.dt, 1e-6));
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    const hc = g.a[i];
    const lap = at(g, g.a, x + 1, y) + at(g, g.a, x - 1, y) + at(g, g.a, x, y + 1) + at(g, g.a, x, y - 1) - 4 * hc;
    const v = (g.b[i] + p.dt * ce * ce * lap) / (1 + p.dt * p.damping);
    out.b[i] = v;
    out.a[i] = hc + p.dt * v;
  }
  return out;
}
/** Discrete wave energy: kinetic (v^2 / 2) + potential (c^2 |grad h|^2 / 2 with forward differences). */
export function waveEnergy(g: Grid, speedCells: number): number {
  let e = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    const gx = at(g, g.a, x + 1, y) - g.a[i], gy = at(g, g.a, x, y + 1) - g.a[i];
    e += 0.5 * g.b[i] * g.b[i] + 0.5 * speedCells * speedCells * (gx * gx + gy * gy);
  }
  return e;
}

/** Isotropic heat step on `a` (periodic, no sources): t += dt * d * (txx + tyy), the anisotropic tensor with equal diffusivities. */
export function heatStep(g: Grid, d: number, dt: number, decay = 0, along: { dir: [number, number]; par: number; perp: number } | null = null): Grid {
  const out = makeGrid(g.w, g.h, () => [0, 0]);
  const par = along ? along.par : 1, perp = along ? along.perp : 1;
  const dir = along ? along.dir : [1, 0];
  const dxx = perp + (par - perp) * dir[0] * dir[0], dyy = perp + (par - perp) * dir[1] * dir[1], dxy = (par - perp) * dir[0] * dir[1];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    const tc = g.a[i];
    const txx = at(g, g.a, x + 1, y) + at(g, g.a, x - 1, y) - 2 * tc;
    const tyy = at(g, g.a, x, y + 1) + at(g, g.a, x, y - 1) - 2 * tc;
    const txy = 0.25 * (at(g, g.a, x + 1, y + 1) - at(g, g.a, x + 1, y - 1) - at(g, g.a, x - 1, y + 1) + at(g, g.a, x - 1, y - 1));
    out.a[i] = (tc + dt * d * (dxx * txx + dyy * tyy + 2 * dxy * txy)) * Math.exp(-dt * decay);
  }
  return out;
}
