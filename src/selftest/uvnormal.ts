import { targetKey } from '../engine/graph/evaluator';
import type { Engine } from '../engine/engine';
import type { Graph, GraphSettings } from '../engine/graph/graph';
import type { ParamValue } from '../engine/params/schema';
import { readTextureFloat32 } from '../engine/resources/readback';
import type { TextureValue } from '../engine/resources/values';
import { fromHalf, islandMapValue, islandRand, islandStats, labelIslands } from '../nodes/_shared/islands';
import { polarC2P, polarDefaults, polarP2C, type PolarRef } from '../nodes/_shared/polar';
import { normalFromHeight } from '../nodes/normal/create/definition';
import type { Helpers } from './generators';
import type { Env, TestDef } from './tests';
import { pushVisual, type VisualCell } from './visuals';

/**
 * GPU tests for UV, normal and island nodes. Names start with `4B ·`. Families:
 *   - every node x gallery variant: finite output on every pin and the texture / buffer pools return to baseline (no leaks),
 *   - known answers: UV convention (absolute vs offset, sign), Transform vs utils.transform, codec round trips, Flow phases,
 *     polar mapping vs the CPU mirror, normal create vs CPU, combine identities, converters,
 *   - ISLANDS: GPU labels vs exact union-find on the CPU (tiling + 4 / 8 connectivity), Island Map / size / centre / id vs CPU stats,
 *     cross-node id consistency, padding vs brute force distance, roll (wrap) invariance,
 *   - VISUAL grids (shown under the test list) and timing at 1024^2.
 */
type Params = Record<string, ParamValue>;
interface R {
  data: Float32Array;
  ch: number;
  w: number;
  h: number;
}
const N = 64;
const TOL = 2.5e-3; // half-float output + one bilinear lookup

export function uvNormalIslandTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link } = h;
  const tests: TestDef[] = [];
  const noiseP = (extra: Params = {}): Params => ({ noise_type: 'perlin', scale: [5, 5], octaves: 3, seed: 3, ...extra });

  async function evalPins(e: Engine, g: Graph, targets: { id: string; pin?: string }[]): Promise<R[]> {
    const res = await e.evaluator.evaluate(g, targets.map((t) => ({ nodeId: t.id, pinId: t.pin ?? 'output' })), { useCache: false });
    try {
      const out: R[] = [];
      for (const t of targets) {
        const err = res.errors.get(t.id);
        if (err) throw new Error(`node failed: ${err}`);
        const v = res.values.get(targetKey({ nodeId: t.id, pinId: t.pin ?? 'output' })) as TextureValue | undefined;
        if (!v || v.kind !== 'texture') throw new Error(`no texture on pin ${t.pin ?? 'output'}`);
        const data = await readTextureFloat32(e.gpu, e.mm, v.tex.texture, v.tex.format, v.width, v.height);
        out.push({ data, ch: data.length / (v.width * v.height), w: v.width, h: v.height });
      }
      return out;
    } finally {
      res.release();
    }
  }
  async function graph(env: Env, size: number, build: (g: Graph) => { id: string; pin?: string }[], settings: Partial<GraphSettings> = { tiling: 'both' }): Promise<R[]> {
    const e = engineOf(env);
    try {
      const g = mk(e, size, settings);
      return await evalPins(e, g, build(g));
    } finally {
      dispose(e);
    }
  }
  const noise = (g: Graph, extra: Params = {}): string => add(g, 'grayscale.noise', noiseP(extra));
  const chan = (r: R, c: number): Float32Array => {
    const o = new Float32Array(r.w * r.h);
    for (let i = 0; i < o.length; i++) o[i] = r.data[i * r.ch + c];
    return o;
  };
  const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>, skip?: (i: number) => boolean): number => {
    let m = 0;
    for (let i = 0; i < a.length; i++) if (!skip || !skip(i)) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
  };
  const must = (what: string, d: number, tol: number): void => {
    if (!(d <= tol)) throw new Error(`${what}: error ${d.toExponential(2)} (tolerance ${tol})`);
  };
  const warp = (g: Graph, src: string, uvNode: string, uvPin = 'output'): string => {
    const t = add(g, 'utils.transform', {});
    link(g, src, t, 'input');
    link(g, uvNode, t, 'uv', uvPin);
    return t;
  };

  /* ---------------------------------------------------------------- every node: finite + no leaks */
  const IDS = [
    ...['identity', 'transform', 'noise', 'directional', 'radial', 'rotational', 'spline', 'flow', 'from_grayscale', 'blend', 'blur', 'cartesian_to_polar'].map((n) => `uv.${n}`),
    ...['create', 'combine', 'color_to_normal', 'normal_to_color', 'normal_merge', 'normal_split'].map((n) => `normal.${n}`),
    ...['generate', 'padding', 'to_color', 'to_gradient', 'to_grayscale', 'to_uv'].map((n) => `islands.${n}`),
    ...['cartesian_to_polar', 'cartesian_to_polar_color', 'polar_to_cartesian', 'polar_to_cartesian_color', 'color_to_uv', 'uv_to_color', 'uv_merge', 'uv_split'].map((n) => `utils.${n}`),
  ];
  function feed(g: Graph, type: string, pinId: string, category: string, k: number): { id: string; pin: string } | null {
    if (type === 'uv') return { id: add(g, 'uv.noise', { seed: 4 + k, strength: 0.06 }), pin: 'output' };
    if (type === 'normal') {
      const n = add(g, 'normal.create', {});
      link(g, noise(g, { seed: 6 + k }), n, 'input');
      return { id: n, pin: 'output' };
    }
    if (category === 'islands' && pinId === 'islands') {
      const n = add(g, 'islands.generate', { threshold: 0.52 });
      link(g, noise(g, { seed: 8, scale: [6, 6] }), n, 'input');
      return { id: n, pin: 'islands' };
    }
    if (type === 'gray' || type === 'color') return { id: noise(g, { seed: 5 + k * 3 }), pin: 'output' };
    return null;
  }
  tests.push({
    name: '4B · every node x gallery variant: finite output on every pin, pools return to baseline (no leaks)',
    async run(env) {
      const lines: string[] = [];
      for (const id of IDS) {
        const d = env.registry.get(id);
        if (!d) throw new Error(`${id} is not registered`);
        const e = engineOf(env);
        try {
          const base = { tex: e.mm.textures.liveBytes, buf: e.mm.buffers.liveBytes - e.arena.heldBytes };
          const variants: { name: string; params: Params }[] = [{ name: 'default', params: {} }, ...(d.gallery ?? [])];
          for (const v of variants) {
            const g = mk(e, 64, { tiling: 'both' });
            const node = g.addNode(d.id, { params: v.params }).id;
            let k = 0;
            for (const pin of d.inputs) {
              if (pin.role === 'modulation' || k >= 3) continue;
              const f = feed(g, pin.type, pin.id, d.category, k);
              if (!f) continue;
              g.connect({ node: f.id, pin: f.pin }, { node, pin: pin.id });
              k++;
            }
            const targets = d.outputs.filter((o) => ['gray', 'color', 'uv', 'normal'].includes(o.type)).map((o) => ({ id: node, pin: o.id }));
            const rs = await evalPins(e, g, targets);
            rs.forEach((r, i) => {
              for (const x of r.data) if (!Number.isFinite(x)) throw new Error(`${d.id}/${v.name}: NaN / Infinity on pin ${targets[i].pin}`);
            });
          }
          e.evaluator.cache.clear();
          // the uniform arena keeps a few chunks on purpose (bounded cache): not a leak
          const after = { tex: e.mm.textures.liveBytes, buf: e.mm.buffers.liveBytes - e.arena.heldBytes };
          if (after.tex !== base.tex || after.buf !== base.buf) throw new Error(`${d.id}: LEAK, texture bytes ${base.tex} -> ${after.tex}, buffer bytes ${base.buf} -> ${after.buf}`);
          lines.push(`${d.id}: ${variants.length} variants OK`);
        } finally {
          dispose(e);
        }
      }
      return lines.join('\n');
    },
  });

  /* ---------------------------------------------------------------- UV pin convention */
  tests.push({
    name: '4B · UV Identity: absolute = own pixel-centre uv, offset = 0',
    async run(env) {
      const [a, o] = await graph(env, 16, (g) => [{ id: add(g, 'uv.identity', {}) }, { id: add(g, 'uv.identity', { uv_out: 'offset' }) }]);
      let d = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d = Math.max(d, Math.abs(a.data[(y * 16 + x) * 2] - (x + 0.5) / 16), Math.abs(a.data[(y * 16 + x) * 2 + 1] - (y + 0.5) / 16));
      must('absolute identity', d, 1e-3);
      must('offset identity', maxDiff(o.data, new Float32Array(o.data.length)), 1e-6);
      return `${a.ch} channels, abs err ${d.toExponential(1)}`;
    },
  });
  tests.push({
    name: '4B · UV Directional: content moves along the angle (lookup delta = -dir * strength); absolute - own uv == offset',
    async run(env) {
      const [off, abs] = await graph(env, N, (g) => [{ id: add(g, 'uv.directional', { angle: 0, strength: 0.1, uv_out: 'offset' }) }, { id: add(g, 'uv.directional', { angle: 90, strength: 0.1, uv_out: 'absolute' }) }]);
      must('offset dx = -strength', maxDiff(chan(off, 0), new Float32Array(N * N).fill(-0.1)), TOL);
      must('offset dy = 0', maxDiff(chan(off, 1), new Float32Array(N * N)), TOL);
      let d = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        d = Math.max(d, Math.abs(abs.data[(y * N + x) * 2] - (x + 0.5) / N), Math.abs(abs.data[(y * N + x) * 2 + 1] - ((y + 0.5) / N - 0.1)));
      }
      must('absolute = uv + delta (angle 90 = down)', d, TOL);
    },
  });
  tests.push({
    name: '4B · UV Transform with a Transform2D equals Utils Transform with the same parameters (sampled image)',
    async run(env) {
      const p = { translate: [0.125, -0.25], rotation: 30, scale: [1.5, 0.75], pivot: [0.4, 0.6], skew: [10, 0] } as Params;
      const [viaUv, direct] = await graph(env, N, (g) => {
        const src = noise(g);
        const uvT = add(g, 'uv.transform', p);
        const t1 = warp(g, src, uvT);
        const t2 = add(g, 'utils.transform', { ...p, edge: 'wrap' });
        link(g, src, t2, 'input');
        return [{ id: t1 }, { id: t2 }];
      });
      const d = maxDiff(viaUv.data, direct.data);
      must('field-warped vs direct transform', d, 0.02);
      return `max diff ${d.toExponential(1)} (two half-float rounds)`;
    },
  });
  tests.push({
    name: '4B · UV Blur keeps the identity field exactly neutral, even without tiling (blur runs on deltas)',
    async run(env) {
      const [r] = await graph(env, N, (g) => {
        const id = add(g, 'uv.identity', {});
        const b = add(g, 'uv.blur', { radius: 0.2 });
        link(g, id, b);
        return [{ id: b }];
      }, { tiling: 'none' });
      let d = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) d = Math.max(d, Math.abs(r.data[(y * N + x) * 2] - (x + 0.5) / N), Math.abs(r.data[(y * N + x) * 2 + 1] - (y + 0.5) / N));
      must('identity after blur', d, 2e-3);
    },
  });
  tests.push({
    name: '4B · UV Blend: add / compose of constant fields (offset mode)',
    async run(env) {
      const [add2, comp] = await graph(env, N, (g) => {
        const a = add(g, 'uv.directional', { angle: 0, strength: 0.1, uv_out: 'offset' });
        const b = add(g, 'uv.directional', { angle: 90, strength: 0.05, uv_out: 'offset' });
        const m1 = add(g, 'uv.blend', { op: 'add', uv_in_a: 'offset', uv_in_b: 'offset', uv_out: 'offset' });
        const m2 = add(g, 'uv.blend', { op: 'compose', uv_in_a: 'offset', uv_in_b: 'offset', uv_out: 'offset' });
        for (const m of [m1, m2]) {
          link(g, a, m, 'a');
          link(g, b, m, 'b');
        }
        return [{ id: m1 }, { id: m2 }];
      });
      for (const r of [add2, comp]) {
        must('dx', maxDiff(chan(r, 0), new Float32Array(N * N).fill(-0.1)), TOL);
        must('dy', maxDiff(chan(r, 1), new Float32Array(N * N).fill(-0.05)), TOL);
      }
    },
  });
  tests.push({
    name: '4B · UV to Color -> Color to UV round trip (biased flowmap, flow sign, flip Y) and UV Merge -> Split',
    async run(env) {
      const [orig, back, mergeSplit] = await graph(env, N, (g) => {
        const n = add(g, 'uv.noise', { strength: 0.08, uv_out: 'offset', seed: 2 });
        const enc = add(g, 'utils.uv_to_color', { uv_in: 'offset', codec: 'biased', range: 0.2, flip_y: true, flow_sign: 'flow' });
        link(g, n, enc);
        const dec = add(g, 'utils.color_to_uv', { codec: 'biased', range: 0.2, flip_y: true, flow_sign: 'flow', uv_out: 'offset' });
        link(g, enc, dec);
        const sp = add(g, 'utils.uv_split', { uv_in: 'offset', output: 'biased', range: 0.2 });
        link(g, n, sp);
        const mg = add(g, 'utils.uv_merge', { source: 'biased', range: 0.2, uv_out: 'offset' });
        link(g, sp, mg, 'u', 'u');
        link(g, sp, mg, 'v', 'v');
        return [{ id: n }, { id: dec }, { id: mg }];
      });
      const d1 = maxDiff(orig.data, back.data);
      const d2 = maxDiff(orig.data, mergeSplit.data);
      must('uv -> color -> uv', d1, 2e-3);
      must('split -> merge', d2, 2e-3);
      return `codec ${d1.toExponential(1)}, merge/split ${d2.toExponential(1)}`;
    },
  });
  tests.push({
    name: '4B · UV Flow: weight = triangle(phase), UV A / B offsets follow the two-phase formula, phase loops',
    async run(env) {
      const q = (phase: number) => graph(env, 16, (g) => {
        const d = add(g, 'uv.directional', { angle: 0, strength: 0.2, uv_out: 'offset' });
        const f = add(g, 'uv.flow', { use_loop: false, phase, phase_noise: 0, strength: 1, uv_in: 'offset', uv_out: 'offset', smooth_weight: false });
        link(g, d, f, 'flow');
        return [{ id: f, pin: 'weight' }, { id: f, pin: 'uv_a' }, { id: f, pin: 'uv_b' }];
      });
      const [w0, a0] = await q(0);
      must('weight at phase 0', maxDiff(w0.data, new Float32Array(w0.data.length)), 1e-3);
      must('uv_a at phase 0: d * (0 - 0.5)', Math.abs(a0.data[0] - 0.5 * 0.2), TOL); // d = -0.2 -> offset = -0.2 * (pa - 0.5) = +0.1
      const [w25, a25, b25] = await q(0.25);
      must('weight at phase 0.25', Math.abs(w25.data[0] - 0.5), 1e-3);
      must('uv_a at phase .25', Math.abs(a25.data[0] - -0.2 * (0.25 - 0.5)), TOL);
      must('uv_b at phase .25', Math.abs(b25.data[0] - -0.2 * (0.75 - 0.5)), TOL);
      const [w1] = await q(1);
      must('phase 1 == phase 0 (loop)', Math.abs(w1.data[0]), 1e-3);
    },
  });

  /* ---------------------------------------------------------------- polar */
  const polarCase = (name: string, params: Params, cpu: Partial<PolarRef>): TestDef => ({
    name: `4B · Cartesian to Polar (UV) matches the CPU mirror: ${name}`,
    async run(env) {
      const [r] = await graph(env, N, (g) => [{ id: add(g, 'uv.cartesian_to_polar', { out_of_range: 'clamp', ...params }) }]);
      const pr: PolarRef = { ...polarDefaults(), oob: 0, ...cpu };
      let worst = 0;
      let n = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const uv: [number, number] = [(x + 0.5) / N, (y + 0.5) / N];
        const c = polarC2P(uv, pr);
        // skip the angular seam, the centre singularity and range edges (a half-float lookup may flip the branch there)
        const rr = Math.hypot(uv[0] - 0.5, uv[1] - 0.5);
        if (rr < 0.04 || c.u < 0.02 || c.u > 0.98 || c.v < 0.02 || c.v > 0.98) continue;
        worst = Math.max(worst, Math.abs(r.data[(y * N + x) * 2] - c.u), Math.abs(r.data[(y * N + x) * 2 + 1] - c.v));
        n++;
      }
      must(name, worst, 4e-3);
      return `${n} pixels, max error ${worst.toExponential(1)}`;
    },
  });
  tests.push(polarCase('Euclidean', { out_of_range: 'repeat' }, { oob: 1 }));
  tests.push(polarCase('Chebyshev + spiral + rotation', { metric: 'chebyshev', spiral: 0.5, rotation: 40, out_of_range: 'repeat' }, { metric: 1, spiral: 0.5, rotation: (40 * Math.PI) / 180, oob: 1 }));
  tests.push(polarCase('squircle + pinch + perspective', { metric: 'squircle', squircle: 4, pinch: 0.5, perspective: 0.4 }, { metric: 2, squircle: 4, pinch: 0.5, persp: 0.4 }));
  tests.push({
    name: '4B · Polar to Cartesian samples the source where the CPU mirror says (x-ramp source, clamp)',
    async run(env) {
      const [r] = await graph(env, N, (g) => {
        const ramp = add(g, 'utils.uv_split', { uv_in: 'absolute', output: 'absolute' });
        link(g, add(g, 'uv.identity', {}), ramp);
        const p = add(g, 'utils.polar_to_cartesian', { out_of_range: 'clamp', spiral: 0.3 });
        link(g, ramp, p, 'input', 'u');
        return [{ id: p }];
      });
      const pr: PolarRef = { ...polarDefaults(), oob: 0, spiral: 0.3 };
      let worst = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const s = polarP2C([(x + 0.5) / N, (y + 0.5) / N], pr);
        if (s[0] < 0.03 || s[0] > 0.97 || s[1] < 0.03 || s[1] > 0.97) continue;
        worst = Math.max(worst, Math.abs(r.data[y * N + x] - s[0]));
      }
      must('P2C x lookup', worst, 6e-3);
      return `max error ${worst.toExponential(1)}`;
    },
  });
  tests.push({
    name: '4B · Cartesian to Polar: the seam is continuous when the input tiles horizontally (angular wrap)',
    async run(env) {
      const [r] = await graph(env, N, (g) => {
        const c = add(g, 'utils.cartesian_to_polar', { out_of_range: 'repeat' });
        link(g, noise(g, { scale: [4, 4] }), c);
        return [{ id: c }];
      });
      // pixels just above / below the horizontal line through the centre, to the right of it, lie on both sides of the u = 0 / 1 seam
      const y = N / 2;
      let jump = 0;
      for (let x = N / 2 + 6; x < N - 2; x++) jump = Math.max(jump, Math.abs(r.data[(y - 1) * N + x] - r.data[y * N + x]));
      const smooth = Math.abs(r.data[y * N + (N / 2 + 10)] - r.data[y * N + (N / 2 + 11)]);
      if (jump > 0.35 && jump > smooth * 8) throw new Error(`visible seam: neighbouring pixels across the seam differ by ${jump.toFixed(3)}`);
      return `across-seam max step ${jump.toFixed(3)}`;
    },
  });

  /* ---------------------------------------------------------------- normals */
  tests.push({
    name: '4B · Normal Create equals the CPU reference (sobel / central / scharr, OpenGL + DirectX, tiling wrap)',
    async run(env) {
      let worst = 0;
      for (const [kernel, dx] of [['sobel', false], ['central', false], ['scharr', true]] as const) {
        const [hgt, nrm] = await graph(env, N, (g) => {
          const nz = noise(g, { seed: 9 });
          const c = add(g, 'normal.create', { kernel, y_convention: dx ? 'directx' : 'opengl', strength: 2 });
          link(g, nz, c);
          return [{ id: nz }, { id: c }];
        });
        const cpu = normalFromHeight(hgt.data, N, N, { strength: 2, heightScale: 0.05, step: 1, kernel, directx: dx, tileX: true, tileY: true });
        for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(nrm.data[i * 4 + c] - cpu[i * 3 + c]));
      }
      must('normal create', worst, 6e-3);
      return `max error ${worst.toExponential(1)} over 3 kernel / convention setups`;
    },
  });
  tests.push({
    name: '4B · Normal Combine identities, Normal Split -> Merge and Color <-> Normal round trips',
    async run(env) {
      const [base, rnmFlat, flatRnm, detailFlat, merged, viaColor] = await graph(env, N, (g) => {
        const c = add(g, 'normal.create', {});
        link(g, noise(g, { seed: 7 }), c);
        const flat = add(g, 'normal.normal_merge', {}); // no inputs = (0, 0, 1)
        const comb = (mode: string, b: string, d: string): string => {
          const n = add(g, 'normal.combine', { mode });
          link(g, b, n, 'base');
          link(g, d, n, 'detail');
          return n;
        };
        const sp = add(g, 'normal.normal_split', {});
        link(g, c, sp);
        const mg = add(g, 'normal.normal_merge', { mode: 'xyz' });
        for (const ch of ['x', 'y', 'z']) link(g, sp, mg, ch, ch);
        const col = add(g, 'normal.normal_to_color', { format: 'encoded' });
        link(g, c, col);
        const back = add(g, 'normal.color_to_normal', { source: 'rgb' });
        link(g, col, back);
        return [{ id: c }, { id: comb('reoriented', c, flat) }, { id: comb('reoriented', flat, c) }, { id: comb('detail', c, flat) }, { id: mg }, { id: back }];
      });
      const rgb = (r: R): Float32Array => Float32Array.from({ length: N * N * 3 }, (_, i) => r.data[Math.floor(i / 3) * 4 + (i % 3)]);
      const b = rgb(base);
      must('RNM(base, flat) = base', maxDiff(rgb(rnmFlat), b), 6e-3);
      must('RNM(flat, base) = base', maxDiff(rgb(flatRnm), b), 6e-3);
      must('UDN(base, flat) = base', maxDiff(rgb(detailFlat), b), 6e-3);
      must('split -> merge', maxDiff(rgb(merged), b), 8e-3);
      must('normal -> color -> normal', maxDiff(rgb(viaColor), b), 4e-3);
    },
  });

  /* ---------------------------------------------------------------- islands */
  const decodeLabels = (r: R): Int32Array => {
    const o = new Int32Array(r.w * r.h);
    for (let i = 0; i < o.length; i++) {
      const d = r.data;
      const k = i * 4;
      o[i] = d[k] < 0 ? -1 : (Math.round(d[k + 2]) * 1024 + Math.round(d[k + 3])) * r.w + Math.round(d[k]) * 1024 + Math.round(d[k + 1]);
    }
    return o;
  };
  const islandCase = (name: string, settings: Partial<GraphSettings>, params: Params, thr: number): TestDef => ({
    name: `4B · Islands Generate equals the exact CPU labelling, stats, id, size and centre: ${name}`,
    async run(env) {
      const tx = settings.tiling === 'both' || settings.tiling === 'x';
      const ty = settings.tiling === 'both' || settings.tiling === 'y';
      const eight = params.connectivity !== 'four';
      const e = engineOf(env);
      try {
        const g = mk(e, N, settings);
        const nz = noise(g, { seed: 12, scale: [7, 7], octaves: 4 });
        const gen = add(g, 'islands.generate', { threshold: thr, ...params });
        link(g, nz, gen);
        const [src, labels, map, id, size, center] = await evalPins(e, g, [{ id: nz }, { id: gen, pin: 'labels' }, { id: gen, pin: 'islands' }, { id: gen, pin: 'id' }, { id: gen, pin: 'size' }, { id: gen, pin: 'center' }]);
        const mask = Uint8Array.from(src.data, (v) => (v >= thr ? 1 : 0));
        const ref = labelIslands(mask, N, N, { tileX: tx, tileY: ty, eight });
        const gpu = decodeLabels(labels);
        let bad = 0;
        for (let i = 0; i < N * N; i++) if (gpu[i] !== ref.labels[i]) bad++;
        if (bad) throw new Error(`${bad} of ${N * N} labels differ from the exact union-find (islands: ${ref.count}); raise Rounds or check island_ccl.wgsl`);
        const stats = islandStats(ref.labels, N, N, { tileX: tx, tileY: ty });
        let dm = 0;
        let dc = 0;
        let ds = 0;
        let di = 0;
        for (let i = 0; i < N * N; i++) {
          const r = ref.labels[i];
          if (r < 0) {
            for (let c = 0; c < 4; c++) dm = Math.max(dm, Math.abs(map.data[i * 4 + c]));
            continue;
          }
          const s = stats.get(r)!;
          const ex = islandMapValue(s, N, N);
          for (let c = 0; c < 4; c++) dm = Math.max(dm, Math.abs(map.data[i * 4 + c] - ex[c]) - 1e-3 * Math.abs(ex[c]));
          const cx = (r % N + s.cx + 0.5) / N;
          const cy = (Math.floor(r / N) + s.cy + 0.5) / N;
          const wrapd = (a: number, b: number): number => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
          dc = Math.max(dc, wrapd(center.data[i * 2], cx), wrapd(center.data[i * 2 + 1], cy));
          ds = Math.max(ds, Math.abs(size.data[i] - Math.min(s.count / (N * N) / 0.1, 1)));
          const m = [0, 1, 2, 3].map((c) => map.data[i * 4 + c]);
          di = Math.max(di, Math.abs(id.data[i] - fromHalf(islandRand(m, 1))));
        }
        must('Island Map vs CPU bounding boxes', dm, 2e-3);
        must('Centre vs CPU centre of mass', dc, 4e-3);
        must('Size vs CPU pixel count', ds, 3e-3);
        must('ID vs CPU hash', di, 1.2e-3);
        return `${ref.count} islands, labels exact; map ${dm.toExponential(1)}, centre ${dc.toExponential(1)}, size ${ds.toExponential(1)}, id ${di.toExponential(1)}`;
      } finally {
        dispose(e);
      }
    },
  });
  tests.push(islandCase('tiling both, 8-connected', { tiling: 'both' }, { connectivity: 'eight' }, 0.5));
  tests.push(islandCase('no tiling, 4-connected', { tiling: 'none' }, { connectivity: 'four' }, 0.47));
  tests.push(islandCase('horizontal tiling, 8-connected, inverted-ish threshold', { tiling: 'x' }, { connectivity: 'eight', invert: true }, 0.55));
  tests.push({
    name: '4B · Islands: a rolled mask has the same number of islands (wrap invariance) and To Grayscale (random) == ID output',
    async run(env) {
      const [a, b, id, tog] = await graph(env, N, (g) => {
        const nz = noise(g, { seed: 21, scale: [6, 6] });
        const g1 = add(g, 'islands.generate', { seed: 3 });
        link(g, nz, g1);
        const tr = add(g, 'utils.transform', { translate: [8 / N, 5 / N], edge: 'tiling' });
        link(g, nz, tr);
        const g2 = add(g, 'islands.generate', {});
        link(g, tr, g2);
        const tg = add(g, 'islands.to_grayscale', { mode: 'random', seed: 3 });
        link(g, g1, tg, 'islands', 'islands');
        return [{ id: g1, pin: 'labels' }, { id: g2, pin: 'labels' }, { id: g1, pin: 'id' }, { id: tg }];
      });
      const ca = new Set(decodeLabels(a)).size;
      const cb = new Set(decodeLabels(b)).size;
      if (ca !== cb) throw new Error(`island count changed under a wrap roll: ${ca} vs ${cb}`);
      must('To Grayscale random == Generate ID', maxDiff(id.data, tog.data), 1.5e-3);
      return `${ca} labels both ways`;
    },
  });
  tests.push({
    name: '4B · Islands Padding grows islands by the distance (vs brute force) and keeps the map consistent',
    async run(env) {
      const dist = 0.06;
      const [src, before, after] = await graph(env, N, (g) => {
        const nz = noise(g, { seed: 31, scale: [6, 6] });
        const gen = add(g, 'islands.generate', { threshold: 0.6 });
        link(g, nz, gen);
        const pad = add(g, 'islands.padding', { distance: dist, shape: 'euclidean', expand_bounds: false });
        link(g, gen, pad, 'islands', 'islands');
        return [{ id: nz }, { id: gen, pin: 'islands' }, { id: pad }];
      });
      const on = (i: number): boolean => src.data[i] >= 0.6;
      const pts: number[] = [];
      for (let i = 0; i < N * N; i++) if (on(i)) pts.push(i);
      let mismatch = 0;
      const limit = dist * N;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let best = 1e9;
        for (const p of pts) {
          let dx = Math.abs((p % N) - x);
          let dy = Math.abs(Math.floor(p / N) - y);
          dx = Math.min(dx, N - dx);
          dy = Math.min(dy, N - dy);
          best = Math.min(best, dx * dx + dy * dy);
        }
        const valid = after.data[(y * N + x) * 4 + 2] > 0;
        const expect = Math.sqrt(best) <= limit;
        if (valid !== expect && Math.abs(Math.sqrt(best) - limit) > 1.2) mismatch++;
      }
      let keep = 0;
      for (let i = 0; i < N * N; i++) if (before.data[i * 4 + 2] > 0) for (let c = 0; c < 4; c++) keep = Math.max(keep, Math.abs(after.data[i * 4 + c] - before.data[i * 4 + c]));
      if (mismatch > N * N * 0.01) throw new Error(`${mismatch} pixels disagree with the brute force distance`);
      must('island pixels keep their map', keep, 1e-6);
      return `${pts.length} island px, ${mismatch} boundary mismatches`;
    },
  });
  tests.push({
    name: '4B · Islands To UV / To Gradient: local coordinates span 0..1 in every island, mask = coverage',
    async run(env) {
      const [map, uvr, mask, gr] = await graph(env, N, (g) => {
        const gen = add(g, 'islands.generate', { threshold: 0.55 });
        link(g, noise(g, { seed: 41, scale: [4, 4] }), gen);
        const uv = add(g, 'islands.to_uv', { fit: 'stretch', uv_out: 'absolute' });
        link(g, gen, uv, 'islands', 'islands');
        const grd = add(g, 'islands.to_gradient', { mode: 'direction', keep_aspect: false });
        link(g, gen, grd, 'islands', 'islands');
        return [{ id: gen, pin: 'islands' }, { id: uv }, { id: uv, pin: 'mask' }, { id: grd }];
      });
      let lo = [1, 1];
      const hi = [0, 0];
      let glo = 1;
      let ghi = 0;
      let covered = 0;
      for (let i = 0; i < N * N; i++) {
        const inside = map.data[i * 4 + 2] > 0;
        if (inside !== mask.data[i] > 0.5) throw new Error('mask output differs from the Island Map coverage');
        if (!inside) continue;
        covered++;
        for (let c = 0; c < 2; c++) {
          lo[c] = Math.min(lo[c], uvr.data[i * 2 + c]);
          hi[c] = Math.max(hi[c], uvr.data[i * 2 + c]);
        }
        glo = Math.min(glo, gr.data[i]);
        ghi = Math.max(ghi, gr.data[i]);
      }
      if (covered < 50) throw new Error('test mask has too few island pixels');
      lo = lo.map((v) => v);
      if (lo[0] > 0.2 || lo[1] > 0.2 || hi[0] < 0.8 || hi[1] < 0.8) throw new Error(`local UV range ${lo.map((v) => v.toFixed(2))} .. ${hi.map((v) => v.toFixed(2))} does not span 0..1`);
      if (glo > 0.15 || ghi < 0.85) throw new Error(`gradient range ${glo.toFixed(2)}..${ghi.toFixed(2)} does not span 0..1`);
      return `UV ${lo.map((v) => v.toFixed(2))}..${hi.map((v) => v.toFixed(2))}, gradient ${glo.toFixed(2)}..${ghi.toFixed(2)}`;
    },
  });

  /* ---------------------------------------------------------------- visual known-answer grids */
  const cell = (label: string, r: R, mode?: 'signed'): VisualCell => ({ label, w: r.w, h: r.h, ch: r.ch === 4 ? 4 : r.ch, data: r.data, mode });
  tests.push({
    name: '4B · VISUAL: UV warps applied to a grid (identity must look like the plain grid)',
    async run(env) {
      const S = 96;
      const variants: [string, string, Params, string?][] = [
        ['identity', 'uv.identity', {}],
        ['transform 30°', 'uv.transform', { rotation: 30, scale: [1, 1] }],
        ['noise vector', 'uv.noise', { mode: 'vector', strength: 0.05 }],
        ['noise curl', 'uv.noise', { mode: 'curl', strength: 0.12, scale: [3, 3] }],
        ['noise angle', 'uv.noise', { mode: 'angle', strength: 0.08 }],
        ['directional 45°', 'uv.directional', { angle: 45, strength: 0.15 }],
        ['radial push', 'uv.radial', { strength: 0.15, radius: 0.45 }],
        ['radial pull', 'uv.radial', { strength: -0.15, radius: 0.45 }],
        ['rotational 120°', 'uv.rotational', { angle: 120, radius: 0.45 }],
        ['spline flow', 'uv.spline', { strength: 0.2, width: 0.2 }],
        ['polar', 'uv.cartesian_to_polar', { perspective: 0.3 }],
      ];
      const rs = await graph(env, S, (g) => {
        const grid = add(g, 'utils.grid', {});
        return variants.map(([, type, p]) => ({ id: warp(g, grid, add(g, type, p)) }));
      });
      pushVisual({ title: 'UV nodes (absolute output) sampling a grid through Utils > Transform UV pin', note: 'Expect: identity = untouched grid; radial push bulges outwards, pull pinches; rotational twists the centre; polar shows concentric rings / rays; spline bends the grid along the curve.', cells: rs.map((r, i) => cell(variants[i][0], r)) });
      return `${rs.length} panels`;
    },
  });
  tests.push({
    name: '4B · VISUAL: Flow, From Grayscale, Blur and codecs',
    async run(env) {
      const S = 96;
      const rs = await graph(env, S, (g) => {
        const dir = add(g, 'uv.directional', { angle: 0, strength: 0.3 });
        const nz = add(g, 'uv.noise', { mode: 'curl', strength: 0.3, scale: [3, 3] });
        const flow = add(g, 'uv.flow', { use_loop: false, phase: 0.25, phase_noise: 0.3 });
        link(g, nz, flow, 'flow');
        link(g, add(g, 'utils.grid', {}), flow, 'source');
        const fg = add(g, 'uv.from_grayscale', { strength: 0.05 });
        link(g, noise(g, { seed: 5, scale: [3, 3] }), fg);
        const blurred = add(g, 'uv.blur', { radius: 0.15 });
        link(g, add(g, 'uv.noise', { strength: 0.1, scale: [8, 8] }), blurred);
        const enc = add(g, 'utils.uv_to_color', { codec: 'biased' });
        link(g, nz, enc);
        return [{ id: dir }, { id: nz }, { id: flow, pin: 'weight' }, { id: flow, pin: 'result' }, { id: fg }, { id: blurred }, { id: enc }];
      });
      const labels = ['directional (abs)', 'curl noise (abs)', 'flow weight A', 'flow result @0.25', 'from grayscale (abs)', 'blurred noise (abs)', 'biased flowmap (RGB)'];
      pushVisual({ title: 'Flow / From Grayscale / Blur / UV to Color', note: 'Biased flowmap must be mid-grey-green where the field is neutral; flow weight is a flat 50% at phase 0.25.', cells: rs.map((r, i) => cell(labels[i], r)) });
    },
  });
  tests.push({
    name: '4B · VISUAL: polar conversions of a stripe pattern and of a ring pattern',
    async run(env) {
      const S = 96;
      const variants: [string, string, Params][] = [
        ['C2P euclid', 'utils.cartesian_to_polar', { angular_tiling: 4, radial_tiling: 3 }],
        ['C2P square', 'utils.cartesian_to_polar', { metric: 'chebyshev', angular_tiling: 4, radial_tiling: 3 }],
        ['C2P squircle', 'utils.cartesian_to_polar', { metric: 'squircle', squircle: 4, angular_tiling: 4, radial_tiling: 3 }],
        ['C2P spiral', 'utils.cartesian_to_polar', { spiral: 1, angular_tiling: 4, radial_tiling: 3 }],
        ['C2P tunnel', 'utils.cartesian_to_polar', { perspective: 0.7, angular_tiling: 4, radial_tiling: 3 }],
        ['C2P half aperture', 'utils.cartesian_to_polar', { angle: 180, angular_tiling: 2, out_of_range: 'transparent' }],
        ['P2C euclid', 'utils.polar_to_cartesian', {}],
        ['P2C square', 'utils.polar_to_cartesian', { metric: 'chebyshev' }],
      ];
      const rs = await graph(env, S, (g) => {
        const grid = add(g, 'utils.grid', {});
        return variants.map(([, type, p]) => {
          const n = add(g, type, p);
          link(g, grid, n);
          return { id: n };
        });
      });
      pushVisual({ title: 'Cartesian <-> Polar of a grid', note: 'C2P: vertical lines become rays, horizontal lines become rings (squares for Chebyshev); P2C is the inverse. Tunnel compresses towards the centre.', cells: rs.map((r, i) => cell(variants[i][0], r)) });
    },
  });
  tests.push({
    name: '4B · VISUAL: normals (kernels, DirectX, combine) and islands (map, id, size, centre, padding, colour, gradients, gray, UV)',
    async run(env) {
      const S = 96;
      const rs = await graph(env, S, (g) => {
        const nz = noise(g, { seed: 9, scale: [5, 5] });
        const nrm = (p: Params): string => {
          const c = add(g, 'normal.create', p);
          link(g, nz, c);
          return c;
        };
        const detail = add(g, 'normal.create', { strength: 2 });
        link(g, noise(g, { seed: 77, scale: [24, 24], octaves: 2 }), detail);
        const comb = add(g, 'normal.combine', { mode: 'reoriented' });
        link(g, nrm({}), comb, 'base');
        link(g, detail, comb, 'detail');
        const gen = add(g, 'islands.generate', { threshold: 0.55 });
        link(g, noise(g, { seed: 12, scale: [4, 4] }), gen);
        const via = (type: string, p: Params, pin = 'output'): { id: string; pin: string } => {
          const n = add(g, type, p);
          link(g, gen, n, 'islands', 'islands');
          return { id: n, pin };
        };
        const pad = add(g, 'islands.padding', { distance: 0.04 });
        link(g, gen, pad, 'islands', 'islands');
        const padColor = add(g, 'islands.to_color', {});
        link(g, pad, padColor, 'islands', 'output');
        const uv = via('islands.to_uv', { fit: 'stretch' });
        const checker = warp(g, add(g, 'utils.grid', {}), uv.id);
        return [
          { id: nrm({}) }, { id: nrm({ kernel: 'central' }) }, { id: nrm({ y_convention: 'directx' }) }, { id: comb },
          { id: gen, pin: 'islands' }, { id: gen, pin: 'id' }, { id: gen, pin: 'size' }, { id: gen, pin: 'center' },
          { id: padColor }, via('islands.to_color', {}), via('islands.to_color', { mode: 'gradient' }),
          via('islands.to_gradient', { mode: 'direction', angle_random: 1 }), via('islands.to_gradient', { mode: 'center' }), via('islands.to_gradient', { mode: 'box' }),
          via('islands.to_grayscale', { mode: 'area', size_reference: 0.5 }), { id: checker },
        ];
      });
      const labels = ['normal sobel', 'normal central', 'normal DirectX', 'combine RNM', 'island map', 'id', 'size', 'centre (abs uv)', 'padded + coloured', 'to color random', 'to color gradient', 'gradient dir random', 'gradient from centre', 'gradient box', 'gray by area', 'grid in island UV'];
      pushVisual({ title: 'Normals and Islands', note: 'Island map shows flat colour regions (bbox encoded in rgba); every island has ONE id / colour; "grid in island UV" shows one stretched grid per island; padded islands bleed outwards by 4%.', cells: rs.map((r, i) => cell(labels[i], r)) });
    },
  });

  /* ---------------------------------------------------------------- timing */
  tests.push({
    name: '4B · Timing at 1024² (wall clock incl. GPU completion, no cache): Islands Generate, Padding, Normal Create, UV Noise, Cartesian to Polar',
    async run(env) {
      const e = engineOf(env);
      const lines: string[] = [];
      try {
        const g = mk(e, 1024, { tiling: 'both' });
        const nz = noise(g, { scale: [8, 8], seed: 2 });
        const gen = add(g, 'islands.generate', { threshold: 0.55 });
        link(g, nz, gen);
        const pad = add(g, 'islands.padding', { distance: 0.02 });
        link(g, gen, pad, 'islands', 'islands');
        const nrm = add(g, 'normal.create', {});
        link(g, nz, nrm);
        const un = add(g, 'uv.noise', { octaves: 3, mode: 'curl' });
        const pol = add(g, 'utils.cartesian_to_polar', { perspective: 0.3 });
        link(g, nz, pol);
        for (const [label, id, pin] of [['islands generate (5 outputs)', gen, 'islands'], ['islands padding (needs generate cached)', pad, 'output'], ['normal create', nrm, 'output'], ['uv noise curl 3 oct', un, 'output'], ['cartesian to polar', pol, 'output']] as const) {
          const t0 = performance.now();
          const res = await e.evaluator.evaluate(g, [{ nodeId: id, pinId: pin }], { useCache: label.includes('padding') });
          await e.gpu.device.queue.onSubmittedWorkDone();
          const ms = performance.now() - t0;
          const err = res.errors.get(id);
          res.release();
          if (err) throw new Error(`${label}: ${err}`);
          lines.push(`${label}: ${ms.toFixed(1)} ms`);
        }
      } finally {
        dispose(e);
      }
      return lines.join('\n');
    },
  });
  return tests;
}
