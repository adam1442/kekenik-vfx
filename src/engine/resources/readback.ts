import type { GpuContext } from '../gpu/device';
import { roundUp } from '../../shared/util';
import { bytesPerPixel, channelCount } from './format';
import { decodeHalfArray } from './half';
import type { MemoryManager } from './memory';

/**
 * Async, strip-wise texture readback. Never blocks: uses mapAsync and one small staging buffer at a time, so
 * peak extra memory is bounded by `maxStripBytes` regardless of image size.
 */
export interface ReadStrip {
  /** First row of this strip relative to the read region. */
  y0: number;
  rows: number;
  width: number;
  /** Tightly packed rows (no 256-byte padding), raw texel bytes of the source format. */
  data: Uint8Array;
}

export interface ReadRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReadOptions {
  region?: ReadRegion;
  maxStripBytes?: number;
  signal?: { cancelled: boolean };
}

export async function readTextureStrips(
  gpu: GpuContext,
  mm: MemoryManager | null,
  texture: GPUTexture,
  format: string,
  width: number,
  height: number,
  onStrip: (s: ReadStrip) => void | Promise<void>,
  opts: ReadOptions = {},
): Promise<void> {
  const r = opts.region ?? { x: 0, y: 0, w: width, h: height };
  if (r.x < 0 || r.y < 0 || r.x + r.w > width || r.y + r.h > height) throw new Error('readTextureStrips: region outside texture');
  const bpp = bytesPerPixel(format);
  const tightRow = r.w * bpp;
  const paddedRow = roundUp(tightRow, 256);
  const maxStrip = opts.maxStripBytes ?? 16 * 1024 * 1024;
  const rowsPerStrip = Math.max(1, Math.min(r.h, Math.floor(maxStrip / paddedRow)));
  for (let y0 = 0; y0 < r.h; y0 += rowsPerStrip) {
    if (opts.signal?.cancelled) return;
    const rows = Math.min(rowsPerStrip, r.h - y0);
    const size = paddedRow * rows;
    mm?.addUsed(size);
    const dev = gpu.device;
    const staging = dev.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: 'readback staging' });
    try {
      const enc = dev.createCommandEncoder({ label: 'readback' });
      enc.copyTextureToBuffer({ texture, origin: { x: r.x, y: r.y + y0 } }, { buffer: staging, bytesPerRow: paddedRow, rowsPerImage: rows }, { width: r.w, height: rows });
      dev.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(staging.getMappedRange());
      const out = new Uint8Array(tightRow * rows);
      for (let row = 0; row < rows; row++) out.set(mapped.subarray(row * paddedRow, row * paddedRow + tightRow), row * tightRow);
      staging.unmap();
      await onStrip({ y0, rows, width: r.w, data: out });
    } finally {
      staging.destroy();
      mm?.removeUsed(size);
    }
  }
}

/** Convert raw texel bytes of a float format into Float32 values (channels interleaved). */
export function decodeTexels(format: string, bytes: Uint8Array): Float32Array {
  const ab = bytes.byteOffset % 4 === 0 ? bytes.buffer : bytes.slice().buffer;
  const off = bytes.byteOffset % 4 === 0 ? bytes.byteOffset : 0;
  if (format.endsWith('32float')) return new Float32Array(ab, off, bytes.byteLength / 4).slice();
  if (format.endsWith('16float')) return decodeHalfArray(new Uint16Array(ab, off, bytes.byteLength / 2));
  if (format.endsWith('8unorm')) {
    const o = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) o[i] = bytes[i] / 255;
    return o;
  }
  throw new Error(`decodeTexels: unsupported format ${format}`);
}

/**
 * Convenience for tests / small images: whole texture (or region) as Float32 (interleaved channels).
 * Refuses huge reads (> 64M floats): use readTextureStrips for exports.
 */
export async function readTextureFloat32(
  gpu: GpuContext,
  mm: MemoryManager | null,
  texture: GPUTexture,
  format: string,
  width: number,
  height: number,
  region?: ReadRegion,
): Promise<Float32Array> {
  const r = region ?? { x: 0, y: 0, w: width, h: height };
  const ch = channelCount(format);
  if (r.w * r.h * ch > 64 * 1024 * 1024) throw new Error('readTextureFloat32: image too large, use readTextureStrips');
  const out = new Float32Array(r.w * r.h * ch);
  await readTextureStrips(gpu, mm, texture, format, width, height, (s) => {
    out.set(decodeTexels(format, s.data), s.y0 * r.w * ch);
  }, { region: r });
  return out;
}
