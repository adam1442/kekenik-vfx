/**
 * HiDPI-correct 2D canvas helper. The canvas backing store is sized in DEVICE pixels (css size x devicePixelRatio, capped so a 4K
 * monitor at 200% does not allocate a gigantic bitmap), the context transform maps 1 unit = 1 CSS pixel, so drawing code only deals
 * with CSS pixels. Call on every resize; returns the context ready to draw.
 */
export function fitCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number, maxPixels = 16_000_000): CanvasRenderingContext2D | null {
  const w = Math.max(1, Math.floor(cssW));
  const h = Math.max(1, Math.floor(cssH));
  let dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (w * h * dpr * dpr > maxPixels) dpr = Math.max(1, Math.sqrt(maxPixels / (w * h)));
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0);
  return ctx;
}
