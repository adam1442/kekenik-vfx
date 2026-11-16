/**
 * Flipbook import + per-frame editing model. PURE where possible; the DOM decode lives in `decodeSheetImage`.
 *
 * The imported sheet is stored INSIDE the project as a PNG data URL param (`image`) so edits survive save / load / undo without
 * an asset store. Frame edits are expressed as:
 *   - `order`: JSON array of SOURCE frame indices in playback order  => reorder / delete / duplicate are just edits of this list,
 *   - painting / replacing a frame rewrites the pixels of the source sheet and stores the new PNG in `image` (one undo step).
 */
import { floatToHalf } from '../resources/half';
import { cellRect, type RowOrder, type SheetSpec } from './flipbook-layout';

export interface SheetPixels {
  w: number;
  h: number;
  /** RGBA8, row 0 = top. */
  data: Uint8ClampedArray;
}

export const MAX_IMPORT_PIXELS = 64 * 1024 * 1024; // hard cap: 8192 x 8192
export const MAX_DATA_URL_CHARS = 24 * 1024 * 1024; // keeps project files sane

export function parseOrder(json: string, count: number): number[] {
  try {
    const a = JSON.parse(json) as unknown;
    if (Array.isArray(a)) return a.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < count).slice(0, 65536);
  } catch {
    /* fall through */
  }
  return Array.from({ length: count }, (_, i) => i);
}
export const stringifyOrder = (o: number[]): string => JSON.stringify(o);

/** Order operations (pure, tested). `i` indexes the PLAYBACK order. */
export const orderOps = {
  remove: (o: number[], i: number): number[] => (o.length > 1 ? o.filter((_, k) => k !== i) : o),
  duplicate: (o: number[], i: number): number[] => [...o.slice(0, i + 1), o[i], ...o.slice(i + 1)],
  move: (o: number[], i: number, d: number): number[] => {
    const j = Math.max(0, Math.min(o.length - 1, i + d));
    const a = [...o];
    const [x] = a.splice(i, 1);
    a.splice(j, 0, x);
    return a;
  },
};

export function sheetSpecOf(px: { w: number; h: number }, cols: number, rows: number, count: number, padding: number, rowOrder: RowOrder): SheetSpec {
  return { sheetW: px.w, sheetH: px.h, cols, rows, count: Math.max(1, Math.min(count, cols * rows)), padding, rowOrder };
}

/** Copy the pixels of source frame `src` into a fresh sheet at cell `dst` (cells = whole cells incl. padding). */
function blitCell(from: SheetPixels, to: SheetPixels, a: SheetSpec, src: number, dst: number): void {
  const s = cellRect(a, src);
  const d = cellRect(a, dst);
  const w = Math.min(s.w, d.w);
  const h = Math.min(s.h, d.h);
  for (let y = 0; y < h; y++) {
    const so = ((s.y + y) * from.w + s.x) * 4;
    const dof = ((d.y + y) * to.w + d.x) * 4;
    to.data.set(from.data.subarray(so, so + w * 4), dof);
  }
}

/** Compose the output sheet: the cells of `order` (source frame indices) laid out again in the same grid. Unused cells are transparent. */
export function composeSheet(src: SheetPixels, spec: SheetSpec, order: number[]): SheetPixels {
  const out: SheetPixels = { w: src.w, h: src.h, data: new Uint8ClampedArray(src.data.length) };
  const n = Math.min(order.length, spec.cols * spec.rows);
  for (let i = 0; i < n; i++) blitCell(src, out, spec, order[i], i);
  return out;
}

/** Paint a stroke segment (round brush) into the CONTENT area of one frame of the source sheet (in place). */
export function paintDot(px: SheetPixels, spec: SheetSpec, frame: number, u: number, v: number, radiusPx: number, rgba: [number, number, number, number], erase: boolean): void {
  const c = cellRect(spec, frame);
  const cx = c.ix + u * c.iw;
  const cy = c.iy + v * c.ih;
  const r = Math.max(0.5, radiusPx);
  for (let y = Math.max(c.iy, Math.floor(cy - r)); y <= Math.min(c.iy + c.ih - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(c.ix, Math.floor(cx - r)); x <= Math.min(c.ix + c.iw - 1, Math.ceil(cx + r)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const a = Math.min(1, (r - d) / Math.max(1, r * 0.25)) * (erase ? 1 : rgba[3] / 255);
      const o = (y * px.w + x) * 4;
      if (erase) {
        px.data[o + 3] = px.data[o + 3] * (1 - a);
      } else {
        const da = px.data[o + 3] / 255;
        const oa = a + da * (1 - a);
        for (let k = 0; k < 3; k++) px.data[o + k] = oa > 0 ? (rgba[k] * a + px.data[o + k] * da * (1 - a)) / oa : 0;
        px.data[o + 3] = oa * 255;
      }
    }
  }
}

/** Replace one frame with an image (stretched to the cell content). */
export function replaceFrame(px: SheetPixels, spec: SheetSpec, frame: number, img: SheetPixels): void {
  const c = cellRect(spec, frame);
  for (let y = 0; y < c.ih; y++) {
    for (let x = 0; x < c.iw; x++) {
      const sx = Math.min(img.w - 1, Math.floor(((x + 0.5) / c.iw) * img.w));
      const sy = Math.min(img.h - 1, Math.floor(((y + 0.5) / c.ih) * img.h));
      const so = (sy * img.w + sx) * 4;
      const o = ((c.iy + y) * px.w + c.ix + x) * 4;
      px.data[o] = img.data[so];
      px.data[o + 1] = img.data[so + 1];
      px.data[o + 2] = img.data[so + 2];
      px.data[o + 3] = img.data[so + 3];
    }
  }
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
let lut: Float32Array | null = null;

/** RGBA8 -> rgba16float texels (half bits). `linearize` converts sRGB colour to linear (alpha untouched). */
export function toHalfRGBA(px: SheetPixels, linearize: boolean): Uint16Array {
  if (!lut) lut = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
  const out = new Uint16Array(px.w * px.h * 4);
  const d = px.data;
  for (let i = 0; i < px.w * px.h; i++) {
    const o = i * 4;
    for (let k = 0; k < 3; k++) out[o + k] = floatToHalf(linearize ? lut[d[o + k]] : d[o + k] / 255);
    out[o + 3] = floatToHalf(d[o + 3] / 255);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ DOM side */

const decoded = new Map<string, SheetPixels | 'pending' | Error>();
/** Fires when an async decode finished (the Engine invalidates the scheduler). */
export const importHooks: { onReady: (() => void) | null } = { onReady: null };

/** Decoded pixels of a data URL, or null while decoding (requested; `importHooks.onReady` fires when done). Throws on a failed decode. */
export function sheetPixels(dataUrl: string): SheetPixels | null {
  const hit = decoded.get(dataUrl);
  if (hit instanceof Error) throw hit;
  if (hit && hit !== 'pending') return hit;
  if (!hit) {
    decoded.set(dataUrl, 'pending');
    void decodeSheetImage(dataUrl).then(
      (p) => {
        decoded.set(dataUrl, p);
        while (decoded.size > 6) decoded.delete(decoded.keys().next().value as string); // bounded
        importHooks.onReady?.();
      },
      (e: Error) => {
        decoded.set(dataUrl, e);
        importHooks.onReady?.();
      },
    );
  }
  return null;
}
export const cachePixels = (dataUrl: string, p: SheetPixels): void => void decoded.set(dataUrl, p);

export async function decodeSheetImage(src: Blob | string): Promise<SheetPixels> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  if (bmp.width * bmp.height > MAX_IMPORT_PIXELS) throw new Error(`Image ${bmp.width}×${bmp.height} is larger than the import limit (8192×8192).`);
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(bmp, 0, 0);
  const id = c.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return { w: id.width, h: id.height, data: id.data };
}

/** Encode pixels as a PNG data URL (rejects absurdly large projects). */
export async function encodeSheetImage(px: SheetPixels): Promise<string> {
  const cv = new OffscreenCanvas(px.w, px.h);
  cv.getContext('2d')!.putImageData(new ImageData(px.data as unknown as Uint8ClampedArray<ArrayBuffer>, px.w, px.h), 0, 0);
  const blob = await cv.convertToBlob({ type: 'image/png' });
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  if (url.length > MAX_DATA_URL_CHARS) throw new Error('The edited sheet is too large to keep inside the project (24 MB). Use a smaller sheet.');
  return url;
}
