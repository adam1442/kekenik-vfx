import { writeFileSync } from 'fs';
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { valueAt } from '../src/engine/anim/animator';
import { Params } from '../src/engine/params/accessor';
import { defaultValues, type ParamValue } from '../src/engine/params/schema';
import { asMesh } from '../src/engine/mesh/accounting';
import { clearHistories } from '../src/engine/mesh/history';
import { renderMeshThumb } from '../src/panels/node-gallery/mesh-thumb';
import { SAMPLES, buildSample } from '../src/samples';
import { makeRegistry } from './helpers';

/**
 * CPU evaluation of the mesh part of every sample (no GPU): the geometry chain must evaluate at several frames into a finite,
 * non-empty mesh of sane size. Texture inputs are replaced by a synthetic CPU texture. Set DUMP=/dir to write thumbnails.
 */
const png = (w: number, h: number, rgba: Uint8Array | Uint8ClampedArray): Uint8Array => {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Uint8Array) => {
    const o = new Uint8Array(12 + d.length), dv = new DataView(o.buffer);
    dv.setUint32(0, d.length);
    for (let i = 0; i < 4; i++) o[4 + i] = t.charCodeAt(i);
    o.set(d, 8);
    dv.setUint32(8 + d.length, crc(o.subarray(4, 8 + d.length)));
    return o;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

describe('sample meshes evaluate on the CPU', () => {
  const reg = makeRegistry();
  const cpuTex = { width: 16, height: 16, channels: 1, data: Float32Array.from({ length: 256 }, (_, i) => ((i % 16) + Math.floor(i / 16)) / 32) };
  for (const s of SAMPLES.filter((x) => x.view?.mesh)) {
    it(s.id, () => {
      const { graph, marks } = buildSample(reg, s);
      const L = graph.settings.loopLength;
      const target = graph.nodes.get(marks.get(s.view!.mesh!)!.node)!;
      const inLink = [...graph.links.values()].find((l) => l.to.node === target.id)!;
      for (const f of [0, Math.floor(L / 3), Math.floor((2 * L) / 3)]) {
        clearHistories();
        const memo = new Map<string, Record<string, unknown>>();
        const run = (id: string): Record<string, unknown> => {
          const hit = memo.get(id);
          if (hit) return hit;
          const nd = graph.nodes.get(id)!;
          if (!nd.type.startsWith('geometry.')) return { output: { kind: 'texture' } };
          const d = reg.get(nd.type)!;
          const inputs: Record<string, unknown> = {};
          for (const l of graph.links.values()) if (l.to.node === id) inputs[l.to.pin] = run(l.from.node)[l.from.pin];
          const values = { ...defaultValues(d.params) } as Record<string, ParamValue>;
          for (const p of d.params) {
            const v = valueAt(graph, id, p.id, f);
            if (v !== undefined) values[p.id] = v;
          }
          const ctx = { params: new Params(d.params, values as never), inputs, node: { id, name: nd.name, type: nd.type }, frame: { time: f / graph.settings.fps, loopPhase: (f % L) / L }, cpuTexture: () => cpuTex, cpuTexturePending: () => false } as never;
          const out = d.evaluate(ctx);
          memo.set(id, out);
          return out;
        };
        const mesh = asMesh(run(inLink.from.node)[inLink.from.pin] as never)!;
        expect(mesh, `${s.id}@${f}`).toBeTruthy();
        expect(mesh.primCount, `${s.id}@${f} prims`).toBeGreaterThan(30);
        expect(Array.from(mesh.positions).every(Number.isFinite), `${s.id}@${f} finite`).toBe(true);
        const b = mesh.bounds();
        for (let k = 0; k < 3; k++) expect(Math.abs(b.max[k]) < 60 && Math.abs(b.min[k]) < 60, `${s.id}@${f} bounds ${b.min} ${b.max}`).toBe(true);
        if (process.env.DUMP) {
          const t = renderMeshThumb(mesh, 256);
          writeFileSync(`${process.env.DUMP}/${s.id}_${f}.png`, png(t.width ?? 256, t.height ?? 256, t.data));
        }
      }
    });
  }
});
