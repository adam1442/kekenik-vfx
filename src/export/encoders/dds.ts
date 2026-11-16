import { ByteBuilder, type ByteSink } from '../bytes';
import { floatToHalf } from '../../engine/resources/half';
import { RowCounter, assertSpec, q16, q8, type ImageFormat, type ImageSpec, type RowEncoder } from './types';

/**
 * Lightweight uncompressed DDS (DX10 extended header; stretch goal of the spec). No mips, no block compression.
 * DXGI formats: 8-bit RGBA(_SRGB) / R8 / RG8, 16-bit UNORM RGBA / R / RG, half / float RGBA / RG / R.
 * 3-channel images are padded to RGBA (alpha = 1) because DXGI has no 3-channel 8/16 bit format.
 */
export function ddsDxgi(channels: number, depth: ImageSpec['depth'], srgb: boolean): number {
  const c = channels === 3 ? 4 : channels;
  const table: Record<string, number> = {
    '8:1': 61, '8:2': 49, '8:4': srgb ? 29 : 28,
    '16:1': 56, '16:2': 37, '16:4': 11,
    'half:1': 54, 'half:2': 34, 'half:4': 10,
    'float:1': 41, 'float:2': 16, 'float:4': 2,
  };
  return table[`${depth}:${c}`];
}

export function ddsHeader(spec: ImageSpec): Uint8Array {
  const c = spec.channels === 3 ? 4 : spec.channels;
  const bps = spec.depth === 8 ? 1 : spec.depth === 16 || spec.depth === 'half' ? 2 : 4;
  const pitch = spec.width * c * bps;
  const b = new ByteBuilder(148);
  b.ascii('DDS ').u32(124).u32(0x1 | 0x2 | 0x4 | 0x1000 | 0x8) // CAPS|HEIGHT|WIDTH|PIXELFORMAT|PITCH
    .u32(spec.height).u32(spec.width).u32(pitch).u32(0).u32(1);
  for (let i = 0; i < 11; i++) b.u32(0);
  b.u32(32).u32(0x4).ascii('DX10').u32(0).u32(0).u32(0).u32(0).u32(0); // pixel format: FOURCC DX10
  b.u32(0x1000).u32(0).u32(0).u32(0).u32(0); // caps
  b.u32(ddsDxgi(spec.channels, spec.depth, spec.colorSpace === 'srgb')).u32(3).u32(0).u32(1).u32(0); // DX10: format, TEXTURE2D, misc, arraySize, alpha mode
  return b.result();
}

class DdsEncoder implements RowEncoder {
  private counter: RowCounter;
  constructor(private spec: ImageSpec, private sink: ByteSink) {
    this.counter = new RowCounter(spec.height, 'dds');
  }
  async start(): Promise<void> {
    await this.sink.write(ddsHeader(this.spec));
  }
  async writeRows(rows: Float32Array, count: number): Promise<void> {
    this.counter.add(count);
    const { width, channels, depth } = this.spec;
    const oc = channels === 3 ? 4 : channels;
    const bps = depth === 8 ? 1 : depth === 'float' ? 4 : 2;
    const out = new Uint8Array(width * count * oc * bps);
    const v = new DataView(out.buffer);
    let o = 0;
    for (let p = 0; p < width * count; p++) {
      for (let c = 0; c < oc; c++) {
        const val = c < channels ? rows[p * channels + c] : 1;
        if (depth === 8) out[o++] = q8(val);
        else if (depth === 16) (v.setUint16(o, q16(val), true), (o += 2));
        else if (depth === 'half') (v.setUint16(o, floatToHalf(val), true), (o += 2));
        else (v.setFloat32(o, val, true), (o += 4));
      }
    }
    await this.sink.write(out);
  }
  async finish(): Promise<void> {
    this.counter.assertComplete();
    await this.sink.close();
  }
  async abort(): Promise<void> {
    await this.sink.abort?.();
  }
}

export const ddsFormat: ImageFormat = {
  id: 'dds',
  label: 'DDS (uncompressed)',
  ext: 'dds',
  mime: 'image/vnd-ms.dds',
  depths: [8, 16, 'half', 'float'],
  linearOnly: false,
  maxChannels: 4,
  async create(spec, sink) {
    assertSpec(spec, ddsFormat);
    const e = new DdsEncoder(spec, sink);
    await e.start();
    return e;
  },
};
