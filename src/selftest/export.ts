import type { Engine } from '../engine/engine';
import { exrPostFilter } from '../export/encoders/exr';
import { concatBytes } from '../export/bytes';
import { halfToFloat } from '../engine/resources/half';
import { JobGate, type JobEnv } from '../export/job-env';
import { runImageJob } from '../export/image-job';
import { runMeshJob } from '../export/mesh-job';
import { defaultSlot, exportNormal, packChannel, PACK_SOURCES } from '../export/pixels';
import { DownloadTarget, MemoryTarget, type ExportTarget } from '../export/targets';
import { readZip } from '../export/zip';
import type { Graph } from '../engine/graph/graph';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/**
 * GPU tests for image and mesh export. Names start with `6B ·`.
 *  - every Export node evaluates (shader compile) and the GPU transforms match their CPU references (multimask, normal, warp),
 *  - end-to-end round trips: render -> export job -> decode the produced PNG / EXR -> compare with a direct read-back,
 *  - tiled export == untiled export, flipbook cells == direct renders, GLB / VAT structure, ZIP delivery,
 *  - a 4096x4096 export keeps the engine memory inside the budget (polled every 15 ms while the job runs).
 */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter();
  void w.write(data as Uint8Array<ArrayBuffer>).then(() => w.close());
  const out: Uint8Array[] = [];
  const r = ds.readable.getReader();
  for (;;) {
    const { value, done } = await r.read();
    if (done) break;
    out.push(value as Uint8Array);
  }
  return concatBytes(out);
}
const dv = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Decode PNG (8 / 16 bit, any colour type, all filters) into floats 0..1. */
export async function decodePngFloats(b: Uint8Array): Promise<{ w: number; h: number; ch: number; data: Float32Array }> {
  const d = dv(b);
  let p = 8;
  let w = 0, h = 0, bits = 8, ct = 0;
  const idat: Uint8Array[] = [];
  for (;;) {
    const len = d.getUint32(p);
    const type = String.fromCharCode(...b.subarray(p + 4, p + 8));
    if (type === 'IHDR') ((w = d.getUint32(p + 8)), (h = d.getUint32(p + 12)), (bits = b[p + 16]), (ct = b[p + 17]));
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
    if (type === 'IEND') break;
  }
  const ch = ({ 0: 1, 4: 2, 2: 3, 6: 4 } as Record<number, number>)[ct];
  const raw = await inflate(concatBytes(idat));
  const bpp = (ch * bits) / 8;
  const stride = w * bpp;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + up;
      else if (f === 3) r = v + ((a + up) >> 1);
      else if (f === 4) {
        const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      }
      px[y * stride + x] = r & 255;
    }
  }
  const data = new Float32Array(w * h * ch);
  const pd = dv(px);
  for (let i = 0; i < data.length; i++) data[i] = bits === 16 ? pd.getUint16(i * 2) / 65535 : px[i] / 255;
  return { w, h, ch, data };
}

/** Decode a half / float scanline EXR written by our encoder into floats in R,G,B,(A) order. */
export async function decodeExrFloats(b: Uint8Array): Promise<{ w: number; h: number; ch: number; data: Float32Array }> {
  const d = dv(b);
  let p = 8;
  let w = 0, h = 0, comp = 0;
  const names: string[] = [];
  let ptype = 1;
  const str = (): string => {
    let s = '';
    while (b[p] !== 0) s += String.fromCharCode(b[p++]);
    p++;
    return s;
  };
  while (b[p] !== 0) {
    const name = str();
    str();
    const size = d.getUint32(p, true);
    p += 4;
    if (name === 'dataWindow') ((w = d.getInt32(p + 8, true) + 1), (h = d.getInt32(p + 12, true) + 1));
    if (name === 'compression') comp = b[p];
    if (name === 'channels') {
      let q = p;
      while (b[q] !== 0) {
        let s = '';
        while (b[q] !== 0) s += String.fromCharCode(b[q++]);
        q++;
        ptype = d.getUint32(q, true);
        q += 16;
        names.push(s);
      }
    }
    p += size;
  }
  p++;
  const lines = comp === 3 ? 16 : 1;
  const nBlocks = Math.ceil(h / lines);
  const ch = names.length;
  const sb = ptype === 2 ? 4 : 2;
  const out = new Float32Array(w * h * ch);
  const order = names.map((n, i) => ({ n, i })).sort((a, c) => (a.n < c.n ? -1 : 1)); // stored order -> source channel index
  for (let k = 0; k < nBlocks; k++) {
    const off = Number(d.getBigUint64(p + k * 8, true));
    const y0 = d.getInt32(off, true);
    const size = d.getUint32(off + 4, true);
    const rows = Math.min(lines, h - y0);
    let data = b.subarray(off + 8, off + 8 + size);
    if (size < rows * w * ch * sb) data = exrPostFilter(await inflate(data));
    const bd = dv(data);
    for (let r = 0; r < rows; r++) for (let s = 0; s < ch; s++) for (let x = 0; x < w; x++) {
      const o = (r * ch * w + s * w + x) * sb;
      const v = ptype === 2 ? bd.getFloat32(o, true) : halfToFloat(bd.getUint16(o, true));
      out[((y0 + r) * w + x) * ch + order[s].i] = v;
    }
  }
  return { w, h, ch, data: out };
}

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

/** Target that only counts bytes (huge exports must not be kept in memory). */
class CountingTarget implements ExportTarget {
  readonly kind = 'memory' as const;
  readonly label = 'counting';
  readonly files: { path: string; bytes: number }[] = [];
  capBytes = Infinity;
  async openFile(path: string) {
    const rec = { path, bytes: 0 };
    this.files.push(rec);
    return {
      canSeek: true,
      get position() {
        return rec.bytes;
      },
      async write(c: Uint8Array) {
        rec.bytes += c.length;
      },
      async writeAt() {},
      async close() {},
    };
  }
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const s = await this.openFile(path);
    await s.write(typeof data === 'string' ? new TextEncoder().encode(data) : data);
  }
  async finish() {
    return 'counted';
  }
  async abort() {}
}

/** Shared by every self-test that runs export jobs (6B + 7B stress): deterministic date, silent log, no progress UI. */
export const selfTestJobEnv = (e: Engine, g: Graph, target: ExportTarget): JobEnv => ({ engine: e, graph: g, graphName: 'selftest', target, gate: new JobGate(), onProgress: () => undefined, log: () => undefined, now: new Date(2025, 0, 1) });

export function exportTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link, read } = h;
  const settings = { tiling: 'both' as const, fps: 30, loopLength: 4 };
  const envOf = selfTestJobEnv;

  return [
    {
      name: '6B · every Export node compiles and evaluates (color, mask, multimask, normal, warp, viewport)',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 32, settings);
          const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4] });
          const nrm = add(g, 'normal.create', {});
          link(g, n, nrm, 'input');
          const uv = add(g, 'uv.noise', {});
          const results: string[] = [];
          const cases: [string, string, string, string][] = [['export.color', 'input', n, 'output'], ['export.mask', 'input', n, 'output'], ['export.multimask', 'r', n, 'output'], ['export.normal', 'input', nrm, 'output'], ['export.warp', 'input', uv, 'output'], ['export.viewport', 'color', n, 'output']];
          for (const [type, pin, src, outPin] of cases) {
            const id = add(g, type, {});
            link(g, src, id, pin, outPin);
            const r = await read(e, g, id, { useCache: false });
            if (!r.data.every((v) => Number.isFinite(v))) throw new Error(`${type}: non-finite output`);
            results.push(`${type.slice(7)} ${r.w}×${r.h}/${r.ch}`);
          }
          return results.join(', ');
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6B · Multimask GPU == CPU packChannel (sources, levels, invert)',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 32, settings);
          const a = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [3, 3], seed: 1 });
          const b = add(g, 'grayscale.gradient', {});
          const m = add(g, 'export.multimask', { r_source: 'r', g_source: 'luma', b_source: 'r', a_source: 'one', b_invert: true, g_black: 0.2, g_white: 0.8, g_gamma: 1.4 });
          link(g, a, m, 'r');
          link(g, b, m, 'g');
          link(g, a, m, 'b');
          const ra = (await read(e, g, a, { useCache: false })).data;
          const rb = (await read(e, g, b, { useCache: false })).data;
          const out = await read(e, g, m, { useCache: false });
          let worst = 0;
          for (let i = 0; i < 32 * 32; i++) {
            const A = [ra[i], ra[i], ra[i], 1], B = [rb[i], rb[i], rb[i], 1];
            const exp = [packChannel(A, defaultSlot('r')), packChannel(B, { ...defaultSlot('luma'), black: 0.2, white: 0.8, gamma: 1.4 }), packChannel(A, { ...defaultSlot('r'), invert: true }), 1];
            for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(out.data[i * 4 + c] - exp[c]));
          }
          if (worst > 3e-3) throw new Error(`GPU / CPU packing differ by ${worst}`);
          void PACK_SOURCES;
          return `max error ${worst.toExponential(2)}`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6B · Export Normal GPU == CPU reference (OpenGL / DirectX, reconstruct, RG)',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 32, settings);
          const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4] });
          const nrm = add(g, 'normal.create', { strength: 2 });
          link(g, n, nrm, 'input');
          const src = (await read(e, g, nrm, { useCache: false })).data;
          let worst = 0;
          let flipped = 0;
          for (const [conv, layout] of [['opengl', 'xyz'], ['directx', 'xyz'], ['directx', 'reconstruct'], ['opengl', 'rg']] as const) {
            const x = add(g, 'export.normal', { convention: conv, normal_layout: layout });
            link(g, nrm, x, 'input');
            const out = (await read(e, g, x, { useCache: false })).data;
            for (let i = 0; i < 32 * 32; i++) {
              const ex = exportNormal([src[i * 4], src[i * 4 + 1], src[i * 4 + 2]], conv, layout);
              for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(out[i * 4 + c] - ex[c]));
              if (conv === 'directx' && layout === 'xyz') flipped = Math.max(flipped, Math.abs(out[i * 4 + 1] - (1 - src[i * 4 + 1])));
            }
          }
          if (worst > 6e-3) throw new Error(`GPU / CPU normal export differ by ${worst}`);
          if (flipped > 8e-3) throw new Error(`DirectX green is not the inverse of the source (${flipped})`);
          return `max error ${worst.toExponential(2)}; DirectX Y = 1 - Y within ${flipped.toExponential(2)}`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6B · Export Warp: identity field with the biased codec is neutral (0.5)',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 32, settings);
          const uv = add(g, 'uv.identity', {});
          const w = add(g, 'export.warp', { codec: 'biased', range: 0.1 });
          link(g, uv, w, 'input');
          const out = (await read(e, g, w, { useCache: false })).data;
          let worst = 0;
          for (let i = 0; i < 32 * 32; i++) for (let c = 0; c < 2; c++) worst = Math.max(worst, Math.abs(out[i * 4 + c] - 0.5));
          if (worst > 2e-3) throw new Error(`identity is not neutral: ${worst}`);
          return `neutral within ${worst.toExponential(2)}`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6B · PNG 16-bit export round trip: decode(file) == read-back (within 1 LSB of 16 bit)',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 96, settings);
          const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [5, 5], octaves: 3 });
          const x = add(g, 'export.mask', { format: 'png', depth: '16', file_name: 'rt' });
          link(g, n, x, 'input');
          const t = new MemoryTarget();
          await runImageJob(envOf(e, g, t), x);
          const png = await decodePngFloats(t.bytesOf('rt.png'));
          const ref = (await read(e, g, x, { useCache: false })).data;
          if (png.w !== 96 || png.h !== 96 || png.ch !== 1) throw new Error(`decoded ${png.w}×${png.h}/${png.ch}`);
          const d = maxDiff(png.data, ref);
          if (d > 1.1 / 65535) throw new Error(`file differs from the read-back by ${d}`);
          return `max difference ${(d * 65535).toFixed(2)} LSB (16 bit)`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6B · EXR half export round trip (ZIP): decode(file) == read-back exactly',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 80, settings);
          const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [5, 5] });
          const x = add(g, 'export.color', { format: 'exr', depth: 'half', file_name: 'rt', alpha: true });
          link(g, n, x, 'input');
          const t = new MemoryTarget();
          await runImageJob(envOf(e, g, t), x);
          const exr = await decodeExrFloats(t.bytesOf('rt.exr'));
          const ref = (await read(e, g, x, { useCache: false })).data;
          if (exr.w !== 80 || exr.h !== 80 || exr.ch !== 4) throw new Error(`decoded ${exr.w}×${exr.h}/${exr.ch}`);
          const d = maxDiff(exr.data, ref);
          if (d > 1e-6) throw new Error(`EXR differs from the read-back by ${d}`);
          return `exact (max ${d.toExponential(1)}), ${t.bytesOf('rt.exr').length} bytes`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6B · tiled export (small memory budget) == untiled export',
      async run(env) {
        const run = async (budgetMB: number): Promise<{ data: Float32Array; tiled: boolean }> => {
          const e = engineOf(env, budgetMB * 1024 * 1024);
          try {
            const g = mk(e, 512, settings);
            const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [6, 6], octaves: 3 });
            const x = add(g, 'export.mask', { format: 'png', depth: '16', file_name: 'rt' });
            link(g, n, x, 'input');
            const t = new MemoryTarget();
            const logs: string[] = [];
            const jobEnv = envOf(e, g, t);
            jobEnv.log = (_l, m) => logs.push(m);
            await runImageJob(jobEnv, x);
            return { data: (await decodePngFloats(t.bytesOf('rt.png'))).data, tiled: logs.some((l) => /tiled/.test(l)) };
          } finally {
            dispose(e);
          }
        };
        const full = await run(1024);
        const tiled = await run(16);
        if (full.tiled) throw new Error('the large budget run was tiled');
        if (!tiled.tiled) throw new Error('the 16 MB budget run was NOT tiled');
        const d = maxDiff(full.data, tiled.data);
        if (d > 2 / 65535) throw new Error(`tiled and untiled differ by ${d}`);
        return `identical within ${(d * 65535).toFixed(2)} LSB`;
      },
    },
    {
      name: '6B · flipbook export: every cell equals a direct render of that frame; JSON written',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 64, settings);
          const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4], octaves: 2, z_cells: 2 });
          const def = e.registry.expanded('grayscale.noise')!.params.find((p) => p.id === 'evolution')!;
          const { setTrackKey } = await import('../engine/anim/tracks');
          let tr = setTrackKey(undefined, def, 0, 0);
          tr = setTrackKey(tr, def, 4, 1);
          g.setNodeTrack(n, 'evolution', tr);
          const x = add(g, 'export.mask', { format: 'png', depth: '16', file_name: 'fb', frame_mode: 'flipbook', frame_count: 4, fb_cols: 2, fb_rows: 2, size_mode: 'absolute', size_abs: [64, 64] });
          link(g, n, x, 'input');
          const t = new MemoryTarget();
          await runImageJob(envOf(e, g, t), x);
          const png = await decodePngFloats(t.bytesOf('fb.png'));
          if (png.w !== 64 || png.h !== 64) throw new Error(`sheet ${png.w}×${png.h}`);
          const g32 = mk(e, 32, settings);
          const n32 = add(g32, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4], octaves: 2, z_cells: 2 });
          g32.setNodeTrack(n32, 'evolution', tr);
          let worst = 0;
          for (let i = 0; i < 4; i++) {
            const ref = (await read(e, g32, n32, { time: i / 30, useCache: false })).data;
            const ox = (i % 2) * 32, oy = Math.floor(i / 2) * 32;
            for (let y = 0; y < 32; y++) for (let xx = 0; xx < 32; xx++) worst = Math.max(worst, Math.abs(png.data[(oy + y) * 64 + ox + xx] - ref[y * 32 + xx]));
          }
          if (worst > 3e-3) throw new Error(`a cell differs from its direct render by ${worst}`);
          const json = JSON.parse(new TextDecoder().decode(t.bytesOf('fb.flipbook.json')));
          if (json.frames !== 4 || json.grid.join() !== '2,2') throw new Error('flipbook JSON is wrong');
          return `max cell difference ${worst.toExponential(2)}; JSON ok (${json.uvRects.length} uv rects)`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6B · Mesh export: GLB beam, VAT soft body (EXR + JSON)',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 32, settings);
          const sweep = add(g, 'geometry.sweep', { profile: 'ribbon', width: 0.3, segments: 16 });
          const glb = add(g, 'export.mesh', { mode: 'mesh', mesh_format: 'glb', file_name: 'beam' });
          link(g, sweep, glb, 'input');
          const t = new MemoryTarget();
          await runMeshJob(envOf(e, g, t), glb);
          const b = t.bytesOf('beam.glb');
          const d = dv(b);
          if (d.getUint32(0, true) !== 0x46546c67 || d.getUint32(8, true) !== b.length) throw new Error('not a valid GLB container');
          const json = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + d.getUint32(12, true))));
          const pos = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
          if (!(pos.count > 4)) throw new Error('no vertices');
          const noise = add(g, 'geometry.noise', { animate: true, loop: true, amplitude: 0.2 });
          link(g, sweep, noise, 'input');
          const vat = add(g, 'export.mesh', { mode: 'vat_soft', mesh_format: 'glb', vat_format: 'exr_half', frame_count: 4, file_name: 'vat' });
          link(g, noise, vat, 'input');
          const t2 = new MemoryTarget();
          await runMeshJob(envOf(e, g, t2), vat);
          const meta = JSON.parse(new TextDecoder().decode(t2.bytesOf('vat.vat.json')));
          const posTex = await decodeExrFloats(t2.bytesOf('vat_pos.exr'));
          if (meta.frames !== 4 || posTex.w !== 4 || posTex.h !== meta.vertexCount) throw new Error(`VAT texture ${posTex.w}×${posTex.h} vs meta ${meta.frames}×${meta.vertexCount}`);
          return `GLB ${b.length} bytes, ${pos.count} vertices; VAT ${posTex.w}×${posTex.h}, bounds ${JSON.stringify(meta.bounds.min.map((v: number) => +v.toFixed(2)))}…`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6B · download target: single file passes through, several files become a valid ZIP',
      async run() {
        const got: { name: string; blob: Blob }[] = [];
        const deliver = (blob: Blob, name: string): void => void got.push({ name, blob });
        const one = new DownloadTarget('x', 1, 1 << 20, deliver);
        await one.writeFile('a.txt', 'hello');
        await one.finish();
        if (got[0].name !== 'a.txt' || (await got[0].blob.text()) !== 'hello') throw new Error('single file was not delivered as is');
        const many = new DownloadTarget('pack', 2, 1 << 20, deliver);
        await many.writeFile('a.txt', 'hello');
        await many.writeFile('sub/b.json', '{"k":1}'.repeat(100));
        await many.finish();
        const z = await readZip(new Uint8Array(await got[1].blob.arrayBuffer()));
        if (got[1].name !== 'pack.zip' || z.size !== 2 || new TextDecoder().decode(z.get('a.txt')) !== 'hello') throw new Error('ZIP content mismatch');
        const small = new DownloadTarget('cap', 2, 100, deliver);
        let capped = false;
        try {
          await small.writeFile('big.bin', new Uint8Array(1000));
        } catch (err) {
          capped = /cap/i.test((err as Error).message);
        }
        if (!capped) throw new Error('the byte cap did not trigger');
        return 'single, ZIP and cap behave';
      },
    },
    {
      name: '6B · 4096×4096 EXR half export stays inside the memory budget (polled during the job)',
      async run(env) {
        const budget = 1024 * 1024 * 1024;
        const e = engineOf(env, budget);
        try {
          const g = mk(e, 256, settings);
          const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [8, 8], octaves: 4 });
          const x = add(g, 'export.mask', { format: 'exr', depth: 'half', file_name: 'big', size_mode: 'absolute', size_abs: [4096, 4096] });
          link(g, n, x, 'input');
          const t = new CountingTarget();
          let peak = 0;
          const timer = setInterval(() => (peak = Math.max(peak, e.mm.usedBytes)), 15);
          const t0 = performance.now();
          try {
            await runImageJob(envOf(e, g, t), x);
          } finally {
            clearInterval(timer);
          }
          peak = Math.max(peak, e.mm.usedBytes);
          if (peak > budget) throw new Error(`peak ${(peak / 1048576).toFixed(0)} MB exceeded the budget of ${budget / 1048576} MB`);
          return `${(t.files[0].bytes / 1048576).toFixed(1)} MB written in ${((performance.now() - t0) / 1000).toFixed(1)} s, peak engine memory ${(peak / 1048576).toFixed(0)} MB of ${budget / 1048576} MB`;
        } finally {
          dispose(e);
        }
      },
    },
  ];
}
