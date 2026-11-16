import { ByteBuilder, concatBytes, deflateZlib, type ByteSink } from '../bytes';
import { floatToHalf } from '../../engine/resources/half';
import { RowCounter, assertSpec, type EncoderOptions, type ImageFormat, type ImageSpec, type RowEncoder } from './types';

/**
 * OpenEXR 2.0 scanline encoder (single part, HALF or FLOAT, NO_COMPRESSION or ZIP (16 scanlines per block)).
 *
 *  - Channels are stored ALPHABETICALLY as the format requires (A,B,G,R); we write the pixel data of one scanline
 *    channel after channel. Gray = "Y". Two channels = "R","G".
 *  - ZIP block = reorder bytes (even bytes first, then odd) -> delta predictor -> zlib deflate; stored raw when it does not
 *    shrink (the reader detects it by size == raw size).
 *  - Header carries the Rec.709 `chromaticities` attribute (linear sRGB primaries, D65 white) so viewers know the primaries.
 *  - The offset table is at the start of the file: with a seekable sink we write a placeholder and patch it; otherwise
 *    compressed blocks are buffered (capped by `maxBufferBytes`, a clear error beyond that).
 */
export const EXR_MAGIC = Uint8Array.from([0x76, 0x2f, 0x31, 0x01]);
export const REC709_CHROMATICITIES = [0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329];
const ZIP_LINES = 16;

export function exrChannelNames(channels: number): string[] {
  return channels === 1 ? ['Y'] : channels === 2 ? ['R', 'G'] : channels === 3 ? ['R', 'G', 'B'] : ['R', 'G', 'B', 'A'];
}

/** Forward ZIP pre-filter (exported for tests): reorder + predictor. */
export function exrPreFilter(raw: Uint8Array): Uint8Array {
  const n = raw.length;
  const out = new Uint8Array(n);
  let t1 = 0;
  let t2 = Math.floor((n + 1) / 2);
  let s = 0;
  for (;;) {
    if (s < n) out[t1++] = raw[s++];
    else break;
    if (s < n) out[t2++] = raw[s++];
    else break;
  }
  let p = out[0];
  for (let t = 1; t < n; t++) {
    const d = (out[t] - p + 384) & 255;
    p = out[t];
    out[t] = d;
  }
  return out;
}
/** Inverse (used by the tests to decode our own files). */
export function exrPostFilter(data: Uint8Array): Uint8Array {
  const n = data.length;
  const t = data.slice();
  for (let i = 1; i < n; i++) t[i] = (t[i - 1] + t[i] - 128) & 255;
  const out = new Uint8Array(n);
  let a = 0;
  let b = Math.floor((n + 1) / 2);
  let o = 0;
  while (o < n) {
    out[o++] = t[a++];
    if (o < n) out[o++] = t[b++];
  }
  return out;
}

export function exrHeader(spec: ImageSpec, compression: 'zip' | 'none', names: string[]): Uint8Array {
  const b = new ByteBuilder(512);
  b.bytes(EXR_MAGIC).u32(2); // version 2, no flags (single part, scanline)
  const attr = (name: string, type: string, body: Uint8Array): void => {
    b.cstr(name).cstr(type).u32(body.length).bytes(body);
  };
  // channels (sorted alphabetically; ASCII order)
  const sorted = names.map((n, i) => ({ n, i })).sort((a, c) => (a.n < c.n ? -1 : a.n > c.n ? 1 : 0));
  const ch = new ByteBuilder(64);
  for (const c of sorted) ch.cstr(c.n).u32(spec.depth === 'float' ? 2 : 1).u8(0).u8(0).u8(0).u8(0).u32(1).u32(1);
  ch.u8(0);
  const box = (): Uint8Array => new ByteBuilder(16).i32(0).i32(0).i32(spec.width - 1).i32(spec.height - 1).result();
  const chroma = new ByteBuilder(32);
  for (const v of REC709_CHROMATICITIES) chroma.f32(v);
  // attributes in alphabetical order, like OpenEXR does
  attr('channels', 'chlist', ch.result());
  attr('chromaticities', 'chromaticities', chroma.result());
  attr('compression', 'compression', Uint8Array.from([compression === 'zip' ? 3 : 0]));
  attr('dataWindow', 'box2i', box());
  attr('displayWindow', 'box2i', box());
  attr('lineOrder', 'lineOrder', Uint8Array.from([0]));
  attr('pixelAspectRatio', 'float', new ByteBuilder(4).f32(1).result());
  attr('screenWindowCenter', 'v2f', new ByteBuilder(8).f32(0).f32(0).result());
  attr('screenWindowWidth', 'float', new ByteBuilder(4).f32(1).result());
  if (spec.software) attr('software', 'string', new ByteBuilder().ascii(spec.software).result());
  b.u8(0); // end of header
  return b.result();
}

class ExrEncoder implements RowEncoder {
  private counter: RowCounter;
  private names: string[];
  private order: number[]; // channel index per stored (alphabetical) slot
  private sampleBytes: number;
  private block: Uint8Array;
  private blockRows = 0;
  private blockY = 0;
  private blocks = 0;
  private totalBlocks: number;
  private lines: number;
  private table: number[] = [];
  private headerLen = 0;
  private buffered: Uint8Array[] = [];
  private bufferedBytes = 0;
  private seekable: boolean;
  constructor(private spec: ImageSpec, private sink: ByteSink, private opts: EncoderOptions) {
    this.counter = new RowCounter(spec.height, 'exr');
    this.names = opts.exrChannels && opts.exrChannels.length === spec.channels ? opts.exrChannels : exrChannelNames(spec.channels);
    this.order = this.names.map((n, i) => ({ n, i })).sort((a, c) => (a.n < c.n ? -1 : a.n > c.n ? 1 : 0)).map((x) => x.i);
    this.sampleBytes = spec.depth === 'float' ? 4 : 2;
    this.lines = (opts.exrCompression ?? 'zip') === 'zip' ? ZIP_LINES : 1;
    this.block = new Uint8Array(this.lines * spec.width * spec.channels * this.sampleBytes);
    this.totalBlocks = Math.ceil(spec.height / this.lines);
    this.seekable = sink.canSeek && !!sink.writeAt;
  }
  async start(): Promise<void> {
    const header = exrHeader(this.spec, (this.opts.exrCompression ?? 'zip'), this.names);
    this.headerLen = header.length;
    if (this.seekable) {
      await this.sink.write(header);
      await this.sink.write(new Uint8Array(this.totalBlocks * 8)); // placeholder offset table
    } else this.buffered.push(header);
    if (!this.seekable) this.bufferedBytes += header.length;
  }
  private put(view: DataView, off: number, v: number): void {
    if (this.spec.depth === 'float') view.setFloat32(off, v, true);
    else view.setUint16(off, floatToHalf(v), true);
  }
  async writeRows(rows: Float32Array, count: number): Promise<void> {
    this.counter.add(count);
    const { width, channels } = this.spec;
    const sb = this.sampleBytes;
    for (let r = 0; r < count; r++) {
      const view = new DataView(this.block.buffer, this.block.byteOffset, this.block.byteLength);
      const rowBase = this.blockRows * width * channels * sb;
      for (let slot = 0; slot < channels; slot++) {
        const ch = this.order[slot];
        const chBase = rowBase + slot * width * sb;
        for (let x = 0; x < width; x++) this.put(view, chBase + x * sb, rows[(r * width + x) * channels + ch]);
      }
      this.blockRows++;
      if (this.blockRows === this.lines) await this.flushBlock();
    }
  }
  private async flushBlock(): Promise<void> {
    if (!this.blockRows) return;
    const raw = this.block.subarray(0, this.blockRows * this.spec.width * this.spec.channels * this.sampleBytes);
    let payload: Uint8Array = raw;
    if ((this.opts.exrCompression ?? 'zip') === 'zip') {
      const z = await deflateZlib(exrPreFilter(raw));
      if (z.length < raw.length) payload = z;
    }
    const blk = new ByteBuilder(payload.length + 8).i32(this.blockY).u32(payload.length).bytes(payload).result();
    if (this.seekable) {
      this.table.push(this.sink.position);
      await this.sink.write(blk);
    } else {
      this.buffered.push(blk);
      this.bufferedBytes += blk.length;
      const cap = this.opts.maxBufferBytes ?? 768 * 1024 * 1024;
      if (this.bufferedBytes > cap) throw new Error(`exr: the compressed image (${(this.bufferedBytes / 1048576).toFixed(0)} MB) exceeds the in-memory limit of ${(cap / 1048576).toFixed(0)} MB. Use a folder export (File System Access API) for this size.`);
    }
    this.blocks++;
    this.blockY += this.blockRows;
    this.blockRows = 0;
  }
  async finish(): Promise<void> {
    this.counter.assertComplete();
    await this.flushBlock();
    if (this.blocks !== this.totalBlocks) throw new Error(`exr: wrote ${this.blocks} of ${this.totalBlocks} blocks`);
    if (this.seekable) {
      const t = new ByteBuilder(this.totalBlocks * 8);
      for (const o of this.table) t.u64(o);
      await this.sink.writeAt!(this.headerLen, t.result());
    } else {
      // offsets: header + table, then blocks in order
      const header = this.buffered[0];
      const blocks = this.buffered.slice(1);
      let pos = header.length + this.totalBlocks * 8;
      const t = new ByteBuilder(this.totalBlocks * 8);
      for (const b of blocks) {
        t.u64(pos);
        pos += b.length;
      }
      await this.sink.write(concatBytes([header, t.result()]));
      for (const b of blocks) await this.sink.write(b);
      this.buffered = [];
    }
    await this.sink.close();
  }
  async abort(): Promise<void> {
    this.buffered = [];
    await this.sink.abort?.();
  }
}

export const exrFormat: ImageFormat = {
  id: 'exr',
  label: 'OpenEXR',
  ext: 'exr',
  mime: 'image/x-exr',
  depths: ['half', 'float'],
  linearOnly: true,
  maxChannels: 4,
  async create(spec, sink, opts = {}) {
    assertSpec(spec, exrFormat);
    const e = new ExrEncoder({ ...spec, software: spec.software ?? 'Kekenik VFX' }, sink, opts);
    await e.start();
    return e;
  },
};
