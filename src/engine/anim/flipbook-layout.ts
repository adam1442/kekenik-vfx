/**
 * Flipbook / sheet layout math. PURE: shared by Sheet Encode, Sheet Decode, the 2D viewport, the baker and the
 * tests (and later by export 6B).
 *
 * Conventions: texture row 0 is the TOP of the image (same as the graph / 2D viewport). Frame 0 is the top-left cell
 * ('top_down') or the bottom-left cell ('bottom_up'). Cells are laid out row-major. Non-square and non-power-of-two sheets
 * are supported: the cell size is floor(sheet / grid), leftover pixels at the right / bottom stay empty.
 */
export type RowOrder = 'top_down' | 'bottom_up';

export interface SheetSpec {
  sheetW: number;
  sheetH: number;
  cols: number;
  rows: number;
  /** Number of frames actually used (<= cols*rows). */
  count: number;
  /** Edge padding in pixels INSIDE each cell (the border replicates the edge pixels: mip-safe). */
  padding: number;
  rowOrder: RowOrder;
}

export interface CellRect {
  index: number;
  col: number;
  row: number;
  /** Pixel rect of the whole cell (including padding). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pixel rect of the frame content (cell minus padding). */
  ix: number;
  iy: number;
  iw: number;
  ih: number;
}

export const cellSize = (s: Pick<SheetSpec, 'sheetW' | 'sheetH' | 'cols' | 'rows'>): { w: number; h: number } => ({
  w: Math.max(1, Math.floor(s.sheetW / Math.max(1, s.cols))),
  h: Math.max(1, Math.floor(s.sheetH / Math.max(1, s.rows))),
});

/** Cell of frame `index` (0-based, playback order). */
export function cellRect(s: SheetSpec, index: number): CellRect {
  const { w, h } = cellSize(s);
  const col = index % s.cols;
  const rowFromStart = Math.floor(index / s.cols);
  const row = s.rowOrder === 'top_down' ? rowFromStart : s.rows - 1 - rowFromStart;
  const pad = Math.max(0, Math.min(s.padding, Math.floor((Math.min(w, h) - 1) / 2)));
  const x = col * w;
  const y = row * h;
  return { index, col, row, x, y, w, h, ix: x + pad, iy: y + pad, iw: w - 2 * pad, ih: h - 2 * pad };
}

/** UV rectangle [u0, v0, du, dv] (v down) of the frame CONTENT (padding excluded) inside the sheet. */
export function frameUvRect(s: SheetSpec, index: number): [number, number, number, number] {
  const c = cellRect(s, index);
  return [c.ix / s.sheetW, c.iy / s.sheetH, c.iw / s.sheetW, c.ih / s.sheetH];
}

/** Validation shared by the encode node and exports. Returns a user-facing message or null. */
export function validateSheet(s: SheetSpec, maxDim: number): string | null {
  if (s.cols < 1 || s.rows < 1) return 'Grid must be at least 1×1.';
  if (s.count < 1) return 'Frame count must be at least 1.';
  if (s.count > s.cols * s.rows) return `${s.count} frames do not fit a ${s.cols}×${s.rows} grid (${s.cols * s.rows} cells).`;
  if (s.sheetW > maxDim || s.sheetH > maxDim) return `Sheet ${s.sheetW}×${s.sheetH} exceeds the device limit of ${maxDim}px.`;
  const c = cellSize(s);
  if (c.w < 1 || c.h < 1) return 'Cells are smaller than one pixel: reduce the grid or enlarge the sheet.';
  return null;
}

/** Square-ish grid for `count` frames (aspect = cell width / cell height of the wanted sheet). */
export function autoGrid(count: number, aspect = 1): { cols: number; rows: number } {
  const n = Math.max(1, Math.round(count));
  let best = { cols: n, rows: 1 };
  let bestScore = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const waste = cols * rows - n;
    const shape = Math.abs(Math.log((cols / rows) / aspect));
    const score = shape + waste * 0.35;
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = { cols, rows };
    }
  }
  return best;
}

/**
 * Timeline FRAME (float) that sheet frame `i` of `count` samples. The range [start,end) is divided in `count` equal steps so
 * a loop of N timeline frames encoded in N sheet frames samples every frame; `offset` shifts all samples (per-frame offset).
 */
export function sampleFrame(i: number, count: number, start: number, end: number, offset = 0, reverse = false): number {
  const k = reverse ? count - 1 - i : i;
  return start + ((end - start) * k) / Math.max(1, count) + offset;
}

/**
 * Loop cross-fade: the last `k` frames are blended towards the same frame sampled one full range EARLIER, so that frame
 * N-1 -> frame 0 is as smooth as any other step even when the source is not periodic. Weight 0 = untouched.
 */
export function crossfadeWeights(count: number, k: number): number[] {
  const w = new Array<number>(count).fill(0);
  const m = Math.max(0, Math.min(Math.floor(k), Math.floor(count / 2)));
  for (let j = 0; j < m; j++) w[count - m + j] = (j + 1) / (m + 1);
  return w;
}

export type DecodeMode = 'loop' | 'once' | 'pingpong';
export interface DecodeResult {
  a: number;
  b: number;
  /** Blend weight of frame b (0 = frame a only). */
  mix: number;
}

/**
 * Which two frames show at `frame` (float, in sheet frames) and how to blend them. Looping wraps b to frame 0 so the last
 * frame crossfades into the first; `once` clamps; `pingpong` bounces.
 */
export function decodeFrame(frame: number, count: number, mode: DecodeMode, blend: boolean): DecodeResult {
  const n = Math.max(1, Math.floor(count));
  let f = frame;
  if (mode === 'loop') f = ((f % n) + n) % n;
  else if (mode === 'once') f = Math.min(n - 1, Math.max(0, f));
  else {
    const span = Math.max(1, n - 1);
    const m = ((f % (2 * span)) + 2 * span) % (2 * span);
    f = m <= span ? m : 2 * span - m;
  }
  const a = Math.min(n - 1, Math.floor(f));
  const frac = f - a;
  if (!blend || frac < 1e-6) return { a, b: a, mix: 0 };
  let b = a + 1;
  if (b >= n) b = mode === 'loop' ? 0 : n - 1;
  return { a, b, mix: frac };
}
