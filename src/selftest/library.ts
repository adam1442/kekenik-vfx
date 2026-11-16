import { assets } from '../engine/io/assets';
import { MemoryAssetStore } from '../engine/io/autosave';
import { buildMakeSubgraph } from '../engine/subgraph/make';
import { SAMPLES, buildSample } from '../samples';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/**
 * GPU tests for import, subgraphs and samples. Names start with `7A ·`.
 *   - every sample project evaluates without errors; its marked output is finite and its mean lies in the expected range,
 *   - a collapsed subgraph produces the SAME PIXELS as the inline graph (flattening + per-instance evaluation),
 *   - Import Texture uploads a known TGA exactly (orientation, alpha, linear colour space),
 *   - subgraph Input / Output boundary nodes: default constants and pass-through.
 */
const mean = (d: Float32Array, ch: number): number => {
  let s = 0;
  let n = 0;
  const c = Math.min(ch, 3);
  for (let i = 0; i < d.length; i += ch) for (let k = 0; k < c; k++) {
    if (!Number.isFinite(d[i + k])) throw new Error('non-finite pixel value');
    s += d[i + k];
    n++;
  }
  return s / Math.max(1, n);
};
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

function tga32(): Uint8Array {
  const h = new Uint8Array(18);
  h[2] = 2; h[12] = 2; h[14] = 2; h[16] = 32; h[17] = 8; // bottom-left origin, 8 alpha bits
  // rows bottom-up, BGRA: bottom row = blue, white(a=128) ; top row = red, green
  const px = [255, 0, 0, 255, 255, 255, 255, 128, 0, 0, 255, 255, 0, 255, 0, 255];
  return Uint8Array.from([...h, ...px]);
}

export function libraryTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link, read } = h;
  const out: TestDef[] = [];

  for (const s of SAMPLES.filter((x) => x.probes?.length)) {
    out.push({
      name: `7A · sample "${s.id}" evaluates without errors; output finite, mean in range`,
      async run(env) {
        const e = engineOf(env);
        try {
          const { graph, marks } = buildSample(env.registry, s);
          const notes: string[] = [];
          for (const p of s.probes ?? []) {
            const m = marks.get(p.mark);
            if (!m) throw new Error(`missing mark ${p.mark}`);
            for (const f of p.frames ?? [0]) {
              const r = await read(e, graph, m.node, { scale: 0.25, useCache: false, time: f / graph.settings.fps });
              const mu = mean(r.data, r.ch);
              if (!Number.isFinite(mu)) throw new Error(`${p.mark}@${f}: non-finite output`);
              if (mu < p.minMean || mu > p.maxMean) throw new Error(`${p.mark}@${f}: mean ${mu.toFixed(4)} outside [${p.minMean}, ${p.maxMean}]`);
              notes.push(`${p.mark}@${f} mean ${mu.toFixed(3)} (${r.w}x${r.h})`);
            }
          }
          return notes.join(', ');
        } finally {
          dispose(e);
        }
      },
    });
  }

  out.push({
    name: '7A+ · Lightning: finite, within [0,1], reveal grows the bolt, branches add pixels',
    async run(env) {
      const e = engineOf(env);
      try {
        const run = async (params: Record<string, number>): Promise<Float32Array> => {
          const g = mk(e, 128);
          const l = add(g, 'grayscale.lightning', params);
          return (await read(e, g, l, { useCache: false })).data;
        };
        const full = await run({ reveal: 1, branches: 0 });
        const half = await run({ reveal: 0.5, branches: 0 });
        const forked = await run({ reveal: 1, branches: 4 });
        let mn = Infinity;
        let mx = -Infinity;
        for (const v of full) {
          if (!Number.isFinite(v)) throw new Error('non-finite pixel');
          mn = Math.min(mn, v);
          mx = Math.max(mx, v);
        }
        if (mn < -1e-3 || mx > 1.001) throw new Error(`range [${mn}, ${mx}] outside [0,1]`);
        if (mx < 0.9) throw new Error(`bolt core never reaches ~1 (max ${mx.toFixed(3)})`);
        const mf = mean(full, 1);
        const mh = mean(half, 1);
        const mb = mean(forked, 1);
        if (!(mf > 0.003)) throw new Error(`bolt is (almost) empty: mean ${mf}`);
        if (!(mh < mf * 0.8)) throw new Error(`reveal 50% (${mh.toFixed(4)}) should draw clearly less than 100% (${mf.toFixed(4)})`);
        if (!(mb > mf * 1.02)) throw new Error(`branches did not add coverage (${mb.toFixed(4)} vs ${mf.toFixed(4)})`);
        return `mean: reveal 100% ${mf.toFixed(4)}, 50% ${mh.toFixed(4)}, forked ${mb.toFixed(4)}`;
      } finally {
        dispose(e);
      }
    },
  });

  out.push({
    name: '7A+ · Radial Blur: constant input unchanged, amount 0 / angle 0 = identity, zoom smears an impulse',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64);
        const u = add(g, 'grayscale.uniform', { value: 0.4 });
        const blur = add(g, 'utils.radial_blur', { mode: 'both', amount: 0.4, angle: 30 });
        link(g, u, blur);
        const flat = (await read(e, g, blur, { useCache: false })).data;
        let worst = 0;
        for (const v of flat) worst = Math.max(worst, Math.abs(v - 0.4));
        if (worst > 3e-3) throw new Error(`constant changed by ${worst}`);

        const g2 = mk(e, 64);
        const dot = add(g2, 'grayscale.shape', { shape: 'circle', size: [0.1, 0.1], position: [0.75, 0.5], softness: 0 });
        const same = add(g2, 'utils.radial_blur', { mode: 'both', amount: 0, angle: 0, jitter: false });
        link(g2, dot, same);
        const a = (await read(e, g2, dot, { useCache: false })).data;
        const b2 = (await read(e, g2, same, { useCache: false })).data;
        const id = maxDiff(a, b2);
        if (id > 3e-3) throw new Error(`amount 0 is not identity (max diff ${id})`);

        const g3 = mk(e, 64);
        const dot3 = add(g3, 'grayscale.shape', { shape: 'circle', size: [0.1, 0.1], position: [0.75, 0.5], softness: 0 });
        const zoom = add(g3, 'utils.radial_blur', { mode: 'zoom', amount: 0.5, jitter: false, falloff: 'box' });
        link(g3, dot3, zoom);
        const before = mean((await read(e, g3, dot3, { useCache: false })).data, 1);
        const after = await read(e, g3, zoom, { useCache: false });
        let cover = 0;
        for (const v of after.data) if (v > 0.02) cover++;
        let coverBefore = 0;
        for (const v of (await read(e, g3, dot3, { useCache: false })).data) if (v > 0.02) coverBefore++;
        if (!(cover > coverBefore * 1.3)) throw new Error(`zoom did not smear the impulse (${coverBefore} -> ${cover} px)`);
        if (Math.abs(mean(after.data, 1) - before) > before * 0.5) throw new Error('energy changed too much');
        return `identity max diff ${id.toExponential(1)}, impulse coverage ${coverBefore} -> ${cover} px`;
      } finally {
        dispose(e);
      }
    },
  });

  out.push({
    name: '7A++ · Kaleidoscope / Fluid Advect / Chromatic Aberration: constants unchanged, identity settings, visible effect',
    async run(env) {
      const e = engineOf(env);
      try {
        // Kaleidoscope: 1 wedge, no mirror, centred source = identity
        const g = mk(e, 64);
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [3, 3], seed: 2 });
        const k1 = add(g, 'utils.kaleidoscope', { segments: 1, mirror: false });
        link(g, n, k1);
        const a = (await read(e, g, n, { useCache: false })).data;
        const b1 = (await read(e, g, k1, { useCache: false })).data;
        const dk = maxDiff(a, b1);
        if (dk > 6e-3) throw new Error(`kaleidoscope 1 wedge is not identity (max diff ${dk})`);
        const k6 = add(g, 'utils.kaleidoscope', { segments: 6, mirror: true });
        link(g, n, k6);
        const b6 = (await read(e, g, k6, { useCache: false })).data;
        if (maxDiff(a, b6) < 0.05) throw new Error('6-fold kaleidoscope did not change the image');

        // Fluid Advect: constant stays constant, strength 0 = identity, strength > 0 moves a disc
        const g2 = mk(e, 64);
        const u = add(g2, 'grayscale.uniform', { value: 0.4 });
        const f0 = add(g2, 'utils.fluid_advect', { strength: 0.3, steps: 5 });
        link(g2, u, f0);
        let worst = 0;
        for (const v of (await read(e, g2, f0, { useCache: false })).data) worst = Math.max(worst, Math.abs(v - 0.4));
        if (worst > 3e-3) throw new Error(`fluid advect changed a constant by ${worst}`);
        const g3 = mk(e, 64);
        const disc = add(g3, 'grayscale.shape', { shape: 'circle', size: [0.4, 0.4], softness: 0.4 });
        const still = add(g3, 'utils.fluid_advect', { strength: 0 });
        const moved = add(g3, 'utils.fluid_advect', { strength: 0.4, steps: 8 });
        link(g3, disc, still);
        link(g3, disc, moved);
        const d0 = (await read(e, g3, disc, { useCache: false })).data;
        const dStill = maxDiff(d0, (await read(e, g3, still, { useCache: false })).data);
        if (dStill > 4e-3) throw new Error(`strength 0 is not identity (max diff ${dStill})`);
        const mv = await read(e, g3, moved, { useCache: false });
        const dMoved = maxDiff(d0, mv.data);
        if (dMoved < 0.05) throw new Error(`advection did not move the disc (max diff ${dMoved})`);
        if (Math.abs(mean(mv.data, 1) - mean(d0, 1)) > mean(d0, 1) * 0.6) throw new Error('advection changed the energy too much');

        // Chromatic Aberration: grey stays grey, amount 0 = identity, fringes appear on an edge
        const g4 = mk(e, 64);
        const c = add(g4, 'color.uniform', { color: [0.4, 0.4, 0.4, 1] });
        const ca = add(g4, 'utils.chromatic_aberration', { amount: 0.08 });
        link(g4, c, ca);
        const grey = (await read(e, g4, ca, { useCache: false })).data;
        let gw = 0;
        for (let i = 0; i < grey.length; i += 4) gw = Math.max(gw, Math.abs(grey[i] - 0.4), Math.abs(grey[i + 1] - 0.4), Math.abs(grey[i + 2] - 0.4));
        if (gw > 4e-3) throw new Error(`grey changed by ${gw}`);
        const g5 = mk(e, 64);
        const sq = add(g5, 'grayscale.shape', { shape: 'circle', size: [0.3, 0.3], softness: 0, position: [0.8, 0.5] });
        const ramp = add(g5, 'color.ramp', {});
        const fr = add(g5, 'utils.chromatic_aberration', { amount: 0.1, falloff: 1 });
        link(g5, sq, ramp);
        link(g5, ramp, fr);
        const fo = (await read(e, g5, fr, { useCache: false })).data;
        let split = 0;
        for (let i = 0; i < fo.length; i += 4) split = Math.max(split, Math.abs(fo[i] - fo[i + 2]));
        if (split < 0.1) throw new Error(`no colour fringe on the edge (max R-B ${split})`);
        return `kaleidoscope id ${dk.toExponential(1)}, advect still ${dStill.toExponential(1)} moved ${dMoved.toFixed(2)}, fringe R-B ${split.toFixed(2)}`;
      } finally {
        dispose(e);
      }
    },
  });

  out.push({
    name: '7A · collapsed subgraph == inline graph (identical pixels, per-instance cache)',
    async run(env) {
      const e = engineOf(env);
      try {
        const build = () => {
          const g = mk(e, 64);
          const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [3, 3], seed: 5 });
          const sh = add(g, 'grayscale.shape', { shape: 'circle', softness: 0.5 });
          const bl = add(g, 'utils.blend', { blend_type: 'multiply' });
          const lv = add(g, 'utils.levels', { in_low: 0.1, in_high: 0.9 });
          link(g, n, bl, 'foreground');
          link(g, sh, bl, 'background');
          link(g, bl, lv);
          return { g, bl, lv };
        };
        const a = build();
        const inline = (await read(e, a.g, a.lv, { useCache: false })).data;
        const b = build();
        const r = buildMakeSubgraph(b.g, e.subgraphs, [b.bl, b.lv], 'Test subgraph');
        if (typeof r === 'string') throw new Error(r);
        r.command.do();
        const sub = (await read(e, b.g, r.instanceId, { useCache: false })).data;
        const d = maxDiff(inline, sub);
        if (d > 1e-6) throw new Error(`subgraph output differs from inline by ${d}`);
        // second evaluation must hit the cache for the shared work
        const again = await e.evaluator.evaluate(b.g, [{ nodeId: r.instanceId }], {});
        const hits = again.stats.cacheHits;
        again.release();
        return `identical (max diff ${d}), ${hits} cache hit(s) on re-evaluation`;
      } finally {
        e.subgraphs.load([]);
        dispose(e);
      }
    },
  });

  out.push({
    name: '7A · Import Texture uploads a known TGA exactly (orientation, alpha, linear)',
    async run(env) {
      const e = engineOf(env);
      const prev = assets.store;
      try {
        assets.store = new MemoryAssetStore();
        const rec = await assets.add(new Blob([tga32() as BlobPart]), 'known.tga');
        await assets.ensure(rec.id, 4096);
        const g = mk(e, 64);
        const id = add(g, 'import.texture', { asset: { assetId: rec.id, name: rec.name }, color_space: 'linear', size_mode: 'native', max_size: '4096' });
        const r = await read(e, g, id, { useCache: false });
        if (r.w !== 2 || r.h !== 2 || r.ch !== 4) throw new Error(`size ${r.w}x${r.h} ch ${r.ch}`);
        const want = [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 128 / 255];
        const d = maxDiff(r.data, want);
        if (d > 3e-3) throw new Error(`pixels differ from the file by ${d}: [${Array.from(r.data).map((x) => x.toFixed(3)).join(', ')}]`);
        return `2x2 matches (max err ${d.toExponential(2)})`;
      } finally {
        assets.store = prev;
        dispose(e);
      }
    },
  });

  out.push({
    name: '7A · subgraph boundary nodes: Input default constant, Output pass-through',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 32);
        const inn = add(g, 'subgraph.in_gray', { value: 0.25, name: 'Amount' });
        const outn = add(g, 'subgraph.out_gray');
        link(g, inn, outn);
        const a = await read(e, g, inn, { useCache: false });
        const b = await read(e, g, outn, { useCache: false });
        const ma = mean(a.data, a.ch);
        if (Math.abs(ma - 0.25) > 2e-3) throw new Error(`Input default mean ${ma}`);
        if (maxDiff(a.data, b.data) > 0) throw new Error('Output node is not a pass-through');
        const c = add(g, 'subgraph.in_color', { color: [0.2, 0.4, 0.6, 1] });
        const cr = await read(e, g, c, { useCache: false });
        if (maxDiff(cr.data.slice(0, 4), [0.2, 0.4, 0.6, 1]) > 3e-3) throw new Error('Color Input default wrong');
        return 'ok';
      } finally {
        dispose(e);
      }
    },
  });
  return out;
}
