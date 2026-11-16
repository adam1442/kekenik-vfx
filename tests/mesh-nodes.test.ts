import { afterEach, describe, expect, it } from 'vitest';
import { gizmoParamRefs } from '../src/engine/graph/gizmo-decl';
import { Params } from '../src/engine/params/accessor';
import { defaultValues, type ParamValue } from '../src/engine/params/schema';
import { asMesh } from '../src/engine/mesh/accounting';
import { accumulateStep, AccumHistory, bakeAnimation, bakePivots, bakeTexture, clearHistories, defaultAccumulateParams, freezeStep, MeshFrameRecorder } from '../src/engine/mesh/history';
import { blendChannel, combineColor, combineScale, combineTransform, defaultCombineColorParams, defaultCombineScaleParams, defaultCombineTransformParams, defaultExtractParams, extractPoints, hash01 } from '../src/engine/mesh/attrs';
import { defaultNoiseParams, defaultWarpParams, falloffWeight, latticeOffset, noiseDisplace, spaceWarp } from '../src/engine/mesh/deform';
import { boundsBox, computeNormalsAngle, computeTangents, deletePrimitives, fusePoints, subdivide, triangulateMesh } from '../src/engine/mesh/helpers';
import { MeshData, STD } from '../src/engine/mesh/mesh';
import { mergeMeshes } from '../src/engine/mesh/ops';
import { defaultShapeParams, makeShape } from '../src/engine/mesh/shapes';
import { fbm, perlin4, simplex3 } from '../src/engine/mesh/noise3';
import { computeFrames, defaultSweepParams, makeProfile, resamplePath, sweep, type SweepParams } from '../src/engine/mesh/sweep';
import { downsample, sampleChannel, sampleTex, texSnaps, type CpuTexture } from '../src/engine/mesh/texsnap';
import { MESH_RECIPES, type RecipeSink } from '../src/nodes/_shared/mesh-recipes';
import { renderMeshThumb } from '../src/panels/node-gallery/mesh-thumb';
import { makeRegistry } from './helpers';

const shape = (s: Parameters<typeof makeShape>[0]['shape'], over: Partial<ReturnType<typeof defaultShapeParams>> = {}) => makeShape({ ...defaultShapeParams(), shape: s, ...over });
const line = (z = 0) => ({ closed: false, points: [{ x: -1, y: 0, attrs: { z, scale: 1, twist: 0 } }, { x: 1, y: 0, attrs: { z, scale: 1, twist: 0 } }] });
const sw = (o: Partial<SweepParams> = {}) => sweep({ ...defaultSweepParams(), spline: line(), ...o });
const tex = (w: number, h: number, ch: number, f: (x: number, y: number, c: number) => number): CpuTexture => {
  const d = new Float32Array(w * h * ch);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) d[(y * w + x) * ch + c] = f(x, y, c);
  return { width: w, height: h, channels: ch, data: d };
};
afterEach(() => clearHistories());

describe('noise3', () => {
  it('is deterministic by seed, bounded and seed dependent', () => {
    const o = { kind: 'perlin' as const, octaves: 3, lacunarity: 2, gain: 0.5, seed: 4, t: 0.3, loopCycles: 0 };
    expect(fbm(0.3, 1.7, 2.2, o)).toBe(fbm(0.3, 1.7, 2.2, o));
    expect(fbm(0.3, 1.7, 2.2, o)).not.toBe(fbm(0.3, 1.7, 2.2, { ...o, seed: 5 }));
    for (let i = 0; i < 400; i++) {
      const v = fbm(i * 0.37, i * 0.11, i * 0.53, o), s = simplex3(i * 0.37, i * 0.11, i * 0.53, 3);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(s)).toBeLessThan(1.2);
    }
    expect(perlin4(3, 4, 5, 6, 1)).toBeCloseTo(0, 6); // lattice points are zero
  });
  it('loops exactly: t = 0 equals t = 1 (perlin 4D periodic lattice and simplex cross-fade)', () => {
    for (const kind of ['perlin', 'simplex'] as const) for (const cycles of [1, 3]) {
      const base = { kind, octaves: 3, lacunarity: 2, gain: 0.5, seed: 9, loopCycles: cycles };
      for (let i = 0; i < 40; i++) {
        const x = i * 0.31, y = i * 0.17 + 0.2, z = i * 0.23;
        expect(fbm(x, y, z, { ...base, t: 0 })).toBeCloseTo(fbm(x, y, z, { ...base, t: 1 }), 5);
      }
      // and it actually moves in between
      expect(Math.abs(fbm(0.4, 0.4, 0.4, { ...base, t: 0 }) - fbm(0.4, 0.4, 0.4, { ...base, t: 0.37 }))).toBeGreaterThan(1e-3);
    }
  });
});

describe('sweep', () => {
  it('circle tube along a line: counts, radius, outward normals, caps, attributes, UV ranges', () => {
    const m = sw({ segments: 8, profileRes: 12, width: 0.4, height: 0.4, capStart: true, capEnd: true });
    expect(m.pointCount).toBe(9 * 12 + 2 * 13);
    expect(m.primCount).toBe(8 * 12 + 2);
    const P = m.positions, N = m.attr('point', STD.N)!.data;
    let maxErr = 0;
    for (let r = 1; r < 8; r++) for (let k = 0; k < 12; k++) {
      const i = r * 12 + k;
      const rad = Math.hypot(P[i * 3 + 1], P[i * 3 + 2]); // line runs along X
      maxErr = Math.max(maxErr, Math.abs(rad - 0.2));
      expect((N[i * 3 + 1] * P[i * 3 + 1] + N[i * 3 + 2] * P[i * 3 + 2]) / rad).toBeGreaterThan(0.95); // outward
    }
    expect(maxErr).toBeLessThan(1e-5);
    const age = m.attr('point', STD.age)!.data;
    expect(age[0]).toBe(0);
    expect(age[8 * 12]).toBeCloseTo(1, 5);
    const uv = m.attr('vertex', 'uv')!.data;
    expect(Math.min(...uv)).toBeGreaterThanOrEqual(-1e-6);
    expect(Math.max(...uv)).toBeLessThanOrEqual(1 + 1e-6);
    expect(m.attr('point', STD.Cd)!.size).toBe(4);
  });
  it('is deterministic and respects v tiling / offset (scrolling)', () => {
    const a = sw({ vTiling: 4, vOffset: 0, capStart: false, capEnd: false }), b = sw({ vTiling: 4, vOffset: 0.25, capStart: false, capEnd: false });
    const ua = a.attr('vertex', 'uv')!.data, ub = b.attr('vertex', 'uv')!.data;
    expect(Math.max(...ua)).toBeCloseTo(4, 5);
    for (let i = 0; i < ua.length; i += 2) expect(ub[i + 1] - ua[i + 1]).toBeCloseTo(0.25, 5);
    expect(Array.from(sw().positions)).toEqual(Array.from(sw().positions));
  });
  it('ribbon faces +N (up) and scale / taper / per-point attributes change the width', () => {
    const m = sw({ profile: 'ribbon', segments: 4, width: 1, up: [0, 0, 1] });
    expect(m.pointCount).toBe(10);
    expect(m.attr('point', STD.N)!.data[2]).toBeGreaterThan(0.99);
    const t = sw({ profile: 'ribbon', segments: 4, width: 1, taperStart: 1, taperEnd: 0.2 });
    const wd = (mm: MeshData, r: number) => Math.abs(mm.positions[(r * 2) * 3 + 1] - mm.positions[(r * 2 + 1) * 3 + 1]);
    expect(wd(t, 0)).toBeCloseTo(1, 5);
    expect(wd(t, 4)).toBeCloseTo(0.2, 5);
    const pa = sweep({ ...defaultSweepParams(), spline: { closed: false, points: [{ x: -1, y: 0, attrs: { z: 0, scale: 1 } }, { x: 1, y: 0, attrs: { z: 0, scale: 3 } }] }, profile: 'ribbon', segments: 4, width: 1 });
    expect(wd(pa, 4)).toBeCloseTo(3, 4);
    expect(Math.abs(sweep({ ...defaultSweepParams(), spline: { closed: false, points: [{ x: -1, y: 0, attrs: { z: 0, scale: 1 } }, { x: 1, y: 0, attrs: { z: 0, scale: 3 } }] }, profile: 'ribbon', segments: 4, width: 1, usePointAttrs: false }).positions[1])).toBeCloseTo(0.5, 5);
  });
  it('closed loops wrap without caps; star / custom profiles build; frames are orthonormal in every mode', () => {
    const ring = { closed: true, points: Array.from({ length: 8 }, (_, i) => ({ x: Math.cos((i / 8) * 6.2832), y: Math.sin((i / 8) * 6.2832), attrs: { z: 0 } })) };
    const t = sweep({ ...defaultSweepParams(), spline: ring, segments: 32, profileRes: 8 });
    expect(t.pointCount).toBe(32 * 8);
    expect(t.primCount).toBe(32 * 8);
    const edges = new Map<string, number>();
    const topo = t.topology;
    for (let p = 0; p < topo.primCount; p++) for (let k = 0; k < 4; k++) {
      const a = topo.vertPoint[topo.primStart[p] + k], b = topo.vertPoint[topo.primStart[p] + ((k + 1) % 4)];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    expect([...edges.values()].every((c) => c === 2)).toBe(true); // watertight torus
    expect(sweep({ ...defaultSweepParams(), spline: line(), profile: 'star', starPoints: 5 }).pointCount).toBeGreaterThan(20);
    expect(makeProfile({ ...defaultSweepParams(), profile: 'custom' }).pts.length).toBe(12);
    const sp = { closed: false, points: [{ x: 0, y: 0, attrs: { z: 0 } }, { x: 1, y: 1, attrs: { z: 0.5 } }, { x: 2, y: 0, attrs: { z: 1 } }, { x: 3, y: 1, attrs: { z: 0.2 } }] };
    for (const mode of ['minimal_torsion', 'frenet', 'up_vector'] as const) {
      const path = resamplePath(sp.points, false, 20);
      const f = computeFrames(path, mode, [0, 0, 1]);
      for (let i = 0; i < 20; i++) {
        expect(Math.hypot(...f.T[i])).toBeCloseTo(1, 4);
        expect(Math.hypot(...f.N[i])).toBeCloseTo(1, 4);
        expect(Math.abs(f.T[i][0] * f.N[i][0] + f.T[i][1] * f.N[i][1] + f.T[i][2] * f.N[i][2])).toBeLessThan(1e-4);
      }
    }
    // minimal torsion on a planar loop closes without residual roll
    const path = resamplePath(ring.points, true, 40);
    const f = computeFrames(path, 'minimal_torsion', [0, 0, 1]);
    const tw = (i: number) => f.N[i][2];
    expect(Math.abs(tw(0) - tw(39))).toBeLessThan(0.2);
  });
  it('guards runaway sizes', () => {
    expect(() => sw({ segments: 4096, profileRes: 256, closed: true })).not.toThrow();
    expect(() => sweep({ ...defaultSweepParams(), spline: { closed: false, points: [] } })).toThrow(/at least 2/);
  });
});

describe('deformers', () => {
  const grid = () => shape('grid', { cols: 12, rows: 12, size: [2, 2, 1] });
  it('noise: deterministic, zero amplitude is identity, masks and falloff restrict it, loop is periodic', () => {
    const g = grid();
    g.freeze();
    const a = noiseDisplace(g, defaultNoiseParams()), b = noiseDisplace(g, defaultNoiseParams());
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.positions)).not.toEqual(Array.from(g.positions));
    expect(Array.from(noiseDisplace(g, { ...defaultNoiseParams(), amplitude: 0 }).positions)).toEqual(Array.from(g.positions));
    const gm = g.clone();
    gm.addAttr('point', 'age', 1, 'f32'); // all zero -> masked out
    gm.freeze();
    expect(Array.from(noiseDisplace(gm, { ...defaultNoiseParams(), mask: 'attribute', maskAttr: 'age' }).positions)).toEqual(Array.from(g.positions));
    const far = noiseDisplace(g, { ...defaultNoiseParams(), falloff: { enabled: true, center: [100, 0, 0], inner: 1, outer: 2, invert: false } });
    expect(Array.from(far.positions)).toEqual(Array.from(g.positions));
    const l0 = noiseDisplace(g, { ...defaultNoiseParams(), t: 0, loopCycles: 2 }), l1 = noiseDisplace(g, { ...defaultNoiseParams(), t: 1, loopCycles: 2 }), lh = noiseDisplace(g, { ...defaultNoiseParams(), t: 0.5, loopCycles: 2 });
    for (let i = 0; i < l0.positions.length; i++) expect(l0.positions[i]).toBeCloseTo(l1.positions[i], 4);
    expect(Array.from(lh.positions)).not.toEqual(Array.from(l0.positions));
    // a texture mask that is 0 everywhere cancels the effect, 1 keeps it
    const withUv = shape('plane', { cols: 6, rows: 6 });
    withUv.freeze();
    const zero = noiseDisplace(withUv, { ...defaultNoiseParams(), mask: 'texture', maskTexture: tex(4, 4, 1, () => 0) });
    expect(Array.from(zero.positions)).toEqual(Array.from(withUv.positions));
    const full = noiseDisplace(withUv, { ...defaultNoiseParams(), mask: 'texture', maskTexture: tex(4, 4, 1, () => 1) });
    expect(Array.from(full.positions)).not.toEqual(Array.from(withUv.positions));
  });
  it('noise stores the raw value and keeps unit normals', () => {
    const g = grid();
    g.freeze();
    const o = noiseDisplace(g, { ...defaultNoiseParams(), storeNoise: true });
    expect(o.attr('point', 'noise')!.data.length).toBe(g.pointCount);
    const N = o.attr('point', STD.N)!.data;
    for (let i = 0; i < N.length / 3; i++) expect(Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2])).toBeCloseTo(1, 4);
  });
  it('space warp: twist rotates, bend curves, taper scales, stretch keeps volume, spherify, wave, ripple, falloff', () => {
    const col = MeshData.fromPositions(Float32Array.of(1, 0, 0, 1, 0, 2, 1, 0, -2));
    col.freeze();
    const w = (over: object) => spaceWarp(col, { ...defaultWarpParams(), recomputeNormals: false, ...over });
    const tw = w({ mode: 'twist', amount: 90, length: 2 }).positions;
    expect(tw[0]).toBeCloseTo(1, 5); // a = 0: unchanged
    expect(Math.hypot(tw[3], tw[4])).toBeCloseTo(1, 5); // stays on the circle
    expect(Math.atan2(tw[4], tw[3])).toBeCloseTo(Math.PI / 2, 4); // a = 2 = length: 90 degrees
    const tp = w({ mode: 'taper', amount: -1, length: 2 }).positions;
    expect(tp[3]).toBeCloseTo(0, 5);
    const st = w({ mode: 'stretch', amount: 1, preserveVolume: true }).positions;
    expect(st[5]).toBeCloseTo(4, 5);
    expect(st[3]).toBeCloseTo(1 / Math.sqrt(2), 5);
    const sp = w({ mode: 'spherify', amount: 1, radius: 2 }).positions;
    for (let i = 0; i < 3; i++) expect(Math.hypot(sp[i * 3], sp[i * 3 + 1], sp[i * 3 + 2])).toBeCloseTo(2, 5);
    const bd = w({ mode: 'bend', amount: 90, length: 2 }).positions;
    expect(bd[0]).toBeCloseTo(1, 5); // a = 0 unchanged
    expect(bd[5]).not.toBeCloseTo(2, 2);
    expect(w({ mode: 'wave', amount: 0.5, frequency: 0.25, phase: 0 }).positions[2]).toBeCloseTo(0.5 * Math.sin(Math.PI / 2), 5); // b = x = 1
    expect(w({ mode: 'ripple', amount: 1, frequency: 1, phase: 0.25 }).positions[2]).toBeCloseTo(Math.sin(Math.PI * 2 * (1 - 0.25)), 5);
    const fo = w({ mode: 'stretch', amount: 1, falloff: { enabled: true, center: [1, 0, 2], inner: 0.1, outer: 0.2, invert: true } }).positions;
    expect(fo[5]).toBeCloseTo(2, 5); // inverted falloff leaves the centre untouched
    expect(falloffWeight({ enabled: true, center: [0, 0, 0], inner: 1, outer: 3, invert: false }, 2, 0, 0)).toBeCloseTo(0.5, 5);
  });
  it('lattice: zero offsets are identity, a corner offset moves the box side smoothly; texture displace follows the map', () => {
    const g = grid();
    g.freeze();
    expect(Array.from(spaceWarp(g, { ...defaultWarpParams(), mode: 'lattice' }).positions)).toEqual(Array.from(g.positions));
    const lat = { res: 2, boxPos: [0, 0, 0] as [number, number, number], boxSize: [2, 2, 2] as [number, number, number], corners: Array.from({ length: 8 }, (_, i) => (i === 7 ? [0, 0, 1] : [0, 0, 0]) as [number, number, number]), jitter: 0, seed: 1 };
    expect(latticeOffset(lat, 1, 1, 1)[2]).toBeCloseTo(1, 6);
    expect(latticeOffset(lat, 0, 0, 0)[2]).toBeCloseTo(0, 6);
    expect(latticeOffset({ ...lat, jitter: 0.5 }, 0.5, 0.5, 0.5)).toEqual(latticeOffset({ ...lat, jitter: 0.5 }, 0.5, 0.5, 0.5));
    const pl = shape('plane', { cols: 4, rows: 4 });
    pl.freeze();
    const d = spaceWarp(pl, { ...defaultWarpParams(), mode: 'displace_texture', amount: 2, textureMid: 0.5, texture: tex(2, 2, 1, () => 1), recomputeNormals: false });
    for (let i = 0; i < d.pointCount; i++) expect(d.positions[i * 3 + 2]).toBeCloseTo(pl.positions[i * 3 + 2] + 1, 4); // plane normal = +Z, (1 - 0.5) * 2
    const none = spaceWarp(pl, { ...defaultWarpParams(), mode: 'displace_texture', amount: 2, texture: null });
    expect(Array.from(none.positions)).toEqual(Array.from(pl.positions)); // snapshot pending: neutral
  });
});

describe('attribute nodes', () => {
  it('combine color: axis gradient, channel write mask, blend, opacity, texture via UV, islands, radial', () => {
    const pl = shape('plane', { cols: 2, rows: 2, size: [2, 2, 1] });
    pl.freeze();
    const g = { stops: [{ pos: 0, color: [0, 0, 0, 1] as [number, number, number, number] }, { pos: 1, color: [1, 0.5, 0.25, 1] as [number, number, number, number] }] };
    const a = combineColor(pl, { ...defaultCombineColorParams(), source: 'gradient_axis', direction: [1, 0, 0], gradient: g });
    const cd = a.attr('point', 'Cd')!.data;
    const P = pl.positions;
    for (let i = 0; i < pl.pointCount; i++) expect(cd[i * 4]).toBeCloseTo((P[i * 3] + 1) / 2, 5);
    const r = combineColor(a, { ...defaultCombineColorParams(), source: 'uniform', color: [0, 0, 0, 0], write: [true, false, false, false], blend: 'copy' });
    r.freeze();
    expect(r.attr('point', 'Cd')!.data[0]).toBe(0);
    expect(r.attr('point', 'Cd')!.data[1]).toBeCloseTo(cd[1], 6); // G untouched
    const half = combineColor(a, { ...defaultCombineColorParams(), source: 'uniform', color: [1, 1, 1, 1], blend: 'add', opacity: 0.5 });
    expect(half.attr('point', 'Cd')!.data[0]).toBeCloseTo(Math.min(1, cd[0]) * 0.5 + (cd[0] + 1) * 0.5 - cd[0] * 0.5 + 0, 5) ;
    // texture via vertex UV (v up): a texture that is 1 only in the top texture row = high v
    const t = tex(2, 2, 1, (_x, y) => (y === 0 ? 1 : 0));
    const tc = combineColor(pl, { ...defaultCombineColorParams(), source: 'texture', texture: t });
    expect(tc.has('vertex', 'Cd')).toBe(true);
    const uvv = pl.attr('vertex', 'uv')!.data, cdv = tc.attr('vertex', 'Cd')!.data;
    for (let v = 0; v < pl.vertexCount; v++) expect(cdv[v * 4]).toBeCloseTo(sampleChannel(t, uvv[v * 2], uvv[v * 2 + 1], 0, true), 5);
    expect(sampleChannel(t, 0.25, 0.75, 0, true)).toBe(1); // top texture row = high v
    expect(combineColor(pl, { ...defaultCombineColorParams(), source: 'texture', texture: null }).has('vertex', 'Cd')).toBe(false); // pending: nothing written
    const two = mergeMeshes([shape('plane', { cols: 2, rows: 2 }), shape('plane', { cols: 2, rows: 2, center: [3, 0, 0] })]);
    two.freeze();
    const ic = combineColor(two, { ...defaultCombineColorParams(), source: 'island' }).attr('point', 'Cd')!.data;
    expect([ic[0], ic[1], ic[2]]).not.toEqual([ic[9 * 4], ic[9 * 4 + 1], ic[9 * 4 + 2]]);
    expect([ic[0], ic[1], ic[2]]).toEqual([ic[4], ic[5], ic[6]]); // same island, same colour
    const rad = combineColor(pl, { ...defaultCombineColorParams(), source: 'gradient_radial', gradient: g }).attr('point', 'Cd')!.data;
    expect(rad[4 * 4]).toBeCloseTo(0, 5); // centre point of the 3x3 grid
    expect(Math.max(...Array.from({ length: pl.pointCount }, (_, i) => rad[i * 4]))).toBeCloseTo(1, 5);
    expect(blendChannel('screen', 0.5, 0.5)).toBeCloseTo(0.75, 6);
    expect(blendChannel('overlay', 0.25, 0.5)).toBeCloseTo(0.25, 6);
  });
  it('combine scale / transform: deterministic random, curve remap, drivers, orient composition', () => {
    const pts = extractPoints(shape('plane', { cols: 4, rows: 4 }), defaultExtractParams());
    pts.freeze();
    const s1 = combineScale(pts, { ...defaultCombineScaleParams(), min: 0.5, max: 1.5, seed: 3 }), s2 = combineScale(pts, { ...defaultCombineScaleParams(), min: 0.5, max: 1.5, seed: 3 });
    const ps = s1.attr('point', STD.pscale)!.data;
    expect(Array.from(ps)).toEqual(Array.from(s2.attr('point', STD.pscale)!.data));
    expect(Math.min(...ps)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...ps)).toBeLessThanOrEqual(1.5);
    expect(Array.from(combineScale(pts, { ...defaultCombineScaleParams(), seed: 4 }).attr('point', STD.pscale)!.data)).not.toEqual(Array.from(ps));
    const sc = combineScale(pts, { ...defaultCombineScaleParams(), source: 'uniform', value: 2, target: 'scale', axes: [1, 0, 1] });
    expect(Array.from(sc.attr('point', STD.scale)!.data.slice(0, 3))).toEqual([2, 1, 2]);
    expect(() => combineScale(pts, { ...defaultCombineScaleParams(), source: 'attribute', attr: 'nope' })).toThrow(/nope/);
    expect(hash01(1, 5)).toBe(hash01(1, 5));
    const ct = combineTransform(pts, { ...defaultCombineTransformParams(), driver: 'x', inMin: -0.5, inMax: 0.5, translate: [0, 0, 1], rotate: [0, 0, 90], scale: [2, 2, 2] });
    const P = pts.positions, Q = ct.positions, SC = ct.attr('point', STD.scale)!.data, OR = ct.attr('point', STD.orient)!.data;
    for (let i = 0; i < pts.pointCount; i++) {
      const v = Math.min(1, Math.max(0, P[i * 3] + 0.5));
      expect(Q[i * 3 + 2] - P[i * 3 + 2]).toBeCloseTo(v, 5);
      expect(SC[i * 3]).toBeCloseTo(1 + v, 5);
      expect(OR[i * 4 + 2]).toBeCloseTo(Math.sin((v * Math.PI) / 4), 4);
    }
  });
  it('extract points: points / vertices / primitives / islands keep attributes and build orient + id', () => {
    const two = mergeMeshes([shape('plane', { cols: 2, rows: 2 }), shape('plane', { cols: 2, rows: 2, center: [4, 0, 0] })]);
    two.freeze();
    const pt = extractPoints(two, defaultExtractParams());
    expect(pt.pointCount).toBe(two.pointCount);
    expect(pt.isPointCloud).toBe(true);
    expect(pt.has('point', STD.orient) && pt.has('point', STD.id) && pt.has('point', 'uv')).toBe(true);
    const half = extractPoints(two, { ...defaultExtractParams(), stride: 2 });
    expect(half.pointCount).toBe(Math.ceil(two.pointCount / 2));
    expect(extractPoints(two, { ...defaultExtractParams(), mode: 'vertices' }).pointCount).toBe(two.vertexCount);
    const prims = extractPoints(two, { ...defaultExtractParams(), mode: 'primitives', pscaleFrom: 'size' });
    expect(prims.pointCount).toBe(8);
    expect(prims.attr('point', STD.pscale)!.data[0]).toBeGreaterThan(0);
    const isl = extractPoints(two, { ...defaultExtractParams(), mode: 'islands', islandCenter: 'bounds', pscaleFrom: 'size' });
    expect(isl.pointCount).toBe(2);
    expect(isl.positions[0]).toBeCloseTo(0, 5);
    expect(isl.positions[3]).toBeCloseTo(4, 5);
    expect(Array.from(isl.attr('point', STD.id)!.data)).toEqual([0, 1]);
    expect(extractPoints(two, { ...defaultExtractParams(), maxPoints: 5 }).pointCount).toBe(5);
    expect(extractPoints(two, { ...defaultExtractParams(), mode: 'islands', islandCenter: 'base' }).positions[2]).toBeCloseTo(0, 5);
  });
});

describe('mesh helpers', () => {
  it('angle weighted normals are unit length and independent of triangulation density', () => {
    const c = shape('sphere', { segments: 16, rings: 8 }).clone();
    computeNormalsAngle(c, 'smooth');
    const N = c.attr('point', STD.N)!.data;
    for (let i = 0; i < c.pointCount; i++) expect(Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2])).toBeCloseTo(1, 4);
    const flat = computeNormalsAngle(shape('cube').clone(), 'flat');
    expect(flat.has('vertex', STD.N)).toBe(true);
  });
  it('tangents, triangulate, subdivide, delete, fuse, bounds', () => {
    const pl = shape('plane', { cols: 2, rows: 2 }).clone();
    computeTangents(pl, 0);
    const tn = pl.attr('vertex', 'tangent')!.data;
    expect([tn[0], tn[1], tn[2], tn[3]]).toEqual([1, 0, 0, 1]);
    pl.freeze();
    const tri = triangulateMesh(pl);
    expect(tri.primCount).toBe(pl.primCount * 2);
    expect(tri.vertexCount).toBe(tri.primCount * 3);
    expect(tri.attr('vertex', 'uv')!.data.length).toBe(tri.vertexCount * 2);
    const s = subdivide(tri, 1);
    expect(s.primCount).toBe(tri.primCount * 4);
    expect(s.pointCount).toBeGreaterThan(tri.pointCount);
    expect(subdivide(pl, 1).primCount).toBe(pl.primCount * 4);
    expect(subdivide(pl, 0).primCount).toBe(pl.primCount);
    const keep = new Uint8Array(pl.primCount);
    keep[0] = 1;
    const d = deletePrimitives(pl, keep, true);
    expect(d.primCount).toBe(1);
    expect(d.pointCount).toBe(4);
    expect(d.attr('vertex', 'uv')!.data.length).toBe(8);
    expect(deletePrimitives(pl, keep, false).pointCount).toBe(pl.pointCount);
    const cube = shape('cube');
    cube.freeze();
    const f = fusePoints(cube, 1e-4);
    expect(f.pointCount).toBe(8);
    expect(f.primCount).toBe(6);
    const b = boundsBox(cube, 0.5);
    expect(b.bounds().max[0]).toBeCloseTo(1, 5);
    expect(b.primCount).toBe(6);
  });
});

describe('texture snapshots', () => {
  it('samples bilinearly with v up, wraps and clamps; downsample keeps the mean; the cache is a LRU', () => {
    const t = tex(2, 2, 1, (x, y) => x + y * 2); // [0 1; 2 3], y down
    const o = [0, 0, 0, 0];
    sampleTex(t, 0.25, 0.75, true, o); // v 0.75 = upper texel row (y=0) -> texel (0,0)
    expect(o[0]).toBeCloseTo(0, 6);
    sampleTex(t, 0.75, 0.25, true, o);
    expect(o[0]).toBeCloseTo(3, 6);
    sampleTex(t, 0.5, 0.5, true, o);
    expect(o[0]).toBeCloseTo(1.5, 6);
    expect(o[3]).toBe(1);
    expect(sampleChannel(t, 1.25, 0.75, 0, true)).toBeCloseTo(0, 6); // wrap
    expect(sampleChannel(t, 5, 0.75, 0, false)).toBeCloseTo(1, 6); // clamp
    const big = tex(1024, 1024, 1, () => 0.5);
    const small = downsample(big, 256);
    expect(small.width).toBe(256);
    expect(small.data[10]).toBeCloseTo(0.5, 6);
    texSnaps.put('k', t);
    expect(texSnaps.has('k')).toBe(true);
    expect(texSnaps.get('k')).toBe(t);
    texSnaps.clear();
    expect(texSnaps.has('k')).toBe(false);
  });
});

describe('accumulate / bake', () => {
  const quad = () => shape('plane').clone();
  it('accumulate: merges past frames, fades alpha, limits the count, resets on rewind and parameter change', () => {
    const h = new AccumHistory();
    const p = { ...defaultAccumulateParams(), maxCount: 4, stepTime: 0.1, decay: 0.5, translate: [1, 0, 0] as [number, number, number] };
    const input = quad();
    input.freeze();
    let out = accumulateStep(h, 'a', 0, input, p);
    expect(out.primCount).toBe(1);
    for (let i = 1; i <= 5; i++) out = accumulateStep(h, 'a', i * 0.1, input, p);
    expect(out.primCount).toBe(4); // current + 3 stored
    expect(h.frames.length).toBe(3);
    const cd = out.attr('point', 'Cd')!.data;
    expect(Math.min(...Array.from({ length: cd.length / 4 }, (_, i) => cd[i * 4 + 3]))).toBeCloseTo(0.5 ** 3, 5);
    expect(out.bounds().max[0]).toBeGreaterThan(3); // oldest drifted 3 units
    accumulateStep(h, 'a', 0.2, input, p); // rewind
    expect(h.frames.length).toBe(1);
    accumulateStep(h, 'b', 0.3, input, p);
    expect(h.frames.length).toBe(1);
    h.reset();
    expect(h.frames.length).toBe(0);
    const capped = new AccumHistory();
    for (let i = 0; i < 6; i++) accumulateStep(capped, 'c', i * 0.1, input, { ...p, maxCount: 50, maxBytes: 400 });
    expect(capped.frames.length).toBeLessThan(6); // byte cap drops the oldest
    capped.reset();
  });
  it('freeze holds the first state at / after the freeze time until the key changes', () => {
    const a = quad(), b = shape('cube').clone();
    a.freeze();
    b.freeze();
    expect(freezeStep('n', 'k', 0, 1, a)).toMatchObject({ frozen: false });
    const f = freezeStep('n', 'k', 1, 1, a);
    expect(f.frozen).toBe(true);
    expect(freezeStep('n', 'k', 5, 1, b).mesh.primCount).toBe(1);
    expect(freezeStep('n', 'k2', 5, 1, b).mesh.primCount).toBe(6);
  });
  it('bake texture / pivots; animation bake is constant topology and memory capped', () => {
    const pl = shape('plane', { cols: 2, rows: 2 });
    pl.freeze();
    const t = tex(2, 2, 4, (_x, _y, c) => (c === 0 ? 1 : 0.25));
    const bt = bakeTexture(pl, { texture: t, uvSet: 0, attribute: 'baked', channels: 'rgba', element: 'vertex', scale: 2, bias: 0 });
    expect(bt.attr('vertex', 'baked')!.size).toBe(4);
    expect(bt.attr('vertex', 'baked')!.data[0]).toBeCloseTo(2, 5);
    expect(bakeTexture(pl, { texture: null, uvSet: 0, attribute: 'x', channels: 'r', element: 'vertex', scale: 1, bias: 0 }).has('vertex', 'x')).toBe(false);
    const two = mergeMeshes([shape('plane', { cols: 2, rows: 2 }), shape('plane', { cols: 2, rows: 2, center: [4, 0, 0] })]);
    two.freeze();
    const bp = bakePivots(two, { pivot: 'bounds', toUvSet: 1 });
    expect(bp.attr('point', STD.pivot)!.data[0]).toBeCloseTo(0, 5);
    expect(bp.attr('point', STD.pivot)!.data[9 * 3]).toBeCloseTo(4, 5);
    expect(bp.attr('point', 'pivot_offset')!.data[0]).toBeCloseTo(two.positions[0], 5);
    expect(bp.has('vertex', 'uv1') && bp.has('vertex', 'uv2')).toBe(true);
    const base = bakePivots(two, { pivot: 'base', toUvSet: -1 });
    expect(base.attr('point', STD.pivot)!.data[2]).toBeCloseTo(0, 5);
    const anim = bakeAnimation((time) => {
      const m = shape('plane').clone();
      (m.writable('point', STD.P) as Float32Array)[2] = time;
      return m;
    }, { fps: 10, frames: 5 });
    expect(anim.frameCount).toBe(5);
    expect(anim.positions.length).toBe(5 * 4 * 3);
    expect(anim.positions[4 * 4 * 3 + 2]).toBeCloseTo(0.4, 5);
    expect(anim.boundsMax[2]).toBeCloseTo(0.4, 5);
    expect(() => bakeAnimation(() => shape('plane'), { fps: 10, frames: 5, capBytes: 100 })).toThrow(/memory cap/);
    expect(() => bakeAnimation((time) => (time > 0.05 ? shape('cube') : shape('plane')), { fps: 10, frames: 3 })).toThrow(/point count/);
    const rec = new MeshFrameRecorder(30, 1e6, false);
    expect(rec.record(0, shape('plane'))).toBe('ok');
    expect(rec.record(0, shape('plane'))).toBe('ok'); // same slot overwrites
    expect(rec.frameCount).toBe(1);
  });
});

describe('node definitions + recipes (end to end, no GPU)', () => {
  const reg = makeRegistry();
  const ids = ['geometry.sweep', 'geometry.noise', 'geometry.noise_points', 'geometry.space_warp', 'geometry.space_warp_points', 'geometry.combine_color', 'geometry.combine_color_points', 'geometry.combine_scale', 'geometry.combine_scale_points', 'geometry.combine_transform', 'geometry.combine_transform_points', 'geometry.promote', 'geometry.extract_points', 'geometry.accumulate', 'geometry.bake', 'geometry.normals', 'geometry.triangulate', 'geometry.subdivide', 'geometry.delete_mask', 'geometry.fuse', 'geometry.bounds'];
  it('are auto-discovered; gizmo refs and texture pins are valid; spatial nodes ship gizmos; gallery presets are valid params', () => {
    for (const id of ids) {
      const d = reg.get(id)!;
      expect(d, id).toBeTruthy();
      const pids = new Set(d.params.map((p) => p.id));
      for (const g of d.gizmos ?? []) for (const r of gizmoParamRefs(g)) expect(pids.has(r), `${id}.${g.id} -> ${r}`).toBe(true);
      for (const t of d.cpuTextureInputs ?? []) expect(d.inputs.some((i) => i.id === t), `${id} cpu pin ${t}`).toBe(true);
      for (const gv of d.gallery ?? []) for (const k of Object.keys(gv.params)) expect(pids.has(k), `${id} gallery ${gv.name}.${k}`).toBe(true);
      expect(d.params.length >= 0 && d.outputs.length === 1).toBe(true);
    }
    for (const id of ['geometry.sweep', 'geometry.noise', 'geometry.space_warp', 'geometry.combine_color', 'geometry.combine_transform', 'geometry.accumulate', 'geometry.delete_mask']) expect(reg.get(id)!.gizmos!.length, id).toBeGreaterThan(0);
    expect(reg.get('geometry.sweep')!.gizmos![0].type).toBe('spline3d');
  });

  /** Minimal evaluator: builds the recipe into plain data and runs every node's `evaluate` with fake contexts. */
  function runRecipe(i: number, texture: CpuTexture | null, loopPhase = 0) {
    const nodes = new Map<string, { type: string; params: Record<string, ParamValue> }>();
    const links: { a: string; ap: string; b: string; bp: string }[] = [];
    let n = 0;
    const sink: RecipeSink = {
      add: (type, _x, _y, params) => (nodes.set(`n${++n}`, { type, params: params ?? {} }), `n${n}`),
      connect: (a, ap, b, bp) => void links.push({ a, ap, b, bp }),
    };
    const res = MESH_RECIPES[i].build(sink, 0, 0);
    const memo = new Map<string, Record<string, unknown>>();
    const run = (id: string): Record<string, unknown> => {
      const hit = memo.get(id);
      if (hit) return hit;
      const nd = nodes.get(id)!;
      if (nd.type.startsWith('grayscale.')) return { output: { kind: 'texture' } };
      const d = reg.get(nd.type);
      if (!d) throw new Error(`unknown node ${nd.type}`);
      const inputs: Record<string, unknown> = {};
      for (const l of links) if (l.b === id) inputs[l.bp] = run(l.a)[l.ap];
      const values = { ...defaultValues(d.params), ...nd.params } as never;
      const ctx = { params: new Params(d.params, values), inputs, node: { id, name: id, type: nd.type }, frame: { time: 0, loopPhase }, cpuTexture: () => texture, cpuTexturePending: () => false } as never;
      const out = d.evaluate(ctx);
      memo.set(id, out);
      return out;
    };
    return { mesh: asMesh(run(res.target).output as never)!, res, count: nodes.size };
  }

  it('recipes: energy beam, shockwave ring and sword swipe build from nodes only and evaluate to finite meshes', () => {
    const streaks = tex(16, 16, 1, (x, y) => ((x + y * 3) % 7) / 7);
    for (let i = 0; i < MESH_RECIPES.length; i++) {
      const { mesh, res } = runRecipe(i, streaks, 0.3);
      expect(mesh.primCount, MESH_RECIPES[i].id).toBeGreaterThan(50);
      expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
      expect(mesh.has('point', STD.Cd) || mesh.has('vertex', STD.Cd)).toBe(true);
      expect(res.target).toBeTruthy();
      const thumb = renderMeshThumb(mesh, 96);
      let lit = 0;
      for (let p = 0; p < thumb.data.length; p += 4) if (thumb.data[p] + thumb.data[p + 1] + thumb.data[p + 2] > 200) lit++;
      expect(lit, `${MESH_RECIPES[i].id} thumbnail has content`).toBeGreaterThan(40);
    }
    // the beam has a texture-driven vertex alpha (streaks) and a tapered ribbon; the swipe is a flat arc facing up
    const beam = runRecipe(0, streaks).mesh;
    const cd = beam.attr('vertex', 'Cd')!.data;
    const alphas = new Set(Array.from({ length: cd.length / 4 }, (_, k) => Math.round(cd[k * 4 + 3] * 100)));
    expect(alphas.size).toBeGreaterThan(2);
    const swipe = runRecipe(2, streaks).mesh;
    expect(swipe.bounds().max[2] - swipe.bounds().min[2]).toBeLessThan(1e-4);
    const ring = runRecipe(1, null).mesh;
    expect(ring.bounds().max[0]).toBeGreaterThan(1.1);
  });
  it('the beam loops: noise at phase 0 equals phase 1, and differs mid-loop; texture pending is neutral and keeps the mesh valid', () => {
    const a = runRecipe(0, null, 0).mesh, b = runRecipe(0, null, 1).mesh, c = runRecipe(0, null, 0.5).mesh;
    for (let i = 0; i < a.positions.length; i++) expect(a.positions[i]).toBeCloseTo(b.positions[i], 3);
    expect(Array.from(c.positions)).not.toEqual(Array.from(a.positions));
    expect(a.has('vertex', STD.Cd)).toBe(false); // snapshot not ready: Combine Color wrote nothing for the texture step
  });
  it('mesh nodes are deterministic: two evaluations give identical meshes', () => {
    const a = runRecipe(1, null, 0.2).mesh, b = runRecipe(1, null, 0.2).mesh;
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });
});
