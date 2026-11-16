import type { RGBA } from '../../shared/util';
import { clamp } from '../../shared/util';
import type { CurveValue, GradientValue } from './schema';

/** CPU evaluation of Curve / Gradient values (used to bake LUT textures/buffers for shaders). Pure, unit-tested. */

export function autoTangent(k: CurveValue['keys'], i: number): number {
  const n = k.length;
  const dxy = (a: number, b: number) => (k[b].y - k[a].y) / Math.max(k[b].x - k[a].x, 1e-9);
  if (n < 2) return 0;
  if (i === 0) return dxy(0, 1);
  if (i === n - 1) return dxy(n - 2, n - 1);
  const d0 = dxy(i - 1, i);
  const d1 = dxy(i, i + 1);
  if (d0 * d1 <= 0) return 0; // local extremum: flat tangent (no overshoot)
  return (2 * d0 * d1) / (d0 + d1); // harmonic mean: monotone-preserving
}

export function evalCurve(c: CurveValue, x: number): number {
  const k = c.keys;
  const n = k.length;
  if (n === 0) return x;
  if (n === 1 || x <= k[0].x) return k[0].y;
  if (x >= k[n - 1].x) return k[n - 1].y;
  let i = 0;
  while (i < n - 2 && x >= k[i + 1].x) i++;
  const a = k[i];
  const b = k[i + 1];
  const dx = b.x - a.x;
  if (dx <= 1e-9) return b.y;
  const t = (x - a.x) / dx;
  const mode = a.mode ?? 'smooth';
  if (mode === 'step') return a.y;
  if (mode === 'linear') return a.y + (b.y - a.y) * t;
  const ma = a.tout ?? autoTangent(k, i);
  const mb = b.tin ?? autoTangent(k, i + 1);
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * dx * ma + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * dx * mb;
}

/** Bake a curve into `n` samples over x in [0,1] (inclusive ends). */
export function bakeCurveLut(c: CurveValue, n = 256): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = evalCurve(c, i / (n - 1));
  return out;
}

export function evalGradient(g: GradientValue, x: number): RGBA {
  const s = g.stops;
  if (s.length === 0) return [0, 0, 0, 1];
  if (x <= s[0].pos) return [...s[0].color] as RGBA;
  if (x >= s[s.length - 1].pos) return [...s[s.length - 1].color] as RGBA;
  let i = 0;
  while (i < s.length - 2 && x >= s[i + 1].pos) i++;
  const a = s[i];
  const b = s[i + 1];
  let t = clamp((x - a.pos) / Math.max(b.pos - a.pos, 1e-9), 0, 1);
  if (g.interp === 'step') return [...a.color] as RGBA;
  if (g.interp === 'smooth') t = t * t * (3 - 2 * t);
  if (g.interp === 'oklab') return oklabMix(a.color, b.color, t);
  return [0, 1, 2, 3].map((c) => a.color[c] + (b.color[c] - a.color[c]) * t) as RGBA;
}

/** Interpolate two LINEAR RGBA colors in OKLab (alpha linearly). */
function oklabMix(a: RGBA, b: RGBA, t: number): RGBA {
  const toLab = (c: RGBA): [number, number, number] => {
    const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
    const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
    const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const A = toLab(a);
  const B = toLab(b);
  const L = A[0] + (B[0] - A[0]) * t;
  const aa = A[1] + (B[1] - A[1]) * t;
  const bb = A[2] + (B[2] - A[2]) * t;
  const l = (L + 0.3963377774 * aa + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * aa - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * aa - 1.291485548 * bb) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s, a[3] + (b[3] - a[3]) * t];
}

/** Bake into n RGBA texels (Float32Array of 4n). */
export function bakeGradientLut(g: GradientValue, n = 256): Float32Array {
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) out.set(evalGradient(g, i / (n - 1)), i * 4);
  return out;
}
