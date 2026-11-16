import type { ColorSpaceFlag, SampleDepth } from './encoders/types';

/**
 * Pixel-domain helpers of the exporter: sRGB transfer functions, channel selection, premultiplication,
 * the channel-packing CPU reference (mirrors the Export Multimask shader) and the streaming edge padder (mip-safe dilation).
 * Pure, allocation-conscious, unit-tested.
 */

/** IEC 61966-2-1 sRGB OETF (linear -> encoded), clamped input. */
export const srgbEncode = (v: number): number => {
  if (!(v > 0)) return 0;
  if (v >= 1) return 1;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};
export const srgbDecode = (v: number): number => {
  if (!(v > 0)) return 0;
  if (v >= 1) return 1;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export const REC709_LUMA = [0.2126, 0.7152, 0.0722] as const;

/* ------------------------------------------------------------------------------------------------ strip conversion */
export interface ConvertOptions {
  /** Channels of the source buffer (1 = Gray texture, 4 = RGBA texture). */
  srcChannels: 1 | 2 | 3 | 4;
  outChannels: 1 | 2 | 3 | 4;
  colorSpace: ColorSpaceFlag;
  /** Multiply RGB by alpha (done in linear light, before the sRGB OETF). Only with 4 output channels. */
  premultiply: boolean;
  /** Clamp to 0..1 (integer formats). Float formats keep the full range. */
  clamp01: boolean;
}

/**
 * Convert `pixels` interleaved pixels from the source layout to the output layout.
 *  1 -> n : gray replicated to RGB, alpha 1 (2 = gray + alpha 1).   m -> 1 : first channel.   m -> 2 : first two channels.
 *  m -> 3 : RGB.   4 -> 4 : RGBA.   Non-finite values become 0.
 */
export function convertPixels(src: Float32Array, pixels: number, o: ConvertOptions, dst?: Float32Array): Float32Array {
  const { srcChannels: sc, outChannels: oc } = o;
  const out = dst ?? new Float32Array(pixels * oc);
  const srgb = o.colorSpace === 'srgb';
  const alphaIdx = oc === 4 ? 3 : -1;
  for (let i = 0; i < pixels; i++) {
    const s = i * sc;
    const d = i * oc;
    for (let c = 0; c < oc; c++) {
      let v: number;
      if (sc === 1) v = oc === 2 ? (c === 0 ? src[s] : 1) : c < 3 ? src[s] : 1;
      else if (c < sc) v = src[s + c];
      else v = c === 3 ? 1 : 0;
      out[d + c] = Number.isFinite(v) ? v : 0;
    }
    if (o.premultiply && alphaIdx === 3) {
      const a = o.clamp01 ? Math.min(1, Math.max(0, out[d + 3])) : out[d + 3];
      out[d] *= a;
      out[d + 1] *= a;
      out[d + 2] *= a;
    }
    if (srgb) for (let c = 0; c < oc; c++) if (c !== alphaIdx) out[d + c] = srgbEncode(out[d + c]);
    if (o.clamp01) for (let c = 0; c < oc; c++) out[d + c] = out[d + c] < 0 ? 0 : out[d + c] > 1 ? 1 : out[d + c];
  }
  return out;
}

/** Bits per sample of a depth (for memory estimates). */
export const depthBytes = (d: SampleDepth): number => (d === 8 ? 1 : d === 16 || d === 'half' ? 2 : 4);
export const isIntegerDepth = (d: SampleDepth): boolean => d === 8 || d === 16;

/* ------------------------------------------------------------------------------------------------ channel packing */
export type PackSource = 'r' | 'g' | 'b' | 'a' | 'luma' | 'zero' | 'one';
export const PACK_SOURCES: PackSource[] = ['r', 'g', 'b', 'a', 'luma', 'zero', 'one'];
export interface PackSlot {
  source: PackSource;
  invert: boolean;
  black: number;
  white: number;
  gamma: number;
}
export const defaultSlot = (source: PackSource = 'r'): PackSlot => ({ source, invert: false, black: 0, white: 1, gamma: 1 });
export const packSourceIndex = (s: PackSource): number => PACK_SOURCES.indexOf(s);

/** CPU reference of the Multimask shader: select a source channel, apply levels (black / white / gamma) then optional inversion. */
export function packChannel(rgba: ArrayLike<number>, slot: PackSlot): number {
  let v: number;
  switch (slot.source) {
    case 'r': v = rgba[0]; break;
    case 'g': v = rgba[1]; break;
    case 'b': v = rgba[2]; break;
    case 'a': v = rgba[3]; break;
    case 'luma': v = REC709_LUMA[0] * rgba[0] + REC709_LUMA[1] * rgba[1] + REC709_LUMA[2] * rgba[2]; break;
    case 'zero': v = 0; break;
    default: v = 1;
  }
  const span = slot.white - slot.black;
  v = Math.abs(span) < 1e-8 ? (v >= slot.white ? 1 : 0) : (v - slot.black) / span;
  v = Math.min(1, Math.max(0, v));
  if (slot.gamma !== 1 && slot.gamma > 0) v = Math.pow(v, 1 / slot.gamma);
  return slot.invert ? 1 - v : v;
}

/* ------------------------------------------------------------------------------------------------ normals / warp (CPU references) */
export type NormalConvention = 'opengl' | 'directx';
export type NormalLayout = 'xyz' | 'reconstruct' | 'rg';

/**
 * CPU reference of the Export Normal shader. Input = ENCODED normal (n * 0.5 + 0.5, the `normal` pin convention, +Y = OpenGL).
 * `reconstruct` rebuilds Z from XY (z = sqrt(1 - x² - y²)) and re-normalises; `rg` keeps XY and writes Z = 0 (BC5 / two-channel
 * sources: engines rebuild Z). DirectX flips the green channel.
 */
export function exportNormal(enc: [number, number, number], convention: NormalConvention, layout: NormalLayout): [number, number, number] {
  let x = enc[0] * 2 - 1;
  let y = enc[1] * 2 - 1;
  let z = enc[2] * 2 - 1;
  if (layout === 'reconstruct' || layout === 'rg') z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  const l = Math.hypot(x, y, z);
  if (l > 1e-8) {
    x /= l;
    y /= l;
    z /= l;
  }
  if (convention === 'directx') y = -y;
  return [x * 0.5 + 0.5, y * 0.5 + 0.5, layout === 'rg' ? 0 : z * 0.5 + 0.5];
}

/* ------------------------------------------------------------------------------------------------ edge padding */
/**
 * Streaming "mip-safe" colour dilation: pixels with alpha <= threshold take the (averaged) colour of the nearest opaque
 * neighbours within `radius` pixels, alpha is untouched, so mip levels and bilinear filtering never bleed the background colour.
 * Works on RGBA rows in bands with a `radius`-row halo; memory = (band + 2 * radius) rows.
 */
export class EdgePadder {
  private ctx: Float32Array = new Float32Array(0); // rows kept as context before the next band
  private ctxRows = 0;
  private pending: Float32Array[] = [];
  private pendingRows = 0;
  private emittedRows = 0;
  constructor(readonly width: number, readonly height: number, readonly radius: number, readonly threshold = 0.001, private bandRows = 128) {}
  /** Feed rows; `emit` receives finished rows (same row count in total as pushed, delayed by the halo). */
  async push(rows: Float32Array, count: number, emit: (rows: Float32Array, n: number) => Promise<void>): Promise<void> {
    this.pending.push(rows.slice(0, count * this.width * 4));
    this.pendingRows += count;
    while (this.pendingRows >= this.bandRows + this.radius) await this.process(false, emit);
  }
  async flush(emit: (rows: Float32Array, n: number) => Promise<void>): Promise<void> {
    if (this.pendingRows > 0) await this.process(true, emit);
  }
  private async process(final: boolean, emit: (rows: Float32Array, n: number) => Promise<void>): Promise<void> {
    const w = this.width;
    const r = this.radius;
    const total = this.ctxRows + this.pendingRows;
    const buf = new Float32Array(total * w * 4);
    buf.set(this.ctx.subarray(0, this.ctxRows * w * 4));
    let o = this.ctxRows * w * 4;
    for (const p of this.pending) (buf.set(p, o), (o += p.length));
    const top = this.ctxRows; // context rows are already emitted: they are only sources
    const emitCount = final ? this.pendingRows : this.pendingRows - r;
    const dilated = this.dilate(buf, total, w);
    await emit(dilated.slice(top * w * 4, (top + emitCount) * w * 4), emitCount);
    this.emittedRows += emitCount;
    const keep = Math.min(r, top + emitCount);
    this.ctx = buf.slice((top + emitCount - keep) * w * 4, (top + emitCount) * w * 4);
    this.ctxRows = keep;
    const rest = total - (top + emitCount);
    this.pending = rest > 0 ? [buf.slice((top + emitCount) * w * 4)] : [];
    this.pendingRows = rest;
  }
  private dilate(src: Float32Array, rows: number, w: number): Float32Array {
    let cur = src;
    const thr = this.threshold;
    for (let it = 0; it < this.radius; it++) {
      const next = cur.slice();
      let changed = false;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (cur[i + 3] > thr || cur[i + 3] === -1) continue;
          let n = 0, sr = 0, sg = 0, sb = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= rows) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              const j = (yy * w + xx) * 4;
              if (cur[j + 3] > thr || cur[j + 3] === -1) {
                sr += cur[j];
                sg += cur[j + 1];
                sb += cur[j + 2];
                n++;
              }
            }
          }
          if (n) {
            next[i] = sr / n;
            next[i + 1] = sg / n;
            next[i + 2] = sb / n;
            next[i + 3] = -1; // marker: "filled" (restored below); keeps the true alpha out of the way
            changed = true;
          }
        }
      }
      cur = next;
      if (!changed) break;
    }
    // restore the real alpha of filled pixels (alpha was <= threshold there: keep their original alpha)
    for (let i = 0; i < rows * w; i++) if (cur[i * 4 + 3] === -1) cur[i * 4 + 3] = src[i * 4 + 3];
    return cur;
  }
}
