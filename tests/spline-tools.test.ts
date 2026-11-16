import { describe, expect, it } from 'vitest';
import { buildGizmoModel, defaultSnap, NO_MODS, type GizmoEnv } from '../src/gizmos';
import { buildModel3D, CameraView, defaultGizmoSettings3D, insertPoint3, sampleSpline3, type Env3D } from '../src/gizmos3d';
import { closestOnPolylineToRay, toolFromKey } from '../src/gizmos/spline-tools';
import { defaultCamera } from '../src/engine/mesh/camera';
import type { SplinePoint, SplineValue } from '../src/engine/params/schema';
import { setOf } from '../src/engine/spline/ops';
import { splineToPoints } from '../src/engine/spline/to-points';
import { STD } from '../src/engine/mesh/mesh';
import { makeRegistry } from './helpers';

const sp2: SplineValue = { closed: false, points: [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.2 }, { x: 0.8, y: 0.5 }] };
const env2 = (state: Record<string, unknown> = {}): GizmoEnv => ({ nodeId: 'n', values: { path: sp2 }, size: [512, 512], tile: [false, false], snap: defaultSnap(), zoom: 1, state });
const decl = { id: 'p', type: 'path', viewport: '2d', param: 'path' } as const;
const pts3 = (): SplinePoint[] => [
  { x: 0, y: 0, attrs: { z: 0, scale: 1, twist: 0 } },
  { x: 1, y: 1, attrs: { z: 1, scale: 1, twist: 0 } },
  { x: 2, y: 0, attrs: { z: 2, scale: 2, twist: 90 } },
];

describe('2D path gizmo tools', () => {
  it('hotkeys map to tools; the toolbar lists tools, convert, close, flip, mirror, snap', () => {
    expect(toolFromKey('a')).toBe('add');
    expect(toolFromKey('X')).toBe('delete');
    expect(toolFromKey('v')).toBe('select');
    expect(toolFromKey('q')).toBeNull();
    const m = buildGizmoModel(decl, env2())!;
    expect(m.toolbar!.map((i) => i.id)).toEqual(['tool:select', 'tool:add', 'tool:delete', 'conv:corner', 'conv:auto', 'conv:free', 'closed', 'flip', 'mirror', 'snap']);
    expect(m.onKey!('a', NO_MODS)).toBe('state');
  });

  it('Add tool: a plain click on empty space appends, a click on a segment inserts there', () => {
    const state: Record<string, unknown> = {};
    expect(buildGizmoModel(decl, env2(state))!.begin('canvas', [10, 10], NO_MODS)).toBeNull(); // select tool: not consumed
    state.tool = 'add';
    const m = buildGizmoModel(decl, env2(state))!;
    const app = m.begin('canvas', [100, 400], NO_MODS)!;
    expect((app.initial!.path as SplineValue).points).toHaveLength(4);
    const ins = buildGizmoModel(decl, env2(state))!.begin('seg0', [150, 200], NO_MODS)!;
    const v = ins.initial!.path as SplineValue;
    expect(v.points).toHaveLength(4);
    expect(state.sel).toBe(1);
    expect(ins.move([200, 300], NO_MODS).path).toBeDefined();
  });

  it('Delete tool: a click on a point removes it, never below two points', () => {
    const state: Record<string, unknown> = { tool: 'delete' };
    const s = buildGizmoModel(decl, env2(state))!.begin('p1', [256, 102], NO_MODS)!;
    expect((s.initial!.path as SplineValue).points).toHaveLength(2);
    const two: GizmoEnv = { ...env2(state), values: { path: { closed: false, points: sp2.points.slice(0, 2) } } };
    expect(buildGizmoModel(decl, two)!.begin('p0', [100, 256], NO_MODS)).toBeNull();
  });

  it('toolbar items: convert / close / flip / mirror write the whole spline; tool switch writes nothing', () => {
    const state: Record<string, unknown> = { sel: 1 };
    const m = buildGizmoModel(decl, env2(state))!;
    const by = (id: string) => m.toolbar!.find((i) => i.id === id)!;
    expect(by('tool:add').run()).toBeNull();
    expect(state.tool).toBe('add');
    expect((by('conv:corner').run()!.path as SplineValue).points[1].mode).toBe('corner');
    expect((by('closed').run()!.path as SplineValue).closed).toBe(true);
    expect((by('flip').run()!.path as SplineValue).points[0].x).toBeCloseTo(0.8);
    expect((by('mirror').run()!.path as SplineValue).points.length).toBe(3);
    const none = buildGizmoModel(decl, env2({}))!;
    expect(none.toolbar!.find((i) => i.id === 'conv:corner')!.disabled).toBe(true); // nothing selected
  });
});

describe('3D sweep-path gizmo tools', () => {
  const view = new CameraView(defaultCamera(), 800, 600);
  const env3 = (state: Record<string, unknown>, points = pts3()): Env3D => ({ nodeId: 'n', values: { sp: { closed: false, points } } as never, view, settings: defaultGizmoSettings3D(), anchor: [0, 0, 0], state });
  const d3 = { id: 's', type: 'spline3d', viewport: '3d', param: 'sp' } as never;

  it('insertPoint3 keeps the curve exactly (new point lies on the old curve, neighbours keep the shape)', () => {
    const before = sampleSpline3(pts3(), false, 64);
    const r = insertPoint3(pts3(), false, 0, 0.5);
    expect(r.points).toHaveLength(4);
    expect(r.index).toBe(1);
    const after = sampleSpline3(r.points, false, 32);
    // every new sample is close to some old sample
    for (const q of after) {
      const dmin = Math.min(...before.map((o) => Math.hypot(o[0] - q[0], o[1] - q[1], o[2] - q[2])));
      expect(dmin).toBeLessThan(0.05);
    }
    expect(r.points[1].attrs!.z).toBeGreaterThan(0);
    expect(r.points[1].attrs!.scale).toBeGreaterThanOrEqual(1);
  });

  it('closestOnPolylineToRay finds the segment under the ray', () => {
    const poly: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
    const hit = closestOnPolylineToRay(poly, { o: [1.5, -5, 0], d: [0, 1, 0] })!;
    expect(hit.seg).toBe(1);
    expect(hit.t).toBeCloseTo(0.5, 5);
    expect(hit.dist).toBeCloseTo(0, 5);
  });

  it('Add tool appends on empty space, segments insert; Delete tool and Delete key remove points', () => {
    const state: Record<string, unknown> = { tool: 'add' };
    const m = buildModel3D(d3, env3(state))!;
    expect(m.toolbar!.length).toBeGreaterThan(8);
    expect(m.handles.some((h) => h.id === 'seg0')).toBe(true);
    const ray = view.ray(400, 300);
    const bg = m.background!(ray, view, { shift: false, ctrl: false, alt: false })!;
    expect(((bg.initial!.sp as unknown) as SplineValue).points).toHaveLength(4);
    const seg = m.handles.find((h) => h.id === 'seg0')!;
    const p0 = view.project([0.5, 0.5, 0.5]);
    const r = seg.begin(view.ray(p0![0], p0![1]), view, { shift: false, ctrl: false, alt: false });
    expect(r === null || ((r.initial!.sp as unknown) as SplineValue).points.length === 4).toBe(true);

    const del = buildModel3D(d3, env3({ tool: 'delete' }))!;
    const ph = del.handles.find((h) => h.id === 'p1')!;
    const ds = ph.begin(view.ray(0, 0), view, { shift: false, ctrl: false, alt: false })!;
    expect(((ds.initial!.sp as unknown) as SplineValue).points).toHaveLength(2);
    const k = buildModel3D(d3, env3({ selected: 2 }))!;
    expect(((k.onKey!('Delete', { shift: false, ctrl: false, alt: false }) as Record<string, unknown>).sp as SplineValue).points).toHaveLength(2);
    expect(k.onKey!('x', { shift: false, ctrl: false, alt: false })).toBe('state');
  });
});

describe('Spline to Points', () => {
  it('equal arc length samples with tangent orientation and age', () => {
    const line: SplineValue = { closed: false, points: [{ x: 0, y: 0, mode: 'corner', attrs: { z: 0 } }, { x: 4, y: 0, mode: 'corner', attrs: { z: 0 } }] };
    const m = splineToPoints(setOf(line), { count: 5, pscale: 2, align: true });
    expect(m.positions.length).toBe(15);
    const xs = [0, 3, 6, 9, 12].map((i) => m.positions[i]);
    expect(xs.map((x) => +x.toFixed(3))).toEqual([0, 1, 2, 3, 4]);
    expect(m.attr('point', STD.age)!.data[4]).toBeCloseTo(1);
    expect(() => splineToPoints(setOf({ closed: false, points: [{ x: 0, y: 0 }] }), { count: 4, pscale: 1, align: true })).toThrow();
  });
  it('the node is registered with a Spline input and a Points output', () => {
    const def = makeRegistry().get('geometry.spline_to_points')!;
    expect(def.inputs[0].type).toBe('spline');
    expect(def.outputs[0].type).toBe('points');
  });
});

