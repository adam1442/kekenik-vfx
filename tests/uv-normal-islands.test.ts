import { describe, expect, it } from 'vitest';
import { makeRegistry } from './helpers';
import { cclModel, autoIterations, fromHalf, islandHash, islandLocal, islandMapValue, islandRand, islandSlots, islandStats, labelIslands } from '../src/nodes/_shared/islands';
import { perspFwd, perspInv, polarC2P, polarDefaults, polarP2C, type PolarRef } from '../src/nodes/_shared/polar';
import { decodeUvCodec, deltaToUv, encodeUvCodec, uvToDelta, type UvCodec } from '../src/nodes/_shared/uvparams';
import { combineNormals } from '../src/nodes/normal/combine/definition';
import { mergeNormalXY } from '../src/nodes/normal/normal_merge/definition';
import { normalFromHeight } from '../src/nodes/normal/create/definition';
import { flowPhases } from '../src/nodes/uv/flow/definition';
import { blendDeltas } from '../src/nodes/uv/blend/definition';
import { sobelGradient } from '../src/nodes/uv/from_grayscale/definition';

const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

describe('registry', () => {
  const reg = makeRegistry();
  const UV = ['identity', 'transform', 'noise', 'directional', 'radial', 'rotational', 'spline', 'flow', 'from_grayscale', 'blend', 'blur', 'cartesian_to_polar'];
  const NORMAL = ['create', 'combine', 'color_to_normal', 'normal_to_color', 'normal_merge', 'normal_split'];
  const ISLANDS = ['generate', 'padding', 'to_color', 'to_gradient', 'to_grayscale', 'to_uv'];
  const UTILS = ['cartesian_to_polar', 'cartesian_to_polar_color', 'polar_to_cartesian', 'polar_to_cartesian_color', 'color_to_uv', 'uv_to_color', 'uv_merge', 'uv_split'];
  const all = [...UV.map((n) => `uv.${n}`), ...NORMAL.map((n) => `normal.${n}`), ...ISLANDS.map((n) => `islands.${n}`), ...UTILS.map((n) => `utils.${n}`)];

  it('registers every node of the 4B scope (32 definitions)', () => {
    for (const id of all) expect(reg.has(id), id).toBe(true);
    expect(all.length).toBe(32);
  });
  it('every node has the Texture tab, a cost hint, gallery entries and a shader declaration', () => {
    for (const id of all) {
      const d = reg.get(id)!;
      expect(reg.expanded(id)!.params.some((p) => p.id === 'tex_size_mode'), id).toBe(true);
      expect(d.cost, id).toBeTruthy();
      expect(d.gallery?.length ?? 0, id).toBeGreaterThan(0);
      expect(d.shaders?.length ?? 0, id).toBeGreaterThan(0);
    }
  });
  it('UV producers store through a `uv_out` mode flag; consumers have an input mode flag', () => {
    for (const n of ['identity', 'transform', 'noise', 'directional', 'radial', 'rotational', 'spline', 'flow', 'from_grayscale', 'blend', 'blur', 'cartesian_to_polar']) {
      const d = reg.get(`uv.${n}`)!;
      expect(d.params.some((p) => p.id === 'uv_out'), n).toBe(true);
      expect(d.outputs.some((o) => o.type === 'uv'), n).toBe(true);
    }
    for (const id of ['uv.transform', 'uv.blur', 'uv.flow', 'utils.uv_to_color', 'utils.uv_split']) expect(reg.get(id)!.params.some((p) => p.id.startsWith('uv_in')), id).toBe(true);
    expect(reg.get('uv.blend')!.params.filter((p) => p.id.startsWith('uv_in')).length).toBe(2);
  });
  it('spatial nodes ship gizmos that reference real params', () => {
    for (const id of ['uv.transform', 'uv.noise', 'uv.directional', 'uv.radial', 'uv.rotational', 'uv.spline', 'uv.from_grayscale', 'uv.blur', 'uv.cartesian_to_polar', 'utils.cartesian_to_polar', 'utils.polar_to_cartesian', 'normal.create', 'islands.padding', 'islands.to_gradient', 'islands.to_uv']) {
      const d = reg.get(id)!;
      expect(d.gizmos?.length ?? 0, id).toBeGreaterThan(0);
    }
    expect(reg.get('uv.spline')!.gizmos!.every((g) => g.type === 'path')).toBe(true);
    expect(reg.get('uv.radial')!.gizmos![0].type).toBe('circle');
  });
  it('pins: Generate exposes the documented island outputs; modulation pins exist', () => {
    expect(reg.get('islands.generate')!.outputs.map((o) => `${o.id}:${o.type}`)).toEqual(['islands:color', 'id:gray', 'size:gray', 'center:uv', 'labels:color']);
    expect(reg.get('uv.flow')!.outputs.map((o) => o.id)).toEqual(['uv_a', 'uv_b', 'weight', 'result']);
    expect(reg.expanded('uv.directional')!.inputs.map((i) => i.id)).toEqual(expect.arrayContaining(['angle_mod', 'strength_mod']));
    expect(reg.expanded('uv.noise')!.inputs.some((i) => i.id === 'strength_mod')).toBe(true);
    expect(reg.get('normal.normal_split')!.outputs.map((o) => o.id)).toEqual(['x', 'y', 'z']);
    expect(reg.get('utils.uv_merge')!.inputs.every((i) => i.optional)).toBe(true);
  });
});

describe('UV pin convention', () => {
  it('absolute <-> offset conversion is exact and mode independent', () => {
    const uv: [number, number] = [0.3, 0.8];
    const delta: [number, number] = [0.05, -0.1];
    expect(deltaToUv(delta, uv, 'absolute')).toEqual([0.35, 0.8 + -0.1]);
    expect(deltaToUv(delta, uv, 'offset')).toEqual(delta);
    expect(uvToDelta(deltaToUv(delta, uv, 'absolute'), uv, 'absolute')[0]).toBeCloseTo(delta[0], 12);
    expect(uvToDelta(deltaToUv(delta, uv, 'offset'), uv, 'offset')).toEqual(delta);
  });
  for (const codec of ['absolute', 'offset', 'biased', 'direction'] as UvCodec[])
    for (const flip of [false, true])
      for (const content of [false, true])
        it(`encode / decode round trip: ${codec} flipY=${flip} contentMotion=${content}`, () => {
          const r = rng(5);
          for (let i = 0; i < 40; i++) {
            const uv: [number, number] = [r(), r()];
            const delta: [number, number] = [(r() - 0.5) * 0.15, (r() - 0.5) * 0.15];
            const e = encodeUvCodec(delta, uv, codec, 0.1, flip, content);
            const d = decodeUvCodec(e, uv, codec, 0.1, flip, content);
            const tol = codec === 'direction' ? 1e-6 : 1e-9;
            expect(Math.abs(d[0] - delta[0]), `${codec} dx`).toBeLessThan(tol);
            expect(Math.abs(d[1] - delta[1]), `${codec} dy`).toBeLessThan(tol);
          }
        });
  it('biased encoding: neutral = 0.5, content-motion flow is the negated lookup offset (engine flowmap convention)', () => {
    expect(encodeUvCodec([0, 0], [0.5, 0.5], 'biased', 0.1, false)).toEqual([0.5, 0.5, 0]);
    const lookup = encodeUvCodec([0.05, 0], [0, 0], 'biased', 0.1, false, false);
    const flow = encodeUvCodec([0.05, 0], [0, 0], 'biased', 0.1, false, true);
    expect(lookup[0]).toBeCloseTo(0.75, 9);
    expect(flow[0]).toBeCloseTo(0.25, 9);
  });
  it('Flow two-phase weights are periodic, complementary and zero exactly at the phase reset', () => {
    for (const smooth of [false, true]) {
      for (let t = -2; t < 3; t += 0.037) {
        const a = flowPhases(t, smooth);
        const b = flowPhases(t + 0.5, smooth);
        expect(a.wa + b.wa).toBeCloseTo(1, 9);
        expect(flowPhases(t + 1, smooth).wa).toBeCloseTo(a.wa, 9);
        expect(flowPhases(t + 1, smooth).pa).toBeCloseTo(a.pa, 9);
      }
      expect(flowPhases(0, smooth).wa).toBe(0);
      expect(flowPhases(0.5, smooth).wa).toBeCloseTo(1, 12);
    }
  });
  it('UV Blend operations on deltas', () => {
    expect(blendDeltas('mix', [0.1, 0], [0.3, 0.2], 0.5, 0.1)).toEqual([0.2, 0.1]);
    expect(blendDeltas('add', [0.1, 0], [0.3, 0.2], 1, 0.1)).toEqual([0.4, 0.2]);
    expect(blendDeltas('add', [0.1, 0], [0.3, 0.2], 0, 0.1)).toEqual([0.1, 0]);
    expect(blendDeltas('subtract', [0.1, 0], [0.3, 0.2], 1, 0.1)[0]).toBeCloseTo(-0.2, 12);
    expect(blendDeltas('multiply', [0.1, 0.1], [0.1, 0.2], 1, 0.1)[1]).toBeCloseTo(0.2, 12);
    expect(blendDeltas('compose', [0.1, 0], [0, 0], 1, 0.1, [0.02, 0.03])).toEqual([expect.closeTo(0.12, 12), 0.03]);
    expect(blendDeltas('max', [0.1, 0], [0.3, 0.2], 1, 0.1)).toEqual([0.3, 0.2]);
  });
  it('Sobel gradient of a linear ramp equals its slope per step', () => {
    const g = sobelGradient((x, y) => 0.1 * x + 0.25 * y, 5, 5, 2);
    expect(g[0]).toBeCloseTo(0.2, 12);
    expect(g[1]).toBeCloseTo(0.5, 12);
  });
});

describe('Cartesian <-> Polar (CPU mirror of _shared/polar.wgsl)', () => {
  const variants: [string, Partial<PolarRef>][] = [
    ['euclidean', {}],
    ['chebyshev', { metric: 1 }],
    ['squircle', { metric: 2, squircle: 4 }],
    ['spiral', { spiral: 0.7 }],
    ['pinch + rotation', { pinch: 0.8, rotation: 0.6 }],
    ['perspective', { persp: 0.5 }],
    ['half aperture', { ap: 0.5 }],
    ['radial scaling / centering', { rscale: 0.8, rcenter: 0.05 }],
    ['offset centre', { center: [0.4, 0.55] }],
  ];
  for (const [name, o] of variants)
    it(`Polar -> Cartesian inverts Cartesian -> Polar: ${name}`, () => {
      const pr: PolarRef = { ...polarDefaults(), ...o };
      const r = rng(11);
      let tested = 0;
      for (let i = 0; i < 400; i++) {
        const p: [number, number] = [pr.center[0] + (r() - 0.5) * 0.8, pr.center[1] + (r() - 0.5) * 0.8];
        const c = polarC2P(p, pr);
        if (c.oob) continue;
        const rn = Math.hypot(p[0] - pr.center[0], p[1] - pr.center[1]);
        if (rn > 0.42 || rn < 0.03) continue;
        const q = polarP2C([c.u, c.v], pr);
        expect(Math.abs(q[0] - p[0]), `${name} x`).toBeLessThan(2e-4);
        expect(Math.abs(q[1] - p[1]), `${name} y`).toBeLessThan(2e-4);
        tested++;
      }
      expect(tested).toBeGreaterThan(40);
    });
  it('perspective mapping is monotonic with fixed ends and exactly invertible', () => {
    for (const a of [0.05, 0.3, 0.7, 0.95]) {
      expect(perspFwd(0, a)).toBeCloseTo(0, 9);
      expect(perspFwd(1, a)).toBeCloseTo(1, 9);
      let prev = -1;
      for (let r = 0; r <= 1; r += 0.05) {
        const v = perspFwd(r, a);
        expect(v).toBeGreaterThan(prev);
        prev = v;
        expect(perspInv(v, a)).toBeCloseTo(r, 6);
      }
    }
  });
  it('angular tiling repeats the angular axis; the seam wraps (u in [0,1))', () => {
    const pr: PolarRef = { ...polarDefaults(), angTiles: 4, oob: 1 };
    const a = polarC2P([0.5 + 0.3 * Math.cos(0.3), 0.5 + 0.3 * Math.sin(0.3)], pr);
    const b = polarC2P([0.5 + 0.3 * Math.cos(0.3 + Math.PI / 2), 0.5 + 0.3 * Math.sin(0.3 + Math.PI / 2)], pr);
    expect(Math.abs(a.u - b.u)).toBeLessThan(1e-6);
    for (let i = 0; i < 200; i++) {
      const c = polarC2P([Math.random(), Math.random()], pr);
      expect(c.u).toBeGreaterThanOrEqual(0);
      expect(c.u).toBeLessThan(1 + 1e-9);
    }
  });
  it('scale 2 doubles the covered radius; Chebyshev makes the equal-v contours square', () => {
    const base = polarC2P([0.75, 0.5], polarDefaults());
    const big = polarC2P([0.75, 0.5], { ...polarDefaults(), scale: 2, oob: 0 });
    expect(base.v).toBeCloseTo(0.5, 9);
    expect(big.v).toBeCloseTo(0.25, 9);
    const sq = { ...polarDefaults(), metric: 1 as const };
    expect(polarC2P([0.7, 0.5], sq).v).toBeCloseTo(polarC2P([0.7, 0.7], sq).v, 9);
  });
});

describe('Normal maps (CPU references)', () => {
  const o = { strength: 1, heightScale: 0.05 };
  it('flat height gives (0.5, 0.5, 1)', () => {
    const n = normalFromHeight(new Float32Array(64).fill(0.3), 8, 8, { ...o, tileX: true, tileY: true });
    for (let i = 0; i < 64; i++) {
      expect(n[i * 3]).toBeCloseTo(0.5, 9);
      expect(n[i * 3 + 1]).toBeCloseTo(0.5, 9);
      expect(n[i * 3 + 2]).toBeCloseTo(1, 9);
    }
  });
  it('a ramp tilts the normal by the documented slope; OpenGL vs DirectX differ only in Y', () => {
    const w = 16;
    const hx = Float32Array.from({ length: w * w }, (_, i) => (i % w) / w);
    const hy = Float32Array.from({ length: w * w }, (_, i) => Math.floor(i / w) / w);
    const at = (a: Float32Array, x: number, y: number, c: number): number => a[(y * w + x) * 3 + c];
    const nx = normalFromHeight(hx, w, w, o);
    // slope 1 * height scale 0.05 -> n = (-0.05, 0, 1) normalised
    const inv = 1 / Math.hypot(0.05, 1);
    expect(at(nx, 8, 8, 0)).toBeCloseTo(-0.05 * inv * 0.5 + 0.5, 6);
    expect(at(nx, 8, 8, 1)).toBeCloseTo(0.5, 9);
    const gl = normalFromHeight(hy, w, w, o);
    const dx = normalFromHeight(hy, w, w, { ...o, directx: true });
    expect(at(gl, 8, 8, 1)).toBeCloseTo(0.05 * inv * 0.5 + 0.5, 6);
    expect(at(dx, 8, 8, 1)).toBeCloseTo(-0.05 * inv * 0.5 + 0.5, 6);
    expect(at(gl, 8, 8, 0)).toBeCloseTo(at(dx, 8, 8, 0), 12);
  });
  it('central, Sobel and Scharr agree on a linear ramp; strength scales the slope', () => {
    const w = 16;
    const h = Float32Array.from({ length: w * w }, (_, i) => ((i % w) + Math.floor(i / w)) / (2 * w));
    const c = normalFromHeight(h, w, w, { ...o, kernel: 'central' });
    const s = normalFromHeight(h, w, w, { ...o, kernel: 'sobel' });
    const k = normalFromHeight(h, w, w, { ...o, kernel: 'scharr' });
    const i = (8 * w + 8) * 3;
    for (let ch = 0; ch < 3; ch++) {
      expect(c[i + ch]).toBeCloseTo(s[i + ch], 6);
      expect(c[i + ch]).toBeCloseTo(k[i + ch], 6);
    }
    const strong = normalFromHeight(h, w, w, { ...o, strength: 4 });
    expect(Math.abs(strong[i] - 0.5)).toBeGreaterThan(Math.abs(s[i] - 0.5) * 3);
  });
  it('tiling: rolling the height rolls the normal map (wrap aware), clamping does not', () => {
    const w = 16;
    const r = rng(3);
    const h = Float32Array.from({ length: w * w }, () => r());
    const roll = (a: ArrayLike<number>, ch: number, dx: number, dy: number): Float32Array => {
      const out = new Float32Array(w * w * ch);
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) out[(((y + dy) % w) * w + ((x + dx) % w)) * ch + c] = a[(y * w + x) * ch + c];
      return out;
    };
    const t = { ...o, tileX: true, tileY: true };
    const a = normalFromHeight(roll(h, 1, 3, 5), w, w, t);
    const b = roll(normalFromHeight(h, w, w, t), 3, 3, 5);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 6);
    const c1 = normalFromHeight(roll(h, 1, 3, 5), w, w, o);
    const c2 = roll(normalFromHeight(h, w, w, o), 3, 3, 5);
    expect(c1.some((v, i) => Math.abs(v - c2[i]) > 1e-3)).toBe(true);
  });
  it('Normal Combine: neutral detail / neutral base identities, unit length for every mode', () => {
    const base: [number, number, number] = [0.3, -0.2, Math.sqrt(1 - 0.13)];
    const flat: [number, number, number] = [0, 0, 1];
    for (const m of ['reoriented', 'detail', 'whiteout', 'partial'] as const) {
      const r = combineNormals(base, flat, m);
      expect(r[0]).toBeCloseTo(base[0], 6);
      expect(r[1]).toBeCloseTo(base[1], 6);
    }
    const rn = combineNormals(flat, base, 'reoriented');
    expect(rn[0]).toBeCloseTo(base[0], 6);
    expect(rn[1]).toBeCloseTo(base[1], 6);
    const det: [number, number, number] = [-0.4, 0.1, Math.sqrt(1 - 0.17)];
    for (const m of ['reoriented', 'detail', 'whiteout', 'linear', 'partial'] as const) expect(Math.hypot(...combineNormals(base, det, m))).toBeCloseTo(1, 9);
    // zero detail strength = base (all modes)
    for (const m of ['reoriented', 'detail', 'whiteout', 'linear', 'partial'] as const) {
      const r = combineNormals(base, det, m, 0);
      if (m !== 'linear') expect(r[0]).toBeCloseTo(base[0], 6);
    }
  });
  it('Normal Merge reconstructs Z', () => {
    expect(mergeNormalXY(0.5, 0.5, { mode: 'reconstruct', range: 1 })).toEqual([0, 0, 1]);
    const e = mergeNormalXY(1, 0.5, { mode: 'reconstruct', range: 1 });
    expect(e[0]).toBeCloseTo(1, 9);
    expect(e[2]).toBeCloseTo(0, 9);
    const clamp = mergeNormalXY(1, 1, { mode: 'reconstruct', range: 1 });
    expect(Math.hypot(...clamp)).toBeCloseTo(1, 9);
    const z = mergeNormalXY(0.75, 0.5, { mode: 'xyz', range: 1, gz: 1 });
    expect(Math.hypot(...z)).toBeCloseTo(1, 9);
    expect(mergeNormalXY(0.5, 1, { mode: 'reconstruct', range: 1, flipY: true })[1]).toBeCloseTo(-1, 9);
  });
});

/* ------------------------------------------------------------------------------------------------ islands */
const snake = (n: number): Uint8Array => {
  const m = new Uint8Array(n * n);
  for (let y = 0; y < n; y += 2) {
    for (let x = 1; x < n - 1; x++) m[y * n + x] = 1;
    if (y + 2 < n) m[(y + 1) * n + ((y / 2) % 2 === 0 ? n - 2 : 1)] = 1;
  }
  return m;
};
const spiral = (n: number): Uint8Array => {
  const m = new Uint8Array(n * n);
  const vis = new Uint8Array(n * n);
  let x = 0;
  let y = 0;
  let dx = 1;
  let dy = 0;
  for (let i = 0; i < n * n; i++) {
    m[y * n + x] = 1;
    vis[y * n + x] = 1;
    const nx = x + dx;
    const ny = y + dy;
    const ax = nx + dx;
    const ay = ny + dy;
    const blocked = nx < 0 || ny < 0 || nx >= n || ny >= n || vis[ny * n + nx] || (ax >= 0 && ay >= 0 && ax < n && ay < n && vis[ay * n + ax]);
    if (blocked) {
      const t = dx;
      dx = -dy;
      dy = t;
    }
    const mx = x + dx;
    const my = y + dy;
    if (mx < 0 || my < 0 || mx >= n || my >= n || vis[my * n + mx]) break;
    x = mx;
    y = my;
  }
  return m;
};
const grid = (rows: string[]): { m: Uint8Array; w: number; h: number } => ({ m: Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0))), w: rows[0].length, h: rows.length });

describe('Islands (CPU references)', () => {
  it('labels small known masks: 4- vs 8-connectivity', () => {
    const { m, w, h } = grid(['#...', '.#..', '..#.', '...#']);
    expect(labelIslands(m, w, h, { eight: false }).count).toBe(4);
    const e = labelIslands(m, w, h, { eight: true });
    expect(e.count).toBe(1);
    expect([...e.labels].filter((v) => v >= 0).every((v) => v === 0)).toBe(true);
  });
  it('labels: root = first pixel in raster order, separate blobs get separate roots', () => {
    const { m, w, h } = grid(['##..#', '##..#', '....#', '.##..', '.##..']);
    const r = labelIslands(m, w, h);
    expect(r.count).toBe(3);
    expect(r.labels[0]).toBe(0);
    expect(r.labels[4]).toBe(4);
    expect(r.labels[3 * 5 + 1]).toBe(3 * 5 + 1);
    expect(r.labels[2]).toBe(-1);
  });
  it('wrap: an island across the seam is ONE island with root = smallest raster index, bbox is root-relative', () => {
    const { m, w, h } = grid(['##.##']);
    expect(labelIslands(m, w, h).count).toBe(2);
    const t = labelIslands(m, w, h, { tileX: true });
    expect(t.count).toBe(1);
    expect(new Set([...t.labels].filter((v) => v >= 0))).toEqual(new Set([0]));
    const s = islandStats(t.labels, w, h, { tileX: true }).get(0)!;
    expect(s.count).toBe(4);
    expect([s.minX, s.maxX]).toEqual([-2, 1]);
    expect(s.cx).toBeCloseTo(-0.5, 12);
    const map = islandMapValue(s, w, h);
    expect(map[0]).toBeCloseTo(-2 / 5, 12);
    expect(map[2]).toBeCloseTo(4 / 5, 12);
    // local coordinates: the pixel at x = 4 (centre uv 0.9) is the second pixel of the box [-0.4, 0.4)
    const loc = islandLocal(map, [0.9, 0.1], true, false);
    expect(loc[0]).toBeCloseTo((0.9 - -0.4 - 1) / 0.8, 6);
  });
  it('stats: counts, bounding boxes and centres of mass of two blobs', () => {
    const { m, w, h } = grid(['##....', '##....', '......', '....#.', '....##']);
    const r = labelIslands(m, w, h);
    const st = islandStats(r.labels, w, h);
    expect(st.size).toBe(2);
    const a = st.get(0)!;
    expect([a.count, a.minX, a.maxX, a.minY, a.maxY]).toEqual([4, 0, 1, 0, 1]);
    expect(a.cx).toBeCloseTo(0.5, 12);
    const b = st.get(3 * 6 + 4)!;
    expect([b.count, b.minX, b.maxX, b.minY, b.maxY]).toEqual([3, 4, 5, 3, 4]);
    expect(b.cx).toBeCloseTo(13 / 3, 12);
  });
  for (const n of [32, 64, 128])
    for (const [name, make] of [
      ['snake', snake],
      ['spiral', spiral],
      ['noise 45%', (k: number) => { const r = rng(7); return Uint8Array.from({ length: k * k }, () => (r() < 0.45 ? 1 : 0)); }],
      ['noise 62%', (k: number) => { const r = rng(9); return Uint8Array.from({ length: k * k }, () => (r() < 0.62 ? 1 : 0)); }],
      ['full', (k: number) => new Uint8Array(k * k).fill(1)],
    ] as [string, (n: number) => Uint8Array][])
      it(`GPU union-find model == exact labelling within the auto round count: ${name} ${n}²`, () => {
        for (const eight of [false, true])
          for (const [tx, ty] of [[false, false], [true, true], [true, false]] as [boolean, boolean][]) {
            const mask = make(n);
            const ref = labelIslands(mask, n, n, { eight, tileX: tx, tileY: ty });
            const res = cclModel(mask, n, n, autoIterations(n, n), { eight, tileX: tx, tileY: ty });
            expect(res.converged, `${name} eight=${eight} tile=${tx}${ty}`).toBeGreaterThanOrEqual(0);
            expect(res.converged).toBeLessThanOrEqual(8);
            expect(Array.from(res.labels)).toEqual(Array.from(ref.labels));
          }
      });
  it('bounded: a budget of 1 round does not hang and still never links different islands', () => {
    const n = 32;
    const mask = spiral(n);
    const res = cclModel(mask, n, n, 1, { eight: true });
    const ref = labelIslands(mask, n, n, { eight: true });
    for (let i = 0; i < n * n; i++) if (res.labels[i] >= 0) expect(ref.labels[i]).toBe(ref.labels[res.labels[i]]);
  });
  it('island hash / random: deterministic, uniform-ish, distinct per island, seed dependent', () => {
    const maps = Array.from({ length: 500 }, (_, i) => [fromHalf(i / 500), fromHalf(((i * 37) % 500) / 500), fromHalf(0.03 + (i % 7) * 0.01), fromHalf(0.02 + (i % 5) * 0.01)]);
    const vals = maps.map((m) => islandRand(m, 1));
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(vals).size).toBe(500);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.05);
    expect(islandHash(maps[3], 1)).toBe(islandHash(maps[3], 1));
    expect(islandHash(maps[3], 1)).not.toBe(islandHash(maps[3], 2));
  });
  it('half-float rounding mirror and table sizing', () => {
    expect(fromHalf(0.5)).toBe(0.5);
    expect(fromHalf(0.1)).toBeCloseTo(0.0999755859375, 12);
    expect(fromHalf(-0.4)).toBeCloseTo(-0.39990234375, 12);
    expect(islandSlots(65536)).toBe(131072);
    expect(islandSlots(16384)).toBe(32768);
    expect(autoIterations(1024, 1024)).toBe(14);
    expect(autoIterations(8192, 8192)).toBeLessThanOrEqual(64);
  });
});
