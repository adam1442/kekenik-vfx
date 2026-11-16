import { utf8, type ByteSink } from '../bytes';
import { RowCounter, assertSpec, type ImageFormat, type ImageSpec, type RowEncoder } from './types';

/**
 * Radiance HDR (RGBE) encoder. RGB only (alpha / extra channels are dropped by the exporter with a validation warning;
 * 1-channel images are replicated to gray RGB). Scanlines use the "new" adaptive RLE when 8 <= width < 32768, flat otherwise.
 */
export function floatToRgbe(r: number, g: number, b: number, out: Uint8Array | number[], o = 0): void {
  const m = Math.max(r, g, b);
  if (!(m > 1e-32) || !Number.isFinite(m)) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  // frexp: m = f * 2^e, f in [0.5, 1)
  let e = Math.ceil(Math.log2(m));
  let f = m / 2 ** e;
  if (f >= 1) {
    f /= 2;
    e++;
  }
  if (f < 0.5) {
    f *= 2;
    e--;
  }
  const scale = (f * 256) / m;
  out[o] = Math.min(255, Math.max(0, Math.floor(r * scale)));
  out[o + 1] = Math.min(255, Math.max(0, Math.floor(g * scale)));
  out[o + 2] = Math.min(255, Math.max(0, Math.floor(b * scale)));
  out[o + 3] = e + 128;
}
export function rgbeToFloat(rgbe: ArrayLike<number>, o = 0): [number, number, number] {
  if (rgbe[o + 3] === 0) return [0, 0, 0];
  const f = 2 ** (rgbe[o + 3] - 136);
  return [(rgbe[o] + 0.5) * f, (rgbe[o + 1] + 0.5) * f, (rgbe[o + 2] + 0.5) * f];
}

/** RLE of one component plane of a scanline (Radiance new-style). */
export function rleEncodePlane(plane: Uint8Array, out: number[]): void {
  const n = plane.length;
  let i = 0;
  while (i < n) {
    // run length at i
    let run = 1;
    while (i + run < n && run < 127 && plane[i + run] === plane[i]) run++;
    if (run >= 4) {
      out.push(128 + run, plane[i]);
      i += run;
    } else {
      // literal block: until a run of >= 4 begins (max 128)
      let j = i;
      while (j < n && j - i < 128) {
        let r = 1;
        while (j + r < n && r < 4 && plane[j + r] === plane[j]) r++;
        if (r >= 4) break;
        j++;
      }
      if (j === i) j = i + 1;
      out.push(j - i);
      for (let k = i; k < j; k++) out.push(plane[k]);
      i = j;
    }
  }
}

class HdrEncoder implements RowEncoder {
  private counter: RowCounter;
  constructor(private spec: ImageSpec, private sink: ByteSink) {
    this.counter = new RowCounter(spec.height, 'hdr');
  }
  async start(): Promise<void> {
    await this.sink.write(utf8(`#?RADIANCE\n# ${this.spec.software ?? 'Kekenik VFX'}\nFORMAT=32-bit_rle_rgbe\n\n-Y ${this.spec.height} +X ${this.spec.width}\n`));
  }
  async writeRows(rows: Float32Array, count: number): Promise<void> {
    this.counter.add(count);
    const { width: w, channels: c } = this.spec;
    const rle = w >= 8 && w < 32768;
    const flat = new Uint8Array(w * 4);
    const out: number[] = [];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * c;
        const r = rows[s];
        floatToRgbe(r, c >= 3 ? rows[s + 1] : r, c >= 3 ? rows[s + 2] : r, flat, x * 4);
      }
      if (!rle) {
        await this.sink.write(flat.slice());
        continue;
      }
      out.length = 0;
      out.push(2, 2, w >> 8, w & 255);
      const plane = new Uint8Array(w);
      for (let ch = 0; ch < 4; ch++) {
        for (let x = 0; x < w; x++) plane[x] = flat[x * 4 + ch];
        rleEncodePlane(plane, out);
      }
      await this.sink.write(Uint8Array.from(out));
    }
  }
  async finish(): Promise<void> {
    this.counter.assertComplete();
    await this.sink.close();
  }
  async abort(): Promise<void> {
    await this.sink.abort?.();
  }
}

export const hdrFormat: ImageFormat = {
  id: 'hdr',
  label: 'Radiance HDR',
  ext: 'hdr',
  mime: 'image/vnd.radiance',
  depths: ['float'],
  linearOnly: true,
  maxChannels: 3,
  async create(spec, sink) {
    assertSpec(spec, hdrFormat);
    const e = new HdrEncoder(spec, sink);
    await e.start();
    return e;
  },
};

