/**
 * histogram maths shared by the GPU service (histogram.wgsl), the widgets and the tests (pure, no GPU).
 * Layout of a result: 5 channels x 256 bins = R, G, B, A, Luma (Rec.709), counts as float. Values outside [min, max] are CLAMPED into the
 * edge bins and counted in `overHi` / `overLo` (the widget draws a small overflow marker). NaN / Inf samples are ignored.
 */
export const BINS = 256;
export const CHANNELS = 5;
export type HistChannel = 'luma' | 'r' | 'g' | 'b' | 'a';
export const CH_INDEX: Record<HistChannel, number> = { r: 0, g: 1, b: 2, a: 3, luma: 4 };
export const MAX_SAMPLES = 1 << 20;
/** Hard cap of the HDR "auto range" (values above are clamped into the last bin). */
export const MAX_HDR_RANGE = 64;

export interface HistRange {
  min: number;
  max: number;
}
export interface HistResult {
  /** CHANNELS * BINS counts. */
  bins: Float32Array;
  overHi: Float32Array;
  overLo: Float32Array;
  /** Largest sample per channel (>= 0 values only, used by the auto range). */
  max: Float32Array;
  samples: number;
  range: HistRange;
}

/** Bin of a value (same expression as histogram.wgsl). */
export function binOf(v: number, r: HistRange): number {
  const t = Math.floor(((v - r.min) / (r.max - r.min)) * BINS);
  return t < 0 ? 0 : t > BINS - 1 ? BINS - 1 : t;
}

/** Deterministic sampling stride: smallest integer step with ceil(w/step) * ceil(h/step) <= maxSamples. */
export function strideFor(w: number, h: number, maxSamples = MAX_SAMPLES): number {
  let step = 1;
  while (Math.ceil(w / step) * Math.ceil(h / step) > maxSamples) step++;
  return step;
}

export const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Auto range: [0, measured max] clamped to [1, MAX_HDR_RANGE]. */
export const autoRange = (measuredMax: number, hardMax = MAX_HDR_RANGE): HistRange => ({ min: 0, max: Math.min(Math.max(Number.isFinite(measuredMax) ? measuredMax : 1, 1), hardMax) });

/** CPU reference: `px` = interleaved texels with `comps` (1 gray, 4 color) components per texel. */
export function cpuHistogram(px: ArrayLike<number>, w: number, h: number, comps: 1 | 4, range: HistRange = { min: 0, max: 1 }, step = strideFor(w, h)): HistResult {
  const bins = new Float32Array(CHANNELS * BINS);
  const overHi = new Float32Array(CHANNELS);
  const overLo = new Float32Array(CHANNELS);
  const max = new Float32Array(CHANNELS);
  let samples = 0;
  const put = (c: number, v: number): void => {
    if (!Number.isFinite(v)) return;
    bins[c * BINS + binOf(v, range)]++;
    if (v > range.max) overHi[c]++;
    if (v < range.min) overLo[c]++;
    if (v > max[c]) max[c] = v;
  };
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * comps;
      const r = px[i];
      const g = comps === 4 ? px[i + 1] : r;
      const b = comps === 4 ? px[i + 2] : r;
      const a = comps === 4 ? px[i + 3] : 1;
      put(0, r);
      put(1, g);
      put(2, b);
      put(3, a);
      put(4, luma(r, g, b));
      samples++;
    }
  }
  return { bins, overHi, overLo, max, samples, range };
}

/** Bin heights 0..1 for drawing. Edge bins (clamped overflow, black / white spikes) are ignored for the scale unless they are all there is. */
export function normalizeBins(bins: ArrayLike<number>, channel: number, log: boolean): Float32Array {
  const out = new Float32Array(BINS);
  const f = (v: number): number => (log ? Math.log1p(v) : v);
  let mx = 0;
  for (let i = 1; i < BINS - 1; i++) mx = Math.max(mx, f(bins[channel * BINS + i]));
  if (mx <= 0) for (let i = 0; i < BINS; i++) mx = Math.max(mx, f(bins[channel * BINS + i]));
  if (mx <= 0) return out;
  for (let i = 0; i < BINS; i++) out[i] = Math.min(1, f(bins[channel * BINS + i]) / mx);
  return out;
}

/** Levels geometry: position of the gamma handle (fraction of the span) and its inverse. Output = x^(1/gamma): mid output 0.5 at x = 0.5^gamma. */
export const gammaHandle = (gamma: number): number => Math.pow(0.5, gamma);
export const gammaFromHandle = (x: number): number => Math.min(10, Math.max(0.01, Math.log(Math.min(0.999, Math.max(0.001, x))) / Math.log(0.5)));
