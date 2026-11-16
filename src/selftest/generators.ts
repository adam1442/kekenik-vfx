import type { Engine } from '../engine/engine';
import type { Graph, GraphSettings } from '../engine/graph/graph';
import type { EvalOptions } from '../engine/graph/evaluator';
import type { ParamValue } from '../engine/params/schema';
import type { Env, TestDef } from './tests';

/**
 * GPU known-answer / property tests for the generators (Noise v2, Fractal, Shape, Gradient, Polar Scatter,
 * Uniform). Registered from tests.ts through `generatorTests(helpers)` (no import cycle).
 *
 * Test families:
 *   - range/finite     every node x defaults + curated gallery variants renders finite values (and [0,1] for all but Uniform)
 *   - ROLL tileability render at (position + k pixels) and compare with the base image rolled by k pixels: this is an
 *                      EXACT seamlessness test (any wrap bug shows up as a seam-shaped difference) for each tiling mode
 *   - loop             Z / evolution / phase 0 == 1 (seamless animation loops)
 *   - known answers    closed-form images (gradients, circle area, regular-grid cones, single pixels, worley F1 ...)
 *   - pins             modulation pin and Input Pattern pin really reach the right texture slot
 */
export interface Helpers {
  engineOf(env: Env, budget?: number): Engine;
  dispose(e: Engine): void;
  mk(e: Engine, size?: number, s?: Partial<GraphSettings>): Graph;
  add(g: Graph, type: string, params?: Record<string, ParamValue>): string;
  link(g: Graph, from: string, to: string, pin?: string, outPin?: string): void;
  read(e: Engine, g: Graph, nodeId: string, opts?: EvalOptions): Promise<{ data: Float32Array; w: number; h: number; ch: number }>;
  maxErr(a: Float32Array, b: (i: number) => number): number;
  halfTol: number;
}

type Params = Record<string, ParamValue>;
const GEN_IDS = ['grayscale.noise', 'grayscale.fractal', 'grayscale.shape', 'grayscale.gradient', 'grayscale.polar_scatter', 'grayscale.uniform'];
const NOISE_TYPES = ['value', 'perlin', 'simplex', 'cubic', 'billow', 'ridged', 'gabor', 'worley_f1', 'worley_f2', 'worley_f2f1', 'cracks', 'cell_id', 'voronoi'];

export function generatorTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link, read, maxErr } = h;
  const N = 128;

  /** Render a single node and return its first channel. */
  async function render(env: Env, type: string, params: Params, settings: Partial<GraphSettings> = {}, size = N): Promise<Float32Array> {
    const e = engineOf(env);
    try {
      const g = mk(e, size, settings);
      const id = add(g, type, params);
      const r = await read(e, g, id);
      const out = new Float32Array(r.w * r.h);
      for (let i = 0; i < out.length; i++) out[i] = r.data[i * r.ch];
      return out;
    } finally {
      dispose(e);
    }
  }

  /**
   * ROLL test. `shifted(sx, sy)` must return params that move the pattern by (sx, sy) UV to the RIGHT / DOWN.
   * With wrap-around on the tiling axes the shifted render must equal the base image rolled by (kx, ky) pixels.
   */
  function rollCase(name: string, type: string, base: Params, shifted: (sx: number, sy: number) => Params, tiling: 'both' | 'x' | 'y', tolMean = 0.01, tolFrac = 0.015): TestDef {
    return {
      name: `Tile roll (${tiling}) · ${name}`,
      async run(env) {
        const kx = tiling === 'y' ? 0 : 29;
        const ky = tiling === 'x' ? 0 : 11;
        const a = await render(env, type, base, { tiling });
        const b = await render(env, type, { ...base, ...shifted(kx / N, ky / N) }, { tiling });
        let sum = 0;
        let bad = 0;
        for (let y = 0; y < N; y++)
          for (let x = 0; x < N; x++) {
            const ref = a[((y - ky + N) % N) * N + ((x - kx + N) % N)];
            const d = Math.abs(b[y * N + x] - ref);
            sum += d;
            if (d > 0.1) bad++;
          }
        const mean = sum / (N * N);
        const frac = bad / (N * N);
        if (!(mean <= tolMean && frac <= tolFrac)) throw new Error(`rolled image differs: mean ${mean.toExponential(2)} (tol ${tolMean}), ${(frac * 100).toFixed(2)}% pixels off by >0.1 (tol ${tolFrac * 100}%) -> not seamless`);
        return `mean diff ${mean.toExponential(1)}, off ${(frac * 100).toFixed(2)}%`;
      },
    };
  }

  const noiseShift = (extra: Params) => (sx: number, sy: number): Params => ({ ...extra, offset: [-sx, -sy] });
  const posShift = (extra: Params, base: number[] = [0, 0]) => (sx: number, sy: number): Params => ({ ...extra, position: [base[0] + sx, base[1] + sy] });
  const tests: TestDef[] = [];

  /* ---------------------------------------------------------------- range / finite / compile */
  tests.push({
    name: 'Generators · all nodes x gallery variants render finite, in range, non-constant',
    async run(env) {
      const lines: string[] = [];
      const defs = env.registry.list().filter((d) => GEN_IDS.includes(d.id));
      if (defs.length !== GEN_IDS.length) throw new Error(`generator nodes missing from the registry: ${GEN_IDS.filter((i) => !defs.some((d) => d.id === i)).join(', ')}`);
      for (const d of defs) {
        const variants: { name: string; params: Params }[] = [{ name: 'default', params: {} }, ...(d.gallery ?? [])];
        let worst = 0;
        for (const v of variants) {
          const img = await render(env, d.id, v.params, {}, 64);
          let mn = Infinity;
          let mx = -Infinity;
          for (const x of img) {
            if (!Number.isFinite(x)) throw new Error(`${d.id}/${v.name}: NaN or Infinity in output`);
            mn = Math.min(mn, x);
            mx = Math.max(mx, x);
          }
          if (d.id !== 'grayscale.uniform' && (mn < -1e-3 || mx > 1 + 1e-3)) throw new Error(`${d.id}/${v.name}: range [${mn}, ${mx}] outside [0,1]`);
          if (d.id !== 'grayscale.uniform' && mx - mn < 0.02) throw new Error(`${d.id}/${v.name}: output is constant (${mn})`);
          worst = Math.max(worst, mx - mn);
        }
        lines.push(`${d.id}: ${variants.length} variants OK`);
      }
      return lines.join('\n');
    },
  });
  tests.push({
    name: 'Noise · every type renders in [0,1] with contrast, non-constant, deterministic',
    async run(env) {
      const out: string[] = [];
      for (const t of NOISE_TYPES) {
        const a = await render(env, 'grayscale.noise', { noise_type: t, octaves: 3, scale: [5, 5] }, {}, 64);
        const b = await render(env, 'grayscale.noise', { noise_type: t, octaves: 3, scale: [5, 5] }, {}, 64);
        let mn = 1;
        let mx = 0;
        let mean = 0;
        let diff = 0;
        a.forEach((v, i) => {
          mn = Math.min(mn, v);
          mx = Math.max(mx, v);
          mean += v / a.length;
          diff += Math.abs(v - b[i]);
        });
        if (!Number.isFinite(mean) || mn < -1e-3 || mx > 1 + 1e-3) throw new Error(`${t}: range [${mn},${mx}]`);
        if (mx - mn < 0.1) throw new Error(`${t}: nearly constant (${mn}..${mx})`);
        if (diff > 0) throw new Error(`${t}: not deterministic`);
        out.push(`${t}: [${mn.toFixed(2)}, ${mx.toFixed(2)}] mean ${mean.toFixed(2)}`);
      }
      return out.join('\n');
    },
  });

  /* ---------------------------------------------------------------- tileability (roll) */
  for (const t of NOISE_TYPES) tests.push(rollCase(`Noise ${t}`, 'grayscale.noise', { noise_type: t, octaves: 3, scale: [4, 6], seed: 3 }, noiseShift({}), 'both', t === 'cracks' ? 0.02 : 0.01, t === 'cracks' || t === 'cell_id' || t === 'voronoi' ? 0.03 : 0.015));
  tests.push(rollCase('Noise simplex, tile X only', 'grayscale.noise', { noise_type: 'simplex', octaves: 2, scale: [5, 5] }, noiseShift({}), 'x'));
  tests.push(rollCase('Noise simplex, tile Y only', 'grayscale.noise', { noise_type: 'simplex', octaves: 2, scale: [5, 6] }, noiseShift({}), 'y'));
  tests.push(rollCase('Noise worley F2-F1 + octave rotation (quarter turns) + anisotropy', 'grayscale.noise', { noise_type: 'worley_f2f1', octaves: 3, octave_rotation: 90, scale: [4, 4], anisotropy: 0.4 }, noiseShift({}), 'both'));
  // The domain-warp field is fixed to the IMAGE (not to the pattern), so offset shifts do not commute with it: test the
  // seam directly (edge difference vs. an ordinary neighbour step) and integer-offset invariance instead.
  tests.push({
    name: 'Tile seam · Noise perlin + domain warp (edge step ~ neighbour step; integer offset invariant)',
    async run(env) {
      const p: Params = { noise_type: 'perlin', octaves: 2, warp_amount: 0.1, warp_freq: 3, scale: [4, 4] };
      const a = await render(env, 'grayscale.noise', p, { tiling: 'both' });
      let seamX = 0, innerX = 0, seamY = 0, innerY = 0;
      for (let y = 0; y < N; y++) {
        seamX += Math.abs(a[y * N + N - 1] - a[y * N]);
        for (let x = 0; x < N - 1; x++) innerX += Math.abs(a[y * N + x + 1] - a[y * N + x]);
      }
      for (let x = 0; x < N; x++) {
        seamY += Math.abs(a[(N - 1) * N + x] - a[x]);
        for (let y = 0; y < N - 1; y++) innerY += Math.abs(a[(y + 1) * N + x] - a[y * N + x]);
      }
      const rx = seamX / N / (innerX / (N * (N - 1)));
      const ry = seamY / N / (innerY / (N * (N - 1)));
      if (rx > 1.6 || ry > 1.6) throw new Error(`seam is ${rx.toFixed(2)}x / ${ry.toFixed(2)}x a normal neighbour step`);
      const b = await render(env, 'grayscale.noise', { ...p, offset: [1, -2] }, { tiling: 'both' });
      if (maxErr(a, (i) => b[i]) > 3e-3) throw new Error('integer offset changes the image');
      return `seam ratio x=${rx.toFixed(2)} y=${ry.toFixed(2)}`;
    },
  });
  const FR: Params = { scale: [4, 4], octaves: 3, seed: 5 };
  const frCases: [string, Params][] = [
    ['cone', {}],
    ['polygon 6, rotated splats, big', { shape: 'polygon', sides: 6, rot_min: -45, rot_max: 45, scale_min: 1, scale_max: 2.2 }],
    ['star, flips, fractional lacunarity (rounded)', { shape: 'star', flip_h: 0.5, flip_v: 0.5, lacunarity: 2.5, rot_max: 90 }],
    ['pyramid, quincunx rows, non-integer scale', { shape: 'pyramid', quincunx: 'rows', scale: [4.4, 3.2] }],
    ['add Z axis, 5 layers, z=0.37', { add_z: true, z_position: 0.37, z_layers: 5 }],
    ['rotation 90 + add octave mode + splat add', { rotation: 90, octave_mode: 'add', splat_blend: 'add', gain: 0.6 }],
    ['single pixel', { shape: 'pixel', scale: [16, 16] }],
  ];
  for (const [n, p] of frCases) {
    tests.push(rollCase(`Fractal ${n}`, 'grayscale.fractal', { ...FR, ...p }, posShift({ ...FR, ...p }), 'both', 0.01, 0.02));
  }
  tests.push(rollCase('Fractal cone, tile X only', 'grayscale.fractal', FR, posShift(FR), 'x'));
  tests.push(rollCase('Fractal cone, tile Y only', 'grayscale.fractal', FR, posShift(FR), 'y'));
  const shShift = (extra: Params) => (sx: number, sy: number): Params => ({ ...extra, position: [0.5 + sx, 0.5 + sy] });
  for (const [n, p] of [
    ['circle crossing the seam', { shape: 'circle', size: [0.6, 0.6] }],
    ['star', { shape: 'star', size: [0.7, 0.7] }],
    ['bolt repeat 3x2', { shape: 'bolt', repeat: [3, 2], size: [0.8, 0.8] }],
    ['heart outline', { shape: 'heart', output_mode: 'outline', outline_width: 0.1 }],
    ['rotated rounded rect, softness', { shape: 'rounded_rect', rotation: 30, rounding: 0.4, softness: 0.3, size: [0.7, 0.4] }],
  ] as [string, Params][])
    tests.push(rollCase(`Shape ${n}`, 'grayscale.shape', p, shShift(p), 'both', 0.01, 0.02));
  tests.push(rollCase('Shape circle, tile X only', 'grayscale.shape', { size: [0.6, 0.6] }, shShift({ size: [0.6, 0.6] }), 'x'));
  const grShift = (extra: Params) => (sx: number, sy: number): Params => {
    const s = (extra.start as number[] | undefined) ?? [0, 0.5];
    const e2 = (extra.end as number[] | undefined) ?? [1, 0.5];
    const c = (extra.center as number[] | undefined) ?? [0.5, 0.5];
    return { ...extra, start: [s[0] + sx, s[1] + sy], end: [e2[0] + sx, e2[1] + sy], center: [c[0] + sx, c[1] + sy] };
  };
  for (const [n, p] of [
    ['radial clamp', { gtype: 'radial', radius: 0.4 }],
    ['angular', { gtype: 'angular' }],
    ['spiral mirror', { gtype: 'spiral', wrap_mode: 'mirror', turns: 2 }],
    ['diamond repeat', { gtype: 'diamond', wrap_mode: 'repeat', repeat: 3 }],
    ['linear sawtooth x3 (frequency snapped)', { gtype: 'linear', wrap_mode: 'repeat', repeat: 3 }],
    ['reflected', { gtype: 'reflected', repeat: 2 }],
  ] as [string, Params][])
    tests.push(rollCase(`Gradient ${n}`, 'grayscale.gradient', p, grShift(p), 'both', 0.01, 0.03));
  const psShift = (extra: Params) => (sx: number, sy: number): Params => ({ ...extra, center: [0.5 + sx, 0.5 + sy] });
  for (const [n, p] of [
    ['default rings', {}],
    ['big radius crossing borders', { radius_min: 0.3, radius_max: 0.7, size: 0.2 }],
    ['spiral stars jitter', { shape: 'star', ring_count: 8, angle_jitter: 0.7, radius_jitter: 0.6, rot_random: 90, seed: 4 }],
  ] as [string, Params][])
    tests.push(rollCase(`Polar scatter ${n}`, 'grayscale.polar_scatter', p, psShift(p), 'both', 0.01, 0.02));

  /* ---------------------------------------------------------------- loops */
  const loopCase = (name: string, type: string, base: Params, a: Params, b: Params, tolMax = 6e-3, expectChange = true): TestDef => ({
    name: `Loop · ${name}`,
    async run(env) {
      const i0 = await render(env, type, { ...base, ...a }, {}, 64);
      const i1 = await render(env, type, { ...base, ...b }, {}, 64);
      const dLoop = maxErr(i0, (i) => i1[i]);
      if (dLoop > tolMax) throw new Error(`start and end of the loop differ by ${dLoop.toExponential(2)} (tol ${tolMax})`);
      let change = '';
      if (expectChange) {
        const mid = await render(env, type, { ...base, ...a, ...mid_(a, b) }, {}, 64);
        const m = i0.reduce((s, v, i) => s + Math.abs(v - mid[i]), 0) / i0.length;
        if (m < 0.005) throw new Error(`the animation does not change anything at the midpoint (mean diff ${m})`);
        change = `, midpoint changes by ${m.toFixed(3)}`;
      }
      return `loop diff ${dLoop.toExponential(1)}${change}`;
    },
  });
  const mid_ = (a: Params, b: Params): Params => {
    const o: Params = {};
    for (const k of Object.keys(a)) o[k] = ((a[k] as number) + (b[k] as number)) / 2;
    return o;
  };
  for (const t of ['value', 'perlin', 'simplex', 'cubic', 'ridged', 'gabor', 'worley_f1', 'worley_f2f1', 'cracks', 'voronoi']) tests.push(loopCase(`Noise ${t} evolution 0 == 1`, 'grayscale.noise', { noise_type: t, octaves: 2, scale: [4, 4], z_cells: 3 }, { evolution: 0 }, { evolution: 1 }, t === 'cracks' || t === 'voronoi' ? 4e-2 : 6e-3));
  tests.push(loopCase('Fractal Z position 0 == 100%', 'grayscale.fractal', { add_z: true, z_layers: 4, scale: [5, 5], octaves: 2 }, { z_position: 0 }, { z_position: 1 }));
  tests.push(loopCase('Fractal Z position 0 == 300%', 'grayscale.fractal', { add_z: true, z_layers: 3, shape: 'star' }, { z_position: 0 }, { z_position: 3 }));
  tests.push(loopCase('Polar scatter phase 0 == 100% (integer spin)', 'grayscale.polar_scatter', { spin: 3, count: 10, angle_jitter: 0.5, seed: 2 }, { phase: 0 }, { phase: 1 }, 0.3));
  tests.push({
    name: 'Fractal · "Add Z axis" off ignores Z position; on, Z changes the pattern',
    async run(env) {
      const off0 = await render(env, 'grayscale.fractal', { z_position: 0.0 }, {}, 64);
      const off1 = await render(env, 'grayscale.fractal', { z_position: 0.4 }, {}, 64);
      if (maxErr(off0, (i) => off1[i]) > 1e-6) throw new Error('Z position changed the image although Add Z axis is off');
      const on0 = await render(env, 'grayscale.fractal', { add_z: true, z_position: 0.0 }, {}, 64);
      const on1 = await render(env, 'grayscale.fractal', { add_z: true, z_position: 0.4 }, {}, 64);
      if (maxErr(on0, (i) => on1[i]) < 0.05) throw new Error('Z position had no effect with Add Z axis on');
    },
  });

  /* ---------------------------------------------------------------- known answers */
  tests.push({
    name: 'Uniform · exact value, all tiling modes',
    async run(env) {
      for (const tiling of ['none', 'both', 'x', 'y'] as const) {
        const img = await render(env, 'grayscale.uniform', { value: 0.37 }, { tiling }, 32);
        const err = maxErr(img, () => 0.37);
        if (err > 1e-3) throw new Error(`${tiling}: error ${err}`);
      }
    },
  });
  tests.push({
    name: 'Gradient · linear / radial / diamond / square / angular match closed-form values',
    async run(env) {
      const n = 64;
      const px = (i: number): number => (i + 0.5) / n;
      const cases: [string, Params, (x: number, y: number) => number][] = [
        ['linear', { gtype: 'linear' }, (x) => x],
        ['linear inverted + offset 0.25 repeat', { gtype: 'linear', invert: true, offset: 0.25, wrap_mode: 'repeat' }, (x) => 1 - (((x + 0.25) % 1) + 1) % 1],
        ['radial', { gtype: 'radial', radius: 0.5 }, (x, y) => Math.min(Math.hypot(x - 0.5, y - 0.5) / 0.5, 1)],
        ['diamond', { gtype: 'diamond', radius: 0.5 }, (x, y) => Math.min((Math.abs(x - 0.5) + Math.abs(y - 0.5)) / 0.5, 1)],
        ['square', { gtype: 'square', radius: 0.5 }, (x, y) => Math.min(Math.max(Math.abs(x - 0.5), Math.abs(y - 0.5)) / 0.5, 1)],
        ['angular', { gtype: 'angular' }, (x, y) => ((Math.atan2(y - 0.5, x - 0.5) / (2 * Math.PI)) % 1 + 1) % 1],
        ['reflected', { gtype: 'reflected', start: [0.5, 0.5], end: [1, 0.5] }, (x) => Math.min(Math.abs(x - 0.5) / 0.5, 1)],
      ];
      for (const [name, p, f] of cases) {
        const img = await render(env, 'grayscale.gradient', p, { tiling: 'none' }, n);
        let worst = 0;
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const exp = f(px(x), px(y));
            let d = Math.abs(img[y * n + x] - exp);
            if (name === 'angular') d = Math.min(d, 1 - d); // seam of the sweep
            worst = Math.max(worst, d);
          }
        if (worst > 3e-3) throw new Error(`${name}: worst error ${worst.toExponential(2)}`);
      }
      return `${cases.length} gradient types match`;
    },
  });
  tests.push({
    name: 'Gradient · curve remap and tiling snap (linear x2.4 becomes whole cycles)',
    async run(env) {
      const n = 64;
      const img = await render(env, 'grayscale.gradient', { gtype: 'linear', curve: { keys: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }, { tiling: 'none' }, n);
      const err = maxErr(img, (i) => 1 - ((i % n) + 0.5) / n);
      if (err > 4e-3) throw new Error(`inverted curve error ${err}`);
      const t = await render(env, 'grayscale.gradient', { gtype: 'linear', wrap_mode: 'repeat', repeat: 2.4 }, { tiling: 'both' }, n);
      // 2.4 snaps to 2 whole cycles -> value at x and x + n/2 equal
      const e2 = maxErr(t, (i) => t[Math.floor(i / n) * n + (((i % n) + n / 2) % n)]);
      if (e2 > 2e-2) throw new Error(`snapped period mismatch ${e2}`);
    },
  });
  tests.push({
    name: 'Shape · circle area, centre, corners, softness and repeat periodicity',
    async run(env) {
      const n = 128;
      const img = await render(env, 'grayscale.shape', { shape: 'circle', size: [0.5, 0.5] }, { tiling: 'none' }, n);
      let area = 0;
      for (const v of img) area += v;
      const expected = Math.PI * (0.25 * n) ** 2;
      if (Math.abs(area - expected) / expected > 0.02) throw new Error(`circle area ${area.toFixed(0)} vs ${expected.toFixed(0)}`);
      if (img[(n / 2) * n + n / 2] < 0.99 || img[0] > 0.01) throw new Error('centre not 1 or corner not 0');
      const soft = await render(env, 'grayscale.shape', { shape: 'circle', size: [0.5, 0.5], softness: 1 }, { tiling: 'none' }, n);
      if (!(soft[(n / 2) * n + n / 2] > 0.99 && soft[(n / 2) * n + n / 2 + 16] < 0.95 && soft[(n / 2) * n + n / 2 + 16] > 0.05)) throw new Error('softness 100% did not make a smooth ramp');
      const rep = await render(env, 'grayscale.shape', { shape: 'star', repeat: [4, 4], size: [0.8, 0.8] }, { tiling: 'both' }, n);
      const err = maxErr(rep, (i) => rep[Math.floor(i / n) * n + (((i % n) + n / 4) % n)]);
      if (err > 2e-3) throw new Error(`repeat 4x4 is not periodic by n/4 (${err})`);
      return `area ${area.toFixed(0)} (expected ${expected.toFixed(0)})`;
    },
  });
  tests.push({
    name: 'Shape · every shape type is non-empty, not full, and inside its box',
    async run(env) {
      const types = ['circle', 'ellipse', 'rounded_rect', 'polygon', 'star', 'ring', 'arc', 'pie', 'cross', 'line', 'heart', 'drop', 'bolt', 'crescent'];
      const n = 96;
      const out: string[] = [];
      for (const t of types) {
        const img = await render(env, 'grayscale.shape', { shape: t, size: [0.5, 0.5] }, { tiling: 'none' }, n);
        let area = 0;
        let outside = 0;
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const v = img[y * n + x];
            area += v;
            // box of size 0.5 around the centre (+ 2 px for AA, + 8% for approximate SDFs)
            if (v > 0.2 && (Math.abs(x - n / 2) > n * 0.27 || Math.abs(y - n / 2) > n * 0.27)) outside++;
          }
        const frac = area / (n * n);
        if (frac < 0.01 || frac > 0.3) throw new Error(`${t}: area fraction ${frac.toFixed(3)} (expected 0.01..0.3)`);
        if (outside > 0) throw new Error(`${t}: ${outside} bright pixels outside the size box`);
        out.push(`${t}: ${(frac * 100).toFixed(1)}%`);
      }
      return out.join(', ');
    },
  });
  tests.push({
    name: 'Fractal · single pixel on a regular grid lights exactly one pixel per cell (known answer)',
    async run(env) {
      const n = 64;
      const base: Params = { shape: 'pixel', scale: [8, 8], octaves: 1, pos_random: 0, int_min: 1, int_max: 1, octave_mode: 'add', scale_min: 1, scale_max: 1 };
      const img = await render(env, 'grayscale.fractal', base, {}, n);
      let lit = 0;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const v = img[y * n + x];
          if (v > 0.5) {
            lit++;
            if (x % 8 !== 4 || y % 8 !== 4) throw new Error(`lit pixel at ${x},${y}: expected cell centres (x%8 == 4)`);
          } else if (v > 0.01) throw new Error(`stray value ${v} at ${x},${y}`);
        }
      if (lit !== 64) throw new Error(`lit pixels ${lit}, expected 64`);
      const q = await render(env, 'grayscale.fractal', { ...base, quincunx: 'rows' }, {}, n);
      lit = q.reduce((s, v) => s + (v > 0.5 ? 1 : 0), 0);
      if (lit !== 64) throw new Error(`quincunx: lit pixels ${lit}, expected 64`);
      const half = await render(env, 'grayscale.fractal', { ...base, visibility: 0.5, seed: 7 }, {}, n);
      lit = half.reduce((s, v) => s + (v > 0.5 ? 1 : 0), 0);
      if (lit < 16 || lit > 48) throw new Error(`visibility 50% lit ${lit} of 64 splats`);
      return 'regular grid: 64 pixels; quincunx 64; visibility 50% lights ' + lit;
    },
  });
  tests.push({
    name: 'Fractal · regular-grid cones match the closed-form profile (and inner filling / pyramid)',
    async run(env) {
      const n = 64;
      const base: Params = { scale: [4, 4], octaves: 1, pos_random: 0, int_min: 1, int_max: 1, octave_mode: 'add', scale_min: 1, scale_max: 1 };
      const cases: [string, Params, (fx: number, fy: number) => number][] = [
        ['cone', {}, (fx, fy) => Math.max(0, 1 - Math.hypot(fx - 0.5, fy - 0.5) * 2)],
        ['cone inner 50%', { inner: 0.5 }, (fx, fy) => Math.min(1, Math.max(0, (1 - Math.hypot(fx - 0.5, fy - 0.5) * 2) / 0.5))],
        ['pyramid', { shape: 'pyramid' }, (fx, fy) => 1 - Math.max(Math.abs(fx - 0.5), Math.abs(fy - 0.5)) * 2],
        ['polygon 4 (square) metric', { shape: 'polygon', sides: 4 }, (fx, fy) => {
          // 4-gon with circumradius 1 in the splat box: diamond |x|+|y| <= 1 (points up)
          const x = (fx - 0.5) * 2;
          const y = (fy - 0.5) * 2;
          return Math.max(0, 1 - (Math.abs(x) + Math.abs(y)));
        }],
      ];
      for (const [name, p, f] of cases) {
        const img = await render(env, 'grayscale.fractal', { ...base, ...p }, { tiling: 'both' }, n);
        let worst = 0;
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const fx = (((x + 0.5) / n) * 4) % 1;
            const fy = (((y + 0.5) / n) * 4) % 1;
            worst = Math.max(worst, Math.abs(img[y * n + x] - f(fx, fy)));
          }
        if (worst > 8e-3) throw new Error(`${name}: worst error ${worst.toExponential(2)}`);
      }
      return `${cases.length} profiles match`;
    },
  });
  tests.push({
    name: 'Fractal · octaves refine the grid; Add vs Max splat blending; seed changes the pattern',
    async run(env) {
      const p: Params = { scale: [3, 3], pos_random: 1, scale_min: 1.4, scale_max: 1.8, int_min: 1, int_max: 1, octaves: 1 };
      const add = await render(env, 'grayscale.fractal', { ...p, splat_blend: 'add' }, {}, 64);
      const max = await render(env, 'grayscale.fractal', { ...p, splat_blend: 'max' }, {}, 64);
      let diff = 0;
      add.forEach((v, i) => {
        if (v < max[i] - 1e-3) throw new Error('Add must never be below Max');
        diff += v - max[i];
      });
      if (diff < 1) throw new Error('overlapping splats: Add and Max are identical');
      const a = await render(env, 'grayscale.fractal', { ...p, seed: 1 }, {}, 64);
      const b = await render(env, 'grayscale.fractal', { ...p, seed: 2 }, {}, 64);
      if (maxErr(a, (i) => b[i]) < 0.1) throw new Error('seed does not change the pattern');
      const o1 = await render(env, 'grayscale.fractal', { ...p, octaves: 1, octave_mode: 'add' }, {}, 64);
      const o3 = await render(env, 'grayscale.fractal', { ...p, octaves: 3, octave_mode: 'add' }, {}, 64);
      if (o3.reduce((s, v) => s + v, 0) <= o1.reduce((s, v) => s + v, 0)) throw new Error('3 octaves in Add mode should be brighter than 1');
    },
  });
  tests.push({
    name: 'Noise · Worley F1 / metrics / cell id are exact on a regular (jitter 0) grid',
    async run(env) {
      const n = 64;
      const base: Params = { noise_type: 'worley_f1', octaves: 1, scale: [4, 4], jitter: 0 };
      const metrics: [string, (dx: number, dy: number) => number][] = [
        ['euclid', (dx, dy) => Math.hypot(dx, dy)],
        ['manhattan', (dx, dy) => (Math.abs(dx) + Math.abs(dy)) * Math.SQRT1_2],
        ['chebyshev', (dx, dy) => Math.max(Math.abs(dx), Math.abs(dy))],
      ];
      for (const [m, f] of metrics) {
        const img = await render(env, 'grayscale.noise', { ...base, metric: m }, {}, n);
        const err = maxErr(img, (i) => {
          const px = (((i % n) + 0.5) / n) * 4;
          const py = ((Math.floor(i / n) + 0.5) / n) * 4;
          return Math.min(1, f((px % 1) - 0.5, (py % 1) - 0.5));
        });
        if (err > 3e-3) throw new Error(`F1 ${m}: error ${err.toExponential(2)}`);
      }
      const ids = await render(env, 'grayscale.noise', { ...base, noise_type: 'cell_id' }, {}, n);
      const vals = new Set<number>();
      for (let cy = 0; cy < 4; cy++)
        for (let cx = 0; cx < 4; cx++) {
          const v0 = ids[(cy * 16 + 8) * n + cx * 16 + 8];
          vals.add(Math.round(v0 * 1000));
          for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.abs(ids[(cy * 16 + y) * n + cx * 16 + x] - v0) > 2e-3) throw new Error(`cell ${cx},${cy} is not a flat id`);
        }
      if (vals.size < 12) throw new Error(`only ${vals.size} distinct ids for 16 cells`);
      return `F1 (3 metrics) exact; ${vals.size} distinct cell ids`;
    },
  });
  tests.push({
    name: 'Noise · cracks are thin, simplex/gabor are well spread (mean near 50%)',
    async run(env) {
      const cr = await render(env, 'grayscale.noise', { noise_type: 'cracks', octaves: 1, scale: [6, 6], edge_width: 0.06 }, {}, 128);
      const crMean = cr.reduce((s, v) => s + v, 0) / cr.length;
      if (crMean > 0.3 || crMean < 0.005) throw new Error(`cracks mean ${crMean} (expected a thin network)`);
      for (const t of ['simplex', 'gabor', 'cubic', 'perlin', 'billow']) {
        const img = await render(env, 'grayscale.noise', { noise_type: t, octaves: 1, scale: [6, 6] }, {}, 128);
        const mean = img.reduce((s, v) => s + v, 0) / img.length;
        const sd = Math.sqrt(img.reduce((s, v) => s + (v - mean) ** 2, 0) / img.length);
        if (t !== 'billow' && Math.abs(mean - 0.5) > 0.12) throw new Error(`${t}: mean ${mean.toFixed(3)} not near 0.5`);
        if (sd < 0.04) throw new Error(`${t}: std ${sd.toFixed(3)} too flat`);
      }
    },
  });
  tests.push({
    name: 'Noise · remap / bias / anisotropy / UV-less warp behave',
    async run(env) {
      const base: Params = { noise_type: 'perlin', octaves: 2 };
      const a = await render(env, 'grayscale.noise', base, {}, 64);
      const stretched = await render(env, 'grayscale.noise', { ...base, remap_lo: 0.3, remap_hi: 0.7 }, {}, 64);
      const sd = (x: Float32Array): number => {
        const m = x.reduce((s, v) => s + v, 0) / x.length;
        return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / x.length);
      };
      if (!(sd(stretched) > sd(a) * 1.5)) throw new Error('remap 30..70% did not stretch the histogram');
      const bright = await render(env, 'grayscale.noise', { ...base, bias: 0.8 }, {}, 64);
      if (!(bright.reduce((s, v) => s + v, 0) > a.reduce((s, v) => s + v, 0))) throw new Error('bias 80% did not brighten');
      const warped = await render(env, 'grayscale.noise', { ...base, warp_amount: 0.15 }, {}, 64);
      if (maxErr(a, (i) => warped[i]) < 0.05) throw new Error('domain warp had no effect');
      // anisotropy: + squeezes horizontally -> more variation along x than along y
      const an = await render(env, 'grayscale.noise', { ...base, octaves: 1, anisotropy: 0.8 }, {}, 64);
      let dx = 0;
      let dy = 0;
      for (let y = 0; y < 63; y++) for (let x = 0; x < 63; x++) {
        dx += Math.abs(an[y * 64 + x + 1] - an[y * 64 + x]);
        dy += Math.abs(an[(y + 1) * 64 + x] - an[y * 64 + x]);
      }
      if (!(dx > dy * 1.5)) throw new Error(`anisotropy +80%: x variation ${dx.toFixed(1)} should exceed y variation ${dy.toFixed(1)}`);
    },
  });
  tests.push({
    name: 'Polar scatter · 8 circles on a ring land at the exact predicted pixels; 8-fold spin symmetry',
    async run(env) {
      const n = 128;
      const p: Params = { shape: 'circle', ring_count: 1, count: 8, radius_min: 0.3, radius_max: 0.3, size: 0.07, align_radial: false, angle_start: 0, softness: 0 };
      const img = await render(env, 'grayscale.polar_scatter', p, { tiling: 'none' }, n);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const x = Math.floor(n * (0.5 + 0.3 * Math.cos(a)));
        const y = Math.floor(n * (0.5 + 0.3 * Math.sin(a)));
        if (img[y * n + x] < 0.8) throw new Error(`element ${k} missing at ${x},${y} (value ${img[y * n + x]})`);
        const a2 = a + Math.PI / 8;
        const x2 = Math.floor(n * (0.5 + 0.3 * Math.cos(a2)));
        const y2 = Math.floor(n * (0.5 + 0.3 * Math.sin(a2)));
        if (img[y2 * n + x2] > 0.05) throw new Error(`gap between ${k} and ${k + 1} is not empty`);
      }
      if (img[(n / 2) * n + n / 2] > 0.01) throw new Error('centre should be empty');
      const spun = await render(env, 'grayscale.polar_scatter', { ...p, phase: 0.125, spin: 1 }, { tiling: 'none' }, n);
      const err = img.reduce((s, v, i) => s + Math.abs(v - spun[i]), 0) / img.length;
      if (err > 5e-3) throw new Error(`spin by 1/8 turn with 8 elements should be identical (mean diff ${err})`);
      const arc = await render(env, 'grayscale.polar_scatter', { ...p, angle_range: 180, angle_start: 0, count: 5 }, { tiling: 'none' }, n);
      let upper = 0;
      for (let y = 0; y < n / 2 - 6; y++) for (let x = 0; x < n; x++) upper += arc[y * n + x];
      if (upper > 1) throw new Error('arc 0..180 degrees (clockwise from +x, y down) must only fill the lower half');
      return 'ring, spin symmetry, arc OK';
    },
  });
  tests.push({
    name: 'Polar scatter · ring count / elements per ring / proportional count produce more elements',
    async run(env) {
      const base: Params = { shape: 'circle', size: 0.04, radius_min: 0.1, radius_max: 0.42, count: 6, ring_count: 1 };
      const area = async (p: Params): Promise<number> => (await render(env, 'grayscale.polar_scatter', { ...base, ...p }, { tiling: 'none' }, 96)).reduce((s, v) => s + v, 0);
      const a1 = await area({});
      const a2 = await area({ count: 12 });
      const a3 = await area({ ring_count: 4 });
      const a4 = await area({ ring_count: 4, count_mode: 'proportional', count: 24 });
      if (!(a2 > a1 * 1.7 && a3 > a1 * 3 && a4 > a3)) throw new Error(`areas ${a1.toFixed(0)} / ${a2.toFixed(0)} / ${a3.toFixed(0)} / ${a4.toFixed(0)} do not scale with the counts`);
    },
  });

  /* ---------------------------------------------------------------- pins (modulation / pattern) */
  tests.push({
    name: 'Fractal · modulation pins reach the right texture slot (visibility, scale, intensity)',
    async run(env) {
      const e = engineOf(env);
      try {
        const size = 64;
        const base: Params = { scale: [4, 4], octaves: 1, pos_random: 0.3, int_min: 1, int_max: 1, octave_mode: 'add' };
        const run = async (pin: string, v: number, mk_: number): Promise<Float32Array> => {
          const g = mk(e, size);
          const f = add(g, 'grayscale.fractal', { ...base, [`${pin.replace('_mod', '')}_mod_k`]: mk_ } as Params);
          const u = add(g, 'grayscale.uniform', { value: v });
          link(g, u, f, pin);
          const r = await read(e, g, f);
          return r.data;
        };
        const g0 = mk(e, size);
        const f0 = add(g0, 'grayscale.fractal', base);
        const ref = (await read(e, g0, f0)).data;
        const vis0 = await run('visibility_mod', 0, 1);
        if (Math.max(...vis0) > 1e-3) throw new Error('visibility mod = 0 (k 100%) must hide every splat');
        const vis1 = await run('visibility_mod', 1, 1);
        if (maxErr(vis1, (i) => ref[i]) > 2e-3) throw new Error('visibility mod = 1 must equal the unmodulated image');
        const sz0 = await run('size_mod', 0, 1);
        if (Math.max(...sz0) > 1e-3) throw new Error('scale mod = 0 must shrink every splat to nothing');
        const sz1 = await run('size_mod', 1, 1);
        if (maxErr(sz1, (i) => ref[i]) > 2e-3) throw new Error('scale mod = 1 must equal the unmodulated image');
        const in0 = await run('intensity_mod', 0, 1);
        if (Math.max(...in0) > 1e-3) throw new Error('intensity mod = 0 must make the image black');
        const inv = await run('intensity_mod', 1, -1);
        if (Math.max(...inv) > 1e-3) throw new Error('intensity mod = 1 with -100% (inverted) must make the image black');
        return 'visibility / scale / intensity mods behave';
      } finally {
        dispose(e);
      }
    },
  });
  tests.push({
    name: 'Fractal · Input Pattern replaces the shape (circle pattern -> round splats), Atlas picks elements',
    async run(env) {
      const e = engineOf(env);
      try {
        const size = 64;
        const g = mk(e, size);
        const sh = add(g, 'grayscale.shape', { shape: 'star', size: [0.9, 0.9] });
        const f = add(g, 'grayscale.fractal', { scale: [2, 2], octaves: 1, pos_random: 0, scale_min: 1, scale_max: 1, int_min: 1, int_max: 1, octave_mode: 'add', shape: 'cone' });
        link(g, sh, f, 'pattern');
        const withPattern = (await read(e, g, f)).data;
        const g2 = mk(e, size);
        const f2 = add(g2, 'grayscale.fractal', { scale: [2, 2], octaves: 1, pos_random: 0, scale_min: 1, scale_max: 1, int_min: 1, int_max: 1, octave_mode: 'add', shape: 'cone' });
        const cone = (await read(e, g2, f2)).data;
        if (maxErr(withPattern, (i) => cone[i]) < 0.1) throw new Error('Input Pattern had no effect');
        // the star pattern has hard corners: a cone is smooth, so the pattern image has a larger gradient energy
        const energy = (a: Float32Array): number => {
          let s = 0;
          for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) s += Math.abs(a[y * size + x + 1] - a[y * size + x]) + Math.abs(a[(y + 1) * size + x] - a[y * size + x]);
          return s;
        };
        if (!(energy(withPattern) > 0)) throw new Error('pattern image is flat');
        // atlas 2x1: left element = black, right = white  => splats are either empty or full, never both
        const g3 = mk(e, size);
        const half = add(g3, 'grayscale.gradient', { gtype: 'linear', wrap_mode: 'clamp', curve: { keys: [{ x: 0, y: 0 }, { x: 0.49, y: 0 }, { x: 0.51, y: 1 }, { x: 1, y: 1 }] } });
        const f3 = add(g3, 'grayscale.fractal', { scale: [4, 4], octaves: 1, pos_random: 0, scale_min: 1, scale_max: 1, int_min: 1, int_max: 1, octave_mode: 'add', atlas_size: [2, 1], seed: 3 });
        link(g3, half, f3, 'pattern');
        const atlas = (await read(e, g3, f3)).data;
        let lit = 0;
        for (const v of atlas) if (v > 0.5) lit++;
        const frac = lit / atlas.length;
        if (frac < 0.1 || frac > 0.9) throw new Error(`atlas of (empty, full) should light roughly half of the splats (lit fraction ${frac.toFixed(2)})`);
        return `atlas lit fraction ${(frac * 100).toFixed(0)}%`;
      } finally {
        dispose(e);
      }
    },
  });
  tests.push({
    name: 'Generators · Background pin + blending tab work on every generator (cross mix 0% = background)',
    async run(env) {
      const e = engineOf(env);
      try {
        for (const id of GEN_IDS) {
          const g = mk(e, 32);
          const bg = add(g, 'grayscale.uniform', { value: 0.25 });
          const n = add(g, id, { blend_cross: 0 });
          link(g, bg, n, 'background');
          const r = await read(e, g, n);
          let worst = 0;
          for (let i = 0; i < r.data.length; i += r.ch) worst = Math.max(worst, Math.abs(r.data[i] - 0.25));
          if (worst > 2e-3) throw new Error(`${id}: cross mix 0% should give the background (error ${worst})`);
        }
      } finally {
        dispose(e);
      }
    },
  });
  tests.push({
    name: 'Generators · HQ supersampling keeps the mean (antialiasing only) for shape / fractal / scatter',
    async run(env) {
      for (const [id, p] of [
        ['grayscale.shape', { shape: 'star', size: [0.8, 0.8] }],
        ['grayscale.fractal', { scale: [6, 6], shape: 'polygon', sides: 7 }],
        ['grayscale.polar_scatter', { ring_count: 4, size: 0.05 }],
      ] as [string, Params][]) {
        const a = await render(env, id, p, {}, 64);
        const b = await render(env, id, { ...p, tex_ss: 3 }, {}, 64);
        const ma = a.reduce((s, v) => s + v, 0) / a.length;
        const mb = b.reduce((s, v) => s + v, 0) / b.length;
        if (Math.abs(ma - mb) > 0.02) throw new Error(`${id}: mean ${ma.toFixed(4)} vs HQ ${mb.toFixed(4)}`);
      }
    },
  });
  tests.push({
    name: 'Generators · 32-bit HQ path renders the same images as 16-bit within half precision',
    async run(env) {
      for (const [id, p] of [
        ['grayscale.noise', { noise_type: 'simplex' }],
        ['grayscale.fractal', {}],
        ['grayscale.shape', { shape: 'heart' }],
        ['grayscale.polar_scatter', {}],
        ['grayscale.gradient', { gtype: 'spiral' }],
      ] as [string, Params][]) {
        const a = await render(env, id, p, { bitDepth: 16 }, 64);
        const b = await render(env, id, p, { bitDepth: 32 }, 64);
        const m = a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
        if (m > 2e-3) throw new Error(`${id}: 16-bit vs 32-bit mean diff ${m}`);
      }
    },
  });
  tests.push({
    name: 'Generators · timing at 1024x1024 (CPU wall time of one evaluation incl. readback, informational)',
    async run(env) {
      const out: string[] = [];
      for (const [id, p] of [
        ['grayscale.noise', { noise_type: 'simplex', octaves: 8 }],
        ['grayscale.noise', { noise_type: 'voronoi', octaves: 3 }],
        ['grayscale.fractal', { octaves: 6 }],
        ['grayscale.fractal', { octaves: 6, add_z: true, scale_max: 2.2, rot_max: 90 }],
        ['grayscale.shape', { shape: 'bolt' }],
        ['grayscale.gradient', { gtype: 'spiral' }],
        ['grayscale.polar_scatter', { ring_count: 32, count: 64 }],
      ] as [string, Params][]) {
        const t0 = performance.now();
        await render(env, id, p, {}, 1024);
        out.push(`${id} ${JSON.stringify(p)}: ${(performance.now() - t0).toFixed(0)} ms`);
      }
      return out.join('\n');
    },
  });
  return tests;
}
