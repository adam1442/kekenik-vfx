import type { GraphSettings, Graph } from '../engine/graph/graph';
import type { ParamValue } from '../engine/params/schema';
import { boxPlan, gaussianPlan } from '../nodes/_shared/blur';
import { sliceReference } from '../nodes/grayscale/slice/definition';
import { thresholdReference } from '../nodes/grayscale/threshold/definition';
import type { Helpers } from './generators';
import type { Env, TestDef } from './tests';

/**
 * GPU tests for grayscale processing, colour nodes and curve LUTs, morphology. Names start with `Processing ·`, `Morphology ·`,
 * `Filter ·`, `Roll ·`, `Loop ·`, `Spline ·`, `Color ·`, `Timing ·`. Strategy:
 *   - BRUTE-FORCE CPU REFERENCES on a read-back noise image (dilate/erode square + disc, box, strided box, gaussian,
 *     median, emboss): exact tests of the sparse-table / strided / cascaded algorithms including wrap-around;
 *   - ROLL tests (tiling): input noise rolled by whole pixels (noise `offset`) must give the rolled output;
 *   - closed-form known answers (threshold, slice, curve LUT, ramp identity, interpolate, replace, hue spread, AO / curvature on shapes);
 *   - shared fractal core: the colour fractal's coverage alpha must equal the gray fractal image.
 */
type Params = Record<string, ParamValue>;
const N = 64;

export function processingTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link, read } = h;
  const tests: TestDef[] = [];

  async function chain(env: Env, size: number, build: (g: Graph) => string, settings: Partial<GraphSettings> = { tiling: 'both' }): Promise<{ data: Float32Array; w: number; ch: number; h: number }> {
    const e = engineOf(env);
    try {
      const g = mk(e, size, settings);
      return await read(e, g, build(g));
    } finally {
      dispose(e);
    }
  }
  const chan = (r: { data: Float32Array; ch: number }, c = 0): Float32Array => {
    const n = r.data.length / r.ch;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = r.data[i * r.ch + c];
    return out;
  };
  const noiseP = (extra: Params = {}): Params => ({ noise_type: 'perlin', scale: [5, 5], octaves: 3, seed: 3, ...extra });
  const noiseOnly = (env: Env, size = N, extra: Params = {}): Promise<Float32Array> => chain(env, size, (g) => add(g, 'grayscale.noise', noiseP(extra))).then((r) => chan(r));
  /** noise -> node */
  const viaNode = (env: Env, type: string, params: Params, size = N, noise: Params = {}, settings: Partial<GraphSettings> = { tiling: 'both' }): Promise<Float32Array> =>
    chain(env, size, (g) => {
      const n = add(g, 'grayscale.noise', noiseP(noise));
      const f = add(g, type, params);
      link(g, n, f);
      return f;
    }, settings).then((r) => chan(r));
  const at = (img: Float32Array, size: number, x: number, y: number): number => img[((y + size) % size) * size + ((x + size) % size)];
  const maxDiff = (a: Float32Array, b: Float32Array): number => {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
  };
  const fail = (what: string, d: number, tol: number): void => {
    if (!(d <= tol)) throw new Error(`${what}: max error ${d.toExponential(2)} (tolerance ${tol})`);
  };
  const ref2d = (_src: Float32Array, size: number, f: (x: number, y: number) => number): Float32Array => {
    const o = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) o[y * size + x] = f(x, y);
    return o;
  };

  /* ================================================================ morphology vs brute force */
  const morph = (name: string, params: Params, rPx: number, shape: 'square' | 'disc', isMax: boolean): TestDef => ({
    name: `Morphology · ${name} equals the brute-force CPU result (wrap-around)`,
    async run(env) {
      const src = await noiseOnly(env);
      const out = await viaNode(env, 'grayscale.dilate', params);
      const ref = ref2d(src, N, (x, y) => {
        let acc = isMax ? -Infinity : Infinity;
        const r = Math.ceil(rPx);
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (shape === 'disc' && dx * dx + dy * dy > (rPx + 0.25) ** 2) continue;
            const v = at(src, N, x + dx, y + dy);
            acc = isMax ? Math.max(acc, v) : Math.min(acc, v);
          }
        return acc;
      });
      fail(name, maxDiff(out, ref), 1e-6 + 1e-3);
      return 'exact';
    },
  });
  tests.push(
    morph('Grow square r=9', { operation: 'grow', shape: 'square', radius: 9 / N }, 9, 'square', true),
    morph('Shrink square r=5', { operation: 'shrink', shape: 'square', radius: 5 / N }, 5, 'square', false),
    morph('Grow square r=22 (several sparse-table levels)', { operation: 'grow', shape: 'square', radius: 22 / N }, 22, 'square', true),
    morph('Grow circle r=4 (exact disc path)', { operation: 'grow', shape: 'circle', radius: 4 / N }, 4, 'disc', true),
    morph('Shrink circle r=3 (exact disc path)', { operation: 'shrink', shape: 'circle', radius: 3 / N }, 3, 'disc', false),
  );
  tests.push({
    name: 'Morphology · circle (16-gon) / octagon / diamond grow: monotone in radius, bounded by the square, contains the exact disc of 0.9 r',
    async run(env) {
      const src = await noiseOnly(env, 128);
      const r = 14;
      const sq = await viaNode(env, 'grayscale.dilate', { operation: 'grow', shape: 'square', radius: r / 128 }, 128);
      for (const shape of ['circle', 'octagon', 'diamond']) {
        const out = await viaNode(env, 'grayscale.dilate', { operation: 'grow', shape, radius: r / 128 }, 128);
        const small = await viaNode(env, 'grayscale.dilate', { operation: 'grow', shape, radius: (r / 2) / 128 }, 128);
        let bad = 0;
        for (let i = 0; i < out.length; i++) {
          if (out[i] > sq[i] + 2e-3) bad++; // inside the square window
          if (small[i] > out[i] + 2e-3) bad++; // grows with the radius
          if (out[i] + 2e-3 < src[i]) bad++; // dilation never lowers the image
        }
        if (bad > 0) throw new Error(`${shape}: ${bad} violations`);
        if (shape === 'circle') {
          // every pixel within 0.9 r must be covered by the max
          let miss = 0;
          for (let y = 0; y < 128; y += 3)
            for (let x = 0; x < 128; x += 3) {
              let m = -Infinity;
              for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= (0.9 * r) ** 2) m = Math.max(m, at(src, 128, x + dx, y + dy));
              if (out[y * 128 + x] + 3e-3 < m) miss++;
            }
          if (miss > 0) throw new Error(`circle: ${miss} samples below the max over the inner 0.9 r disc`);
        }
      }
    },
  });
  tests.push({
    name: 'Morphology · open <= input <= close, grow >= input >= shrink',
    async run(env) {
      const src = await noiseOnly(env);
      const get = (operation: string) => viaNode(env, 'grayscale.dilate', { operation, shape: 'square', radius: 4 / N });
      const [o, c, g, s] = [await get('open'), await get('close'), await get('grow'), await get('shrink')];
      for (let i = 0; i < src.length; i++) {
        if (o[i] > src[i] + 3e-3 || c[i] + 3e-3 < src[i] || g[i] + 3e-3 < src[i] || s[i] > src[i] + 3e-3) throw new Error(`ordering violated at pixel ${i}`);
      }
    },
  });

  /* ================================================================ filters vs brute force */
  tests.push({
    name: 'Filter · box blur (direct taps r=3) equals the CPU box mean',
    async run(env) {
      const src = await noiseOnly(env);
      const out = await viaNode(env, 'grayscale.filter', { mode: 'box', radius: 3 / N });
      const ref = ref2d(src, N, (x, y) => {
        let s = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) s += at(src, N, x + dx, y + dy);
        return s / 49;
      });
      fail('box r=3', maxDiff(out, ref), 4e-3);
    },
  });
  tests.push({
    name: 'Filter · strided box blur (two-stage, s*m window) equals the CPU box mean of the effective radius',
    async run(env) {
      const size = 128;
      const rPx = 30;
      const plan = boxPlan(rPx);
      if (plan.direct) throw new Error('expected the strided path');
      const src = await noiseOnly(env, size);
      const out = await viaNode(env, 'grayscale.filter', { mode: 'box', radius: rPx / size }, size);
      const R = plan.radius;
      const ref = ref2d(src, size, (x, y) => {
        let s = 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) s += at(src, size, x + dx, y + dy);
        return s / ((2 * R + 1) ** 2);
      });
      fail(`box W=${2 * R + 1}`, maxDiff(out, ref), 5e-3);
      return `effective radius ${R} (asked ${rPx}), s=${plan.s}, m=${plan.m}`;
    },
  });
  tests.push({
    name: 'Filter · gaussian (sigma 4 px) equals the CPU gaussian; sharpen / high-pass / emboss / median match their formulas',
    async run(env) {
      const src = await noiseOnly(env);
      const sigma = 4;
      const plan = gaussianPlan(sigma);
      const kern = (x: number, y: number): number => {
        let s = 0;
        let ws = 0;
        for (let dy = -plan.radius; dy <= plan.radius; dy++)
          for (let dx = -plan.radius; dx <= plan.radius; dx++) {
            const w = Math.exp(-(dx * dx) / (2 * sigma * sigma)) * Math.exp(-(dy * dy) / (2 * sigma * sigma));
            s += at(src, N, x + dx, y + dy) * w;
            ws += w;
          }
        return s / ws;
      };
      const gauss = await viaNode(env, 'grayscale.filter', { mode: 'gaussian', radius: (2 * sigma) / N });
      fail('gaussian', maxDiff(gauss, ref2d(src, N, kern)), 5e-3);
      const sharp = await viaNode(env, 'grayscale.filter', { mode: 'sharpen', radius: (2 * sigma) / N, amount: 1.5 });
      fail('sharpen', maxDiff(sharp, ref2d(src, N, (x, y) => at(src, N, x, y) + 1.5 * (at(src, N, x, y) - kern(x, y)))), 8e-3);
      const hp = await viaNode(env, 'grayscale.filter', { mode: 'highpass', radius: (2 * sigma) / N, amount: 1 });
      fail('high-pass', maxDiff(hp, ref2d(src, N, (x, y) => 0.5 + at(src, N, x, y) - kern(x, y))), 8e-3);
      const med = await viaNode(env, 'grayscale.filter', { mode: 'median', median_size: '3x3' });
      fail('median 3x3', maxDiff(med, ref2d(src, N, (x, y) => {
        const a: number[] = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a.push(at(src, N, x + dx, y + dy));
        return a.sort((p, q) => p - q)[4];
      })), 2e-3);
      const med5 = await viaNode(env, 'grayscale.filter', { mode: 'median', median_size: '5x5' });
      fail('median 5x5', maxDiff(med5, ref2d(src, N, (x, y) => {
        const a: number[] = [];
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) a.push(at(src, N, x + dx, y + dy));
        return a.sort((p, q) => p - q)[12];
      })), 2e-3);
      const emb = await viaNode(env, 'grayscale.filter', { mode: 'emboss', amount: 2, angle: 0 });
      fail('emboss', maxDiff(emb, ref2d(src, N, (x, y) => {
        const p = (dx: number, dy: number): number => at(src, N, x + dx, y + dy);
        const gx = p(1, -1) + 2 * p(1, 0) + p(1, 1) - (p(-1, -1) + 2 * p(-1, 0) + p(-1, 1));
        return 0.5 + 2 * 0.25 * gx;
      })), 6e-3);
    },
  });
  tests.push({
    name: 'Filter · min / max (square) = erode / dilate of the same radius',
    async run(env) {
      const a = await viaNode(env, 'grayscale.filter', { mode: 'max', shape: 'square', radius: 6 / N });
      const b = await viaNode(env, 'grayscale.dilate', { operation: 'grow', shape: 'square', radius: 6 / N });
      fail('max', maxDiff(a, b), 1e-6);
      const c = await viaNode(env, 'grayscale.filter', { mode: 'min', shape: 'square', radius: 6 / N });
      const d = await viaNode(env, 'grayscale.dilate', { operation: 'shrink', shape: 'square', radius: 6 / N });
      fail('min', maxDiff(c, d), 1e-6);
    },
  });

  /* ================================================================ tile roll */
  const KX = 29;
  const KY = 11;
  const roll = (name: string, type: string, params: Params, tolMean = 0.008): TestDef => ({
    name: `Roll · ${name}: rolled input gives the rolled output (tiling wrap is exact)`,
    async run(env) {
      const a = await viaNode(env, type, params, N, {}, { tiling: 'both' });
      const b = await viaNode(env, type, params, N, { offset: [-KX / N, -KY / N] }, { tiling: 'both' });
      let sum = 0;
      let bad = 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const d = Math.abs(b[y * N + x] - at(a, N, x - KX, y - KY));
          sum += d;
          if (d > 0.1) bad++;
        }
      const mean = sum / (N * N);
      if (!(mean <= tolMean && bad / (N * N) <= 0.02)) throw new Error(`mean diff ${mean.toExponential(2)}, ${((100 * bad) / (N * N)).toFixed(2)}% pixels off by > 0.1`);
      return `mean diff ${mean.toExponential(1)}`;
    },
  });
  tests.push(
    roll('Dilate circle r=10', 'grayscale.dilate', { operation: 'grow', shape: 'circle', radius: 10 / N }),
    roll('Dilate open octagon', 'grayscale.dilate', { operation: 'open', shape: 'octagon', radius: 5 / N }),
    roll('Filter box (strided)', 'grayscale.filter', { mode: 'box', radius: 20 / N }),
    roll('Filter gaussian', 'grayscale.filter', { mode: 'gaussian', radius: 0.08 }),
    roll('Filter median 5x5', 'grayscale.filter', { mode: 'median', median_size: '5x5' }),
    roll('Filter emboss', 'grayscale.filter', { mode: 'emboss', amount: 1 }),
    roll('Curvature', 'grayscale.curvature', { radius: 0.06, intensity: 2 }),
    roll('AO (jitter off)', 'grayscale.ao', { jitter: false, radius: 0.15, height_scale: 1, directions: 8, steps: 6 }),
    roll('XDoG', 'grayscale.xdog', { radius: 0.05, epsilon: 0.45 }),
    roll('Curve', 'grayscale.curve', {}),
    roll('Threshold soft', 'grayscale.threshold', { type: 'soft', smoothness: 0.2 }),
    roll('Slice bands', 'grayscale.slice', { bands: 4, spacing: 0.15, width: 0.08 }),
  );
  tests.push({
    name: 'Roll · Caustics: offset shift == roll (all three tiling modes), Loop · Evolution 0% == 100% (speed 1, 2, 3)',
    async run(env) {
      const base: Params = { scale: [3, 3], iterations: 6 };
      const img = (extra: Params, tiling: GraphSettings['tiling'] = 'both') => chain(env, N, (g) => add(g, 'grayscale.caustics', { ...base, ...extra }), { tiling }).then((r) => chan(r));
      for (const tiling of ['both', 'x', 'y'] as const) {
        const kx = tiling === 'y' ? 0 : KX;
        const ky = tiling === 'x' ? 0 : KY;
        const a = await img({}, tiling);
        const b = await img({ offset: [-kx / N, -ky / N] }, tiling);
        let sum = 0;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) sum += Math.abs(b[y * N + x] - at(a, N, x - kx, y - ky));
        if (sum / (N * N) > 6e-3) throw new Error(`tiling ${tiling}: mean diff ${(sum / (N * N)).toExponential(2)}`);
      }
      for (const speed of [1, 2, 3]) {
        const a = await img({ evolution: 0, speed });
        const b = await img({ evolution: 1, speed });
        fail(`loop speed ${speed}`, maxDiff(a, b), 4e-3);
      }
      const c = await img({});
      const mean = c.reduce((s, v) => s + v, 0) / c.length;
      const sd = Math.sqrt(c.reduce((s, v) => s + (v - mean) ** 2, 0) / c.length);
      if (!(sd > 0.04)) throw new Error(`caustics are nearly constant (sd ${sd.toFixed(3)})`);
      const mid = await img({ evolution: 0.5 });
      if (maxDiff(mid, c) < 0.05) throw new Error('evolution has no visible effect');
      return `sd ${sd.toFixed(3)}, mean ${mean.toFixed(3)}`;
    },
  });

  /* ================================================================ closed form: threshold, slice, curve */
  const grad = (g: Graph): string => add(g, 'grayscale.gradient', { gtype: 'linear' });
  const viaGrad = (env: Env, type: string, params: Params): Promise<Float32Array> =>
    chain(env, 128, (g) => {
      const a = grad(g);
      const f = add(g, type, params);
      link(g, a, f);
      return f;
    }, { tiling: 'none' }).then((r) => chan(r));
  tests.push({
    name: 'Processing · Threshold / Slice / Curve match their CPU references on a linear gradient',
    async run(env) {
      const v = (i: number): number => ((i % 128) + 0.5) / 128;
      for (const [p, soft] of [[{ threshold: 0.4 }, false], [{ type: 'soft', threshold: 0.6, smoothness: 0.12 }, true]] as [Params, boolean][]) {
        const out = await viaGrad(env, 'grayscale.threshold', p);
        let worst = 0;
        out.forEach((o, i) => (worst = Math.max(worst, Math.abs(o - thresholdReference(v(i), p.threshold as number, (p.smoothness as number) ?? 0.1, soft)))));
        if (worst > 0.012) throw new Error(`threshold ${JSON.stringify(p)}: error ${worst}`); // the hard step may flip one pixel (half precision of the input)
      }
      for (const o of [{ bands: 1, width: 0.2, softness: 0, center: 0.5 }, { bands: 3, spacing: 0.25, width: 0.1, softness: 0.4, center: 0.5 }]) {
        const out = await viaGrad(env, 'grayscale.slice', o as Params);
        let bad = 0;
        out.forEach((val, i) => {
          if (Math.abs(val - sliceReference(v(i), { center: 0.5, width: o.width, softness: o.softness, spacing: o.spacing ?? 0.2, bands: o.bands })) > 0.03) bad++;
        });
        if (bad > 2) throw new Error(`slice ${JSON.stringify(o)}: ${bad} pixels differ`);
      }
      const ident = await viaGrad(env, 'grayscale.curve', { curve: { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } });
      fail('identity curve (256 LUT)', maxDiff(ident, ref2d(ident, 128, (x) => (x + 0.5) / 128)), 3e-3);
      const inv = await viaGrad(env, 'grayscale.curve', { curve: { keys: [{ x: 0, y: 1, mode: 'linear' }, { x: 1, y: 0 }] } });
      fail('inverting curve', maxDiff(inv, ref2d(inv, 128, (x) => 1 - (x + 0.5) / 128)), 4e-3);
      const post = await viaGrad(env, 'grayscale.curve', { curve: { keys: [{ x: 0, y: 0, mode: 'step' }, { x: 0.5, y: 1, mode: 'step' }, { x: 1, y: 1 }] } });
      const distinct = new Set(Array.from(post, (x) => Math.round(x * 20)));
      if (distinct.size > 3) throw new Error(`step curve produced ${distinct.size} distinct levels`);
    },
  });

  /* ================================================================ AO / curvature / xdog known answers */
  tests.push({
    name: 'Processing · AO: flat = 1 everywhere, a bowl is darker in the middle; Curvature: flat = 50%, a cone tip is convex; XDoG: flat bright = white',
    async run(env) {
      const flat = (env2: Env, type: string, p: Params) => chain(env2, N, (g) => { const u = add(g, 'grayscale.uniform', { value: 0.6 }); const f = add(g, type, p); link(g, u, f); return f; }).then((r) => chan(r));
      const ao = await flat(env, 'grayscale.ao', {});
      const mn = Math.min(...ao);
      if (mn < 0.995) throw new Error(`AO of a flat image dropped to ${mn}`);
      const bowl = (type: string, p: Params, invert = false) => chain(env, 96, (g) => { const u = add(g, 'grayscale.gradient', { gtype: 'radial', radius: 0.3, invert }); const f = add(g, type, p); link(g, u, f); return f; }, { tiling: 'none' }).then((r) => chan(r));
      const b = await bowl('grayscale.ao', { radius: 0.25, height_scale: 1, jitter: false, directions: 16, steps: 12, bias: 5 });
      const centre = b[48 * 96 + 48];
      const corner = b[4 * 96 + 4];
      if (!(centre < 0.9 && corner > 0.99)) throw new Error(`AO bowl: centre ${centre.toFixed(3)} (expect < 0.9), corner ${corner.toFixed(3)} (expect > 0.99)`);
      const cf = await flat(env, 'grayscale.curvature', { kind: 'both' });
      fail('curvature of a flat image', Math.max(...cf.map((x) => Math.abs(x - 0.5))), 2e-3);
      const hill = await bowl('grayscale.curvature', { kind: 'both', radius: 0.04, intensity: 3 }, true);
      if (!(hill[48 * 96 + 48] > 0.6)) throw new Error(`cone tip is not convex: ${hill[48 * 96 + 48]}`);
      const xd = await flat(env, 'grayscale.xdog', {});
      fail('xdog of a bright flat image', Math.max(...xd.map((x) => Math.abs(x - 1))), 3e-3);
      return `AO bowl centre ${centre.toFixed(3)}, corner ${corner.toFixed(3)}`;
    },
  });

  /* ================================================================ spline */
  const SPL = (pts: [number, number][], closed = false): ParamValue => ({ closed, points: pts.map(([x, y]) => ({ x, y })) });
  tests.push({
    name: 'Spline · stroke covers its control points, gradient output runs 0 -> 100% along the path, flat caps end at the end point',
    async run(env) {
      const size = 128;
      const pts: [number, number][] = [[0.15, 0.5], [0.5, 0.5], [0.85, 0.5]];
      const build = (extra: Params, pin: string) => (g: Graph): string => {
        const s = add(g, 'grayscale.spline', { spline: SPL(pts), width: 0.08, ...extra });
        const l = add(g, 'utils.levels', {});
        link(g, s, l, 'input', pin);
        return l;
      };
      const px = (r: Float32Array, x: number, y: number): number => r[Math.round(y * size) * size + Math.round(x * size)];
      const mask = chan(await chain(env, size, build({}, 'output'), { tiling: 'none' }));
      const along = chan(await chain(env, size, build({}, 'gradient'), { tiling: 'none' }));
      if (!(px(mask, 0.5, 0.5) > 0.95 && px(mask, 0.3, 0.5) > 0.95)) throw new Error('stroke does not cover the path');
      if (!(px(mask, 0.5, 0.2) < 0.02)) throw new Error('mask is not zero far from the stroke');
      const t0 = px(along, 0.2, 0.5);
      const t1 = px(along, 0.5, 0.5);
      const t2 = px(along, 0.8, 0.5);
      if (!(t0 < t1 && t1 < t2 && t0 < 0.25 && t2 > 0.75 && Math.abs(t1 - 0.5) < 0.1)) throw new Error(`gradient along the path: ${t0.toFixed(2)}, ${t1.toFixed(2)}, ${t2.toFixed(2)}`);
      const round = chan(await chain(env, size, build({ cap: 'round' }, 'output'), { tiling: 'none' }));
      const butt = chan(await chain(env, size, build({ cap: 'butt' }, 'output'), { tiling: 'none' }));
      if (!(px(round, 0.15 - 0.03, 0.5) > 0.5 && px(butt, 0.15 - 0.03, 0.5) < 0.1)) throw new Error('round cap should extend past the end point, flat cap should not');
      const taper = chan(await chain(env, size, build({ width_curve: { keys: [{ x: 0, y: 1 }, { x: 1, y: 0 }] }, softness: 0 }, 'output'), { tiling: 'none' }));
      if (!(px(taper, 0.3, 0.52) > px(taper, 0.7, 0.52) + 0.3)) throw new Error('width profile does not taper the stroke');
      return 'ok';
    },
  });
  tests.push({
    name: 'Roll · Spline: a closed ring crossing the border, moved by whole pixels, equals the rolled image (tiled strokes wrap)',
    async run(env) {
      const ring = (dx: number, dy: number): ParamValue => SPL([[0.92 + dx, 0.5 + dy], [0.72 + dx, 0.7 + dy], [0.52 + dx, 0.5 + dy], [0.72 + dx, 0.3 + dy]], true);
      const img = (dx: number, dy: number) => chain(env, N, (g) => add(g, 'grayscale.spline', { spline: ring(dx, dy), width: 0.1, softness: 0.4 }), { tiling: 'both' }).then((r) => chan(r));
      const a = await img(0, 0);
      const b = await img(KX / N, KY / N);
      let sum = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) sum += Math.abs(b[y * N + x] - at(a, N, x - KX, y - KY));
      if (sum / (N * N) > 0.01) throw new Error(`mean diff ${(sum / (N * N)).toExponential(2)}`);
      if (Math.min(...a.slice(0, 8)) === Math.max(...a)) throw new Error('empty image');
    },
  });

  /* ================================================================ colour nodes */
  const colorChain = (env: Env, build: (g: Graph) => string, size = 32, settings: Partial<GraphSettings> = { tiling: 'none' }) => chain(env, size, build, settings);
  const px4 = (r: { data: Float32Array; ch: number }, i = 0): number[] => Array.from(r.data.slice(i * r.ch, i * r.ch + 4));
  const near = (a: number[], b: number[], tol: number, what: string): void => {
    for (let i = 0; i < b.length; i++) if (!(Math.abs(a[i] - b[i]) <= tol)) throw new Error(`${what}: got [${a.map((x) => x.toFixed(3))}] expected [${b.map((x) => x.toFixed(3))}]`);
  };
  tests.push({
    name: 'Color · Uniform (HDR, intensity), Interpolate (mask 0 / 50% / 100%, OKLab), Hue Spread (hue = id), Replace (match / no match + mask output)',
    async run(env) {
      const u = await colorChain(env, (g) => add(g, 'color.uniform', { color: [0.25, 0.5, 0.75, 0.5], intensity: 2 }));
      near(px4(u), [0.5, 1, 1.5, 0.5], 2e-3, 'uniform color x2');
      const mixAt = async (m: number, space = 'linear'): Promise<number[]> =>
        px4(await colorChain(env, (g) => {
          const a = add(g, 'color.uniform', { color: [1, 0, 0, 1] });
          const b = add(g, 'color.uniform', { color: [0, 0, 1, 1] });
          const mk_ = add(g, 'grayscale.uniform', { value: m });
          const i = add(g, 'color.interpolate', { space });
          link(g, a, i, 'a');
          link(g, b, i, 'b');
          link(g, mk_, i, 'mask');
          return i;
        }));
      near(await mixAt(0), [1, 0, 0, 1], 2e-3, 'interpolate 0%');
      near(await mixAt(1), [0, 0, 1, 1], 2e-3, 'interpolate 100%');
      near(await mixAt(0.5), [0.5, 0, 0.5, 1], 3e-3, 'interpolate 50% linear');
      const ok = await mixAt(0.5, 'oklab');
      if (!(ok.every(Number.isFinite) && ok[1] >= -1e-3)) throw new Error(`oklab mix not finite: ${ok}`);
      // hue spread: set mode, id 0.5 of a full turn -> cyan-ish (hue 180 degrees)
      const hs = px4(await colorChain(env, (g) => {
        const id = add(g, 'grayscale.uniform', { value: 0.5 });
        const f = add(g, 'color.hue_spread', { mode: 'set', hue_start: 0, hue_range: 360, saturation: 1, value: 1 });
        link(g, id, f, 'id');
        return f;
      }));
      if (!(hs[0] < 0.05 && hs[1] > 0.5 && hs[2] > 0.5)) throw new Error(`hue spread at id 50% should be cyan, got [${hs.map((x) => x.toFixed(2))}]`);
      const rep = async (inp: number[]) => {
        const e = engineOf(env);
        try {
          const g = mk(e, 16, { tiling: 'none' });
          const c = add(g, 'color.uniform', { color: inp });
          const r = add(g, 'color.replace', { source: [0.8, 0.1, 0.05, 1], target: [0.05, 0.4, 1, 1], tolerance: 0.1, softness: 0.05 });
          link(g, c, r);
          const lv = add(g, 'utils.levels', {});
          link(g, r, lv, 'input', 'mask');
          const col = await read(e, g, r);
          const msk = await read(e, g, lv);
          return { col: px4(col), mask: msk.data[0] };
        } finally {
          dispose(e);
        }
      };
      const hit = await rep([0.8, 0.1, 0.05, 1]);
      near(hit.col, [0.05, 0.4, 1, 1], 4e-3, 'replace (match)');
      if (!(hit.mask > 0.99)) throw new Error(`mask at a match: ${hit.mask}`);
      const miss = await rep([0.05, 0.9, 0.1, 1]);
      near(miss.col, [0.05, 0.9, 0.1, 1], 2e-3, 'replace (no match)');
      if (!(miss.mask < 0.01)) throw new Error(`mask away from the source: ${miss.mask}`);
    },
  });
  tests.push({
    name: 'Color · Ramp: black->white gradient reproduces its gray input (256 LUT); Adjust identity / exposure / desaturate',
    async run(env) {
      const lin = { interp: 'linear', stops: [{ pos: 0, color: [0, 0, 0, 1] }, { pos: 1, color: [1, 1, 1, 1] }] };
      const src = await noiseOnly(env, 32);
      const ramp = await colorChain(env, (g) => {
        const n = add(g, 'grayscale.noise', noiseP());
        const r = add(g, 'color.ramp', { gradient: lin as ParamValue });
        link(g, n, r);
        return r;
      }, 32, { tiling: 'both' });
      let worst = 0;
      for (let i = 0; i < src.length; i++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(ramp.data[i * ramp.ch + c] - Math.min(Math.max(src[i], 0), 1)));
      if (worst > 4e-3) throw new Error(`ramp deviates from its input by ${worst}`);
      const adj = async (p: Params) => px4(await colorChain(env, (g) => {
        const c = add(g, 'color.uniform', { color: [0.3, 0.2, 0.1, 0.7] });
        const a = add(g, 'color.adjust', p);
        link(g, c, a);
        return a;
      }));
      near(await adj({}), [0.3, 0.2, 0.1, 0.7], 1.5e-3, 'adjust identity');
      near(await adj({ exposure: 1 }), [0.6, 0.4, 0.2, 0.7], 3e-3, 'adjust +1 EV');
      near(await adj({ value: 0.5 }), [0.15, 0.1, 0.05, 0.7], 2e-3, 'adjust value 50%');
      const gray = await adj({ saturation: 0 });
      if (!(Math.abs(gray[0] - gray[1]) < 4e-3 && Math.abs(gray[1] - gray[2]) < 4e-3)) throw new Error(`saturation 0 is not gray: ${gray}`);
      const hue = await adj({ hue: 120 });
      if (maxDiff(Float32Array.from(hue), Float32Array.from([0.3, 0.2, 0.1, 0.7])) < 0.02) throw new Error('hue shift has no effect');
      if (hue.some((x) => !Number.isFinite(x))) throw new Error('hue shift produced NaN');
    },
  });
  tests.push({
    name: 'Color · Fractal: alpha = coverage equals the Gray Fractal (shared fractal_core); tile roll; hue mode gives several hues',
    async run(env) {
      const fp: Params = { scale: [6, 6], octaves: 2, seed: 4, shape: 'star', sides: 5, rot_max: 40 };
      const g1 = await chain(env, N, (g) => add(g, 'grayscale.fractal', fp), { tiling: 'both' });
      const c1 = await chain(env, N, (g) => add(g, 'color.fractal', { ...fp, alpha_mode: 'coverage' }), { tiling: 'both' });
      fail('colour fractal coverage vs gray fractal', maxDiff(chan(c1, 3), chan(g1)), 3e-3);
      for (const t of [px4(c1, 0), px4(c1, 777)]) if (t.some((x) => !Number.isFinite(x))) throw new Error('NaN in colour fractal');
      // plateau (inner) + full intensity: a pointed splat rarely exceeds the coverage threshold below at 64 px
      const base = { ...fp, inner: 0.8, int_min: 1, alpha_mode: 'coverage', color_mode: 'hue' } as Params;
      const a = await chain(env, N, (g) => add(g, 'color.fractal', base), { tiling: 'both' });
      const b = await chain(env, N, (g) => add(g, 'color.fractal', { ...base, position: [KX / N, KY / N] }), { tiling: 'both' });
      let sum = 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) for (let c = 0; c < 4; c++) sum += Math.abs(b.data[(y * N + x) * 4 + c] - a.data[(((y - KY + N) % N) * N + ((x - KX + N) % N)) * 4 + c]);
      if (sum / (N * N * 4) > 0.012) throw new Error(`colour fractal roll: mean diff ${(sum / (N * N * 4)).toExponential(2)}`);
      // several distinct hues: chroma spread of lit pixels
      let lit = 0;
      let rMax = 0;
      let gMax = 0;
      let bMax = 0;
      for (let i = 0; i < N * N; i++) {
        if (a.data[i * 4 + 3] > 0.5) {
          lit++;
          rMax = Math.max(rMax, a.data[i * 4]);
          gMax = Math.max(gMax, a.data[i * 4 + 1]);
          bMax = Math.max(bMax, a.data[i * 4 + 2]);
        }
      }
      if (lit < 10 || Math.min(rMax, gMax, bMax) < 0.3) throw new Error(`hue mode: lit ${lit}, channel maxima ${rMax.toFixed(2)} ${gMax.toFixed(2)} ${bMax.toFixed(2)}`);
      return `${lit} lit pixels, maxima ${rMax.toFixed(2)}/${gMax.toFixed(2)}/${bMax.toFixed(2)}`;
    },
  });

  /* ================================================================ all nodes x gallery */
  const NEW_IDS = ['grayscale.curve', 'grayscale.threshold', 'grayscale.slice', 'grayscale.dilate', 'grayscale.filter', 'grayscale.curvature', 'grayscale.ao', 'grayscale.caustics', 'grayscale.xdog', 'grayscale.spline', 'color.uniform', 'color.adjust', 'color.ramp', 'color.interpolate', 'color.hue_spread', 'color.replace', 'color.fractal'];
  tests.push({
    name: 'Processing · all 17 new nodes x default + gallery variants render finite, non-constant output (tiling both)',
    async run(env) {
      const lines: string[] = [];
      for (const id of NEW_IDS) {
        const def = env.registry.get(id);
        if (!def) throw new Error(`${id} is not registered`);
        const variants: { name: string; params: Params }[] = [{ name: 'default', params: {} }, ...(def.gallery ?? [])];
        for (const v of variants) {
          const e = engineOf(env);
          try {
            const g = mk(e, 64, { tiling: 'both' });
            const node = add(g, id, v.params);
            let k = 0;
            for (const pin of def.inputs) {
              if (pin.optional || pin.role === 'modulation') continue;
              const n = add(g, 'grayscale.noise', { seed: 5 + k, scale: [4 + k, 4 + k] });
              if (pin.type === 'color') {
                const r = add(g, 'color.ramp', {});
                link(g, n, r);
                link(g, r, node, pin.id);
              } else link(g, n, node, pin.id);
              k++;
            }
            const r = await read(e, g, node);
            let mn = Infinity;
            let mx = -Infinity;
            for (const x of r.data) {
              if (!Number.isFinite(x)) throw new Error(`${id}/${v.name}: NaN or Infinity`);
              mn = Math.min(mn, x);
              mx = Math.max(mx, x);
            }
            if (mx - mn < 0.005 && id !== 'color.uniform') throw new Error(`${id}/${v.name}: output is constant (${mn})`);
            const gray = r.ch === 1 && !['grayscale.filter', 'grayscale.curve', 'grayscale.caustics'].includes(id);
            if (gray && (mn < -1e-3 || mx > 1 + 1e-3)) throw new Error(`${id}/${v.name}: range [${mn}, ${mx}] outside [0,1]`);
          } finally {
            dispose(e);
          }
        }
        lines.push(`${id}: ${variants.length} variants OK`);
      }
      return lines.join('\n');
    },
  });

  /* ================================================================ timing */
  tests.push({
    name: 'Timing · 2048x2048 GPU wall time of one evaluation (submit -> queue idle, no readback; informational, budget ~8 ms per node on mid-range GPUs)',
    async run(env) {
      const e = engineOf(env);
      const out: string[] = [];
      try {
        const size = 2048;
        const g = mk(e, size, { tiling: 'both' });
        const src = add(g, 'grayscale.noise', { scale: [8, 8], octaves: 4 });
        const time = async (target: string): Promise<number> => {
          const run = async (): Promise<number> => {
            const t0 = performance.now();
            const res = await e.evaluator.evaluate(g, [{ nodeId: target }], { useCache: false });
            await e.gpu.device.queue.onSubmittedWorkDone();
            const dt = performance.now() - t0;
            res.release();
            return dt;
          };
          await run();
          return Math.min(await run(), await run());
        };
        const base = await time(src);
        out.push(`noise source alone: ${base.toFixed(1)} ms`);
        const cases: [string, Params][] = [
          ['grayscale.ao', {}],
          ['grayscale.ao', { directions: 24, steps: 12, radius: 0.2 }],
          ['grayscale.dilate', { operation: 'grow', shape: 'circle', radius: 0.02 }],
          ['grayscale.dilate', { operation: 'close', shape: 'circle', radius: 0.08 }],
          ['grayscale.dilate', { operation: 'grow', shape: 'square', radius: 0.12 }],
          ['grayscale.filter', { mode: 'box', radius: 0.02 }],
          ['grayscale.filter', { mode: 'gaussian', radius: 0.01 }],
          ['grayscale.filter', { mode: 'median', median_size: '3x3' }],
          ['grayscale.filter', { mode: 'median', median_size: '5x5' }],
          ['grayscale.filter', { mode: 'sharpen', radius: 0.006 }],
          ['grayscale.curvature', {}],
          ['grayscale.xdog', {}],
          ['grayscale.curve', {}],
        ];
        for (const [type, p] of cases) {
          const n = add(g, type, p);
          link(g, src, n);
          const t = await time(n);
          out.push(`${type} ${JSON.stringify(p)}: ${t.toFixed(1)} ms total, ~${Math.max(t - base, 0).toFixed(1)} ms for the node${t - base > 8 ? '  (> 8 ms budget on this GPU)' : ''}`);
        }
        for (const [type, p] of [['grayscale.caustics', {}], ['grayscale.spline', { spline_2: SPL([[0.1, 0.1], [0.9, 0.9]]) }]] as [string, Params][]) {
          const n = add(g, type, p);
          out.push(`${type}: ${(await time(n)).toFixed(1)} ms`);
        }
      } finally {
        dispose(e);
      }
      return out.join('\n');
    },
  });
  return tests;
}
