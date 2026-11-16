import { ByteBuilder, type ByteSink } from '../bytes';
import { RowCounter, assertSpec, q8, type ImageFormat, type ImageSpec, type RowEncoder } from './types';

/**
 * TGA encoder: uncompressed 8-bit, top-left origin (descriptor bit 5), TGA 2.0 footer.
 *   1 channel -> image type 3 (grayscale, 8 bpp);  3 -> type 2 BGR (24 bpp);  4 -> type 2 BGRA (32 bpp, 8 alpha bits).
 * Two-channel images are not representable: the exporter converts them to RGB before calling this.
 */
export function tgaHeader(spec: ImageSpec): Uint8Array {
  const c = spec.channels;
  return new ByteBuilder(18)
    .u8(0) // id length
    .u8(0) // no colour map
    .u8(c === 1 ? 3 : 2)
    .u16(0)
    .u16(0)
    .u8(0) // colour map spec
    .u16(0)
    .u16(0) // x/y origin
    .u16(spec.width)
    .u16(spec.height)
    .u8(c * 8)
    .u8(0x20 | (c === 4 ? 8 : 0))
    .result();
}
export const TGA_FOOTER = new ByteBuilder(26).u32(0).u32(0).ascii('TRUEVISION-XFILE.').u8(0).result();

class TgaEncoder implements RowEncoder {
  private counter: RowCounter;
  constructor(private spec: ImageSpec, private sink: ByteSink) {
    this.counter = new RowCounter(spec.height, 'tga');
  }
  async start(): Promise<void> {
    await this.sink.write(tgaHeader(this.spec));
  }
  async writeRows(rows: Float32Array, count: number): Promise<void> {
    this.counter.add(count);
    const { width, channels } = this.spec;
    const out = new Uint8Array(width * channels * count);
    let o = 0;
    for (let i = 0; i < width * count; i++) {
      const s = i * channels;
      if (channels === 1) out[o++] = q8(rows[s]);
      else {
        out[o++] = q8(rows[s + 2]); // B
        out[o++] = q8(rows[s + 1]); // G
        out[o++] = q8(rows[s]); // R
        if (channels === 4) out[o++] = q8(rows[s + 3]);
      }
    }
    await this.sink.write(out);
  }
  async finish(): Promise<void> {
    this.counter.assertComplete();
    await this.sink.write(TGA_FOOTER);
    await this.sink.close();
  }
  async abort(): Promise<void> {
    await this.sink.abort?.();
  }
}

export const tgaFormat: ImageFormat = {
  id: 'tga',
  label: 'TGA',
  ext: 'tga',
  mime: 'image/x-tga',
  depths: [8],
  linearOnly: false,
  maxChannels: 4,
  async create(spec, sink) {
    assertSpec(spec, tgaFormat);
    if (spec.channels === 2) throw new Error('tga: two-channel images are not supported (convert to RGB)');
    const e = new TgaEncoder(spec, sink);
    await e.start();
    return e;
  },
};
