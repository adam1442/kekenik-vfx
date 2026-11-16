import { loopMatch } from '../engine/anim/keyframes';
import { setTrackKey } from '../engine/anim/tracks';
import { targetKey, type EvalOptions } from '../engine/graph/evaluator';
import type { ParamValue } from '../engine/params/schema';
import type { Engine } from '../engine/engine';
import { readTextureFloat32 } from '../engine/resources/readback';
import type { TextureValue } from '../engine/resources/values';
import { adjustVector, decodeMotion, encodeMotion } from '../nodes/_shared/vectorref';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/**
 * GPU known-answer tests for vector fields, vector advection, motion vectors, grid simulations and Lightning. Names start with `9B ·`.
 *   vector       every generator renders finite vectors; Uniform known answer; curl noise is divergence free and tileable;
 *                Adjust (normalize) and Motion Encode == CPU reference; Advect with a uniform field == the image rolled by the vector
 *   simulations  Reaction Diffusion / Wave / Diffusion / Burn Front / Flow Advection: finite, bounded, deterministic (two engines),
 *                periodic edges, scrub back == forward; wave energy does not blow up
 *   lightning    the Spline output has the bolt structure, the mask renders
 *   motion       Motion Vector Generate recovers a known translation of a baked flipbook; Interpolate beats a cross-fade on it
 */
type Env = Parameters<TestDef['run']>[0];
type Params = Record<string, ParamValue>;

export function simVectorTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link, read } = h;
  const N = 64;
  const tests: TestDef[] = [];

  /** Evaluate one output pin of a node and read it back as Float32 (the shared `read` helper only reads the default pin). */
  async function readPin(e: Engine, g: ReturnType<typeof mk>, id: string, pin: string, time = 0, opts: EvalOptions = {}): Promise<{ data: Float32Array; w: number; h: number; ch: number }> {
    const res = await e.evaluator.evaluate(g, [{ nodeId: id, pinId: pin }], { time, ...opts });
    try {
      const err = res.errors.get(id);
      if (err) throw new Error(`node failed: ${err}`);
      const v = res.values.get(targetKey({ nodeId: id, pinId: pin })) as TextureValue | undefined;
      if (!v || v.kind !== 'texture') throw new Error(`no texture on pin ${pin}`);
      const data = await readTextureFloat32(e.gpu, e.mm, v.tex.texture, v.tex.format, v.width, v.height);
      return { data, w: v.width, h: v.height, ch: data.length / (v.width * v.height) };
    } finally {
      res.release();
    }
  }
  const finite = (a: Float32Array): boolean => a.every((x) => Number.isFinite(x));
  const meanAbs = (a: ArrayLike<number>): number => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i]);
    return s / Math.max(1, a.length);
  };
  const same = (a: Float32Array, b: Float32Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

  /* ---------------------------------------------------------------------------------------------- vector fields */
  tests.push({
    name: '9B · Vector generators: Uniform / Noise (curl, plain) / Radial / Vortex / Spline render finite vectors',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, N);
        const ids = [add(g, 'vector.uniform'), add(g, 'vector.noise'), add(g, 'vector.noise', { kind: 'plain' }), add(g, 'vector.radial'), add(g, 'vector.vortex'), add(g, 'vector.spline')];
        const peaks: number[] = [];
        for (const id of ids) {
          const r = await read(e, g, id);
          if (!finite(r.data)) throw new Error(`${id}: non-finite values`);
          peaks.push(meanAbs(r.data));
        }
        if (!(peaks[0] > 0 && peaks[1] > 0)) throw new Error('Uniform / Noise are all zero');
        return `mean |v| ${peaks.map((x) => x.toFixed(3)).join(' / ')}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '9B · Vector Uniform: angle 0 = (strength, 0) everywhere, angle 90 = vertical',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 32);
        const a = await read(e, g, add(g, 'vector.uniform', { mode: 'angle', angle: 0, strength: 0.3 }));
        const b = await read(e, g, add(g, 'vector.uniform', { mode: 'angle', angle: 90, strength: 0.3 }));
        let worst = 0;
        for (let i = 0; i < a.w * a.h; i++) worst = Math.max(worst, Math.abs(a.data[i * a.ch] - 0.3), Math.abs(a.data[i * a.ch + 1]), Math.abs(b.data[i * b.ch]), Math.abs(Math.abs(b.data[i * b.ch + 1]) - 0.3));
        if (worst > 2e-3) throw new Error(`worst error ${worst}`);
        return `worst error ${worst.toExponential(1)}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '9B · Vector Noise (curl): divergence far below a plain field, and tileable (no seam at the borders)',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const n = 128;
        const g = mk(e, n);
        const curl = await read(e, g, add(g, 'vector.noise', { kind: 'curl', scale: [2, 2], octaves: 1, strength: 0.2 }));
        const plain = await read(e, g, add(g, 'vector.noise', { kind: 'plain', scale: [2, 2], octaves: 1, strength: 0.2 }));
        const div = (r: typeof curl): number => {
          let s = 0;
          const at = (x: number, y: number, c: number): number => r.data[(((y + n) % n) * n + ((x + n) % n)) * r.ch + c];
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) s += Math.abs((at(x + 1, y, 0) - at(x - 1, y, 0)) * 0.5 + (at(x, y + 1, 1) - at(x, y - 1, 1)) * 0.5);
          return s / (n * n);
        };
        const dc = div(curl), dp = div(plain);
        if (!(dc < 0.25 * dp)) throw new Error(`curl divergence ${dc.toExponential(2)} is not << plain ${dp.toExponential(2)}`);
        let seam = 0, inner = 0;
        for (let y = 0; y < n; y++) {
          for (let c = 0; c < 2; c++) {
            seam += Math.abs(curl.data[(y * n + n - 1) * curl.ch + c] - curl.data[y * n * curl.ch + c]);
            inner += Math.abs(curl.data[(y * n + n / 2) * curl.ch + c] - curl.data[(y * n + n / 2 + 1) * curl.ch + c]);
          }
        }
        if (seam > Math.max(inner * 3, 1e-4)) throw new Error(`seam ${seam.toExponential(2)} vs inner step ${inner.toExponential(2)}`);
        return `div ${dc.toExponential(1)} vs plain ${dp.toExponential(1)}, seam ${seam.toExponential(1)} / step ${inner.toExponential(1)}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '9B · Vector Adjust (normalize + clamp) == CPU reference',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, N);
        const src = add(g, 'vector.noise', { strength: 0.4 });
        const adj = add(g, 'vector.adjust', { normalize: true, length: 0.25, gain: 1 });
        link(g, src, adj);
        const a = await read(e, g, src);
        const b = await read(e, g, adj);
        const o = { invertX: false, invertY: false, deadzone: 0, power: 1, reference: 1, gain: 1, normalize: true, length: 0.25, minLen: 0, maxLen: 0 };
        let worst = 0;
        for (let i = 0; i < a.w * a.h; i++) {
          if (Math.hypot(a.data[i * a.ch], a.data[i * a.ch + 1]) < 5e-3) continue; // half-float noise floor
          const r = adjustVector(a.data[i * a.ch], a.data[i * a.ch + 1], o);
          worst = Math.max(worst, Math.abs(r[0] - b.data[i * b.ch]), Math.abs(r[1] - b.data[i * b.ch + 1]));
        }
        if (worst > 8e-3) throw new Error(`worst error ${worst}`);
        return `worst error ${worst.toExponential(1)}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '9B · Motion Vector Encode / Decode: encode == CPU reference (Unreal Y flip, 0.5 bias) and decode restores the vector',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, N);
        const src = add(g, 'vector.noise', { strength: 0.05 });
        const enc = add(g, 'vector.motion_encode', { scale: 0.1, convention: 'unreal', signed_out: false, depth: 'float' });
        link(g, src, enc, 'vector');
        const a = await read(e, g, src);
        const b = await readPin(e, g, enc, 'output');
        const d = await readPin(e, g, enc, 'decoded');
        const o = { scale: 0.1, flipY: true, signed: false, bits: 32 as const };
        let worst = 0, back = 0;
        for (let i = 0; i < a.w * a.h; i++) {
          const x = a.data[i * a.ch], y = a.data[i * a.ch + 1];
          const r = encodeMotion(x, y, o);
          worst = Math.max(worst, Math.abs(r[0] - b.data[i * b.ch]), Math.abs(r[1] - b.data[i * b.ch + 1]));
          const dv = decodeMotion(b.data[i * b.ch], b.data[i * b.ch + 1], o);
          back = Math.max(back, Math.abs(dv[0] - x), Math.abs(dv[1] - y));
          void d;
        }
        if (worst > 4e-3) throw new Error(`encode error ${worst}`);
        if (back > 4e-3) throw new Error(`decode error ${back}`);
        return `encode ${worst.toExponential(1)}, round trip ${back.toExponential(1)}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '9B · Vector Advect: a uniform field shifts the image exactly (displace and RK4 integrate, tiling on)',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const n = 32;
        const g = mk(e, n, { tiling: 'both' });
        const img = add(g, 'grayscale.noise', { noise_type: 'value', scale: [4, 4], octaves: 1 });
        const vec = add(g, 'vector.uniform', { mode: 'angle', angle: 0, strength: 0.25 }); // 8 px per second (to the right)
        const results: string[] = [];
        for (const mode of ['displace', 'integrate'] as const) {
          const adv = add(g, 'vector.advect', { mode, method: 'rk4', steps: 4, strength: 1, direction: 'backward' });
          link(g, img, adv, 'input');
          link(g, vec, adv, 'vector');
          const a = await read(e, g, img);
          const b = await read(e, g, adv);
          let worst = 0;
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) worst = Math.max(worst, Math.abs(b.data[(y * n + x) * b.ch] - a.data[(y * n + ((x - 8 + n) % n)) * a.ch]));
          if (worst > 6e-3) throw new Error(`${mode}: worst error ${worst}`);
          results.push(`${mode} ${worst.toExponential(1)}`);
        }
        return results.join(', ');
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '9B · Vector Advect flow map: phase 0 == phase 1 (the loop closes)',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 48);
        const img = add(g, 'grayscale.noise', { noise_type: 'value', scale: [5, 5], octaves: 2 });
        const vec = add(g, 'vector.noise', { strength: 0.2 });
        const mkAdv = (phase: number): string => {
          const a = add(g, 'vector.advect', { mode: 'flowmap', phase, strength: 0.4, scatter: 0.3 });
          link(g, img, a, 'input');
          link(g, vec, a, 'vector');
          return a;
        };
        const a = await read(e, g, mkAdv(0));
        const b = await read(e, g, mkAdv(1));
        let worst = 0;
        for (let i = 0; i < a.data.length; i++) worst = Math.max(worst, Math.abs(a.data[i] - b.data[i]));
        if (worst > 3e-3) throw new Error(`phase 0 vs 1 differ by ${worst}`);
        return `worst ${worst.toExponential(1)}`;
      } finally {
        dispose(e);
      }
    },
  });

  /* ---------------------------------------------------------------------------------------------- simulations */
  const GRID = { sim_res: 64, precision: 'half' };
  const frame = async (e: Engine, g: ReturnType<typeof mk>, id: string, pin: string, f: number): Promise<Float32Array> => {
    await readPin(e, g, id, pin, f / 30); // registers the request
    await e.sims.settle(f);
    return (await readPin(e, g, id, pin, f / 30)).data;
  };
  const simCases: Array<{ id: string; pin: string; params: Params; lo: number; hi: number; frames: number }> = [
    { id: 'simulation.reaction_diffusion', pin: 'b', params: { ...GRID, warmup: 0, substeps: 8, feed: 0.037, kill: 0.06, seed_mode: 'center', seed_radius: 0.1 }, lo: -1e-3, hi: 1.001, frames: 12 },
    { id: 'simulation.reaction_diffusion', pin: 'pattern', params: { ...GRID, warmup: 0, substeps: 8, seed_mode: 'noise' }, lo: -1e-3, hi: 1.001, frames: 6 },
    { id: 'simulation.wave', pin: 'height', params: { ...GRID, em1_on: true, boundary: 'periodic' }, lo: -64, hi: 64, frames: 14 },
    { id: 'simulation.diffusion', pin: 'output', params: { ...GRID }, lo: -1e-2, hi: 64, frames: 8 },
    { id: 'simulation.burn_front', pin: 'front', params: { ...GRID }, lo: -1e-3, hi: 1.001, frames: 10 },
    { id: 'simulation.flow_advect_sim', pin: 'output', params: { ...GRID }, lo: -1e-2, hi: 64, frames: 8 },
  ];
  for (const c of simCases) {
    tests.push({
      name: `9B · ${c.id} (${c.pin}): finite, bounded, deterministic across engines, scrub back == forward`,
      async run(env: Env) {
        const e1 = engineOf(env);
        const e2 = engineOf(env);
        try {
          const g1 = mk(e1, 64, { fps: 30, loopLength: 60 });
          const id1 = add(g1, c.id, c.params);
          const g2 = mk(e2, 64, { fps: 30, loopLength: 60 });
          const id2 = add(g2, c.id, c.params);
          const a = await frame(e1, g1, id1, c.pin, c.frames);
          if (!finite(a)) throw new Error('non-finite values');
          for (const v of a) if (v < c.lo || v > c.hi) throw new Error(`value ${v} outside [${c.lo}, ${c.hi}]`);
          const early = await frame(e1, g1, id1, c.pin, 1);
          const again = await frame(e1, g1, id1, c.pin, c.frames);
          if (!same(a, again)) throw new Error('frame differs after scrubbing back and forward');
          if (same(early, a)) throw new Error('frame 1 and the last frame are identical (nothing simulated)');
          const b = await frame(e2, g2, id2, c.pin, c.frames);
          if (!same(a, b)) throw new Error('two engines with the same project differ (not deterministic)');
          return `range ok, ${c.frames} frames`;
        } finally {
          dispose(e1);
          dispose(e2);
        }
      },
    });
  }

  tests.push({
    name: '9B · Reaction Diffusion with periodic boundary tiles: left / right edge step ~ inner step',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64, { fps: 30, loopLength: 60 });
        const id = add(g, 'simulation.reaction_diffusion', { ...GRID, warmup: 0, substeps: 12, periodic: true, feed: 0.037, kill: 0.06 });
        const a = await frame(e, g, id, 'b', 12);
        const r = await readPin(e, g, id, 'b', 12 / 30);
        const n = r.w;
        let seam = 0, inner = 0;
        for (let y = 0; y < r.h; y++) {
          seam += Math.abs(a[y * n * r.ch + (n - 1) * r.ch] - a[y * n * r.ch]);
          inner += Math.abs(a[y * n * r.ch + (n / 2) * r.ch] - a[y * n * r.ch + (n / 2 + 1) * r.ch]);
        }
        if (seam > Math.max(inner * 4, 1e-3)) throw new Error(`seam ${seam.toExponential(2)} vs inner ${inner.toExponential(2)}`);
        return `seam ${seam.toExponential(1)} inner ${inner.toExponential(1)}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '9B · Wave: undamped energy does not blow up over 60 frames (CFL clamp), reflecting boundary',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64, { fps: 30, loopLength: 120 });
        const id = add(g, 'simulation.wave', { ...GRID, em1_on: true, em1_amp: 4, damping: 0, boundary: 'reflect', wave_speed: 3 });
        const early = await frame(e, g, id, 'height', 10);
        const late = await frame(e, g, id, 'height', 60);
        if (!finite(late)) throw new Error('non-finite');
        const peak = (a: Float32Array): number => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
        if (peak(late) > Math.max(peak(early) * 50, 20)) throw new Error(`amplitude grew ${peak(early)} -> ${peak(late)}`);
        return `peak ${peak(early).toFixed(2)} -> ${peak(late).toFixed(2)}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '9B · Simulation loop crossfade: seam is as smooth as normal motion (Reaction Diffusion, Wave)',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const out: string[] = [];
        for (const [type, pin, params] of [['simulation.reaction_diffusion', 'b', { ...GRID, warmup: 0, substeps: 6 }], ['simulation.wave', 'height', { ...GRID, em1_on: true }]] as Array<[string, string, Params]>) {
          const g = mk(e, 64, { fps: 30, loopLength: 12 });
          const id = add(g, type, { ...params, loop_mode: 'crossfade', loop_frames: 12, blend_frames: 5 });
          const f0 = await frame(e, g, id, pin, 0);
          const fl = await frame(e, g, id, pin, 11);
          const fp = await frame(e, g, id, pin, 10);
          const md = (x: Float32Array, y: Float32Array): number => x.reduce((s, v, i) => s + Math.abs(v - y[i]), 0) / x.length;
          const seam = md(fl, f0), nat = md(fp, fl);
          if (!(seam <= Math.max(nat * 3, 1e-4))) throw new Error(`${type}: seam ${seam} vs natural ${nat}`);
          out.push(`${type.split('.')[1]} ${seam.toExponential(1)}/${nat.toExponential(1)}`);
        }
        return out.join(', ');
      } finally {
        dispose(e);
      }
    },
  });

  /* ---------------------------------------------------------------------------------------------- lightning */
  tests.push({
    name: '9B · Lightning: Spline output has start/end + per-point width, mask renders inside [0, 1] and is not empty',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, N);
        const id = add(g, 'simulation.lightning', { p_start: [0.5, 0.1], p_end: [0.5, 0.9], branch_prob: 0.3, seed: 3 });
        const res = await e.evaluator.evaluate(g, [{ nodeId: id, pinId: 'spline' }], {});
        try {
          const err = res.errors.get(id);
          if (err) throw new Error(err);
          const v = res.values.get(targetKey({ nodeId: id, pinId: 'spline' })) as { kind: string; data?: { splines?: Array<{ closed: boolean; points: Array<{ x: number; y: number; w?: number }> }> } } | undefined;
          const sp = v?.data?.splines;
          if (!sp || !sp.length) throw new Error('no spline set');
          const main = sp[0].points;
          if (Math.hypot(main[0].x - 0.5, main[0].y - 0.1) > 1e-4) throw new Error('main channel does not start at the start point');
          if (Math.hypot(main[main.length - 1].x - 0.5, main[main.length - 1].y - 0.9) > 1e-4) throw new Error('main channel does not end at the end point');
          if (!main.every((p) => (p.w ?? 0) > 0)) throw new Error('missing per-point widths');
        } finally {
          res.release();
        }
        const m = await readPin(e, g, id, 'mask');
        let mx = 0;
        for (const x of m.data) {
          if (!(x >= -1e-3 && x <= 1.001)) throw new Error(`mask value ${x} outside [0, 1]`);
          mx = Math.max(mx, x);
        }
        if (mx < 0.3) throw new Error(`mask is (nearly) empty, max ${mx}`);
        return `${m.w}x${m.h} mask max ${mx.toFixed(2)}`;
      } finally {
        dispose(e);
      }
    },
  });


  /* ---------------------------------------------------------------------------------------------- motion vectors */
  /** A 4-frame 2x2 flipbook (32 px cells) of a noise image translating by `shift` tiles per loop (linear): frame k is shifted by shift * (2k / 8). */
  const MV_LOOP = 8;
  const MV_SHIFT = 1; // tiles per loop => 8 px between two flipbook frames
  const MV_PX = (MV_SHIFT * 2 * 32) / MV_LOOP;
  function translatingSource(e: Engine, g: ReturnType<typeof mk>): string {
    const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [3, 3], octaves: 1, seed: 5 });
    const t = add(g, 'utils.transform', { edge: 'wrap' });
    link(g, n, t, 'input');
    const def = e.registry.expanded('utils.transform')!.params.find((q) => q.id === 'translate')!;
    let tr = setTrackKey(undefined, def, 0, [0, 0]);
    tr = setTrackKey(tr, def, MV_LOOP, [MV_SHIFT, 0]);
    if (tr.kind === 'num') tr = { kind: 'num', ch: tr.ch.map((c) => loopMatch({ ...c, keys: c.keys.map((k) => ({ ...k, interp: 'linear' as const })) }, undefined, false)) };
    g.setNodeTrack(t, 'translate', tr);
    return t;
  }
  const waitBaker = async (e: Engine): Promise<void> => {
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 30));
    while (e.flipbooks.isBusy() && performance.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 50));
  };
  const cellOf = (data: Float32Array, w: number, ch: number, i: number, x0: number, x1: number, y0: number, y1: number, chan = 0): number[] => {
    const out: number[] = [];
    const ox = (i % 2) * 32;
    const oy = Math.floor(i / 2) * 32;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(data[((oy + y) * w + ox + x) * ch + chan]);
    return out;
  };
  const mad = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / Math.max(1, a.length);
  const FLOW = { levels: 4, iterations: 16, max_disp: 16, consistency: true, loop_wrap: false };
  const OPT: EvalOptions = { useCache: false };

  tests.push({
    name: '9B · Motion Vector Generate: recovers the translation of a baked flipbook (vector ~ 8 px / 32 px cell) and writes an occlusion mask',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64, { tiling: 'both', fps: 30, loopLength: MV_LOOP });
        const src = translatingSource(e, g);
        const enc = add(g, 'utils.sheet_encode', { frames: 4, auto_grid: false, cols: 2, rows: 2 });
        link(g, src, enc, 'input');
        const mg = add(g, 'vector.motion_generate', FLOW);
        link(g, enc, mg, 'flipbook', 'flipbook');
        await readPin(e, g, mg, 'sheet', 0, OPT).catch(() => undefined); // requests the bake
        await waitBaker(e);
        const v = await readPin(e, g, mg, 'sheet', 0, OPT);
        if (!finite(v.data)) throw new Error('non-finite vectors');
        // frames 0..2 have a successor; the interior (away from the left strip that enters the cell) must show +MV_PX / 32 in x
        const want = MV_PX / 32;
        const worst: string[] = [];
        for (let i = 0; i < 3; i++) {
          const vx = cellOf(v.data, v.w, v.ch, i, 12, 28, 6, 26);
          const vy = cellOf(v.data, v.w, v.ch, i, 12, 28, 6, 26, 1);
          const mean = vx.reduce((a, b) => a + b, 0) / vx.length;
          const meanY = vy.reduce((a, b) => a + b, 0) / vy.length;
          if (Math.abs(meanY) > want * 0.35) throw new Error(`cell ${i}: mean vy ${meanY.toFixed(4)} should be ~0`);
          if (Math.abs(Math.abs(mean) - want) > want * 0.4) throw new Error(`cell ${i}: mean |vx| ${Math.abs(mean).toFixed(4)}, expected ${want.toFixed(4)} +-40%`);
          worst.push(mean.toFixed(3));
        }
        const o = await readPin(e, g, mg, 'occlusion', 0, OPT);
        if (!finite(o.data) || o.data.some((x) => x < -1e-3 || x > 1.001)) throw new Error('occlusion outside [0, 1]');
        return `mean vx per cell ${worst.join(' / ')} (expected +-${want.toFixed(3)})`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '9B · Motion Vector Interpolate: 4 -> 8 frames, the in-between frame is closer to the true frame than a cross-fade',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64, { tiling: 'both', fps: 30, loopLength: MV_LOOP });
        const src = translatingSource(e, g);
        const enc = add(g, 'utils.sheet_encode', { frames: 4, auto_grid: false, cols: 2, rows: 2 });
        link(g, src, enc, 'input');
        const mg = add(g, 'vector.motion_generate', FLOW);
        link(g, enc, mg, 'flipbook', 'flipbook');
        const ip = add(g, 'vector.motion_interpolate', { mode: 'count', count: 8, loop_wrap: false });
        link(g, enc, ip, 'flipbook', 'flipbook');
        link(g, mg, ip, 'motion', 'motion');
        await readPin(e, g, ip, 'sheet', 0, OPT).catch(() => undefined);
        await waitBaker(e);
        const out = await readPin(e, g, ip, 'sheet', 0, OPT);
        if (!finite(out.data)) throw new Error('non-finite output');
        // output frame 1 sits half-way between source frames 0 and 1 (animation frame 1): compare with the exact render
        const cols = Math.round(out.w / 32);
        const oc = (i: number, data: Float32Array, w: number, c: number): number[] => {
          const ox = (i % cols) * 32;
          const oy = Math.floor(i / cols) * 32;
          const r: number[] = [];
          for (let y = 6; y < 26; y++) for (let x = 14; x < 30; x++) r.push(data[((oy + y) * w + ox + x) * c]);
          return r;
        };
        const truth = await read(e, g, src, { time: 1 / 30, scale: 0.5, useCache: false });
        const a0 = await read(e, g, src, { time: 0, scale: 0.5, useCache: false });
        const a1 = await read(e, g, src, { time: 2 / 30, scale: 0.5, useCache: false });
        const crop = (d: Float32Array, c: number): number[] => {
          const r: number[] = [];
          for (let y = 6; y < 26; y++) for (let x = 14; x < 30; x++) r.push(d[(y * 32 + x) * c]);
          return r;
        };
        const tv = crop(truth.data, truth.ch);
        const fade = crop(a0.data, a0.ch).map((x, i) => 0.5 * (x + crop(a1.data, a1.ch)[i]));
        const eWarp = mad(oc(1, out.data, out.w, out.ch), tv);
        const eFade = mad(fade, tv);
        if (!(eWarp < eFade)) throw new Error(`warped frame error ${eWarp.toFixed(4)} is not below the cross-fade error ${eFade.toFixed(4)}`);
        const prev = await readPin(e, g, ip, 'preview', 0, OPT);
        if (!finite(prev.data)) throw new Error('preview is not finite');
        return `${out.w}x${out.h} sheet; warp err ${eWarp.toFixed(4)} < cross-fade err ${eFade.toFixed(4)}`;
      } finally {
        dispose(e);
      }
    },
  });

  return tests;
}
