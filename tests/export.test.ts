import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MemorySink, adler32, crc32, utf8, concatBytes, type ByteSink } from '../src/export/bytes';
import { ddsDxgi, ddsHeader } from '../src/export/encoders/dds';
import { exrFormat, exrPostFilter, exrPreFilter } from '../src/export/encoders/exr';
import { floatToRgbe, hdrFormat, rgbeToFloat } from '../src/export/encoders/hdr';
import { PNG_SIGNATURE, pngFormat } from '../src/export/encoders/png';
import { tgaFormat } from '../src/export/encoders/tga';
import { ENGINE_PRESETS, AXIS_MATRICES, matDet3 } from '../src/export/engines';
import { MeshData, Topology } from '../src/engine/mesh/mesh';
import { buildExportMesh, encodePivots, mergeFrames } from '../src/export/mesh/build';
import { buildGltf, buildObj, buildPly, toGlb } from '../src/export/mesh/formats';
import { buildRigidVat, fitRigid, quatRotate, rigidVatRows, softBounds, softVatDecode, softVatRows, vatRowUv, vec3Bounds, vatMetadata } from '../src/export/mesh/vat';
import { expandTemplate, sanitizeSegment, uniquePaths } from '../src/export/naming';
import { EdgePadder, convertPixels, exportNormal, packChannel, defaultSlot, srgbDecode, srgbEncode } from '../src/export/pixels';
import { estimateImageJob, planTiling, resolveImageSettings, validateImageSettings } from '../src/export/settings';
import { ZipWriter, readZip } from '../src/export/zip';
import { halfToFloat } from '../src/engine/resources/half';
import { defaultGraphSettings } from '../src/engine/graph/graph';

/** Sink without seek support (like a ZIP entry). */
class StreamSink implements ByteSink {
  readonly canSeek = false;
  parts: Uint8Array[] = [];
  private len = 0;
  get position(): number {
    return this.len;
  }
  async write(c: Uint8Array): Promise<void> {
    this.parts.push(c.slice());
    this.len += c.length;
  }
  async close(): Promise<void> {}
  bytes(): Uint8Array {
    return concatBytes(this.parts);
  }
}

const dv = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Minimal PNG decoder (filters 0..4) for round-trip checks. */
function decodePng(b: Uint8Array): { w: number; h: number; bits: number; ch: number; data: Uint8Array; chunks: string[] } {
  expect([...b.subarray(0, 8)]).toEqual([...PNG_SIGNATURE]);
  const d = dv(b);
  let p = 8;
  let w = 0, h = 0, bits = 0, ct = 0;
  const idat: Uint8Array[] = [];
  const chunks: string[] = [];
  for (;;) {
    const len = d.getUint32(p);
    const type = String.fromCharCode(...b.subarray(p + 4, p + 8));
    const data = b.subarray(p + 8, p + 8 + len);
    const crc = d.getUint32(p + 8 + len);
    expect(crc32(b.subarray(p + 4, p + 8 + len))).toBe(crc);
    chunks.push(type);
    if (type === 'IHDR') ((w = dv(data).getUint32(0)), (h = dv(data).getUint32(4)), (bits = data[8]), (ct = data[9]));
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
    if (type === 'IEND') break;
  }
  const ch = ({ 0: 1, 4: 2, 2: 3, 6: 4 } as Record<number, number>)[ct];
  const raw = new Uint8Array(inflateSync(concatBytes(idat)));
  const bpp = (ch * bits) / 8;
  const stride = w * bpp;
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + up;
      else if (f === 3) r = v + ((a + up) >> 1);
      else if (f === 4) {
        const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      }
      out[y * stride + x] = r & 255;
    }
  }
  return { w, h, bits, ch, data: out, chunks };
}

describe('checksums', () => {
  it('CRC-32 / Adler-32 known answers', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
    expect(adler32(utf8('Wikipedia'))).toBe(0x11e60398);
    expect(crc32(new Uint8Array(0))).toBe(0);
    // incremental == one shot
    const a = utf8('hello '), b = utf8('world');
    expect(crc32(b, crc32(a))).toBe(crc32(utf8('hello world')));
  });
});

describe('PNG encoder', () => {
  const W = 5, H = 4;
  const mk = (ch: number): Float32Array => Float32Array.from({ length: W * H * ch }, (_, i) => ((i * 37) % 101) / 100);
  for (const filter of ['none', 'sub', 'up', 'adaptive'] as const) {
    it(`8-bit RGBA round trip (${filter})`, async () => {
      const sink = new MemorySink();
      const rows = mk(4);
      const e = await pngFormat.create({ width: W, height: H, channels: 4, depth: 8, colorSpace: 'srgb' }, sink, { pngFilter: filter });
      await e.writeRows(rows.subarray(0, W * 4 * 2), 2);
      await e.writeRows(rows.subarray(W * 4 * 2), 2);
      await e.finish();
      const png = decodePng(sink.bytes());
      expect([png.w, png.h, png.bits, png.ch]).toEqual([W, H, 8, 4]);
      expect(png.chunks[0]).toBe('IHDR');
      expect(png.chunks).toContain('sRGB');
      expect(png.chunks[png.chunks.length - 1]).toBe('IEND');
      for (let i = 0; i < rows.length; i++) expect(png.data[i]).toBe(Math.round(rows[i] * 255));
    });
  }
  it('16-bit RGB is big-endian and linear data gets gAMA', async () => {
    const sink = new MemorySink();
    const rows = mk(3);
    const e = await pngFormat.create({ width: W, height: H, channels: 3, depth: 16, colorSpace: 'linear' }, sink);
    await e.writeRows(rows, H);
    await e.finish();
    const png = decodePng(sink.bytes());
    expect(png.bits).toBe(16);
    expect(png.chunks).toContain('gAMA');
    expect(png.chunks).not.toContain('sRGB');
    const d = dv(png.data);
    for (let i = 0; i < rows.length; i++) expect(d.getUint16(i * 2)).toBe(Math.round(rows[i] * 65535));
  });
  it('gray and gray+alpha colour types; clamps and NaN', async () => {
    for (const [ch, ct] of [[1, 0], [2, 4]] as const) {
      const sink = new MemorySink();
      const e = await pngFormat.create({ width: 2, height: 1, channels: ch, depth: 8, colorSpace: 'linear' }, sink);
      await e.writeRows(Float32Array.from([-1, 2, NaN, 0.5].slice(0, 2 * ch)), 1);
      await e.finish();
      const b = sink.bytes();
      expect(b[8 + 8 + 9]).toBe(ct);
      expect([...decodePng(b).data]).toEqual(ch === 1 ? [0, 255] : [0, 255, 0, 128]);
    }
  });
  it('rejects wrong row counts and unsupported depth', async () => {
    const e = await pngFormat.create({ width: 2, height: 2, channels: 1, depth: 8, colorSpace: 'linear' }, new MemorySink());
    await e.writeRows(new Float32Array(2), 1);
    await expect(e.finish()).rejects.toThrow(/1 of 2 rows/);
    await expect(pngFormat.create({ width: 2, height: 2, channels: 1, depth: 'half', colorSpace: 'linear' }, new MemorySink())).rejects.toThrow(/not supported/);
  });
});

describe('TGA encoder', () => {
  it('header, BGRA order, top-left origin, footer', async () => {
    const sink = new MemorySink();
    const e = await tgaFormat.create({ width: 2, height: 1, channels: 4, depth: 8, colorSpace: 'srgb' }, sink);
    await e.writeRows(Float32Array.from([1, 0, 0, 1, 0, 1, 0, 0.5]), 1);
    await e.finish();
    const b = sink.bytes();
    expect([b[2], b[12], b[13], b[14], b[15], b[16], b[17]]).toEqual([2, 2, 0, 1, 0, 32, 0x28]);
    expect([...b.subarray(18, 26)]).toEqual([0, 0, 255, 255, 0, 255, 0, 128]);
    expect(String.fromCharCode(...b.subarray(b.length - 18, b.length - 1))).toBe('TRUEVISION-XFILE.');
  });
});

describe('EXR encoder', () => {
  it('pre / post filter are inverse', () => {
    const raw = Uint8Array.from({ length: 1001 }, (_, i) => (i * 7 + (i >> 3)) & 255);
    expect([...exrPostFilter(exrPreFilter(raw))]).toEqual([...raw]);
  });
  function parse(b: Uint8Array): { w: number; h: number; chans: string[]; comp: number; blocks: Map<number, Uint8Array>; attrs: string[]; types: number[] } {
    const d = dv(b);
    expect([...b.subarray(0, 4)]).toEqual([0x76, 0x2f, 0x31, 0x01]);
    expect(d.getUint32(4, true)).toBe(2);
    let p = 8;
    const attrs: string[] = [];
    let w = 0, h = 0, comp = -1;
    const chans: string[] = [];
    const types: number[] = [];
    const str = (): string => {
      let s = '';
      while (b[p] !== 0) s += String.fromCharCode(b[p++]);
      p++;
      return s;
    };
    while (b[p] !== 0) {
      const name = str();
      const type = str();
      const size = d.getUint32(p, true);
      p += 4;
      attrs.push(`${name}:${type}`);
      if (name === 'dataWindow') ((w = d.getInt32(p + 8, true) + 1), (h = d.getInt32(p + 12, true) + 1));
      if (name === 'compression') comp = b[p];
      if (name === 'channels') {
        let q = p;
        while (b[q] !== 0) {
          let s = '';
          while (b[q] !== 0) s += String.fromCharCode(b[q++]);
          q++;
          types.push(d.getUint32(q, true));
          q += 16;
          chans.push(s);
        }
      }
      p += size;
    }
    p++;
    const lines = comp === 3 ? 16 : 1;
    const n = Math.ceil(h / lines);
    const offsets: number[] = [];
    for (let i = 0; i < n; i++) offsets.push(Number(d.getBigUint64(p + i * 8, true)));
    const blocks = new Map<number, Uint8Array>();
    const bytesPerLine = w * chans.length * (types[0] === 2 ? 4 : 2);
    offsets.forEach((o) => {
      const y = d.getInt32(o, true);
      const size = d.getUint32(o + 4, true);
      let data = b.subarray(o + 8, o + 8 + size);
      const raw = Math.min(lines, h - y) * bytesPerLine;
      if (size < raw) data = exrPostFilter(new Uint8Array(inflateSync(data)));
      blocks.set(y, data.slice());
    });
    return { w, h, chans, comp, blocks, attrs, types };
  }
  for (const [name, sinkFactory] of [['seekable', () => new MemorySink()], ['non-seekable (buffered)', () => new StreamSink()]] as const) {
    for (const depth of ['half', 'float'] as const) {
      for (const compression of ['zip', 'none'] as const) {
        it(`RGBA ${depth} ${compression} ${name}`, async () => {
          const W = 7, H = 37; // H not a multiple of 16: partial last block
          const rows = Float32Array.from({ length: W * H * 4 }, (_, i) => (((i * 13) % 64) - 8) / 8);
          const sink = sinkFactory() as MemorySink | StreamSink;
          const e = await exrFormat.create({ width: W, height: H, channels: 4, depth, colorSpace: 'linear' }, sink, { exrCompression: compression });
          await e.writeRows(rows.subarray(0, W * 4 * 20), 20);
          await e.writeRows(rows.subarray(W * 4 * 20), H - 20);
          await e.finish();
          const x = parse(sink.bytes());
          expect([x.w, x.h]).toEqual([W, H]);
          expect(x.chans).toEqual(['A', 'B', 'G', 'R']);
          expect(x.attrs).toContain('chromaticities:chromaticities');
          expect(x.comp).toBe(compression === 'zip' ? 3 : 0);
          // decode a few pixels
          const lines = compression === 'zip' ? 16 : 1;
          for (const [px, py] of [[0, 0], [6, 16], [3, 36]]) {
            const blk = x.blocks.get(Math.floor(py / lines) * lines)!;
            const lineInBlock = py % lines;
            const sb = depth === 'float' ? 4 : 2;
            for (let c = 0; c < 4; c++) {
              const slot = 3 - c; // A,B,G,R order: R is slot 3
              const off = (lineInBlock * 4 * W + slot * W + px) * sb;
              const v = depth === 'float' ? dv(blk).getFloat32(off, true) : halfToFloat(dv(blk).getUint16(off, true));
              expect(v).toBeCloseTo(rows[(py * W + px) * 4 + c], 6);
            }
          }
        });
      }
    }
  }
  it('gray channel is named Y', async () => {
    const sink = new MemorySink();
    const e = await exrFormat.create({ width: 2, height: 1, channels: 1, depth: 'half', colorSpace: 'linear' }, sink);
    await e.writeRows(Float32Array.from([0.5, 1]), 1);
    await e.finish();
    expect(parse(sink.bytes()).chans).toEqual(['Y']);
  });
});

describe('HDR + DDS', () => {
  it('RGBE round trip', () => {
    for (const v of [[1, 1, 1], [0.25, 0.5, 2], [100, 0.01, 3], [0, 0, 0]] as const) {
      const o = new Uint8Array(4);
      floatToRgbe(v[0], v[1], v[2], o);
      const r = rgbeToFloat(o);
      const m = Math.max(...v);
      for (let c = 0; c < 3; c++) expect(Math.abs(r[c] - v[c])).toBeLessThanOrEqual(m / 128 + 1e-6);
    }
  });
  it('file header and RLE scanline decode', async () => {
    const sink = new MemorySink();
    const W = 16, H = 2;
    const e = await hdrFormat.create({ width: W, height: H, channels: 3, depth: 'float', colorSpace: 'linear' }, sink);
    const rows = new Float32Array(W * H * 3).fill(0.5);
    for (let x = 0; x < W; x++) rows[x * 3] = x / W;
    await e.writeRows(rows, H);
    await e.finish();
    const b = sink.bytes();
    const text = new TextDecoder().decode(b.subarray(0, 80));
    expect(text.startsWith('#?RADIANCE\n')).toBe(true);
    expect(text).toContain('FORMAT=32-bit_rle_rgbe');
    expect(text).toContain(`-Y ${H} +X ${W}\n`);
    const start = text.indexOf('-Y') + `-Y ${H} +X ${W}\n`.length;
    expect([b[start], b[start + 1], b[start + 2], b[start + 3]]).toEqual([2, 2, 0, W]);
    // decode the first scanline
    let p = start + 4;
    const planes: number[][] = [[], [], [], []];
    for (let c = 0; c < 4; c++) {
      while (planes[c].length < W) {
        const n = b[p++];
        if (n > 128) {
          const v = b[p++];
          for (let k = 0; k < n - 128; k++) planes[c].push(v);
        } else for (let k = 0; k < n; k++) planes[c].push(b[p++]);
      }
    }
    for (let x = 0; x < W; x++) {
      const r = rgbeToFloat([planes[0][x], planes[1][x], planes[2][x], planes[3][x]]);
      expect(r[1]).toBeCloseTo(0.5, 2);
      expect(Math.abs(r[0] - x / W)).toBeLessThan(0.01);
    }
  });
  it('DDS DX10 header', () => {
    const h = ddsHeader({ width: 8, height: 4, channels: 4, depth: 'half', colorSpace: 'linear' });
    expect(h.length).toBe(148);
    expect(String.fromCharCode(...h.subarray(0, 4))).toBe('DDS ');
    expect(dv(h).getUint32(12, true)).toBe(4);
    expect(dv(h).getUint32(16, true)).toBe(8);
    expect(dv(h).getUint32(128, true)).toBe(10);
    expect(ddsDxgi(4, 8, true)).toBe(29);
  });
});

describe('ZIP writer', () => {
  it('stores and deflates entries, central directory + CRC verified by the reader', async () => {
    const sink = new MemorySink();
    const z = new ZipWriter({ write: (c) => sink.write(c) });
    const big = utf8('abc'.repeat(5000));
    await z.addFile('a/readme.txt', utf8('hello'), 'store');
    await z.addFile('b.json', big, 'deflate');
    const s = z.beginEntry('c.bin', 'store');
    await s.write(Uint8Array.from([1, 2, 3]));
    await s.write(Uint8Array.from([4]));
    await s.close();
    await z.finish();
    const bytes = sink.bytes();
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const files = await readZip(bytes);
    expect([...files.keys()]).toEqual(['a/readme.txt', 'b.json', 'c.bin']);
    expect(new TextDecoder().decode(files.get('a/readme.txt'))).toBe('hello');
    expect(files.get('b.json')!.length).toBe(15000);
    expect([...files.get('c.bin')!]).toEqual([1, 2, 3, 4]);
    expect(bytes.length).toBeLessThan(15000); // the deflated entry is small
  });
  it('enforces the hard cap with a clear error', async () => {
    const z = new ZipWriter({ write: async () => undefined }, 200);
    await expect(z.addFile('x.bin', new Uint8Array(500))).rejects.toThrow(/cap/i);
  });
});

describe('file naming templates', () => {
  const now = new Date(2025, 0, 9, 8, 7, 6);
  it('expands tokens with padding', () => {
    const r = expandTemplate('{graph}_{node}_{frame:4}_{w}x{h}_{date}', { graph: 'Beam', node: 'Albedo', frame: 7, w: 512, h: 256, now });
    expect(r.path).toBe('Beam_Albedo_0007_512x256_2025-01-09');
    expect(r.usesFrame).toBe(true);
    expect(expandTemplate('{time}', { graph: 'g', node: 'n', now }).path).toBe('080706');
  });
  it('reports unknown tokens and sanitises paths', () => {
    const r = expandTemplate('../C:/{bogus}/CON/{node}?*', { graph: 'g', node: 'a b' });
    expect(r.unknown).toEqual(['bogus']);
    expect(r.path).not.toContain('..');
    expect(r.path).not.toMatch(/[:?*]/);
    expect(r.path.split('/')[2]).toBe('_CON');
    expect(sanitizeSegment('...')).toBe('_');
    expect(sanitizeSegment('a<b>c')).toBe('a_b_c');
  });
  it('makes duplicates unique', () => {
    expect(uniquePaths(['a.png', 'A.png', 'a.png', 'dir/b'])).toEqual(['a.png', 'A_2.png', 'a_3.png', 'dir/b']);
  });
});

describe('pixel pipeline', () => {
  it('sRGB transfer functions', () => {
    expect(srgbEncode(0)).toBe(0);
    expect(srgbEncode(1)).toBe(1);
    expect(srgbEncode(0.18)).toBeCloseTo(0.4614, 3);
    expect(srgbDecode(srgbEncode(0.37))).toBeCloseTo(0.37, 6);
    expect(srgbEncode(NaN)).toBe(0);
  });
  it('convertPixels: gray replicate, premultiply before encode, alpha untouched by sRGB', () => {
    const o = convertPixels(Float32Array.from([0.5]), 1, { srcChannels: 1, outChannels: 4, colorSpace: 'linear', premultiply: false, clamp01: true });
    expect([...o]).toEqual([0.5, 0.5, 0.5, 1]);
    const p = convertPixels(Float32Array.from([0.5, 0.25, 1, 0.5]), 1, { srcChannels: 4, outChannels: 4, colorSpace: 'srgb', premultiply: true, clamp01: true });
    expect(p[0]).toBeCloseTo(srgbEncode(0.25), 6);
    expect(p[3]).toBe(0.5);
    const rg = convertPixels(Float32Array.from([0.1, 0.2, 0.3, 0.4]), 1, { srcChannels: 4, outChannels: 2, colorSpace: 'linear', premultiply: false, clamp01: false });
    expect([...rg].map((v) => +v.toFixed(2))).toEqual([0.1, 0.2]);
  });
  it('channel packing: source select, levels, invert', () => {
    const px = [0.2, 0.4, 0.6, 0.8];
    expect(packChannel(px, defaultSlot('g'))).toBeCloseTo(0.4);
    expect(packChannel(px, defaultSlot('a'))).toBeCloseTo(0.8);
    expect(packChannel(px, { ...defaultSlot('b'), invert: true })).toBeCloseTo(0.4);
    expect(packChannel(px, { ...defaultSlot('r'), black: 0.2, white: 0.6 })).toBeCloseTo(0);
    expect(packChannel(px, { ...defaultSlot('g'), black: 0.2, white: 0.6 })).toBeCloseTo(0.5);
    expect(packChannel(px, { ...defaultSlot('g'), gamma: 2 })).toBeCloseTo(Math.sqrt(0.4));
    expect(packChannel(px, defaultSlot('zero'))).toBe(0);
    expect(packChannel(px, defaultSlot('one'))).toBe(1);
    expect(packChannel([1, 0, 0, 1], defaultSlot('luma'))).toBeCloseTo(0.2126);
  });
  it('normal export: DirectX flips green, reconstruct and rg layouts', () => {
    const n = (x: number, y: number, z: number): [number, number, number] => [x * 0.5 + 0.5, y * 0.5 + 0.5, z * 0.5 + 0.5];
    const gl = exportNormal(n(0.6, 0.0, 0.8), 'opengl', 'xyz');
    const dx = exportNormal(n(0.6, 0.0, 0.8), 'directx', 'xyz');
    expect(gl[0]).toBeCloseTo(dx[0]);
    expect(dx[1]).toBeCloseTo(0.5);
    const up = exportNormal(n(0, 0.6, 0.8), 'directx', 'xyz');
    expect(up[1]).toBeCloseTo(0.5 - 0.3);
    const rec = exportNormal(n(0.6, 0, 0.1), 'opengl', 'reconstruct'); // wrong z gets rebuilt: sqrt(1 - .36) = .8
    expect(rec[2]).toBeCloseTo(0.9, 5);
    expect(exportNormal(n(0.6, 0, 0.8), 'opengl', 'rg')[2]).toBe(0);
  });
  it('EdgePadder streaming == one-shot dilation, alpha preserved', async () => {
    const W = 13, H = 50, R = 3;
    const px = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const solid = (x - 6) ** 2 + (y - 25) ** 2 < 30 || (x === 2 && y === 5);
      px.set(solid ? [0.2 + (x % 3) * 0.1, 0.5, 0.9, 1] : [0, 0, 0, 0], (y * W + x) * 4);
    }
    const run = async (band: number, chunk: number): Promise<Float32Array> => {
      const pad = new EdgePadder(W, H, R, 0.001, band);
      const out: Float32Array[] = [];
      const emit = async (r: Float32Array, n: number): Promise<void> => void (n && out.push(r.slice(0, n * W * 4)));
      for (let y = 0; y < H; y += chunk) await pad.push(px.subarray(y * W * 4, Math.min(H, y + chunk) * W * 4), Math.min(chunk, H - y), emit);
      await pad.flush(emit);
      return concatF(out);
    };
    const concatF = (a: Float32Array[]): Float32Array => {
      const o = new Float32Array(a.reduce((n, x) => n + x.length, 0));
      let p = 0;
      for (const x of a) (o.set(x, p), (p += x.length));
      return o;
    };
    const whole = await run(10_000, H);
    const streamed = await run(7, 5);
    expect(streamed.length).toBe(W * H * 4);
    expect([...streamed]).toEqual([...whole]);
    for (let i = 0; i < W * H; i++) expect(whole[i * 4 + 3]).toBe(px[i * 4 + 3]);
    // a pixel next to the disc got colour, a far pixel did not
    expect(whole[(25 * W + 12) * 4 + 2]).toBeGreaterThan(0.5);
    expect(whole[(0 * W + 12) * 4 + 2]).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------------ settings */
describe('settings / validation / estimates', () => {
  const g = { ...defaultGraphSettings(), width: 1024, height: 512, loopLength: 16 };
  it('resolves engine defaults and coerces invalid depth', () => {
    const s = resolveImageSettings('color', { format: 'png', depth: 'half', engine: 'unreal' }, g);
    expect(s.depth).toBe(16);
    expect(s.notes.join(' ')).toMatch(/cannot store/);
    expect(s.colorSpace).toBe('srgb');
    const n = resolveImageSettings('normal', { convention: 'engine', engine: 'unreal' }, g);
    expect(n.normalConvention).toBe('directx');
    expect(resolveImageSettings('normal', { convention: 'engine', engine: 'unity' }, g).normalConvention).toBe('opengl');
    expect(resolveImageSettings('normal', { convention: 'opengl', engine: 'unreal' }, g).normalConvention).toBe('opengl');
    expect(resolveImageSettings('mask', { format: 'exr', depth: '8' }, g).depth).toBe('half');
    expect(resolveImageSettings('color', { format: 'exr', color_space: 'srgb', depth: 'float' }, g).colorSpace).toBe('linear');
    expect(resolveImageSettings('mask', {}, g).channels).toBe(1);
    expect(resolveImageSettings('color', { format: 'hdr', depth: 'float' }, g).channels).toBe(3);
  });
  it('size modes and flipbook grid', () => {
    expect(resolveImageSettings('color', { size_mode: 'multiplier', size_mul: [2, 0.5] }, g)).toMatchObject({ width: 2048, height: 256 });
    expect(resolveImageSettings('color', { size_mode: 'absolute', size_abs: [1000, 333] }, g)).toMatchObject({ width: 1000, height: 333 });
    const f = resolveImageSettings('color', { frame_mode: 'flipbook', frame_count: 16, size_mode: 'absolute', size_abs: [2048, 2048] }, g);
    expect(f.fbCols * f.fbRows).toBeGreaterThanOrEqual(16);
    expect(f.frameCount).toBe(16);
    expect(resolveImageSettings('color', { frame_mode: 'sequence' }, g).frameCount).toBe(16);
  });
  const env = { maxDim: 8192, budgetBytes: 2 * 1024 ** 3, hq: false, graphTiling: 'none' as const, hasInput: true, graphBitDepth: 16 as const };
  it('validation warnings', () => {
    const s = resolveImageSettings('color', { engine: 'unreal', size_mode: 'absolute', size_abs: [1000, 1000] }, g);
    const msgs = validateImageSettings(s, { ...env, sourcePin: 'gray' }).map((i) => i.message).join('\n');
    expect(msgs).toMatch(/power of two/);
    expect(msgs).toMatch(/no alpha/);
    expect(msgs).toMatch(/tiling is off/);
    expect(validateImageSettings(s, { ...env, hasInput: false }).some((i) => i.level === 'error')).toBe(true);
    const bad = resolveImageSettings('color', { frame_mode: 'flipbook', frame_count: 16, fb_cols: 2, fb_rows: 2 }, g);
    expect(validateImageSettings(bad, env).some((i) => i.level === 'error' && /do not fit/.test(i.message))).toBe(true);
  });
  it('tiling plan: 4096² fits, 16K tiles and stays inside the budget', () => {
    const e = { maxDim: 8192, budgetBytes: 1024 ** 3, hq: false };
    expect(planTiling(1024, 1024, e).tiled).toBe(false);
    const t = planTiling(16384, 16384, e);
    expect(t.tiled).toBe(true);
    expect(t.tileSize * t.tileSize * 8 * 6).toBeLessThanOrEqual(e.budgetBytes * 0.25);
    const s = resolveImageSettings('color', { size_mode: 'absolute', size_abs: [4096, 4096], format: 'exr', depth: 'half' }, g);
    const est = estimateImageJob(s, { maxDim: 16384, budgetBytes: 1024 ** 3, hq: false });
    expect(est.gpuBytes + est.cpuBytes).toBeLessThan(1024 ** 3);
  });
  it('engine presets', () => {
    expect(ENGINE_PRESETS.unreal.normal).toBe('directx');
    expect(ENGINE_PRESETS.unity.warpFlipY).toBe(true);
    expect(matDet3(AXIS_MATRICES.gltf)).toBe(1);
    expect(matDet3(AXIS_MATRICES.unity)).toBe(-1);
    expect(matDet3(AXIS_MATRICES.unreal)).toBe(-1);
  });
});

/* ------------------------------------------------------------------------------------------------ meshes */
function quadMesh(): MeshData {
  const P = Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const m = MeshData.fromPositions(P, new Topology(Uint32Array.from([0, 1, 2, 3]), Uint32Array.from([0, 4])));
  m.setAttr({ name: 'uv', element: 'vertex', size: 2, kind: 'f32', data: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]) });
  m.setAttr({ name: 'Cd', element: 'point', size: 4, kind: 'f32', data: Float32Array.from([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 0.5]) });
  m.setAttr({ name: 'pscale', element: 'point', size: 1, kind: 'f32', data: Float32Array.from([1, 2, 3, 4]) });
  return m;
}

describe('mesh export', () => {
  it('builds an indexed triangle mesh; mirrored axis flips winding', () => {
    const a = buildExportMesh(quadMesh(), { axis: 'zup', scale: 1, normals: true, custom: true });
    expect(a.vertexCount).toBe(4);
    expect([...a.indices]).toEqual([0, 1, 2, 0, 2, 3]);
    expect(a.custom.map((c) => c.name)).toEqual(['pscale']);
    expect(a.normals).not.toBeNull();
    const u = buildExportMesh(quadMesh(), { axis: 'unity', scale: 1, normals: true, custom: false });
    expect([...u.indices]).toEqual([0, 2, 1, 0, 3, 2]);
    expect([...u.positions.subarray(6, 9)]).toEqual([1, 0, 1]); // (1,1,0) -> (x, z, y) = (1, 0, 1)
    const g = buildExportMesh(quadMesh(), { axis: 'gltf', scale: 100, normals: false, custom: false });
    expect([...g.positions.subarray(3, 6)].map((v) => v + 0)).toEqual([100, 0, 0]);
    expect([...g.positions.subarray(6, 9)].map((v) => v + 0)).toEqual([100, 0, -100]);
    expect(() => buildExportMesh(MeshData.fromPositions(new Float32Array(9)), { axis: 'zup', scale: 1, normals: false, custom: false })).toThrow(/no faces/);
  });
  it('GLB container: header, chunks, accessors, flipped v, custom attributes', () => {
    const m = buildExportMesh(quadMesh(), { axis: 'gltf', scale: 1, normals: true, custom: true });
    const glb = toGlb(buildGltf(m, { name: 'Quad' }));
    const d = dv(glb);
    expect(d.getUint32(0, true)).toBe(0x46546c67);
    expect(d.getUint32(4, true)).toBe(2);
    expect(d.getUint32(8, true)).toBe(glb.length);
    expect(glb.length % 4).toBe(0);
    const jlen = d.getUint32(12, true);
    expect(d.getUint32(16, true)).toBe(0x4e4f534a);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jlen)));
    const blen = d.getUint32(20 + jlen, true);
    expect(d.getUint32(24 + jlen, true)).toBe(0x004e4942);
    expect(json.buffers[0].byteLength).toBe(blen);
    const prim = json.meshes[0].primitives[0];
    expect(Object.keys(prim.attributes)).toEqual(['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0', '_PSCALE']);
    expect(json.accessors[prim.attributes.POSITION]).toMatchObject({ count: 4, type: 'VEC3', min: [0, 0, -1], max: [1, 0, 0] });
    expect(json.accessors[prim.indices]).toMatchObject({ count: 6, componentType: 5123 });
    const bin = glb.subarray(28 + jlen);
    const uvView = json.bufferViews[json.accessors[prim.attributes.TEXCOORD_0].bufferView];
    expect(dv(bin).getFloat32(uvView.byteOffset + 4 * 3, true)).toBe(1); // vertex 1... (v of vertex 1 = 1 - 0)
    for (const v of json.bufferViews) expect(v.byteOffset % 4).toBe(0);
    expect(json.meshes[0].extras.kekenik.customAttributes[0]).toMatchObject({ name: 'pscale', gltf: '_PSCALE' });
  });
  it('OBJ and PLY', () => {
    const m = buildExportMesh(quadMesh(), { axis: 'zup', scale: 1, normals: true, custom: true });
    const obj = new TextDecoder().decode(concatBytes(buildObj(m, { name: 'Quad' })));
    expect(obj.match(/^v /gm)!.length).toBe(4);
    expect(obj.match(/^vt /gm)!.length).toBe(4);
    expect(obj.match(/^vn /gm)!.length).toBe(4);
    expect(obj).toContain('f 1/1/1 2/2/2 3/3/3');
    const ply = buildPly(m, { name: 'Quad' });
    const head = new TextDecoder().decode(ply.subarray(0, 900));
    expect(head).toContain('element vertex 4');
    expect(head).toContain('element face 2');
    expect(head).toContain('property float pscale');
    expect(head).toContain('property uchar alpha');
    const end = head.indexOf('end_header\n') + 11;
    const stride = 12 + 12 + 8 + 4 + 4;
    expect(ply.length).toBe(end + 4 * stride + 2 * 13);
  });
  it('mesh flipbook merges frames with frame attributes and index offsets', () => {
    const a = buildExportMesh(quadMesh(), { axis: 'zup', scale: 1, normals: true, custom: false });
    const { mesh, ranges } = mergeFrames([a, a, a]);
    expect(mesh.vertexCount).toBe(12);
    expect(mesh.indices.length).toBe(18);
    expect(ranges[2]).toEqual({ frame: 2, firstVertex: 8, vertexCount: 4, firstIndex: 12, indexCount: 6 });
    expect(mesh.indices[12]).toBe(8);
    expect(mesh.custom.find((c) => c.name === 'frame')!.data[9]).toBe(2);
    expect(mesh.uvSets[mesh.uvSets.length - 1].data[8 * 2]).toBeCloseTo(2.5 / 3);
  });
  it('pivot encodings', () => {
    const e = buildExportMesh(quadMesh(), { axis: 'zup', scale: 1, normals: false, custom: false });
    e.custom.push({ name: 'pivot', size: 3, data: Float32Array.from([0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2]), source: 'point' }, { name: 'id', size: 1, data: Float32Array.from([0, 0, 1, 1]), source: 'point' });
    const info = encodePivots(e, 'vertex_color');
    expect(info.pieces).toBe(2);
    expect([...e.colors!.subarray(8, 11)]).toEqual([1, 1, 1]);
    expect(e.custom.map((c) => c.name)).toContain('rand_id');
    const f = buildExportMesh(quadMesh(), { axis: 'zup', scale: 1, normals: false, custom: false });
    expect(() => encodePivots(f, 'uv')).toThrow(/pivot/);
  });
});

describe('VAT', () => {
  const F = 5, N = 3;
  const positions = new Float32Array(F * N * 3);
  const normals = new Float32Array(F * N * 3);
  for (let f = 0; f < F; f++) for (let i = 0; i < N; i++) {
    positions.set([i + f * 0.5, -2 + f, 10 * (i - 1)], (f * N + i) * 3);
    normals.set([0, 0, 1], (f * N + i) * 3);
  }
  it('bounds are exact and degenerate ranges are widened', () => {
    const b = vec3Bounds(positions);
    expect(b.min).toEqual([0, -2, -10]);
    expect(b.max).toEqual([4, 2, 10]);
    const flat = vec3Bounds(Float32Array.from([1, 1, 1, 1, 1, 1]));
    expect(flat.max[0] - flat.min[0]).toBeGreaterThan(0);
  });
  for (const offset of [false, true]) {
    for (const normalize of [true, false]) {
      it(`soft rows decode back to the positions (normalize=${normalize}, offset=${offset})`, () => {
        const src = { frames: F, rows: N, positions, normals };
        const enc = { normalize, offset };
        const bounds = softBounds(src, offset);
        const { pos, nrm } = softVatRows(src, 1, 2, enc, bounds); // rows 1..2
        for (let r = 0; r < 2; r++) for (let f = 0; f < F; f++) {
          const t = pos.subarray((r * F + f) * 4, (r * F + f) * 4 + 4);
          if (normalize) for (let c = 0; c < 3; c++) (expect(t[c]).toBeGreaterThanOrEqual(-1e-6), expect(t[c]).toBeLessThanOrEqual(1 + 1e-6));
          const rest: [number, number, number] = [positions[(1 + r) * 3], positions[(1 + r) * 3 + 1], positions[(1 + r) * 3 + 2]];
          const p = softVatDecode(t, bounds, enc, rest);
          for (let c = 0; c < 3; c++) expect(p[c]).toBeCloseTo(positions[(f * N + 1 + r) * 3 + c], 4);
        }
        expect(nrm![2]).toBe(1);
        expect(nrm![0]).toBe(normalize ? 0.5 : 0);
      });
    }
  }
  it('row UV addresses the texel centre', () => {
    const [u, v] = vatRowUv(2, 8, 10);
    expect(u).toBeCloseTo(0.05);
    expect(1 - v).toBeCloseTo(2.5 / 8);
  });
  it('rigid fit recovers rotation + translation; VAT reconstruct matches', () => {
    const pts = Float32Array.from([1, 0, 0, 0, 2, 0, 0, 0, 3, -1, -1, 0.5, 0.3, 0.2, -2]);
    const ang = 0.7;
    const q: [number, number, number, number] = [0, 0, Math.sin(ang / 2), Math.cos(ang / 2)];
    const cur = new Float32Array(pts.length);
    for (let i = 0; i < pts.length / 3; i++) {
      const r = quatRotate(q, [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]);
      cur.set([r[0] + 5, r[1] - 1, r[2] + 2], i * 3);
    }
    const fit = fitRigid(pts, cur);
    expect(Math.abs(fit.q[2] * q[2] + fit.q[3] * q[3])).toBeCloseTo(1, 5);
    const pivot: [number, number, number] = [0.5, 0.5, 0.5];
    const vat = buildRigidVat([pts], [[pts], [cur]], [pivot]);
    expect(vat.displacement.slice(0, 3).every((v) => Math.abs(v) < 1e-5)).toBe(true); // frame 0 is identity
    const qf = [...vat.rotation.slice(4, 8)] as [number, number, number, number];
    for (let i = 0; i < pts.length / 3; i++) {
      const rel = quatRotate(qf, [pts[i * 3] - pivot[0], pts[i * 3 + 1] - pivot[1], pts[i * 3 + 2] - pivot[2]]);
      for (let c = 0; c < 3; c++) expect(pivot[c] + vat.displacement[3 + c] + rel[c]).toBeCloseTo(cur[i * 3 + c], 4);
    }
    const bounds = vec3Bounds(vat.displacement);
    const rows = rigidVatRows(vat, 0, 1, true, bounds);
    expect(rows.rot[1 * 4 + 3]).toBeGreaterThanOrEqual(0.5 - 1e-6); // w >= 0 -> encoded >= 0.5
  });
  it('metadata JSON carries bounds, frames and uv channel', () => {
    const meta = vatMetadata({ type: 'soft', frames: 5, rows: 3, fps: 30, bounds: vec3Bounds(positions), normalize: true, offset: false, uvChannel: 1, uvName: 'uv1', axis: 'gltf', scale: 1, files: { position: 'a.exr' }, depth: 'half', vertexCount: 3, loop: true });
    expect(meta).toMatchObject({ format: 'kekenik-vat', frames: 5, fps: 30, vertexCount: 3, textureSize: [5, 3], uv: { channel: 1 } });
    expect(JSON.parse(JSON.stringify(meta)).bounds.max).toEqual([4, 2, 10]);
  });
});
