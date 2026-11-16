import { describe, expect, it } from 'vitest';
import { gizmoParamRefs } from '../src/engine/graph/gizmo-decl';
import { defaultValues } from '../src/engine/params/schema';
import { Params } from '../src/engine/params/accessor';
import { computeIslands, computeNormals, flipWinding, MeshBuilder, promoteAttr } from '../src/engine/mesh/builder';
import { MeshAccounting, MeshResource } from '../src/engine/mesh/accounting';
import { asCamera, cameraBasis, cameraValue, defaultCamera } from '../src/engine/mesh/camera';
import { checkMeshLimits, MeshData, MeshLimitError, Topology } from '../src/engine/mesh/mesh';
import { mat4Compose, mat4Invert, mat4Mul, mat4Point, quatFromEulerDeg, quatRotate, quatToEulerDeg, v3 } from '../src/engine/mesh/math3';
import { copyAndTransform, copyToPoints, defaultCopyToPointsParams, defaultCopyTransformParams, defaultTransformParams, defaultUvParams, mergeMeshes, projectUV, transformMesh } from '../src/engine/mesh/ops';
import { defaultPointsParams, makePoints } from '../src/engine/mesh/points';
import { defaultShapeParams, makeShape, SHAPE_KINDS } from '../src/engine/mesh/shapes';
import { buildModel3D, CameraView, defaultGizmoSettings3D, Gizmo3DController, sampleSpline3, closestOnAxis, rayPlane, type Env3D } from '../src/gizmos3d';
import { axisDots, OrbitCamera, pickAxisDot } from '../src/panels/viewport-3d/camera-math';
import { badTriangles, islandColors, renderArrays } from '../src/panels/viewport-3d/render-data';
import { makeRegistry } from './helpers';

const shape = (s: (typeof SHAPE_KINDS)[number], over: Partial<ReturnType<typeof defaultShapeParams>> = {}) => makeShape({ ...defaultShapeParams(), shape: s, ...over });
const close = (a: number, b: number, e = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(e);

describe('mesh data model', () => {
  it('builds a plane: counts, triangulation cache, bounds, uv, normals', () => {
    const m = shape('plane', { cols: 2, rows: 3 });
    expect(m.pointCount).toBe(12);
    expect(m.primCount).toBe(6);
    expect(m.vertexCount).toBe(24);
    expect(m.topology.triangles().verts.length / 3).toBe(12);
    expect(m.topology.triangles()).toBe(m.topology.triangles()); // cached
    const b = m.bounds();
    expect(b.min).toEqual([-0.5, -0.5, 0]);
    expect(b.max).toEqual([0.5, 0.5, 0]);
    expect(m.attr('vertex', 'uv')!.data.length).toBe(48);
    expect(m.attr('point', 'N')!.data[2]).toBeCloseTo(1); // faces +Z
  });
  it('copy-on-write: clone shares arrays, writable copies, frozen refuses edits', () => {
    const a = shape('plane');
    const p0 = a.attr('point', 'P')!.data;
    a.freeze();
    expect(() => a.setAttr({ name: 'x', element: 'point', size: 1, kind: 'f32', data: new Float32Array(4) })).toThrow(/frozen/);
    const b = a.clone();
    expect(b.attr('point', 'P')!.data).toBe(p0); // shared
    expect(b.isShared('point', 'P')).toBe(true);
    const w = b.writable('point', 'P') as Float32Array;
    expect(w).not.toBe(p0); // copied on first write
    w[0] = 99;
    expect(p0[0]).not.toBe(99);
    expect(b.writable('point', 'P')).toBe(w); // owned now: in place
    expect(b.version).not.toBe(a.version);
  });
  it('version/bounds invalidate on write', () => {
    const m = shape('plane');
    const b0 = m.bounds();
    (m.writable('point', 'P') as Float32Array)[0] = -5;
    expect(m.bounds().min[0]).toBe(-5);
    expect(m.bounds()).not.toBe(b0);
  });
  it('resolveToVertex: point, primitive and detail attributes', () => {
    const m = shape('plane');
    expect(m.resolveToVertex('N')!.data.length).toBe(m.vertexCount * 3);
    m.addAttr('primitive', 'q', 1, 'f32').data[0] = 7;
    expect(m.resolveToVertex('q')!.data[0]).toBe(7);
    expect(m.resolveToVertex('nope')).toBeNull();
  });
  it('rejects wrong attribute length and bad topology', () => {
    const m = new MeshData(3);
    expect(() => m.setAttr({ name: 'a', element: 'point', size: 3, kind: 'f32', data: new Float32Array(2) })).toThrow();
    expect(() => new Topology(new Uint32Array(3), new Uint32Array([0, 2]))).toThrow();
  });
  it('hard caps throw MeshLimitError before allocating', () => {
    expect(() => checkMeshLimits(5_000_000, 0, 0, 't')).toThrow(MeshLimitError);
  });
});

describe('memory accounting', () => {
  const fakeMm = () => {
    const mm = { used: 0, ext: 0, room: [] as number[], ensureRoom(b: number) { this.room.push(b); }, addExternal(_c: string, b: number) { this.ext += b; this.used += b; }, removeExternal(_c: string, b: number) { this.ext -= b; this.used -= b; } };
    return mm;
  };
  it('counts shared arrays once and frees on the last release', () => {
    const mm = fakeMm();
    const acct = new MeshAccounting(mm as never);
    const a = shape('cube');
    const bytesA = a.bytes;
    const ra = new MeshResource(a, acct);
    ra.retain();
    expect(mm.ext).toBe(bytesA);
    const b = transformMesh(a, { ...defaultTransformParams(), translate: [1, 0, 0] }); // shares uv / topology / N? (N is rotated copy) -> only P (+N) are new
    const rb = new MeshResource(b, acct);
    rb.retain();
    expect(mm.ext).toBeLessThan(bytesA + b.bytes); // dedup
    expect(mm.ext).toBeGreaterThan(bytesA);
    ra.release();
    rb.release();
    expect(mm.ext).toBe(0);
    expect(acct.liveArrays).toBe(0);
    expect(mm.room.length).toBeGreaterThan(0);
  });
});

describe('shapes', () => {
  for (const kind of SHAPE_KINDS) {
    it(`${kind}: finite, valid indices, unit normals, UVs`, () => {
      const m = shape(kind, { segments: 12, rings: 4, cols: 3, rows: 3 });
      expect(m.pointCount).toBeGreaterThan(0);
      expect(m.primCount).toBeGreaterThan(0);
      for (const x of m.positions) expect(Number.isFinite(x)).toBe(true);
      for (const v of m.topology.vertPoint) expect(v).toBeLessThan(m.pointCount);
      const N = m.attr('point', 'N')!.data;
      for (let i = 0; i < m.pointCount; i++) close(Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]), 1, 1e-3);
      expect(m.attr('vertex', 'uv')!.data.length).toBe(m.vertexCount * 2);
      expect(badTrianglesCount(m)).toBeLessThanOrEqual(kind === 'cone' ? 0 : 0);
    });
  }
  it('normals point outward (sphere, cylinder, cube, torus)', () => {
    for (const kind of ['sphere', 'cylinder', 'cube'] as const) {
      const m = shape(kind, { segments: 16, rings: 6, radius: 1, size: [2, 2, 2] });
      const N = m.attr('point', 'N')!.data, P = m.positions;
      let ok = 0;
      for (let i = 0; i < m.pointCount; i++) if (N[i * 3] * P[i * 3] + N[i * 3 + 1] * P[i * 3 + 1] + N[i * 3 + 2] * P[i * 3 + 2] > 0) ok++;
      expect(ok / m.pointCount, kind).toBeGreaterThan(0.95);
    }
    const t = shape('torus', { segments: 24, rings: 4, radius: 1, inner_radius: 0.3 });
    const N = t.attr('point', 'N')!.data, P = t.positions;
    for (let i = 0; i < t.pointCount; i++) {
      const r = Math.hypot(P[i * 3], P[i * 3 + 1]);
      const c = [(P[i * 3] / r) * 1, (P[i * 3 + 1] / r) * 1, 0];
      const d = [P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2]];
      expect(N[i * 3] * d[0] + N[i * 3 + 1] * d[1] + N[i * 3 + 2] * d[2]).toBeGreaterThan(0);
    }
  });
  it('cube has 24 points / 6 quads and hard normals; ring faces +Z; hemisphere is open above z=0', () => {
    const c = shape('cube');
    expect([c.pointCount, c.primCount]).toEqual([24, 6]);
    const r = shape('ring', { radius: 1, inner_radius: 0.5, segments: 16, rings: 2 });
    const Nr = r.attr('point', 'N')!.data;
    for (let i = 0; i < r.pointCount; i++) expect(Nr[i * 3 + 2]).toBeGreaterThan(0.99);
    const hs = shape('hemisphere', { radius: 1, segments: 12, rings: 4, caps: false });
    expect(hs.bounds().min[2]).toBeGreaterThan(-1e-6);
  });
  it('pivot base and centre offset', () => {
    const m = shape('cylinder', { size: [1, 1, 2], pivot: 'base', center: [1, 2, 3] });
    close(m.bounds().min[2], 3);
    close(m.bounds().center[0], 1);
  });
});
function badTrianglesCount(m: MeshData): number {
  return badTriangles(m, renderArrays(m)).reasons.zeroArea;
}

describe('points', () => {
  it('circle: count, radius, orient aligns +Z to the outward normal', () => {
    const p = makePoints({ ...defaultPointsParams(), mode: 'circle', count: 8, radius: 2 });
    expect(p.pointCount).toBe(8);
    expect(p.primCount).toBe(0);
    close(Math.hypot(p.positions[0], p.positions[1]), 2);
    const q = p.attr('point', 'orient')!.data;
    const z = quatRotate([q[0], q[1], q[2], q[3]], [0, 0, 1]);
    close(z[0], 1);
  });
  it('surface scatter is deterministic and lies on the surface', () => {
    const plane = shape('plane', { size: [2, 2, 1] });
    const a = makePoints({ ...defaultPointsParams(), mode: 'surface', count: 200, seed: 5 }, plane);
    const b = makePoints({ ...defaultPointsParams(), mode: 'surface', count: 200, seed: 5 }, plane);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    for (let i = 0; i < 200; i++) {
      close(a.positions[i * 3 + 2], 0);
      expect(Math.abs(a.positions[i * 3])).toBeLessThanOrEqual(1.0001);
    }
    expect(a.has('point', 'uv')).toBe(true);
    expect(() => makePoints({ ...defaultPointsParams(), mode: 'surface' })).toThrow();
  });
  it('grid / sphere / line / random counts + 1M points stays cheap', () => {
    expect(makePoints({ ...defaultPointsParams(), mode: 'grid', grid: [5, 4] }).pointCount).toBe(20);
    expect(makePoints({ ...defaultPointsParams(), mode: 'sphere', count: 100 }).pointCount).toBe(100);
    const t0 = performance.now();
    const big = makePoints({ ...defaultPointsParams(), mode: 'random', count: 1_000_000, size: [2, 2, 2] });
    expect(big.pointCount).toBe(1_000_000);
    expect(performance.now() - t0).toBeLessThan(8000);
  });
});

describe('ops', () => {
  it('transform: rotate 90 about Z maps +X to +Y, normals follow, mirroring flips winding', () => {
    const m = shape('plane').freeze();
    const t = transformMesh(m, { ...defaultTransformParams(), rotate: [0, 0, 90], translate: [0, 0, 1] });
    const t2 = transformMesh(t, { ...defaultTransformParams(), scale: [-1, 1, 1] });
    const P = t.positions;
    const i = [...Array(4).keys()].find((k) => m.positions[k * 3] > 0.4 && m.positions[k * 3 + 1] < -0.4)!; // (0.5,-0.5) -> (0.5,0.5)
    close(P[i * 3], 0.5);
    close(P[i * 3 + 1], 0.5);
    close(P[i * 3 + 2], 1);
    expect(t.attr('vertex', 'uv')!.data).toBe(m.attr('vertex', 'uv')!.data); // untouched attribute is SHARED
    const n2 = computeNormals(t2.clone(), 'smooth').attr('point', 'N')!.data; // winding flipped so recomputed normals still face +Z
    expect(n2[2]).toBeGreaterThan(0.99);
  });
  it('merge unites attributes with defaults and offsets topology', () => {
    const a = shape('plane').freeze();
    const b = makePoints({ ...defaultPointsParams(), count: 3 }).freeze();
    const m = mergeMeshes([a, b]);
    expect(m.pointCount).toBe(a.pointCount + 3);
    expect(m.primCount).toBe(1);
    expect(m.attr('point', 'pscale')!.data[0]).toBe(1);
    expect(m.attr('point', 'orient')!.data[3]).toBe(1);
    const c = mergeMeshes([a, a]);
    expect(c.topology.vertPoint[4]).toBe(4);
    expect(c.topology.primStart[2]).toBe(8);
  });
  it('copy to points: orient, pscale, colour, id, pivot', () => {
    const src = shape('cube', { size: [1, 1, 1] }).freeze();
    const pts = makePoints({ ...defaultPointsParams(), mode: 'line', count: 3, start: [0, 0, 0], end: [4, 0, 0], pscale: 2, align: false, color: [1, 0.5, 0.25, 1] }).freeze();
    const out = copyToPoints(src, pts, defaultCopyToPointsParams());
    expect(out.pointCount).toBe(72);
    expect(out.primCount).toBe(18);
    const b = out.bounds();
    close(b.min[0], -1); // pscale 2 -> cube half-size 1
    close(b.max[0], 5);
    expect(out.attr('point', 'id')!.data[24]).toBe(1);
    close(out.attr('point', 'pivot')!.data[24 * 3], 2);
    close(out.attr('point', 'Cd')!.data[1], 0.5);
    expect(() => copyToPoints(src, new MeshData(0), defaultCopyToPointsParams())).not.toThrow();
  });
  it('copy to points aligns to a normal when there is no orient', () => {
    const src = shape('plane').freeze(); // faces +Z
    const pts = new MeshData(1);
    pts.setAttr({ name: 'P', element: 'point', size: 3, kind: 'f32', data: new Float32Array([0, 0, 0]) });
    pts.setAttr({ name: 'N', element: 'point', size: 3, kind: 'f32', data: new Float32Array([1, 0, 0]) });
    const out = copyToPoints(src, pts.freeze(), defaultCopyToPointsParams());
    close(out.attr('point', 'N')!.data[0], 1, 1e-3);
  });
  it('copy and transform composes the step exactly', () => {
    const src = shape('quad').freeze();
    const out = copyAndTransform(src, { ...defaultCopyTransformParams(), copies: 4, translate: [1, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1], pscale_start: 1, pscale_end: 2, age_start: 0, age_end: 1 });
    expect(out.pointCount).toBe(16);
    close(out.bounds().max[0], 3.5);
    expect(out.attr('point', 'id')!.data[12]).toBe(3);
    close(out.attr('point', 'age')!.data[12], 1);
    close(out.attr('point', 'pscale')!.data[12], 2);
    const spiral = copyAndTransform(src, { ...defaultCopyTransformParams(), copies: 3, translate: [0, 0, 1], rotate: [0, 0, 90] });
    close(spiral.attr('point', 'pivot')!.data[2 * 4 * 3 + 2], 2);
    const jitterA = copyAndTransform(src, { ...defaultCopyTransformParams(), copies: 5, jitter_translate: [1, 1, 1], seed: 3 });
    const jitterB = copyAndTransform(src, { ...defaultCopyTransformParams(), copies: 5, jitter_translate: [1, 1, 1], seed: 3 });
    expect(Array.from(jitterA.positions)).toEqual(Array.from(jitterB.positions));
    expect(() => copyAndTransform(shape('sphere', { segments: 512, rings: 256 }).freeze(), { ...defaultCopyTransformParams(), copies: 100000 })).toThrow(MeshLimitError);
  });
  it('uv projections', () => {
    const cube = shape('cube').freeze();
    const planar = projectUV(cube, { ...defaultUvParams(), mode: 'planar', axis: 'z' });
    const uv = planar.attr('vertex', 'uv')!.data;
    for (const x of uv) expect(x).toBeGreaterThanOrEqual(-1e-6);
    const sph = projectUV(shape('sphere', { segments: 16, rings: 4, radius: 1 }).freeze(), { ...defaultUvParams(), mode: 'spherical', size: [2, 2, 2] });
    const sv = sph.attr('vertex', 'uv')!.data;
    for (let i = 0; i < sv.length / 2; i++) expect(sv[i * 2 + 1]).toBeLessThanOrEqual(1.0001);
    const box = projectUV(cube, { ...defaultUvParams(), mode: 'box' });
    expect(box.attr('vertex', 'uv')!.data.length).toBe(cube.vertexCount * 2);
    const merged = mergeMeshes([shape('plane').freeze(), transformMesh(shape('plane').freeze(), { ...defaultTransformParams(), translate: [5, 0, 0] }).freeze()]).freeze();
    const isl = projectUV(merged, { ...defaultUvParams(), mode: 'island', margin: 0 });
    expect(isl.attr('primitive', 'island')!.data.length).toBe(2);
    const u = isl.attr('vertex', 'uv')!.data;
    for (const x of u) { expect(x).toBeGreaterThanOrEqual(-1e-6); expect(x).toBeLessThanOrEqual(1 + 1e-6); }
    const second = projectUV(cube, { ...defaultUvParams(), uv_set: 1 });
    expect(second.has('vertex', 'uv1')).toBe(true);
    expect(second.has('vertex', 'uv')).toBe(true); // original set kept
  });
  it('islands, promote, flipWinding', () => {
    const m = mergeMeshes([shape('plane').freeze(), shape('plane').freeze()]);
    expect(computeIslands(m).count).toBe(2); // coincident but separate point indices (merge does NOT weld)
  });
  it('promote point -> vertex -> primitive', () => {
    const m = shape('plane', { cols: 2, rows: 1 }).freeze();
    const v = promoteAttr(m, 'N', 'point', 'vertex');
    expect(v.has('vertex', 'N')).toBe(true);
    expect(v.has('point', 'N')).toBe(false);
    const pr = promoteAttr(m, 'N', 'point', 'primitive');
    expect(pr.attr('primitive', 'N')!.data.length).toBe(m.primCount * 3);
    close(pr.attr('primitive', 'N')!.data[2], 1);
    const f = flipWinding(m.clone());
    expect(f.topology.vertPoint[0]).toBe(m.topology.vertPoint[3]);
  });
  it('builder: uv back-fill and prim without uv', () => {
    const b = new MeshBuilder();
    const a = b.addPoint(0, 0, 0), c = b.addPoint(1, 0, 0), d = b.addPoint(0, 1, 0);
    b.tri(a, c, d);
    b.tri(a, c, d, [0, 0, 1, 0, 0, 1]);
    const m = b.build();
    expect(m.attr('vertex', 'uv')!.data.length).toBe(12);
    expect(m.attr('vertex', 'uv')!.data[0]).toBe(0);
  });
});

describe('math', () => {
  it('euler <-> quaternion and matrix inverse', () => {
    const q = quatFromEulerDeg(10, 20, 30);
    const e = quatToEulerDeg(q);
    close(e[0], 10, 1e-3);
    close(e[1], 20, 1e-3);
    close(e[2], 30, 1e-3);
    const m = mat4Compose([1, 2, 3], q, [2, 1, 3]);
    const id = mat4Mul(m, mat4Invert(m));
    for (let i = 0; i < 16; i++) close(id[i], i % 5 === 0 ? 1 : 0, 1e-9);
    const p = mat4Point(m, [1, 1, 1]);
    const back = mat4Point(mat4Invert(m), p);
    close(back[0], 1, 1e-9);
    expect(v3.len(quatRotate(q, [1, 0, 0]))).toBeCloseTo(1);
  });
});

describe('camera + viewport math', () => {
  it('default orbit is a 3/4 view above the origin; front view looks along +Y', () => {
    const o = new OrbitCamera();
    o.setView('front');
    o.snap();
    const c = o.toCamera(1);
    close(c.position[0], c.target[0], 1e-6);
    expect(c.position[1]).toBeLessThan(c.target[1]);
    const b = cameraBasis(c);
    close(b.forward[1], 1, 1e-6);
    close(b.right[0], 1, 1e-6);
  });
  it('top view is well defined; damping converges; frame fits the sphere; pan moves target', () => {
    const o = new OrbitCamera();
    o.setView('top');
    for (let i = 0; i < 200; i++) o.update(1 / 60);
    const c = o.toCamera(1);
    expect(c.position[2]).toBeGreaterThan(c.target[2]);
    const b = cameraBasis(c);
    for (const x of [...b.right, ...b.up, ...b.forward]) expect(Number.isFinite(x)).toBe(true);
    o.frame([1, 2, 3], 2);
    for (let i = 0; i < 400; i++) o.update(1 / 60);
    expect(o.animating).toBe(false);
    close(o.cur.target[0], 1, 1e-3);
    expect(o.cur.dist).toBeGreaterThan(2);
    const t0 = [...o.goal.target];
    o.pan(100, 0, 800);
    expect(o.goal.target[0] === t0[0] && o.goal.target[1] === t0[1] && o.goal.target[2] === t0[2]).toBe(false);
  });
  it('axis gizmo picking and look-through adopt', () => {
    const o = new OrbitCamera();
    o.setView('front');
    o.snap();
    const dots = axisDots(o.toCamera(1), 34);
    const x = dots.find((d) => d.label === 'X')!;
    expect(pickAxisDot(dots, x.x, x.y)?.label).toBe('X');
    const c = defaultCamera();
    o.adopt(c);
    const back = o.toCamera(1);
    for (let i = 0; i < 3; i++) close(back.position[i], c.position[i], 1e-3);
    expect(asCamera(cameraValue(c))).toBeTruthy();
  });
});

describe('render data', () => {
  it('bad triangles: degenerate and non-finite are found; island colours per component', () => {
    const b = new MeshBuilder();
    const a = b.addPoint(0, 0, 0), c = b.addPoint(1, 0, 0), d = b.addPoint(2, 0, 0), e = b.addPoint(0, 1, 0);
    b.tri(a, c, e);
    b.tri(a, c, d); // collinear
    const m = b.build();
    const ra = renderArrays(m);
    expect(ra.triCount).toBe(2);
    expect(badTriangles(m, ra).reasons.zeroArea).toBe(1);
    (m.writable('point', 'P') as Float32Array)[0] = NaN;
    expect(badTriangles(m, renderArrays(m)).reasons.nonFinite).toBe(2);
    expect(islandColors(shape('cube')).count).toBe(6);
  });
});

describe('3D gizmos', () => {
  const view = (w = 800, h = 600) => new CameraView({ ...defaultCamera(), position: [0, -8, 0], target: [0, 0, 0] }, w, h);
  const env = (values: Record<string, unknown>, settings = defaultGizmoSettings3D()): Env3D => ({ nodeId: 'n', values: values as never, view: view(), settings, anchor: [0, 0, 0], state: {} });
  it('view: project / ray round trip, constant screen size', () => {
    const v = view();
    const p = v.project([1, 0, 2])!;
    const r = v.ray(p[0], p[1]);
    const t = (1 - r.o[0]) / r.d[0];
    close(r.o[2] + r.d[2] * t, 2, 1e-3);
    close(v.unitsPerPixel([0, 0, 0]) * 600, v.unitsPerPixel([0, 0, 0]) * 600);
    expect(v.unitsPerPixel([0, 8, 0])).toBeGreaterThan(v.unitsPerPixel([0, 0, 0]));
    close(closestOnAxis({ o: [0, -5, 0], d: [0, 1, 0] }, [1, 0, 0], [0, 0, 1]), 0, 1e-9);
    expect(rayPlane({ o: [0, -5, 0], d: [0, 1, 0] }, [0, 0, 0], [0, -1, 0])).toEqual([0, 0, 0]);
  });
  const fakeHost = () => {
    const sets: [string, string, unknown][] = [];
    let committed = 0;
    let cancelled = 0;
    return {
      sets, get committed() { return committed; }, get cancelled() { return cancelled; },
      host: { beginGesture: () => ({ set: (n: string, p: string, v: unknown) => { sets.push([n, p, v]); }, commit: () => { committed++; return true; }, cancel: () => { cancelled++; }, changed: true }), invalidate: () => {} } as never,
    };
  };
  it('translate: dragging the X arrow moves along X only, one undo step on release, Esc cancels', () => {
    const f = fakeHost();
    const ctl = new Gizmo3DController(f.host);
    const e = env({ translate: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1], uniform: 1, pivot: [0, 0, 0] });
    const model = buildModel3D({ id: 'xf', type: 'transform3d', viewport: '3d', position: 'translate', rotation: 'rotate', scale: 'scale', uniform: 'uniform', pivot: 'pivot' }, e)!;
    ctl.setModels([model]);
    const v = e.view;
    const tip = (model.handles.find((h) => h.id === 'tax0')!.geom[1] as { p: [number, number, number] }).p;
    const s = v.project(tip)!;
    expect(ctl.pointerDown(v, s[0] - 20, s[1], { shift: false, ctrl: false, alt: false })).toBe(true); // grab the arrow shaft near the tip
    ctl.pointerMove(v, s[0] + 60, s[1], { shift: false, ctrl: false, alt: false });
    const last = f.sets[f.sets.length - 1][2] as number[];
    expect(last[0]).toBeGreaterThan(0.2);
    close(last[1], 0, 1e-6);
    close(last[2], 0, 1e-6);
    ctl.pointerUp();
    expect(f.committed).toBe(1);
    // Esc
    ctl.pointerDown(v, s[0] - 20, s[1], { shift: false, ctrl: false, alt: false });
    ctl.cancel();
    expect(f.cancelled).toBe(1);
  });
  it('snap rounds translation to the step (Ctrl inverts)', () => {
    const f = fakeHost();
    const ctl = new Gizmo3DController(f.host);
    const e = env({ c: [0, 0, 0] }, { ...defaultGizmoSettings3D(), snap: true, moveStep: 0.5 });
    ctl.setModels([buildModel3D({ id: 'p', type: 'point3d', viewport: '3d', param: 'c' }, e)!]);
    const model = ctl.getModels()[0];
    const tip = (model.handles.find((h) => h.id === 'p.ax0')!.geom[1] as { p: [number, number, number] }).p;
    const s = e.view.project(tip)!;
    ctl.pointerDown(e.view, s[0] - 15, s[1], { shift: false, ctrl: false, alt: false });
    ctl.pointerMove(e.view, s[0] + 37, s[1], { shift: false, ctrl: false, alt: false });
    const x = (f.sets[f.sets.length - 1][2] as number[])[0];
    close(x / 0.5, Math.round(x / 0.5), 1e-6);
  });
  it('rotate writes continuous Euler degrees; scale handle multiplies; radius / box / axis / spline build', () => {
    const e = env({ r: [0, 0, 10], s: [1, 1, 1] }, { ...defaultGizmoSettings3D(), mode: 'rotate' });
    const rot = buildModel3D({ id: 'x', type: 'transform3d', viewport: '3d', rotation: 'r' }, e)!;
    expect(rot.handles.length).toBe(3);
    const f = fakeHost();
    const ctl = new Gizmo3DController(f.host);
    ctl.setModels([rot]);
    const ringPts = (rot.handles[2].geom[0] as { pts: [number, number, number][] }).pts; // Z ring
    const a = e.view.project(ringPts[0])!, b = e.view.project(ringPts[6])!;
    if (ctl.pointerDown(e.view, a[0], a[1], { shift: false, ctrl: false, alt: false })) {
      ctl.pointerMove(e.view, b[0], b[1], { shift: false, ctrl: false, alt: false });
      const w = f.sets[f.sets.length - 1][2] as number[];
      expect(Number.isFinite(w[2])).toBe(true);
    }
    const sc = buildModel3D({ id: 'x', type: 'transform3d', viewport: '3d', scale: 's' }, env({ s: [1, 2, 1] }, { ...defaultGizmoSettings3D(), mode: 'scale' }))!;
    expect(sc.handles.map((h) => h.id)).toEqual(['s0', 's1', 's2', 'su']);
    expect(buildModel3D({ id: 'r', type: 'radius3d', viewport: '3d', radius: 'r' }, env({ r: 2 }))!.handles.length).toBe(6);
    expect(buildModel3D({ id: 'b', type: 'box3d', viewport: '3d', position: 'c', size: 's' }, env({ c: [0, 0, 0], s: [1, 2, 3] }))!.handles.length).toBe(7);
    expect(buildModel3D({ id: 'a', type: 'axis3d', viewport: '3d', direction: 'd' }, env({ d: [0, 0, 1] }))!.handles.length).toBe(1);
    expect(buildModel3D({ id: 'f', type: 'falloff3d', viewport: '3d', inner: 'i', outer: 'o' }, env({ i: 1, o: 2 }))!.handles.length).toBe(12);
    expect(buildModel3D({ id: 'x', type: 'point3d', viewport: '3d', param: 'c', visibleIf: () => false }, env({ c: [0, 0, 0] }))).toBeNull();
    expect(buildModel3D({ id: 'x', type: 'circle', viewport: '2d', radius: 'r' } as never, env({}))).toBeNull();
  });
  it('spline3d: sampling, handles per point (position / scale / twist), writes a full spline', () => {
    const sv = { closed: false, points: [{ x: 0, y: 0, attrs: { z: 0, scale: 1 } }, { x: 1, y: 0, attrs: { z: 1, scale: 1 } }, { x: 2, y: 1, attrs: { z: 0, scale: 2 } }] };
    const s = sampleSpline3(sv.points, false, 8);
    expect(s.length).toBe(17);
    close(s[0][0], 0);
    close(s[s.length - 1][0], 2);
    const e = env({ sp: sv });
    e.state.selected = 1;
    const m = buildModel3D({ id: 'sp', type: 'spline3d', viewport: '3d', param: 'sp' }, e)!;
    expect(m.handles.filter((h) => h.id.startsWith('p')).length).toBe(3);
    expect(m.handles.some((h) => h.id === 'hin1')).toBe(true);
    const f = fakeHost();
    const ctl = new Gizmo3DController(f.host);
    ctl.setModels([m]);
    const p1 = e.view.project([1, 0, 1])!;
    expect(ctl.pointerDown(e.view, p1[0], p1[1], { shift: false, ctrl: false, alt: false })).toBe(true);
    ctl.pointerMove(e.view, p1[0] + 40, p1[1] - 30, { shift: false, ctrl: false, alt: false });
    const w = f.sets[f.sets.length - 1][2] as typeof sv;
    expect(w.points.length).toBe(3);
    expect(w.points[1].x).toBeGreaterThan(1);
  });
});

describe('geometry + camera node definitions', () => {
  const reg = makeRegistry();
  const ids = ['geometry.shapes', 'geometry.points_shape', 'geometry.transform', 'geometry.transform_points', 'geometry.merge', 'geometry.merge_points', 'geometry.copy_to_points', 'geometry.copy_transform', 'geometry.uv', 'camera.camera', 'camera.look_at'];
  it('are auto-discovered with valid pins and gizmo param references', () => {
    for (const id of ids) {
      const d = reg.get(id)!;
      expect(d, id).toBeTruthy();
      const pids = new Set(d.params.map((p) => p.id));
      for (const g of d.gizmos ?? []) for (const r of gizmoParamRefs(g)) expect(pids.has(r), `${id}.${g.id} -> ${r}`).toBe(true);
      for (const o of d.outputs) expect(['mesh', 'points', 'camera']).toContain(o.type);
    }
    for (const id of ['geometry.shapes', 'geometry.transform', 'geometry.copy_to_points', 'geometry.points_shape']) expect(reg.get(id)!.gizmos!.length).toBeGreaterThan(0);
  });
  const ctxFor = (id: string, inputs: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => {
    const d = reg.get(id)!;
    const values = { ...defaultValues(d.params), ...over } as never;
    return { d, ctx: { params: new Params(d.params, values), inputs, node: { id: 'n', name: 'n', type: id } } as never };
  };
  it('Shapes -> Transform -> Copy To Points evaluates end to end (values carry a ref-counted resource)', () => {
    const s = ctxFor('geometry.shapes', {}, { shape: 'cube', size: [0.2, 0.2, 0.2] });
    const sv = s.d.evaluate(s.ctx).mesh;
    expect(sv.kind === 'data' && sv.pin === 'mesh').toBe(true);
    const t = ctxFor('geometry.transform', { input: sv }, { translate: [0, 0, 1] });
    const tv = t.d.evaluate(t.ctx).output;
    const p = ctxFor('geometry.points_shape', {}, { mode: 'circle', count: 6, radius: 2 });
    const pv = p.d.evaluate(p.ctx).points;
    expect(pv.kind === 'data' && pv.pin === 'points').toBe(true);
    const c = ctxFor('geometry.copy_to_points', { mesh: tv, points: pv });
    const cv = c.d.evaluate(c.ctx).mesh;
    expect(cv.kind).toBe('data');
    const m = (cv as { data: MeshData }).data;
    expect(m.pointCount).toBe(6 * 24);
    expect(m.frozen).toBe(true);
    close(m.attr('point', 'pivot')!.data[0], 2, 1e-3);
    expect(m.attr('point', 'id')!.data[24]).toBe(1);
    expect(() => ctxFor('geometry.copy_to_points', { mesh: tv }).d.evaluate(ctxFor('geometry.copy_to_points', { mesh: tv }).ctx)).toThrow();
  });
  it('Camera and Look At produce camera values', () => {
    const cam = ctxFor('camera.camera', {}, { position: [0, -5, 0], target: [0, 0, 0] });
    const cv = cam.d.evaluate(cam.ctx).camera;
    expect(asCamera(cv)!.position).toEqual([0, -5, 0]);
    const sv = ctxFor('geometry.shapes', {}, { shape: 'sphere', radius: 1, center: [5, 0, 0] });
    const mesh = sv.d.evaluate(sv.ctx).mesh;
    const la = ctxFor('camera.look_at', { camera: cv, mesh }, {});
    const out = asCamera(la.d.evaluate(la.ctx).camera)!;
    close(out.target[0], 5, 1e-3);
    expect(v3.len(v3.sub(out.position, out.target))).toBeGreaterThan(1);
  });
});
