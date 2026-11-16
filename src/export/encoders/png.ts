import { ByteBuilder, StreamCompressor, concatBytes, crc32, type ByteSink } from '../bytes';
import { RowCounter, assertSpec, q16, q8, type EncoderOptions, type ImageFormat, type ImageSpec, type RowEncoder } from './types';

/**
 * PNG encoder (8 / 16 bit; gray, gray+alpha, RGB, RGBA). Streaming: rows -> filter -> zlib (CompressionStream) -> IDAT chunks.
 * Chunks written: IHDR, sRGB (render intent 0) or gAMA(100000) for linear data, tEXt Software, IDAT..., IEND. Own CRC.
 * 16-bit samples are big-endian as the PNG spec requires.
 */
export const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_TYPE: Record<number, number> = { 1: 0, 2: 4, 3: 2, 4: 6 };

/** Build one chunk: length, type, data, CRC(type + data). */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const b = new ByteBuilder(data.length + 12);
  b.u32(data.length, false).ascii(type).bytes(data);
  const body = b.result();
  const crc = crc32(body.subarray(4));
  return new ByteBuilder(body.length + 4).bytes(body).u32(crc, false).result();
}

export function pngHeaderChunks(spec: ImageSpec): Uint8Array[] {
  const ihdr = new ByteBuilder(13)
    .u32(spec.width, false)
    .u32(spec.height, false)
    .u8(spec.depth === 16 ? 16 : 8)
    .u8(COLOR_TYPE[spec.channels])
    .u8(0) // compression
    .u8(0) // filter method
    .u8(0) // no interlace
    .result();
  const out = [PNG_SIGNATURE, pngChunk('IHDR', ihdr)];
  out.push(spec.colorSpace === 'srgb' ? pngChunk('sRGB', Uint8Array.from([0])) : pngChunk('gAMA', new ByteBuilder(4).u32(100000, false).result()));
  const text = (k: string, v: string): Uint8Array => pngChunk('tEXt', new ByteBuilder().ascii(k).u8(0).ascii(v.replace(/[^\x20-\x7e]/g, '?')).result());
  out.push(text('Software', spec.software ?? 'Kekenik VFX'));
  if (spec.comment) out.push(text('Comment', spec.comment));
  return out;
}

/** Filter one raw scanline; returns the filter-type-prefixed row (length = 1 + raw.length). `prev` = previous raw row or zeros. */
export function filterRow(mode: 'none' | 'sub' | 'up' | 'adaptive', raw: Uint8Array, prev: Uint8Array, bpp: number, out: Uint8Array): void {
  const n = raw.length;
  const doSub = (o: Uint8Array): void => {
    for (let i = 0; i < n; i++) o[i + 1] = (raw[i] - (i >= bpp ? raw[i - bpp] : 0)) & 255;
  };
  const doUp = (o: Uint8Array): void => {
    for (let i = 0; i < n; i++) o[i + 1] = (raw[i] - prev[i]) & 255;
  };
  if (mode === 'none') {
    out[0] = 0;
    out.set(raw, 1);
  } else if (mode === 'sub') {
    out[0] = 1;
    doSub(out);
  } else if (mode === 'up') {
    out[0] = 2;
    doUp(out);
  } else {
    // adaptive: minimum sum of absolute (signed) values heuristic over None / Sub / Up
    const score = (o: Uint8Array): number => {
      let s = 0;
      for (let i = 1; i <= n; i++) s += o[i] < 128 ? o[i] : 256 - o[i];
      return s;
    };
    const a = new Uint8Array(n + 1);
    const b = new Uint8Array(n + 1);
    a[0] = 1;
    doSub(a);
    b[0] = 2;
    doUp(b);
    out[0] = 0;
    out.set(raw, 1);
    const s0 = score(out);
    const s1 = score(a);
    const s2 = score(b);
    if (s1 <= s0 && s1 <= s2) out.set(a);
    else if (s2 < s0) out.set(b);
  }
}

class PngEncoder implements RowEncoder {
  private cmp: StreamCompressor;
  private counter: RowCounter;
  private prev: Uint8Array;
  private raw: Uint8Array;
  private filtered: Uint8Array;
  private bpp: number;
  private pending: Uint8Array[] = [];
  private pendingLen = 0;
  constructor(private spec: ImageSpec, private sink: ByteSink, private opts: EncoderOptions) {
    const bytesPer = spec.depth === 16 ? 2 : 1;
    this.bpp = spec.channels * bytesPer;
    const rowBytes = spec.width * this.bpp;
    this.prev = new Uint8Array(rowBytes);
    this.raw = new Uint8Array(rowBytes);
    this.filtered = new Uint8Array(rowBytes + 1);
    this.counter = new RowCounter(spec.height, 'png');
    this.cmp = new StreamCompressor('deflate', async (c) => this.queue(c));
  }
  async start(): Promise<void> {
    for (const c of pngHeaderChunks(this.spec)) await this.sink.write(c);
  }
  private async queue(c: Uint8Array): Promise<void> {
    this.pending.push(c);
    this.pendingLen += c.length;
    if (this.pendingLen >= 65536) await this.flush();
  }
  private async flush(): Promise<void> {
    if (!this.pendingLen) return;
    const data = concatBytes(this.pending);
    this.pending = [];
    this.pendingLen = 0;
    await this.sink.write(pngChunk('IDAT', data));
  }
  async writeRows(rows: Float32Array, count: number): Promise<void> {
    this.counter.add(count);
    const { width, channels, depth } = this.spec;
    const per = width * channels;
    // Batch several filtered rows per compressor push (fewer awaits).
    const batchRows = Math.max(1, Math.floor(262144 / (per * 2)));
    const batch = new Uint8Array(batchRows * this.filtered.length);
    let fill = 0;
    for (let r = 0; r < count; r++) {
      const base = r * per;
      if (depth === 16) {
        for (let i = 0; i < per; i++) {
          const v = q16(rows[base + i]);
          this.raw[i * 2] = v >> 8;
          this.raw[i * 2 + 1] = v & 255;
        }
      } else for (let i = 0; i < per; i++) this.raw[i] = q8(rows[base + i]);
      filterRow(this.opts.pngFilter ?? 'adaptive', this.raw, this.prev, this.bpp, this.filtered);
      batch.set(this.filtered, fill);
      fill += this.filtered.length;
      const t = this.prev;
      this.prev = this.raw;
      this.raw = t;
      if (fill + this.filtered.length > batch.length) {
        await this.cmp.push(batch.subarray(0, fill).slice());
        fill = 0;
      }
    }
    if (fill) await this.cmp.push(batch.subarray(0, fill).slice());
  }
  async finish(): Promise<void> {
    this.counter.assertComplete();
    await this.cmp.finish();
    await this.flush();
    await this.sink.write(pngChunk('IEND', new Uint8Array(0)));
    await this.sink.close();
  }
  async abort(): Promise<void> {
    await this.cmp.abort();
    await this.sink.abort?.();
  }
}

export const pngFormat: ImageFormat = {
  id: 'png',
  label: 'PNG',
  ext: 'png',
  mime: 'image/png',
  depths: [8, 16],
  linearOnly: false,
  maxChannels: 4,
  async create(spec, sink, opts = {}) {
    assertSpec(spec, pngFormat);
    const e = new PngEncoder(spec, sink, opts);
    await e.start();
    return e;
  },
};
