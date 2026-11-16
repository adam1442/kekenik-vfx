import { unzlibSync } from 'fflate';
import { floatToHalf, halfToFloat } from '../resources/half';

/**
 * Pure image decoders (no DOM, unit-tested on tiny fixtures): TGA, Radiance HDR, OpenEXR (scanline; NONE / RLE / ZIPS / ZIP,
 * half + float channels), plus flipbook GRID DETECTION and box down-scaling. PNG / JPG / WEBP go through the browser
 * (`createImageBitmap`, see assets.ts). Decoded pixels are kept as RGBA8 (LDR) or RGBA half-float (HDR): 4 / 8 bytes per pixel.
 */
export interface DecodedImage {
  width: number;
  height: number;
  /** 'u8': RGBA8 as stored in the file (sRGB encoded for colour textures). 'half': linear RGBA16F bits (Uint16). */
  kind: 'u8' | 'half';
  data: Uint8ClampedArray | Uint16Array;
  hasAlpha: boolean;
  /** Set when the image was reduced on import (factor 2 = half the size per axis). */
  downscaled?: number;
}

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}
export const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const checkSize = (w: number, h: number): void => {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new DecodeError(`Invalid image size ${w}x${h}.`);
  if (w * h > MAX_IMAGE_PIXELS) throw new DecodeError(`Image is too large (${w}x${h} = ${(w * h / 1e6).toFixed(0)} MP, max ${MAX_IMAGE_PIXELS / 1e6} MP). Downscale it first.`);
};

/* ------------------------------------------------------------------------------------------------ TGA */
export function decodeTga(b: Uint8Array): DecodedImage {
  if (b.length < 18) throw new DecodeError('TGA: file too small.');
  const idLen = b[0];
  const cmapType = b[1];
  const type = b[2];
  const cmapFirst = b[3] | (b[4] << 8);
  const cmapLen = b[5] | (b[6] << 8);
  const cmapBits = b[7];
  const w = b[12] | (b[13] << 8);
  const h = b[14] | (b[15] << 8);
  const bpp = b[16];
  const desc = b[17];
  checkSize(w, h);
  const rle = type >= 9;
  const base = type & 7;
  if (![1, 2, 3].includes(base)) throw new DecodeError(`TGA: unsupported image type ${type}.`);
  if (![8, 15, 16, 24, 32].includes(bpp)) throw new DecodeError(`TGA: unsupported bit depth ${bpp}.`);
  let p = 18 + idLen;
  let cmap: Uint8Array | null = null;
  if (cmapType === 1) {
    const eb = Math.ceil(cmapBits / 8);
    cmap = b.subarray(p, p + cmapLen * eb);
    p += cmapLen * eb;
  }
  const bytes = Math.ceil(bpp / 8);
  const out = new Uint8ClampedArray(w * h * 4);
  const topLeft = (desc & 0x20) !== 0;
  let hasAlpha = false;
  const put = (i: number, src: Uint8Array, o: number): void => {
    const y = Math.floor(i / w);
    const x = i - y * w;
    const dy = topLeft ? y : h - 1 - y;
    const d = (dy * w + x) * 4;
    if (base === 3) {
      out[d] = out[d + 1] = out[d + 2] = src[o];
      out[d + 3] = bytes === 2 ? src[o + 1] : 255;
    } else if (base === 1) {
      const idx = src[o] - cmapFirst;
      const eb = Math.ceil(cmapBits / 8);
      const c = (cmap ?? new Uint8Array(0)).subarray(idx * eb, idx * eb + eb);
      out[d] = c[2] ?? 0;
      out[d + 1] = c[1] ?? 0;
      out[d + 2] = c[0] ?? 0;
      out[d + 3] = eb === 4 ? c[3] : 255;
    } else if (bytes === 2) {
      const v = src[o] | (src[o + 1] << 8);
      out[d] = ((v >> 10) & 31) * 8;
      out[d + 1] = ((v >> 5) & 31) * 8;
      out[d + 2] = (v & 31) * 8;
      out[d + 3] = 255;
    } else {
      out[d] = src[o + 2];
      out[d + 1] = src[o + 1];
      out[d + 2] = src[o];
      out[d + 3] = bytes === 4 ? src[o + 3] : 255;
    }
    if (out[d + 3] !== 255) hasAlpha = true;
  };
  const n = w * h;
  if (!rle) {
    if (p + n * bytes > b.length) throw new DecodeError('TGA: truncated pixel data.');
    for (let i = 0; i < n; i++) put(i, b, p + i * bytes);
  } else {
    let i = 0;
    while (i < n && p < b.length) {
      const c = b[p++];
      const cnt = (c & 127) + 1;
      if (c & 128) {
        for (let k = 0; k < cnt && i < n; k++) put(i++, b, p);
        p += bytes;
      } else {
        for (let k = 0; k < cnt && i < n; k++) {
          put(i++, b, p);
          p += bytes;
        }
      }
    }
  }
  return { width: w, height: h, kind: 'u8', data: out, hasAlpha };
}

/* ------------------------------------------------------------------------------------------------ HDR (Radiance RGBE) */
export function decodeHdr(b: Uint8Array): DecodedImage {
  let p = 0;
  const line = (): string => {
    let s = '';
    while (p < b.length && b[p] !== 10) s += String.fromCharCode(b[p++]);
    p++;
    return s;
  };
  const magic = line();
  if (!magic.startsWith('#?')) throw new DecodeError('HDR: missing #?RADIANCE header.');
  for (let guard = 0; guard < 64; guard++) if (line().trim() === '') break;
  const res = /([-+])Y\s+(\d+)\s+([-+])X\s+(\d+)/.exec(line());
  if (!res) throw new DecodeError('HDR: bad resolution line.');
  const h = parseInt(res[2], 10);
  const w = parseInt(res[4], 10);
  checkSize(w, h);
  const flipY = res[1] === '+';
  const out = new Uint16Array(w * h * 4);
  const scan = new Uint8Array(w * 4);
  const one = floatToHalf(1);
  for (let y = 0; y < h; y++) {
    if (p + 4 > b.length) throw new DecodeError('HDR: truncated data.');
    if (w >= 8 && w < 32768 && b[p] === 2 && b[p + 1] === 2 && ((b[p + 2] << 8) | b[p + 3]) === w) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          if (p >= b.length) throw new DecodeError('HDR: truncated RLE data.');
          let cnt = b[p++];
          if (cnt > 128) {
            cnt -= 128;
            const v = b[p++];
            for (let k = 0; k < cnt && x < w; k++) scan[(x++) * 4 + c] = v;
          } else {
            for (let k = 0; k < cnt && x < w; k++) scan[(x++) * 4 + c] = b[p++];
          }
        }
      }
    } else {
      if (p + w * 4 > b.length) throw new DecodeError('HDR: truncated flat data.');
      scan.set(b.subarray(p, p + w * 4));
      p += w * 4;
    }
    const dy = flipY ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      const f = e === 0 ? 0 : Math.pow(2, e - 136);
      const o = (dy * w + x) * 4;
      out[o] = floatToHalf(scan[x * 4] * f);
      out[o + 1] = floatToHalf(scan[x * 4 + 1] * f);
      out[o + 2] = floatToHalf(scan[x * 4 + 2] * f);
      out[o + 3] = one;
    }
  }
  return { width: w, height: h, kind: 'half', data: out, hasAlpha: false };
}

/* ------------------------------------------------------------------------------------------------ EXR */
interface ExrChannel {
  name: string;
  type: number; // 0 uint, 1 half, 2 float
  bytes: number;
}
const dv = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Reverses the EXR predictor + byte de-interleave used by ZIP / RLE blocks. */
function exrUnpredict(src: Uint8Array): Uint8Array {
  const n = src.length;
  for (let i = 1; i < n; i++) src[i] = (src[i - 1] + src[i] - 128) & 255;
  const out = new Uint8Array(n);
  const half = (n + 1) >> 1;
  for (let k = 0, i = 0; k < half; k++) {
    out[i++] = src[k];
    if (i < n) out[i++] = src[half + k];
  }
  return out;
}
function exrRle(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0;
  let i = 0;
  while (i < src.length && o < expected) {
    const c = (src[i++] << 24) >> 24;
    if (c < 0) {
      const n = -c;
      for (let k = 0; k < n && o < expected; k++) out[o++] = src[i++];
    } else {
      const v = src[i++];
      for (let k = 0; k < c + 1 && o < expected; k++) out[o++] = v;
    }
  }
  return out;
}

export function decodeExr(b: Uint8Array): DecodedImage {
  if (b.length < 16 || b[0] !== 0x76 || b[1] !== 0x2f || b[2] !== 0x31 || b[3] !== 0x01) throw new DecodeError('EXR: bad magic number.');
  const v = dv(b);
  const flags = v.getUint32(4, true);
  if (flags & 0x200) throw new DecodeError('EXR: tiled images are not supported (use scanline EXR).');
  if (flags & 0x1800 || flags & 0x2000) throw new DecodeError('EXR: deep / multipart images are not supported.');
  let p = 8;
  const str = (): string => {
    let s = '';
    while (p < b.length && b[p] !== 0) s += String.fromCharCode(b[p++]);
    p++;
    return s;
  };
  let channels: ExrChannel[] = [];
  let compression = 0;
  let box = [0, 0, 0, 0];
  for (let guard = 0; guard < 256; guard++) {
    const name = str();
    if (!name) break;
    str(); // type
    const size = v.getInt32(p, true);
    p += 4;
    const end = p + size;
    if (name === 'channels') {
      let q = p;
      channels = [];
      while (q < end - 1 && b[q] !== 0) {
        let nm = '';
        while (b[q] !== 0) nm += String.fromCharCode(b[q++]);
        q++;
        const type = v.getInt32(q, true);
        const xs = v.getInt32(q + 8, true);
        const ys = v.getInt32(q + 12, true);
        if (xs !== 1 || ys !== 1) throw new DecodeError('EXR: sub-sampled channels are not supported.');
        channels.push({ name: nm, type, bytes: type === 1 ? 2 : 4 });
        q += 16;
      }
    } else if (name === 'compression') compression = b[p];
    else if (name === 'dataWindow') box = [v.getInt32(p, true), v.getInt32(p + 4, true), v.getInt32(p + 8, true), v.getInt32(p + 12, true)];
    p = end;
  }
  const w = box[2] - box[0] + 1;
  const h = box[3] - box[1] + 1;
  checkSize(w, h);
  if (![0, 1, 2, 3].includes(compression)) throw new DecodeError(`EXR: compression ${compression} (PIZ / PXR24 / B44 / DWA) is not supported. Re-save as ZIP, RLE or uncompressed.`);
  if (!channels.length) throw new DecodeError('EXR: no channels.');
  const lines = compression === 3 ? 16 : 1;
  const chunks = Math.ceil(h / lines);
  const offsets: number[] = [];
  for (let i = 0; i < chunks; i++) {
    const lo = v.getUint32(p + i * 8, true);
    const hi = v.getUint32(p + i * 8 + 4, true);
    offsets.push(hi * 4294967296 + lo);
  }
  const idx = (n: string): number => channels.findIndex((c) => c.name === n || c.name.endsWith(`.${n}`));
  const ci = { r: idx('R'), g: idx('G'), b: idx('B'), a: idx('A'), y: idx('Y') };
  if (ci.r < 0 && ci.y < 0) throw new DecodeError('EXR: no R/G/B or Y channel found.');
  const rowBytes = channels.reduce((s, c) => s + c.bytes * w, 0);
  const out = new Uint16Array(w * h * 4);
  const one = floatToHalf(1);
  const conv = (c: ExrChannel, view: DataView, o: number): number => (c.type === 1 ? view.getUint16(o, true) : c.type === 2 ? floatToHalf(view.getFloat32(o, true)) : floatToHalf(view.getUint32(o, true)));
  for (let ch = 0; ch < chunks; ch++) {
    let q = offsets[ch];
    const y0 = v.getInt32(q, true) - box[1];
    const size = v.getInt32(q + 4, true);
    q += 8;
    const nLines = Math.min(lines, h - y0);
    const raw = b.subarray(q, q + size);
    const expect = rowBytes * nLines;
    let data: Uint8Array;
    if (compression === 0 || size === expect) data = raw;
    else if (compression === 1) data = exrUnpredict(exrRle(raw, expect));
    else {
      try {
        data = exrUnpredict(unzlibSync(raw, { out: new Uint8Array(expect) }));
      } catch (e) {
        throw new DecodeError(`EXR: corrupt ZIP block (${(e as Error).message}).`);
      }
    }
    const view = dv(data);
    for (let l = 0; l < nLines; l++) {
      let o = l * rowBytes;
      const base = (y0 + l) * w;
      for (let ci2 = 0; ci2 < channels.length; ci2++) {
        const c = channels[ci2];
        const slot = ci2 === ci.r ? 0 : ci2 === ci.g ? 1 : ci2 === ci.b ? 2 : ci2 === ci.a ? 3 : ci2 === ci.y ? 4 : -1;
        if (slot >= 0) {
          for (let x = 0; x < w; x++) {
            const hv = conv(c, view, o + x * c.bytes);
            if (slot === 4) {
              out[(base + x) * 4] = out[(base + x) * 4 + 1] = out[(base + x) * 4 + 2] = hv;
            } else out[(base + x) * 4 + slot] = hv;
          }
        }
        o += c.bytes * w;
      }
    }
  }
  if (ci.a < 0) for (let i = 3; i < out.length; i += 4) out[i] = one;
  return { width: w, height: h, kind: 'half', data: out, hasAlpha: ci.a >= 0 };
}

/* ------------------------------------------------------------------------------------------------ helpers */
export type ImageFormat = 'png' | 'jpg' | 'webp' | 'tga' | 'exr' | 'hdr' | 'gif' | 'bmp' | 'avif' | 'unknown';
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'tga', 'exr', 'hdr', 'bmp', 'gif', 'avif'];

export function sniffImageFormat(bytes: Uint8Array, name = ''): ImageFormat {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (bytes.length >= 4 && bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01) return 'exr';
  if (bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x3f) return 'hdr';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'webp';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (ext === 'tga') return 'tga'; // TGA has no magic number
  if (ext === 'jpeg') return 'jpg';
  return (['png', 'jpg', 'webp', 'gif', 'bmp', 'avif', 'tga', 'exr', 'hdr'] as const).find((e) => e === ext) ?? 'unknown';
}

/** Decode the formats we parse ourselves. Browser formats return null (caller uses createImageBitmap). */
export function decodeNative(bytes: Uint8Array, name: string): DecodedImage | null {
  switch (sniffImageFormat(bytes, name)) {
    case 'tga':
      return decodeTga(bytes);
    case 'hdr':
      return decodeHdr(bytes);
    case 'exr':
      return decodeExr(bytes);
    default:
      return null;
  }
}

/** Integer box downscale by `k` per axis (memory-safe import of huge files). */
export function downscaleImage(src: DecodedImage, k: number): DecodedImage {
  if (k <= 1) return src;
  const w = Math.max(1, Math.floor(src.width / k));
  const h = Math.max(1, Math.floor(src.height / k));
  const half = src.kind === 'half';
  const out = half ? new Uint16Array(w * h * 4) : new Uint8ClampedArray(w * h * 4);
  const get = (i: number): number => (half ? halfToFloat((src.data as Uint16Array)[i]) : (src.data as Uint8ClampedArray)[i]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let s = 0;
        let n = 0;
        for (let dy = 0; dy < k; dy++) {
          for (let dx = 0; dx < k; dx++) {
            const sx = x * k + dx;
            const sy = y * k + dy;
            if (sx < src.width && sy < src.height) {
              s += get((sy * src.width + sx) * 4 + c);
              n++;
            }
          }
        }
        out[(y * w + x) * 4 + c] = half ? floatToHalf(s / n) : Math.round(s / n);
      }
    }
  }
  return { ...src, width: w, height: h, data: out, downscaled: (src.downscaled ?? 1) * k };
}

/** Smallest integer factor that brings the image under `maxDim` per axis. */
export const downscaleFactor = (w: number, h: number, maxDim: number): number => (maxDim > 0 ? Math.max(1, Math.ceil(Math.max(w, h) / maxDim)) : 1);

/** sRGB (0..1) -> linear. */
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const LUT = new Float32Array(256).map((_, i) => srgbToLinear(i / 255));

/** Converts rows [y0, y1) of a decoded image to RGBA half-float bits (the upload format). */
export function rowsToHalf(img: DecodedImage, y0: number, y1: number, srgbDecode: boolean, out: Uint16Array): void {
  const w = img.width;
  let o = 0;
  if (img.kind === 'half') {
    out.set((img.data as Uint16Array).subarray(y0 * w * 4, y1 * w * 4));
    return;
  }
  const d = img.data as Uint8ClampedArray;
  for (let i = y0 * w * 4; i < y1 * w * 4; i += 4) {
    out[o++] = floatToHalf(srgbDecode ? LUT[d[i]] : d[i] / 255);
    out[o++] = floatToHalf(srgbDecode ? LUT[d[i + 1]] : d[i + 1] / 255);
    out[o++] = floatToHalf(srgbDecode ? LUT[d[i + 2]] : d[i + 2] / 255);
    out[o++] = floatToHalf(d[i + 3] / 255);
  }
}

/* ------------------------------------------------------------------------------------------------ flipbook grid detection */
export interface GridGuess {
  cols: number;
  rows: number;
  /** 0..1 (higher = more convincing). */
  confidence: number;
  /** Frames = cols * rows unless trailing cells are empty. */
  frames: number;
}

/**
 * Detects the grid of a flipbook sheet. Authored flipbooks keep content away from cell borders (padding / soft sprites), so
 * the correct grid has very low "energy" (alpha * luminance, or luminance when there is no alpha) on its border pixels, and so
 * does every COARSER grid whose borders are a subset. We therefore pick the FINEST grid whose border energy is within a small
 * tolerance of the best one. Returns `{1,1}` for an image that is not a sheet.
 */
export function detectGrid(img: DecodedImage, maxCells = 16): GridGuess {
  const { width: w, height: h } = img;
  const lum = new Float32Array(w * h);
  const half = img.kind === 'half';
  for (let i = 0; i < w * h; i++) {
    const g = (c: number): number => (half ? halfToFloat((img.data as Uint16Array)[i * 4 + c]) : (img.data as Uint8ClampedArray)[i * 4 + c] / 255);
    const l = 0.2126 * g(0) + 0.7152 * g(1) + 0.0722 * g(2);
    lum[i] = img.hasAlpha ? l * g(3) : l;
  }
  const cands: { c: number; r: number; e: number }[] = [];
  const border = (c: number, r: number): number => {
    let sum = 0;
    let n = 0;
    for (let k = 1; k < c; k++) {
      const x = Math.round((k * w) / c);
      for (const xx of [x - 1, x]) {
        if (xx < 0 || xx >= w) continue;
        for (let y = 0; y < h; y++) {
          sum += lum[y * w + xx];
          n++;
        }
      }
    }
    for (let k = 1; k < r; k++) {
      const y = Math.round((k * h) / r);
      for (const yy of [y - 1, y]) {
        if (yy < 0 || yy >= h) continue;
        for (let x = 0; x < w; x++) {
          sum += lum[yy * w + x];
          n++;
        }
      }
    }
    return n ? sum / n : 0;
  };
  let mean = 0;
  for (let i = 0; i < lum.length; i++) mean += lum[i];
  mean /= lum.length || 1;
  for (let c = 1; c <= maxCells; c++) {
    for (let r = 1; r <= maxCells; r++) {
      if (c * r < 2 || w % c !== 0 || h % r !== 0) continue;
      const cw = w / c;
      const ch = h / r;
      if (cw < 4 || ch < 4) continue;
      if (Math.max(cw, ch) / Math.min(cw, ch) > 4) continue;
      cands.push({ c, r, e: border(c, r) });
    }
  }
  if (!cands.length || mean < 1e-6) return { cols: 1, rows: 1, confidence: 0, frames: 1 };
  const best = Math.min(...cands.map((x) => x.e));
  const tol = best * 1.25 + mean * 0.004;
  const ok = cands.filter((x) => x.e <= tol).sort((a, b) => b.c * b.r - a.c * a.r || Math.abs(a.c - a.r) - Math.abs(b.c - b.r));
  const pick = ok[0];
  const confidence = Math.max(0, Math.min(1, 1 - pick.e / (mean * 0.5 + 1e-9)));
  if (confidence < 0.35) return { cols: 1, rows: 1, confidence, frames: 1 };
  return { cols: pick.c, rows: pick.r, confidence, frames: pick.c * pick.r };
}
