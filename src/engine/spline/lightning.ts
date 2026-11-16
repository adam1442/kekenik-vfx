/**
 * Lightning bolt generator: recursive midpoint displacement + branch spawning, deterministic (seeded), bounded.
 * Output = `SplineSet` (one open corner-mode spline per channel, per-point width in `w`) so bolts feed Spline mask nodes and 3D Sweep.
 */
import type { SplinePoint, SplineValue } from '../params/schema';
import type { SplineSet } from './ops';

export interface BoltParams {
  start: [number, number];
  end: [number, number];
  /** 0..1 displacement as a fraction of the segment length. */
  jaggedness: number;
  levels: number;
  branchProb: number;
  /** Degrees. */
  branchAngle: number;
  /** Branch length as a fraction of its parent. */
  branchLength: number;
  branchDepth: number;
  maxBranches: number;
  /** Full width (UV) of the main channel at the start. */
  width: number;
  /** Width at the tip relative to the start. */
  taper: number;
  branchWidth: number;
  seed: number;
  /** Hard cap on the total number of points. */
  maxPoints: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed of a flicker frame: `variant = floor(time * rate) mod loop` makes the flicker periodic (loops seamlessly). */
export const flickerSeed = (seed: number, time: number, rate: number, loopFrames: number): number => {
  if (rate <= 0) return seed;
  const n = Math.floor(time * rate + 1e-6);
  return (seed + (loopFrames > 0 ? ((n % loopFrames) + loopFrames) % loopFrames : n) * 7919) >>> 0;
};

type V2 = [number, number];
function displace(a: V2, b: V2, levels: number, jag: number, rnd: () => number): V2[] {
  let pts: V2[] = [a, b];
  for (let l = 0; l < levels; l++) {
    const next: V2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const len = Math.hypot(dx, dy);
      const off = (rnd() * 2 - 1) * jag * len * 0.5;
      const nx = len > 1e-9 ? -dy / len : 0, ny = len > 1e-9 ? dx / len : 0;
      next.push([(p[0] + q[0]) / 2 + nx * off, (p[1] + q[1]) / 2 + ny * off], q);
    }
    pts = next;
  }
  return pts;
}

export interface BoltPath { pts: V2[]; depth: number }
export function generateBolt(p: BoltParams): { paths: BoltPath[]; widths: number[][] } {
  const rnd = mulberry32(p.seed);
  let levels = Math.max(1, Math.min(8, Math.round(p.levels)));
  // hard cap: the main channel alone (2^levels + 1 points) must fit the point budget, so the bolt is never truncated by the renderer
  while (levels > 1 && 2 ** levels + 1 > p.maxPoints) levels--;
  const paths: BoltPath[] = [{ pts: displace(p.start, p.end, levels, p.jaggedness, rnd), depth: 0 }];
  let total = paths[0].pts.length;
  const queue = [0];
  let branches = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const parent = paths[queue[qi]];
    if (parent.depth >= p.branchDepth) continue;
    const pl = parent.pts.length;
    for (let i = 1; i < pl - 1; i++) {
      const prob = p.branchProb * 0.5 ** parent.depth;
      const roll = rnd();
      if (roll >= prob || branches >= p.maxBranches) continue;
      const a = parent.pts[i], prev = parent.pts[i - 1], next = parent.pts[i + 1];
      const tx = next[0] - prev[0], ty = next[1] - prev[1];
      const tl = Math.hypot(tx, ty) || 1;
      const ang = ((rnd() < 0.5 ? -1 : 1) * p.branchAngle * (0.5 + rnd())) * (Math.PI / 180);
      const c = Math.cos(ang), s = Math.sin(ang);
      const dx = (tx / tl) * c - (ty / tl) * s, dy = (tx / tl) * s + (ty / tl) * c;
      let plen = 0;
      for (let k = 1; k < pl; k++) plen += Math.hypot(parent.pts[k][0] - parent.pts[k - 1][0], parent.pts[k][1] - parent.pts[k - 1][1]);
      const len = plen * p.branchLength * (0.6 + 0.4 * rnd()) * (pl - i) / pl;
      const lv = Math.max(1, levels - 1 - parent.depth);
      const need = 2 ** lv + 1;
      if (total + need > p.maxPoints) continue;
      const pts = displace(a, [a[0] + dx * len, a[1] + dy * len], lv, p.jaggedness, rnd);
      paths.push({ pts, depth: parent.depth + 1 });
      total += pts.length;
      queue.push(paths.length - 1);
      branches++;
    }
  }
  const widths = paths.map((pa) => {
    const n = pa.pts.length;
    const w0 = p.width * p.branchWidth ** pa.depth;
    return pa.pts.map((_, i) => w0 * (1 - (1 - p.taper) * (n > 1 ? i / (n - 1) : 0)));
  });
  return { paths, widths };
}

export function boltToSplines(b: ReturnType<typeof generateBolt>): SplineSet {
  const splines: SplineValue[] = b.paths.map((pa, k) => ({
    closed: false,
    points: pa.pts.map((q, i): SplinePoint => ({ x: q[0], y: q[1], w: b.widths[k][i], mode: 'corner', attrs: { depth: pa.depth } })),
  }));
  return { splines };
}
