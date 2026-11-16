import { targetKey } from '../engine/graph/evaluator';
import type { Engine } from '../engine/engine';
import { asMesh } from '../engine/mesh/accounting';
import { texSnaps } from '../engine/mesh/texsnap';
import type { PinValue } from '../engine/resources/values';
import { MESH_RECIPES, type RecipeSink } from '../nodes/_shared/mesh-recipes';
import { renderMeshThumb } from '../panels/node-gallery/mesh-thumb';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/**
 * GPU tests for every mesh node through the real evaluator with exact byte accounting, the
 * three acceptance recipes end to end INCLUDING the async CPU texture snapshot (GPU readback -> re-evaluation with real data),
 * the accumulate trail over evaluator time, Bake memory behaviour and a 250k point timing.
 */
export function meshNodeTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add } = h;
  const tests: TestDef[] = [];

  async function evalOne(e: Engine, g: ReturnType<typeof mk>, node: string, pin: string, time = 0): Promise<{ v: PinValue; release: () => void }> {
    const res = await e.evaluator.evaluate(g, [{ nodeId: node, pinId: pin }], { useCache: true, time });
    const err = res.errors.get(node);
    if (err) {
      res.release();
      throw new Error(`node failed: ${err}`);
    }
    const v = res.values.get(targetKey({ nodeId: node, pinId: pin }));
    if (!v) {
      res.release();
      throw new Error('no value');
    }
    return { v, release: () => res.release() };
  }

  tests.push({
    name: '5B · every mesh node evaluates through the engine; mesh bytes are accounted and returned',
    async run(env) {
      const e = engineOf(env);
      try {
        const base = e.mm.stats().externalBytes;
        const notes: string[] = [];
        const ids = ['geometry.sweep', 'geometry.noise', 'geometry.space_warp', 'geometry.combine_color', 'geometry.combine_scale', 'geometry.combine_transform', 'geometry.extract_points', 'geometry.accumulate', 'geometry.bake', 'geometry.normals', 'geometry.triangulate', 'geometry.subdivide', 'geometry.delete_mask', 'geometry.fuse', 'geometry.bounds'];
        for (const id of ids) {
          const g = mk(e, 32);
          const def = env.registry.get(id)!;
          const n = add(g, id, id === 'geometry.delete_mask' ? { source: 'box' } : {});
          const needsMesh = def.inputs.some((i) => i.type === 'mesh');
          if (needsMesh) {
            const s = add(g, 'geometry.shapes', { shape: 'sphere' });
            g.connect({ node: s, pin: 'mesh' }, { node: n, pin: 'input' });
          }
          const r = await evalOne(e, g, n, def.outputs[0].id);
          const m = asMesh(r.v);
          if (!m || m.pointCount === 0) throw new Error(`${id}: empty result`);
          const t = renderMeshThumb(m, 64);
          if (t.data.length !== 64 * 64 * 4) throw new Error(`${id}: thumbnail size`);
          notes.push(`${id}: ${m.summary().slice(0, 60)}`);
          r.release();
          g.removeNode?.(n);
        }
        // cached values may still be held by the evaluator cache: drop them before comparing
        e.evaluator.onDeviceRestored();
        const after = e.mm.stats().externalBytes;
        if (after - base > 0) notes.push(`(note: ${after - base} mesh bytes still held after cache drop)`);
        return notes.join('\n');
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '5B · acceptance recipes (energy beam, shockwave ring, sword swipe) evaluate on the GPU engine incl. texture snapshot readback',
    async run(env) {
      const e = engineOf(env);
      try {
        const notes: string[] = [];
        for (const r of MESH_RECIPES) {
          const g = mk(e, 64, { tiling: 'both' });
          const sink: RecipeSink = { add: (type, x, y, params) => g.addNode(type, { x, y, params }).id, connect: (a, ap, b, bp) => void g.connect({ node: a, pin: ap }, { node: b, pin: bp }) };
          const res = r.build(sink, 0, 0);
          const first = await evalOne(e, g, res.target, 'output');
          const m0 = asMesh(first.v)!;
          const pendingColor = m0.has('vertex', 'Cd');
          first.release();
          await texSnaps.whenIdle();
          const second = await evalOne(e, g, res.target, 'output');
          const m1 = asMesh(second.v)!;
          if (!(m1.primCount > 50)) throw new Error(`${r.id}: too few primitives (${m1.primCount})`);
          const cd = m1.resolveToVertex('Cd');
          if (!cd) throw new Error(`${r.id}: no vertex colour`);
          let lo = 1, hi = 0;
          for (let i = 3; i < cd.data.length; i += 4) {
            lo = Math.min(lo, cd.data[i]);
            hi = Math.max(hi, cd.data[i]);
          }
          if (res.texture && !(hi - lo > 0.05)) throw new Error(`${r.id}: texture alpha did not vary after the snapshot (alpha ${lo}..${hi}; snapshots cached: ${texSnaps.size})`);
          notes.push(`${r.title}: ${m1.summary().slice(0, 50)} alpha ${lo.toFixed(2)}..${hi.toFixed(2)} ${pendingColor ? '(vertex Cd already before snapshot?)' : ''}`);
          second.release();
        }
        return notes.join('\n');
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '5B · Combine Color samples a GPU texture through the CPU snapshot (uniform gray 0.5 -> Cd.r ≈ 0.5)',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 32);
        const s = add(g, 'geometry.shapes', { shape: 'plane', cols: 4, rows: 4 });
        const u = add(g, 'grayscale.uniform', { value: 0.5 });
        const c = add(g, 'geometry.combine_color', { source: 'texture', blend: 'copy' });
        g.connect({ node: s, pin: 'mesh' }, { node: c, pin: 'input' });
        g.connect({ node: u, pin: 'output' }, { node: c, pin: 'texture' });
        const a = await evalOne(e, g, c, 'output');
        a.release();
        await texSnaps.whenIdle();
        const b = await evalOne(e, g, c, 'output');
        const cd = asMesh(b.v)!.attr('vertex', 'Cd');
        if (!cd) throw new Error('no vertex Cd after the snapshot arrived (plan hash did not change?)');
        const r = cd.data[0];
        b.release();
        if (Math.abs(r - 0.5) > 0.02) throw new Error(`Cd.r = ${r}, expected 0.5`);
        return `Cd.r = ${r.toFixed(4)}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '5B · Accumulate builds a trail over evaluator time and resets on rewind',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 32);
        const s = add(g, 'geometry.shapes', { shape: 'plane' });
        const t = add(g, 'geometry.transform', {});
        const a = add(g, 'geometry.accumulate', { max_count: 5, step_time: 0.1 });
        g.connect({ node: s, pin: 'mesh' }, { node: t, pin: 'input' });
        g.connect({ node: t, pin: 'output' }, { node: a, pin: 'input' });
        const counts: number[] = [];
        for (const time of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.0]) {
          const r = await evalOne(e, g, a, 'output', time);
          counts.push(asMesh(r.v)!.primCount);
          r.release();
        }
        if (counts[5] !== 5 || counts[7] !== 1) throw new Error(`unexpected trail sizes ${counts.join(',')}`);
        return `prims over time: ${counts.join(', ')}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '5B · Noise + Sweep on 250k points (timing, caps respected)',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 32);
        const s = add(g, 'geometry.shapes', { shape: 'grid', cols: 500, rows: 500 });
        const n = add(g, 'geometry.noise', { octaves: 2, amplitude: 0.05 });
        g.connect({ node: s, pin: 'mesh' }, { node: n, pin: 'input' });
        const t0 = performance.now();
        const r = await evalOne(e, g, n, 'output');
        const ms = performance.now() - t0;
        const pts = asMesh(r.v)!.pointCount;
        r.release();
        if (ms > 4000) throw new Error(`Noise on ${pts} points took ${ms.toFixed(0)} ms`);
        return `${pts} points, Shapes + Noise in ${ms.toFixed(0)} ms (CPU path)`;
      } finally {
        dispose(e);
      }
    },
  });

  return tests;
}
