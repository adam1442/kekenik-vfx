import { describe, expect, it } from 'vitest';
import { packUniforms } from '../src/engine/shaders/uniforms';
import { blurReference, gaussianKernel1D, kawaseOffsets, pyramidBoxVariance, pyramidLevels } from '../src/nodes/_shared/blur2';
import { boxPlan, gaussianPlan } from '../src/nodes/_shared/blur';
import { reduceReference } from '../src/nodes/_shared/reduce';
import { bilateralPlan, LAYOUT as BILATERAL_LAYOUT } from '../src/nodes/utils/bilateral/definition';
import { blendReference, crossReference } from '../src/nodes/utils/blend/definition';
import { LAYOUT as COPY_LAYOUT, modInverse, scatterPlan, scatterReach } from '../src/nodes/utils/copy_transform/definition';
import { jfaSteps } from '../src/nodes/utils/distance/definition';
import { glowDepth, glowWeights } from '../src/nodes/utils/glow/definition';
import { latticeJitter, latticeRest } from '../src/nodes/utils/lattice/definition';
import { levelsReference } from '../src/nodes/utils/levels/definition';
import { grayWeights } from '../src/nodes/utils/rgb_to_grayscale/definition';
import { softblendWeight } from '../src/nodes/utils/softblend/definition';
import { switchIndices } from '../src/nodes/utils/multi_switch/definition';
import { LAYOUT as TRANSFORM_LAYOUT, transformInverse, transformMapUv } from '../src/nodes/utils/transform/definition';
import { makeRegistry } from './helpers';

const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

describe('registry', () => {
  const reg = makeRegistry();
  const BASES = ['blur', 'directional_blur', 'bilateral', 'kuwahara', 'denoise', 'glow', 'fxaa', 'edge_detect', 'levels', 'blend', 'multi_blend', 'softblend', 'multi_switch', 'transform', 'tile', 'lattice', 'copy_transform', 'auto_crop'];
  const SINGLE = ['distance', 'grid', 'alpha_merge', 'alpha_split', 'rgba_merge', 'rgba_split', 'hsva_to_rgba', 'rgba_to_hsva', 'rgb_to_grayscale'];
  it('registers every node; filters ship Gray AND Color variants', () => {
    for (const b of BASES) {
      expect(reg.has(`utils.${b}`), b).toBe(true);
      expect(reg.has(`utils.${b}_color`), `${b}_color`).toBe(true);
      expect(reg.get(`utils.${b}`)!.inputs[0].type === 'gray' || b === 'multi_blend' || b === 'multi_switch').toBe(true);
    }
    for (const s of SINGLE) expect(reg.has(`utils.${s}`), s).toBe(true);
  });
  it('every node has Texture tab params, gizmos for spatial nodes, gallery entries and pooled-friendly cost hints', () => {
    for (const id of [...BASES.flatMap((b) => [`utils.${b}`, `utils.${b}_color`]), ...SINGLE.map((s) => `utils.${s}`)]) {
      const ex = reg.expanded(id)!;
      expect(ex.params.some((p) => p.id === 'tex_size_mode'), id).toBe(true);
      expect(reg.get(id)!.cost, id).toBeTruthy();
    }
    for (const id of ['utils.transform', 'utils.grid', 'utils.lattice', 'utils.tile', 'utils.copy_transform']) expect(reg.get(id)!.gizmos?.length, id).toBeGreaterThan(0);
    expect(reg.get('utils.lattice')!.gizmos!.length).toBe(16);
    expect(reg.get('utils.grid')!.outputs.map((o) => o.id)).toContain('cell_id');
  });
  it('Distance exposes distance / id / nearest uv; Blur and Directional Blur are modulatable', () => {
    expect(reg.get('utils.distance')!.outputs.map((o) => o.type)).toEqual(['gray', 'gray', 'uv']);
    expect(reg.expanded('utils.blur')!.inputs.some((i) => i.id === 'radius_mod')).toBe(true);
    const db = reg.expanded('utils.directional_blur')!.inputs.map((i) => i.id);
    expect(db).toContain('angle_mod');
    expect(db).toContain('length_mod');
    expect(db).toContain('uv');
  });
  it('blend mode list has every required mode', () => {
    const modes = reg.get('utils.blend')!.params.find((p) => p.id === 'blend_type')!;
    const vals = (modes as { options: { value: string }[] }).options.map((o) => o.value);
    for (const m of ['copy', 'add', 'subtract', 'multiply', 'divide', 'screen', 'overlay', 'soft_light', 'hard_light', 'color_dodge', 'color_burn', 'difference', 'exclusion', 'min', 'max', 'smooth_min', 'smooth_max', 'hue', 'saturation', 'color', 'luminosity']) expect(vals).toContain(m);
  });
  it('uniform layouts pack for typical values', () => {
    expect(() => packUniforms(BILATERAL_LAYOUT, { taps: 4, stride: 1, sigma_s: 2, sigma_r: 0.1, dir_x: 0, dir_y: 0, mode: 0 })).not.toThrow();
    expect(() => packUniforms(TRANSFORM_LAYOUT, { translate: [0, 0], pivot: [0.5, 0.5], minv: [1, 0, 0, 1], edge: 0, has_uv: 0 })).not.toThrow();
    const plan = scatterPlan(100);
    expect(() => packUniforms(COPY_LAYOUT, { offset: [0, 0], grid: plan.grid, reach: 2, count: 100, cells_total: plan.total, inv_a: plan.invA, seed: 1, size: 0.1, scale_min: 1, scale_max: 1, rot_min: 0, rot_max: 0, value_min: 1, value_max: 1, jitter: 1, combine: 0, has_scale_map: 0, has_mask: 0 })).not.toThrow();
  });
});

describe('blur math', () => {
  it('gaussian kernel is normalised and symmetric', () => {
    const k = gaussianKernel1D(3);
    expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(k[0]).toBeCloseTo(k[k.length - 1], 12);
  });
  it('wrap reference: blurring a single bright pixel at the border wraps energy to the opposite side', () => {
    const n = 16;
    const img = new Float32Array(n * n);
    img[0] = 1;
    const t = blurReference(img, n, n, 2, 2, true, true);
    const c = blurReference(img, n, n, 2, 2, false, false);
    expect(t[n - 1]).toBeGreaterThan(0);
    expect(t.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(c[n - 1]).toBe(0);
  });
  it('plans: pyramid depth stops at odd / tiny sizes; cascaded gaussian and box plans stay bounded', () => {
    expect(pyramidLevels(1024, 1024, 6)).toBe(0);
    expect(pyramidLevels(1024, 1024, 100)).toBe(4);
    expect(pyramidLevels(1000, 1000, 400)).toBe(3); // 1000 -> 500 -> 250 -> 125 (odd) stops
    expect(pyramidLevels(63, 63, 100)).toBe(0);
    expect(gaussianPlan(10).iterations).toBe(1);
    expect(gaussianPlan(1000).iterations).toBeLessThanOrEqual(8);
    expect(boxPlan(100).radius).toBeLessThanOrEqual(160);
  });
  it('kawase offsets reproduce the requested variance', () => {
    for (const s of [1, 4, 16, 60]) {
      const v = kawaseOffsets(s).reduce((a, o) => a + o * o, 0);
      expect(Math.sqrt(v)).toBeCloseTo(s, 6);
    }
    expect(kawaseOffsets(0.05)).toEqual([]);
  });
  it('CPU simulation of the pyramid hybrid (box down, gaussian, cubic up) matches the exact gaussian on smooth data', () => {
    const n = 128;
    const sigma = 24;
    const img = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) img[y * n + x] = 0.5 + 0.3 * Math.sin((2 * Math.PI * 2 * x) / n) * Math.cos((2 * Math.PI * 3 * y) / n) + 0.15 * Math.sin((2 * Math.PI * 7 * (x + y)) / n);
    const k = pyramidLevels(n, n, sigma);
    expect(k).toBeGreaterThanOrEqual(1);
    let cur = img;
    let cn = n;
    for (let i = 0; i < k; i++) {
      const m = cn / 2;
      const nx = new Float32Array(m * m);
      for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) nx[y * m + x] = (cur[2 * y * cn + 2 * x] + cur[2 * y * cn + 2 * x + 1] + cur[(2 * y + 1) * cn + 2 * x] + cur[(2 * y + 1) * cn + 2 * x + 1]) / 4;
      cur = nx;
      cn = m;
    }
    const s = Math.sqrt(Math.max(sigma * sigma - pyramidBoxVariance(k), 0)) / 2 ** k;
    const low = blurReference(cur, cn, cn, s, s, true, true);
    const w = (t: number): number[] => [-0.5 * t ** 3 + t * t - 0.5 * t, 1.5 * t ** 3 - 2.5 * t * t + 1, -1.5 * t ** 3 + 2 * t * t + 0.5 * t, 0.5 * t ** 3 - 0.5 * t * t];
    const up = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const px = ((x + 0.5) / n) * cn - 0.5;
        const py = ((y + 0.5) / n) * cn - 0.5;
        const fx = Math.floor(px), fy = Math.floor(py);
        const wx = w(px - fx), wy = w(py - fy);
        let acc = 0;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) acc += low[((((fy + j - 1) % cn) + cn) % cn) * cn + ((((fx + i - 1) % cn) + cn) % cn)] * wx[i] * wy[j];
        up[y * n + x] = acc;
      }
    const exact = blurReference(img, n, n, sigma, sigma, true, true);
    let worst = 0;
    for (let i = 0; i < up.length; i++) worst = Math.max(worst, Math.abs(up[i] - exact[i]));
    expect(worst).toBeLessThan(0.02);
  });
});

describe('levels / blend / softblend / switch math', () => {
  it('levels reference still identity', () => {
    expect(levelsReference(0.3, { inLow: 0, inHigh: 1, gamma: 1, outLow: 0, outHigh: 1, clamp: true })).toBeCloseTo(0.3, 9);
  });
  it('blend modes: algebraic identities and known values', () => {
    for (const bg of [0.1, 0.5, 0.9]) {
      expect(blendReference('multiply', bg, 1)).toBeCloseTo(bg, 9);
      expect(blendReference('screen', bg, 0)).toBeCloseTo(bg, 9);
      expect(blendReference('add', bg, 0)).toBeCloseTo(bg, 9);
      expect(blendReference('difference', bg, bg)).toBe(0);
      expect(blendReference('overlay', bg, 0.5)).toBeCloseTo(bg, 9);
      expect(blendReference('hard_light', bg, 0.5)).toBeCloseTo(bg, 9);
      expect(blendReference('color_dodge', bg, 0)).toBeCloseTo(bg, 9);
      expect(blendReference('color_burn', bg, 1)).toBeCloseTo(bg, 9);
      expect(blendReference('linear_light', bg, 0.5)).toBeCloseTo(bg, 9);
      expect(blendReference('soft_light', bg, 0.5)).toBeCloseTo(bg, 9);
    }
    expect(blendReference('subtract', 0.5, 0.2)).toBeCloseTo(0.3, 9);
    expect(blendReference('divide', 0.6, 0.3)).toBeCloseTo(2, 6);
    expect(blendReference('exclusion', 0.3, 0.7)).toBeCloseTo(0.3 + 0.7 - 2 * 0.21, 9);
    expect(blendReference('smooth_min', 0.3, 0.3, 0.2)).toBeLessThan(0.3);
    expect(blendReference('smooth_min', 0.2, 0.9, 0.1)).toBeCloseTo(0.2, 9); // far apart: hard min
    expect(blendReference('smooth_max', 0.2, 0.9, 0.1)).toBeCloseTo(0.9, 9);
    for (const m of ['add', 'multiply', 'screen', 'max', 'min', 'difference']) expect(blendReference(m, 0.3, 0.7)).toBeCloseTo(blendReference(m, 0.7, 0.3), 9); // commutative modes
  });
  it('cross mix: 0 = background, 50% = blend, 100% = foreground, linear between', () => {
    expect(crossReference(0.3, 0.7, 1.0, 0)).toBeCloseTo(0.3, 9);
    expect(crossReference(0.3, 0.7, 1.0, 0.5)).toBeCloseTo(1.0, 9);
    expect(crossReference(0.3, 0.7, 1.0, 1)).toBeCloseTo(0.7, 9);
    expect(crossReference(0.3, 0.7, 1.0, 0.25)).toBeCloseTo(0.65, 9);
  });
  it('softblend weight: hard when far apart, 0.5 at equal heights, offset moves it', () => {
    expect(softblendWeight(0.9, 0.1, 0.1)).toBe(1);
    expect(softblendWeight(0.1, 0.9, 0.1)).toBe(0);
    expect(softblendWeight(0.5, 0.5, 0.1)).toBeCloseTo(0.5, 9);
    expect(softblendWeight(0.4, 0.5, 0.1, 0.1)).toBeCloseTo(0.5, 9);
  });
  it('multi switch indices: step / nearest / crossfade, wrap and clamp (loop friendly)', () => {
    expect(switchIndices(1.7, 3, 'step', true)).toEqual({ a: 1, b: 1, t: 0 });
    expect(switchIndices(1.6, 3, 'nearest', true).a).toBe(2);
    expect(switchIndices(3, 3, 'step', true).a).toBe(0);
    expect(switchIndices(-1, 3, 'step', true).a).toBe(2);
    expect(switchIndices(7, 3, 'step', false).a).toBe(2);
    const c = switchIndices(2.25, 3, 'crossfade', true);
    expect([c.a, c.b]).toEqual([2, 0]);
    expect(c.t).toBeCloseTo(0.25, 9);
    expect(switchIndices(2.25, 3, 'crossfade', false)).toMatchObject({ a: 2, b: 2 });
    // loop: index and index + count give identical selections
    for (const i of [0, 0.4, 1.5, 2.9]) {
      const a = switchIndices(i + 3, 3, 'crossfade', true);
      const b = switchIndices(i, 3, 'crossfade', true);
      expect([a.a, a.b]).toEqual([b.a, b.b]);
      expect(a.t).toBeCloseTo(b.t, 9);
    }
  });
});

describe('transform / lattice / scatter math', () => {
  it('transform inverse composes to identity and maps the pivot to itself', () => {
    const rot = 0.7, sc: [number, number] = [1.3, 0.6], sk: [number, number] = [0.2, -0.1];
    const inv = transformInverse(rot, sc, sk);
    // forward matrix
    const c = Math.cos(rot), s = Math.sin(rot), kx = Math.tan(sk[0]), ky = Math.tan(sk[1]);
    const a = sc[0], b = kx * sc[1], cc = ky * sc[0], d = sc[1];
    const m = [c * a - s * cc, c * b - s * d, s * a + c * cc, s * b + c * d];
    const id = [inv[0] * m[0] + inv[1] * m[2], inv[0] * m[1] + inv[1] * m[3], inv[2] * m[0] + inv[3] * m[2], inv[2] * m[1] + inv[3] * m[3]];
    expect(id[0]).toBeCloseTo(1, 9);
    expect(id[1]).toBeCloseTo(0, 9);
    expect(id[2]).toBeCloseTo(0, 9);
    expect(id[3]).toBeCloseTo(1, 9);
    const p = transformMapUv([0.3, 0.8], { translate: [0, 0], pivot: [0.3, 0.8], minv: inv, aspect: 1.5 });
    expect(p[0]).toBeCloseTo(0.3, 9);
    expect(p[1]).toBeCloseTo(0.8, 9);
  });
  it('identity transform maps every uv to itself; translation shifts the lookup', () => {
    const id = transformInverse(0, [1, 1], [0, 0]);
    expect(transformMapUv([0.2, 0.9], { translate: [0, 0], pivot: [0.5, 0.5], minv: id, aspect: 2 })).toEqual([0.2, 0.9]);
    const t = transformMapUv([0.5, 0.5], { translate: [0.1, 0], pivot: [0.5, 0.5], minv: id, aspect: 1 });
    expect(t[0]).toBeCloseTo(0.4, 9); // content moves right => lookup moves left
  });
  it('scatter plan: N copies occupy N DISTINCT cells and the inverse recovers the index', () => {
    for (const n of [1, 2, 7, 64, 100, 1000, 4096]) {
      const p = scatterPlan(n);
      expect(p.grid * p.grid).toBeGreaterThanOrEqual(n);
      const seen = new Set<number>();
      for (let k = 0; k < n; k++) {
        const cell = (k * p.a) % p.total;
        expect(seen.has(cell)).toBe(false);
        seen.add(cell);
        expect((cell * p.invA) % p.total).toBe(k);
      }
    }
    expect(modInverse(3, 7)).toBe(5);
    expect(() => modInverse(2, 4)).toThrow();
    expect(scatterReach(32, 0.1, 1, 1)).toBeGreaterThanOrEqual(2);
    expect(scatterReach(64, 2, 4, 1)).toBe(6);
  });
  it('lattice helpers: rest positions, deterministic jitter in range', () => {
    expect(latticeRest(3, 0, true)).toEqual([0.75, 0]);
    expect(latticeRest(3, 3, false)).toEqual([1, 1]);
    const a = latticeJitter(1, 2, 7);
    expect(latticeJitter(1, 2, 7)).toEqual(a);
    expect(latticeJitter(1, 2, 8)).not.toEqual(a);
    for (let i = 0; i < 16; i++) for (const v of latticeJitter(i % 4, Math.floor(i / 4), 3)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });
});

describe('distance (jump flooding) CPU model', () => {
  it('step list: halves down to 1 and ends with the extra JFA+1 step', () => {
    expect(jfaSteps(8, 8)).toEqual([4, 2, 1, 1]);
    const s = jfaSteps(1000, 600);
    expect(s[0]).toBe(500);
    expect(s[s.length - 1]).toBe(1);
    expect(s[s.length - 2]).toBe(1);
  });
  it('the JFA algorithm (same steps, wrap, minimum image) matches brute force on random masks', () => {
    const n = 40;
    const rnd = rng(5);
    for (const density of [0.01, 0.05, 0.3]) {
      const seed = new Array<number>(n * n).fill(-1);
      for (let i = 0; i < n * n; i++) if (rnd() < density) seed[i] = i;
      const wd = (a: number, b: number): number => { const d = Math.abs(a - b); return Math.min(d, n - d); };
      let cur = seed.slice();
      for (const step of jfaSteps(n, n)) {
        const nxt = cur.slice();
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          let best = cur[y * n + x];
          let bd = best >= 0 ? wd(x, best % n) ** 2 + wd(y, Math.floor(best / n)) ** 2 : Infinity;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const q = cur[((((y + j * step) % n) + n) % n) * n + ((((x + i * step) % n) + n) % n)];
            if (q < 0) continue;
            const d = wd(x, q % n) ** 2 + wd(y, Math.floor(q / n)) ** 2;
            if (d < bd) { bd = d; best = q; }
          }
          nxt[y * n + x] = best;
        }
        cur = nxt;
      }
      const pts = seed.filter((v) => v >= 0);
      if (!pts.length) continue;
      let bad = 0, worst = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let best = Infinity;
        for (const p of pts) best = Math.min(best, Math.hypot(wd(x, p % n), wd(y, Math.floor(p / n))));
        const q = cur[y * n + x];
        const got = Math.hypot(wd(x, q % n), wd(y, Math.floor(q / n)));
        const e = Math.abs(got - best);
        worst = Math.max(worst, e);
        if (e > 1e-6) bad++;
      }
      expect(bad / (n * n)).toBeLessThan(0.02);
      expect(worst).toBeLessThan(1.5);
    }
  });
});

describe('reduction / glow / bilateral / channel helpers', () => {
  it('reduction reference: bounds, value range, empty content', () => {
    const w = 8, h = 6;
    const d = new Float32Array(w * h);
    d[2 * w + 3] = 0.9;
    d[4 * w + 6] = 0.5;
    const r = reduceReference(d, w, h, 1, (p) => [p[0], p[0]], 0.1);
    expect(r.slice(0, 4)).toEqual([3, 2, 7, 5]); expect(r[5]).toBeCloseTo(0.9, 6); expect(r.slice(6)).toEqual([2, 1]);
    expect(reduceReference(d, w, h, 1, (p) => [p[0], p[0]], 5)).toEqual([0, 0, w, h, 0, Math.fround(0.9), 0, 0]);
    expect(reduceReference(d, w, h, 1, (p) => [p[0], p[0]], null).slice(4, 6)).toEqual([0, Math.fround(0.9)]);
  });
  it('glow weights are normalised and move to coarser levels with a bigger radius; depth honours divisibility', () => {
    const small = glowWeights(4, 6, 6);
    const big = glowWeights(200, 6, 6);
    expect(small.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(big.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(big[5]).toBeGreaterThan(small[5]);
    expect(small[0]).toBeGreaterThan(big[0]);
    expect(glowWeights(50, 6, 0).every((v) => v === 0)).toBe(true);
    expect(glowDepth(1024, 1024, 6)).toBe(6);
    expect(glowDepth(1000, 1000, 6)).toBe(3);
    expect(glowDepth(1001, 1000, 6)).toBe(0);
  });
  it('bilateral plan caps taps and uses a stride for big radii', () => {
    expect(bilateralPlan(3)).toMatchObject({ taps: 3, stride: 1 });
    const p = bilateralPlan(60);
    expect(p.taps).toBeLessThanOrEqual(12);
    expect(p.taps * p.stride).toBeGreaterThanOrEqual(50);
  });
  it('gray weights: presets sum to 1, custom normalises on request', () => {
    for (const m of ['rec709', 'rec601', 'average']) expect(grayWeights(m, [0, 0, 0], false).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    expect(grayWeights('custom', [2, 1, 1], true)).toEqual([0.5, 0.25, 0.25]);
    expect(grayWeights('custom', [2, 1, 1], false)).toEqual([2, 1, 1]);
  });
});
