import { zlibSync } from 'fflate';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphEditor } from '../src/engine/commands/graph-commands';
import { Graph } from '../src/engine/graph/graph';
import { AssetManager, contentId } from '../src/engine/io/assets';
import { MemoryAssetStore } from '../src/engine/io/autosave';
import { decodeExr, decodeHdr, decodeTga, detectGrid, downscaleImage, sniffImageFormat, type DecodedImage } from '../src/engine/io/decode';
import { modelToMesh, defaultModelOptions, parseGlb, parseModel, parseObj } from '../src/engine/io/model';
import { deserializeProject, migrateProject, serializeProject, PROJECT_VERSION } from '../src/engine/io/project';
import { halfToFloat } from '../src/engine/resources/half';
import { FACTORY_PRESETS } from '../src/engine/presets/factory';
import { MemoryPresetBackend, PresetStore, parseLibraryBundle, presetFromNode, spawnPreset } from '../src/engine/presets/presets';
import { SubgraphLibrary } from '../src/engine/subgraph/library';
import { hashString } from '../src/shared/util';
import { SAMPLES, buildSample } from '../src/samples';
import { makeRegistry } from './helpers';

/* ------------------------------------------------------------------ fixtures built in code (tiny files) */
function tga(): Uint8Array {
  // 2x2, 24-bit, bottom-left origin, uncompressed: rows bottom-up (BGR)
  const h = new Uint8Array(18);
  h[2] = 2; h[12] = 2; h[14] = 2; h[16] = 24;
  const px = [0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255]; // bottom row: red, green ; top row: blue, white (BGR order)
  return Uint8Array.from([...h, ...px]);
}
function hdr(): Uint8Array {
  const head = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n');
  return Uint8Array.from([...head, 128, 64, 32, 129, 0, 0, 0, 0]); // (1.0*?, ...) pixel0 = rgb*2^(129-136), pixel1 = black
}
const u32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
function exr(compression: 0 | 3): Uint8Array {
  const enc = (s: string): number[] => [...new TextEncoder().encode(s), 0];
  const attr = (name: string, type: string, data: number[]): number[] => [...enc(name), ...enc(type), ...u32(data.length), ...data];
  const ch = (n: string): number[] => [...enc(n), ...u32(2), 0, 0, 0, 0, ...u32(1), ...u32(1)]; // float channel
  const chlist = [...ch('B'), ...ch('G'), ...ch('R'), 0];
  const box = [...u32(0), ...u32(0), ...u32(1), ...u32(1)];
  const header = [0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0, ...attr('channels', 'chlist', chlist), ...attr('compression', 'compression', [compression]), ...attr('dataWindow', 'box2i', box), ...attr('displayWindow', 'box2i', box), ...attr('lineOrder', 'lineOrder', [0]), ...attr('pixelAspectRatio', 'float', [0, 0, 128, 63]), 0];
  // 2x2 float RGB: pixel values R=x+1, G=y+1, B=0.5 (rows stored scanline by scanline, channels B,G,R each w floats)
  const f32 = (v: number): number[] => [...new Uint8Array(new Float32Array([v]).buffer)];
  const rows: number[][] = [];
  for (let y = 0; y < 2; y++) rows.push([...f32(0.5), ...f32(0.5), ...f32(y + 1), ...f32(y + 1), ...f32(1), ...f32(2)]);
  const raw = rows.flat();
  let payload: number[];
  if (compression === 3) {
    // forward EXR transform: de-interleave halves then predictor (delta + 128)
    const n = raw.length, half = (n + 1) >> 1, t = new Array<number>(n);
    for (let i = 0, k = 0; k < half; k++) { t[k] = raw[i++]; if (i < n) t[half + k] = raw[i++]; }
    for (let i = n - 1; i > 0; i--) t[i] = (t[i] - t[i - 1] + 256 + 128) & 255;
    payload = [...zlibSync(Uint8Array.from(t))];
  } else payload = raw;
  const lines = compression === 3 ? 16 : 1;
  const chunks = compression === 3 ? [payload] : [rows[0], rows[1]];
  const tableStart = header.length;
  const dataStart = tableStart + chunks.length * 8;
  const table: number[] = [];
  const body: number[] = [];
  chunks.forEach((c, i) => {
    table.push(...u32(dataStart + body.length), 0, 0, 0, 0);
    body.push(...u32(i * lines), ...u32(c.length), ...c);
  });
  return Uint8Array.from([...header, ...table, ...body]);
}
function glb(): ArrayBuffer {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const idx = new Uint16Array([0, 1, 2, 0]); // padded
  const bin = new Uint8Array(pos.byteLength + 8);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [0, 0, 5] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
  });
  const jb = new TextEncoder().encode(json + ' '.repeat((4 - (json.length % 4)) % 4));
  const total = 12 + 8 + jb.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, total, true);
  v.setUint32(12, jb.length, true); v.setUint32(16, 0x4e4f534a, true); out.set(jb, 20);
  const o = 20 + jb.length;
  v.setUint32(o, bin.length, true); v.setUint32(o + 4, 0x004e4942, true); out.set(bin, o + 8);
  return out.buffer;
}

describe('import decoding (tiny fixtures)', () => {
  it('TGA: BGR, bottom-left origin', () => {
    const i = decodeTga(tga());
    expect([i.width, i.height]).toEqual([2, 2]);
    const d = i.data as Uint8ClampedArray;
    expect([...d.slice(0, 4)]).toEqual([0, 0, 255, 255]); // top-left = blue
    expect([...d.slice(8, 12)]).toEqual([255, 0, 0, 255]); // bottom-left = red
  });
  it('HDR: RGBE -> half floats', () => {
    const i = decodeHdr(hdr());
    expect([i.width, i.height]).toEqual([2, 1]);
    const d = i.data as Uint16Array;
    expect(halfToFloat(d[0])).toBeCloseTo(128 * 2 ** (129 - 136), 3);
    expect(halfToFloat(d[3])).toBe(1);
    expect(halfToFloat(d[4])).toBe(0);
  });
  it('EXR: uncompressed and ZIP scanlines', () => {
    for (const c of [0, 3] as const) {
      const i = decodeExr(exr(c));
      const d = i.data as Uint16Array;
      expect([i.width, i.height]).toEqual([2, 2]);
      expect(halfToFloat(d[0])).toBe(1); // R at (0,0)
      expect(halfToFloat(d[4])).toBe(2); // R at (1,0)
      expect(halfToFloat(d[1])).toBe(1); // G row 0
      expect(halfToFloat(d[2 * 4 + 1])).toBe(2); // G row 1
      expect(halfToFloat(d[2])).toBe(0.5);
    }
  });
  it('rejects garbage with readable errors and sniffs formats', () => {
    expect(() => decodeExr(new Uint8Array(32))).toThrow(/magic/);
    expect(() => decodeTga(new Uint8Array(4))).toThrow(/small/);
    expect(sniffImageFormat(tga(), 'a.tga')).toBe('tga');
    expect(sniffImageFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), 'x')).toBe('png');
  });
  it('box downscale keeps averages', () => {
    const img: DecodedImage = { width: 2, height: 2, kind: 'u8', data: Uint8ClampedArray.from([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255]), hasAlpha: false };
    const s = downscaleImage(img, 2);
    expect(s.width).toBe(1);
    expect((s.data as Uint8ClampedArray)[0]).toBe(100);
  });
  it('flipbook grid detection finds a 4x4 sheet of padded discs', () => {
    const N = 64, cells = 4, w = N, cs = N / cells;
    const data = new Uint8ClampedArray(N * N * 4);
    for (let i = 0; i < N * N; i++) data[i * 4 + 3] = 255;
    for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) {
      const dx = x - cs / 2 + 0.5, dy = y - cs / 2 + 0.5;
      if (Math.hypot(dx, dy) < cs * 0.32) {
        const o = ((cy * cs + y) * w + cx * cs + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = 255;
      }
    }
    const g = detectGrid({ width: N, height: N, kind: 'u8', data, hasAlpha: false });
    expect([g.cols, g.rows]).toEqual([4, 4]);
    const flat = detectGrid({ width: 16, height: 16, kind: 'u8', data: new Uint8ClampedArray(16 * 16 * 4).fill(255), hasAlpha: false });
    expect(flat.cols * flat.rows).toBe(1);
  });
  it('asset manager: store, decode cache, bundle round trip', async () => {
    const a = new AssetManager(new MemoryAssetStore());
    const rec = await a.add(new Blob([tga() as BlobPart]), 'tiny.tga');
    expect(rec.kind).toBe('image');
    expect(rec.width).toBe(2);
    expect(a.image(rec.id, 4096)?.width).toBe(2);
    const blobs = await a.exportBlobs([rec.id]);
    const b = new AssetManager(new MemoryAssetStore());
    b.setRecords([rec]);
    expect(await b.importBlobs(blobs)).toBe(1);
    expect(b.image(rec.id, 0)).toBeNull(); // async decode started
    await b.ensure(rec.id, 0);
    expect(b.image(rec.id, 0)?.height).toBe(2);
    expect(contentId(tga())).toBe(contentId(tga()));
    await expect(a.add(new Blob(['x']), 'x.txt')).rejects.toThrow(/supported/);
  });
});

describe('model import', () => {
  it('OBJ: polygons are triangulated, v/vt/vn de-duplicated, indices negative ok', () => {
    const m = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1 4/4/1\nf -4 -3 -2');
    expect(m.triangleCount).toBe(3);
    const mesh = modelToMesh(m, { ...defaultModelOptions(), axis: 'none' });
    expect(mesh.primCount).toBe(3);
    expect(() => parseObj('f 1 2 3')).toThrow(/does not exist/);
    expect(() => parseObj('# nothing')).toThrow(/no faces/);
  });
  it('GLB: accessors, node transform, axis conversion', () => {
    const m = parseGlb(glb());
    expect(m.triangleCount).toBe(1);
    expect(m.prims[0].positions[2]).toBe(5); // translated by the node
    const mesh = modelToMesh(m, { ...defaultModelOptions(), scale: 2 });
    const P = mesh.positions;
    expect([P[0], P[1], P[2]]).toEqual([0, -10, 0]); // Y-up -> Z-up: (x, -z, y) * 2
    expect(parseModel(new Uint8Array(glb()), 'a.glb').triangleCount).toBe(1);
    expect(() => parseModel(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'a.fbx')).toThrow(/Unsupported/);
  });
});

describe('presets', () => {
  it('every factory preset spawns on the real registry', () => {
    const reg = makeRegistry();
    const g = new Graph(reg);
    const ed = new GraphEditor(g);
    const store = new PresetStore(new MemoryPresetBackend(), FACTORY_PRESETS);
    expect(store.all().length).toBeGreaterThan(25);
    for (const p of store.all()) spawnPreset(ed, null, p, { x: 0, y: 0 });
    expect(g.nodes.size).toBe(store.all().length);
    expect(new Set(store.all().map((p) => p.id)).size).toBe(store.all().length);
  });
  it('save / search / favourite / bundle round trip incl. subgraph presets', async () => {
    const reg = makeRegistry();
    const g = new Graph(reg);
    const n = g.addNode('grayscale.noise', { name: 'N', params: { noise_type: 'worley_f1', scale: [9, 9] } });
    const backend = new MemoryPresetBackend();
    const store = new PresetStore(backend, FACTORY_PRESETS);
    const lib = new SubgraphLibrary(reg);
    const saved = await store.add(presetFromNode(g, n.id, lib, { name: 'My Cells', folder: 'Team', tags: ['cells', 'zzunique'] }));
    expect(store.search('zzunique')[0].id).toBe(saved.id);
    expect(store.search('', { folder: 'Team' })).toHaveLength(1);
    await store.toggleFavorite(saved.id);
    expect(store.search('', { favoritesOnly: true }).map((p) => p.id)).toContain(saved.id);
    const json = JSON.stringify(store.exportBundle(lib));
    const store2 = new PresetStore(new MemoryPresetBackend());
    const r = await store2.importBundle(json);
    expect(r.presets).toBe(1);
    expect(store2.get(saved.id)!.params.noise_type).toBe('worley_f1');
    expect(() => parseLibraryBundle('{"format":"x"}')).toThrow(/library bundle/);
    expect((await backend.all()).length).toBe(1);
  });
});

describe('project format', () => {
  it('migrates v1 -> current and keeps subgraphs + assets fields', () => {
    const reg = makeRegistry();
    const g = new Graph(reg);
    g.addNode('grayscale.noise', { id: 'a' });
    const v1 = { ...serializeProject(g), version: 1 } as Record<string, unknown>;
    delete v1.subgraphs;
    const { project, migratedFrom } = migrateProject(v1);
    expect(migratedFrom).toBe(1);
    expect(project.version).toBe(PROJECT_VERSION);
    expect(project.subgraphs).toEqual([]);
    const lib = new SubgraphLibrary(reg);
    const r = deserializeProject(reg, v1, (p) => void lib.load(p.subgraphs));
    expect(r.graph.nodes.has('a')).toBe(true);
    expect(() => migrateProject({ ...v1, version: 99 })).toThrow(/newer/);
  });
});

describe('sample projects', () => {
  const reg = makeRegistry();
  const fixturePath = 'tests/fixtures/samples.json';
  const current: Record<string, unknown> = {};
  for (const s of SAMPLES) {
    it(`${s.id}: builds from real nodes, validates, round-trips`, () => {
      const { graph, marks } = buildSample(reg, s);
      const data = graph.toData();
      const types = new Set(data.nodes.map((n) => n.type));
      const idx = new Map(data.nodes.map((n, i) => [n.id, i]));
      for (const t of types) expect(reg.has(t)).toBe(true);
      const again = Graph.fromData(reg, JSON.parse(JSON.stringify(data)));
      expect(again.warnings).toEqual([]);
      expect(again.graph.links.size).toBe(graph.links.size);
      for (const p of s.probes ?? []) expect(marks.has(p.mark)).toBe(true);
      expect(s.description.length).toBeGreaterThan(20);
      if (s.kind === 'sample') expect(data.nodes.length).toBeGreaterThanOrEqual(7);
      current[s.id] = { nodes: data.nodes.length, links: data.links.length, types: [...types].sort(), graphHash: hashString(JSON.stringify(data.nodes.map((n) => [n.type, n.params])) + JSON.stringify(data.links.map((l) => [idx.get(l.from.node), l.from.pin, idx.get(l.to.node), l.to.pin]))) };
    });
  }
  it('matches the stored regression fixture (UPDATE_FIXTURES=1 rewrites it)', () => {
    if (process.env.UPDATE_FIXTURES || !existsSync(fixturePath)) {
      mkdirSync('tests/fixtures', { recursive: true });
      writeFileSync(fixturePath, JSON.stringify(current, null, 2));
    }
    const stored = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, { nodes: number; links: number; types: string[] }>;
    for (const [id, m] of Object.entries(current as Record<string, { nodes: number; links: number; types: string[] }>)) {
      expect(stored[id], id).toBeDefined();
      expect(m.nodes, `${id} node count`).toBe(stored[id].nodes);
      expect(m.links, `${id} link count`).toBe(stored[id].links);
      expect(m.types, `${id} node types`).toEqual(stored[id].types);
      expect(m, `${id} graph hash`).toEqual(stored[id]);
    }
  });
});
