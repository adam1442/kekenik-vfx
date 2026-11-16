import { targetKey } from '../engine/graph/evaluator';
import type { Engine } from '../engine/engine';
import { asMesh, bindMeshAccounting, MeshResource } from '../engine/mesh/accounting';
import { MeshData } from '../engine/mesh/mesh';
import { defaultShapeParams, makeShape } from '../engine/mesh/shapes';
import type { PinValue } from '../engine/resources/values';
import { OrbitCamera } from '../panels/viewport-3d/camera-math';
import { TextureBridge, BRIDGE_MODE } from '../panels/viewport-3d/bridge';
import { ViewportScene } from '../panels/viewport-3d/scene';
import type { Helpers } from './generators';
import { Skip, type TestDef } from './tests';

/**
 * GPU tests for mesh nodes through the real evaluator + memory accounting, the lazy GPU
 * buffer mirror (upload + readback), the three.js viewport on the SHARED device (render smoke test with a pixel probe, material
 * bridge / ExternalTexture additive preview) and a 1M-point timing.
 */
export function meshTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add } = h;
  const tests: TestDef[] = [];
  const GEO_IDS = ['geometry.shapes', 'geometry.points_shape', 'camera.camera'];

  async function evalOne(e: Engine, g: ReturnType<typeof mk>, node: string, pin: string): Promise<{ v: PinValue; release: () => void }> {
    const res = await e.evaluator.evaluate(g, [{ nodeId: node, pinId: pin }], { useCache: false });
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
    name: '5A · every geometry / camera node evaluates; mesh bytes are accounted and returned',
    async run(env) {
      const e = engineOf(env);
      try {
        const base = e.mm.stats().externalBytes;
        const notes: string[] = [];
        for (const id of GEO_IDS) {
          const g = mk(e, 32);
          const n = add(g, id);
          const def = env.registry.get(id)!;
          const pin = def.outputs[0].id;
          const r = await evalOne(e, g, n, pin);
          const during = e.mm.stats().externalBytes;
          if (id.startsWith('geometry') && !(during > base)) throw new Error(`${id}: external bytes did not grow (${during} vs ${base})`);
          notes.push(`${id}: ${asMesh(r.v)?.summary() ?? r.v.kind}`);
          r.release();
          if (e.mm.stats().externalBytes !== base) throw new Error(`${id}: ${e.mm.stats().externalBytes - base} mesh bytes leaked after release`);
        }
        return notes.join('\n');
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '5A · Shapes -> Transform -> Copy To Points graph (acceptance chain) evaluates, caches and reuses',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 32);
        const s = add(g, 'geometry.shapes', { shape: 'cube', size: [0.2, 0.2, 0.2] });
        const t = add(g, 'geometry.transform', { translate: [0, 0, 0.5] });
        const p = add(g, 'geometry.points_shape', { mode: 'circle', count: 12, radius: 2 });
        const c = add(g, 'geometry.copy_to_points');
        g.connect({ node: s, pin: 'mesh' }, { node: t, pin: 'input' });
        g.connect({ node: t, pin: 'output' }, { node: c, pin: 'mesh' });
        g.connect({ node: p, pin: 'points' }, { node: c, pin: 'points' });
        const t0 = performance.now();
        const first = await evalOne(e, g, c, 'mesh');
        const m = asMesh(first.v)!;
        if (m.pointCount !== 12 * 24) throw new Error(`expected 288 points, got ${m.pointCount}`);
        first.release();
        const ms1 = performance.now() - t0;
        // cached re-evaluation: change only the final node
        const res = await e.evaluator.evaluate(g, [{ nodeId: c, pinId: 'mesh' }], {});
        res.release();
        g.setParam(c, 'scale', 2);
        const t1 = performance.now();
        const res2 = await e.evaluator.evaluate(g, [{ nodeId: c, pinId: 'mesh' }], {});
        const m2 = asMesh(res2.values.get(targetKey({ nodeId: c, pinId: 'mesh' })))!;
        const dx = m2.bounds().max[0] - m.bounds().max[0];
        res2.release();
        if (!(Math.abs(dx) > 0.05)) throw new Error('scale param had no effect on bounds');
        return `first ${ms1.toFixed(1)} ms, param edit ${(performance.now() - t1).toFixed(1)} ms`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '5A · GPU mesh mirror: lazy upload + readback (positions, triangles, attribute) and release',
    async run(env) {
      const e = engineOf(env);
      try {
        const acct = bindMeshAccounting(e.mm);
        void acct;
        const mesh = makeShape({ ...defaultShapeParams(), shape: 'sphere', segments: 12, rings: 4 });
        const res = new MeshResource(mesh, acct);
        res.retain();
        const before = e.mm.stats().bufferLiveBytes;
        const mir = res.gpu();
        const pos = mir.positions();
        const tri = mir.triangles();
        const nb = mir.attribute('N', 'point')!;
        const read = async (b: GPUBuffer, bytes: number): Promise<ArrayBuffer> => {
          const dev = env.gpu.device;
          const stage = dev.createBuffer({ size: Math.ceil(bytes / 4) * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          const enc = dev.createCommandEncoder();
          enc.copyBufferToBuffer(b, 0, stage, 0, Math.ceil(bytes / 4) * 4);
          dev.queue.submit([enc.finish()]);
          await stage.mapAsync(GPUMapMode.READ);
          const out = stage.getMappedRange().slice(0);
          stage.unmap();
          stage.destroy();
          return out;
        };
        const P = new Float32Array(await read(pos.buffer, mesh.pointCount * 16));
        for (let i = 0; i < mesh.pointCount; i++) for (let c = 0; c < 3; c++) if (P[i * 4 + c] !== mesh.positions[i * 3 + c]) throw new Error(`position ${i}.${c} differs`);
        if (P[3] !== 1) throw new Error('w must be 1');
        const T = new Uint32Array(await read(tri.buffer, mesh.topology.triangles().verts.length * 4));
        if (T.some((x, i) => x !== mesh.topology.triangles().verts[i])) throw new Error('triangle indices differ');
        const N = new Float32Array(await read(nb.buffer, mesh.pointCount * 12));
        if (N.some((x, i) => x !== mesh.attr('point', 'N')!.data[i])) throw new Error('normal attribute differs');
        const grew = e.mm.stats().bufferLiveBytes - before;
        res.release();
        if (e.mm.stats().bufferLiveBytes !== before) throw new Error('GPU mirror buffers leaked after the last release');
        return `mirror ${grew} B uploaded, ${mesh.pointCount} points, ${T.length / 3} triangles`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '5A · 3D viewport renders on the shared device (pixel probe) + additive material through ExternalTexture',
    async run(env) {
      const e = engineOf(env);
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 120;
      let scene: ViewportScene | null = null;
      let bridge: TextureBridge | null = null;
      try {
        const base = e.mm.stats().externalBytes;
        scene = await ViewportScene.create(env.gpu, e.mm, canvas);
        scene.setSize(160, 120, 1);
        scene.setOptions({ display: 'unlit', grid: false, axes: false });
        const mesh = makeShape({ ...defaultShapeParams(), shape: 'cube', size: [1, 1, 1] }).freeze();
        scene.setMesh(mesh, null);
        const orbit = new OrbitCamera();
        orbit.setView('front');
        orbit.frame([0, 0, 0], 0.9);
        orbit.snap();
        const probe = (): { c: number[]; corner: number[] } => {
          const c2 = document.createElement('canvas');
          c2.width = 160;
          c2.height = 120;
          const g = c2.getContext('2d')!;
          g.drawImage(canvas, 0, 0);
          return { c: Array.from(g.getImageData(80, 60, 1, 1).data), corner: Array.from(g.getImageData(3, 3, 1, 1).data) };
        };
        scene.render(orbit.toCamera(160 / 120), 0);
        const a = probe();
        if (a.c[3] === 0 && a.corner[3] === 0) throw new Skip('canvas readback returned an empty frame (browser clears WebGPU canvases before drawImage); verify visually');
        const lum = (p: number[]): number => p[0] + p[1] + p[2];
        if (!(lum(a.c) > lum(a.corner) + 150)) throw new Error(`cube centre ${a.c} is not brighter than the background ${a.corner}`);
        // additive VFX material from a graph texture
        const g = mk(e, 32);
        const u = add(g, 'grayscale.uniform', { value: 0.9 });
        const r = await evalOne(e, g, u, 'output');
        if (r.v.kind !== 'texture') throw new Error('uniform did not produce a texture');
        bridge = new TextureBridge(env.gpu, e.mm);
        const br = bridge.update(r.v.tex, BRIDGE_MODE.gray);
        r.release();
        scene.setMesh(null, 'plane');
        scene.setTexture(br.texture, true);
        scene.setMaterial({ enabled: true, blend: 'additive', doubleSided: true, depthWrite: false });
        scene.setOptions({ display: 'unlit' });
        orbit.frame([0, 0, 0], 1.2);
        orbit.snap();
        scene.render(orbit.toCamera(160 / 120), 0.5);
        const b = probe();
        if (!(lum(b.c) > lum(b.corner) + 150)) throw new Error(`additive plane centre ${b.c} is not brighter than background ${b.corner}`);
        scene.dispose();
        scene = null;
        if (e.mm.stats().externalBytes !== base) throw new Error(`viewport geometry bytes leaked: ${e.mm.stats().externalBytes - base}`);
        return `cube centre ${a.c}, background ${a.corner}; additive plane ${b.c}`;
      } finally {
        scene?.dispose();
        bridge?.dispose();
        dispose(e);
      }
    },
  });

  tests.push({
    name: '5A · 1M points: Points Shape + Transform + Copy-free pipeline timing',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 32);
        const p = add(g, 'geometry.points_shape', { mode: 'random', count: 1_000_000, size: [4, 4, 4] });
        const t = add(g, 'geometry.transform_points', { rotate: [0, 0, 30], translate: [1, 2, 3] });
        g.connect({ node: p, pin: 'points' }, { node: t, pin: 'input' });
        const t0 = performance.now();
        const r = await evalOne(e, g, t, 'output');
        const ms = performance.now() - t0;
        const m = r.v.kind === 'data' ? (r.v.data as MeshData) : null;
        if (!m || m.pointCount !== 1_000_000) throw new Error('wrong point count');
        r.release();
        if (ms > 6000) throw new Error(`too slow: ${ms.toFixed(0)} ms`);
        return `${ms.toFixed(0)} ms for generate + transform of 1M points (target: interactive-ish < 1.5 s on desktop)`;
      } finally {
        dispose(e);
      }
    },
  });

  return tests;
}
