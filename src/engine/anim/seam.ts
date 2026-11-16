/**
 * Loop SEAM verifier math. PURE.
 *
 * A perfect loop of N frames has f(N) == f(0): the jump from the last frame f(N-1) to f(0) must look like any other
 * frame-to-frame step. We compare:
 *   seamDiff  = mean|f(N-1) - f(0)|            (what the viewer sees at the loop point)
 *   meanStep  = mean over i of mean|f(i) - f(i+1)|
 *   ratio     = seamDiff / meanStep            (~1 for a clean loop; >> 1 = visible pop)
 *   wrapError = mean|f(N) - f(0)| / meanStep   (optional: evaluating ONE frame past the end must reproduce frame 0)
 */
export type SeamVerdict = 'clean' | 'minor' | 'visible' | 'static';

export interface SeamReport {
  frames: number;
  seamDiff: number;
  meanStep: number;
  maxStep: number;
  /** seamDiff / meanStep */
  ratio: number;
  /** mean|f(N) - f(0)| / meanStep, NaN when no wrap frame was supplied. */
  wrapRel: number;
  verdict: SeamVerdict;
  message: string;
}

export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}

export const SEAM_THRESHOLDS = { clean: 1.5, minor: 2.5, wrap: 0.25, still: 1e-6, duplicate: 0.05 };

/** `frames` = f(0..N-1) (equal sized); `wrap` = optional f(N). */
export function analyzeSeam(frames: ArrayLike<number>[], wrap?: ArrayLike<number>): SeamReport {
  const n = frames.length;
  if (n < 2) return { frames: n, seamDiff: 0, meanStep: 0, maxStep: 0, ratio: 0, wrapRel: Number.NaN, verdict: 'static', message: 'Need at least 2 frames to verify a loop.' };
  let sum = 0;
  let max = 0;
  for (let i = 0; i < n - 1; i++) {
    const d = meanAbsDiff(frames[i], frames[i + 1]);
    sum += d;
    if (d > max) max = d;
  }
  const meanStep = sum / (n - 1);
  const seamDiff = meanAbsDiff(frames[n - 1], frames[0]);
  if (meanStep < SEAM_THRESHOLDS.still) {
    const still = seamDiff < SEAM_THRESHOLDS.still;
    return {
      frames: n,
      seamDiff,
      meanStep,
      maxStep: max,
      ratio: still ? 1 : Infinity,
      wrapRel: Number.NaN,
      verdict: still ? 'static' : 'visible',
      message: still ? 'The output does not change over the loop (nothing animated).' : 'Frames are static but the last frame differs from the first.',
    };
  }
  const ratio = seamDiff / meanStep;
  const wrapRel = wrap ? meanAbsDiff(wrap, frames[0]) / meanStep : Number.NaN;
  const wrapBad = !Number.isNaN(wrapRel) && wrapRel > SEAM_THRESHOLDS.wrap;
  let verdict: SeamVerdict;
  const duplicate = ratio < SEAM_THRESHOLDS.duplicate;
  if (duplicate) verdict = 'minor';
  else if (ratio <= SEAM_THRESHOLDS.clean && !wrapBad) verdict = 'clean';
  else if (ratio <= SEAM_THRESHOLDS.minor) verdict = 'minor';
  else verdict = 'visible';
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const message = duplicate
    ? `The last frame duplicates the first (last→first step is ${ratio.toFixed(2)}× a normal step): the loop holds one frame. Sample N frames over [0, N) instead of [0, N-1].`
    : verdict === 'clean'
      ? `Clean loop: the last→first step is ${ratio.toFixed(2)}× a normal step${Number.isNaN(wrapRel) ? '' : `, frame N matches frame 0 within ${pct(wrapRel)} of a step`}.`
      : verdict === 'minor'
        ? `Minor seam: the last→first step is ${ratio.toFixed(2)}× a normal step${wrapBad ? ` and frame N differs from frame 0 by ${pct(wrapRel)} of a step` : ''}. Use Loop match on the keys.`
        : `Visible seam: the last→first step is ${ratio.toFixed(2)}× a normal step${wrapBad ? ` (frame N differs from frame 0 by ${pct(wrapRel)} of a step)` : ''}. Make the animation periodic (Loop match, cycle extrapolation).`;
  return { frames: n, seamDiff, meanStep, maxStep: max, ratio, wrapRel, verdict, message };
}
