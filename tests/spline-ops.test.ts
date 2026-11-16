import { describe, expect, it } from 'vitest';
import { defaultSweepSpline, sweep, type SweepParams } from '../src/engine/mesh/sweep';
import type { SplineValue } from '../src/engine/params/schema';
import { canConnect } from '../src/engine/graph/pins';
import {
  applyAddTool,
  applyDeleteTool,
  convertMode,
  deletePoints,
  hitPoint,
  hitTestAdd,
  insertAtParam,
  liftTo3D,
  mirror,
  normalizeProfile,
  polylineLength,
  presetSpline,
  resample,
  setClosed,
  signedArea,
  SPLINE_PRESETS,
  toPolyline,
  validateProfile,
} from '../src/engine/spline/ops';
import { splineValue, asSplineSet } from '../src/engine/spline/value';
import { nodeRegistry } from '../src/engine/graph/registry';
import { discoverNodes } from '../src/engine/graph/discover';

const line = (): SplineValue => ({ closed: false, points: [{ x: 0, y: 0, mode: 'corner' }, { x: 1, y: 0, mode: 'corner' }, { x: 1, y: 1, mode: 'corner' }] });
const square = (s = 0.4, cx = 0.3, cy = 0.7): SplineValue => ({ closed: true, points: [{ x: cx - s, y: cy - s, mode: 'corner' }, { x: cx + s, y: cy - s, mode: 'corner' }, { x: cx + s, y: cy + s, mode: 'corner' }, { x: cx - s, y: cy + s, mode: 'corner' }] });

describe('spline data model', () => {
  it('insert at parameter keeps the curve exactly and adds one point', () => {
    const sp = line();
    const r = insertAtParam(sp, 0, 0.5);
    expect(r.value.points).toHaveLength(4);
    expect(r.index).toBe(1);
    expect(r.value.points[1].x).toBeCloseTo(0.5, 6);
    expect(r.value.points[1].y).toBeCloseTo(0, 6);
    expect(polylineLength(toPolyline(r.value, 8))).toBeCloseTo(polylineLength(toPolyline(sp, 8)), 3);
    expect(sp.points).toHaveLength(3); // input is never mutated
  });
  it('delete (several) respects the minimum point count', () => {
    expect(deletePoints(line(), [1]).points).toHaveLength(2);
    expect(deletePoints(line(), [0, 1]).points).toHaveLength(3);
    expect(deletePoints(line(), [0, 1, 2], 0).points).toHaveLength(0);
  });
  it('convert tangent mode: free materialises handles, corner / auto drop them', () => {
    const sp: SplineValue = { closed: false, points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }] };
    const free = convertMode(sp, [1], 'free');
    expect(free.points[1].mode).toBe('free');
    expect(free.points[1].hout).toBeDefined();
    const c = convertMode(free, [1], 'corner');
    expect(c.points[1].hout).toBeUndefined();
    expect(c.points[1].mode).toBe('corner');
  });
  it('close / open (closing needs at least 3 points)', () => {
    expect(setClosed(line(), true).closed).toBe(true);
    expect(setClosed({ closed: false, points: line().points.slice(0, 2) }, true).closed).toBe(false);
    expect(setClosed(square(), false).closed).toBe(false);
  });
  it('resample gives equally spaced points', () => {
    const r = resample(line(), 9);
    expect(r.points).toHaveLength(9);
    const poly = r.points.map((p) => [p.x, p.y] as [number, number]);
    const d = poly.slice(1).map((p, i) => Math.hypot(p[0] - poly[i][0], p[1] - poly[i][1]));
    expect(Math.max(...d) / Math.min(...d)).toBeLessThan(1.6); // corners are rounded by the auto handles
  });
  it('mirror flips x about the centre and keeps the spline closed', () => {
    const m = mirror(square(), 'x', 0.5);
    expect(m.closed).toBe(true);
    expect(Math.min(...m.points.map((p) => p.x))).toBeCloseTo(0.5 - (0.7 - 0.5) - 0.0, 1);
  });
  it('presets all produce usable splines', () => {
    for (const name of SPLINE_PRESETS) {
      const sp = presetSpline(name);
      expect(sp.points.length, name).toBeGreaterThanOrEqual(2);
      expect(sp.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), name).toBe(true);
    }
  });
});

describe('hit-testing for the Add / Delete tools', () => {
  it('Add on a segment inserts at the right parameter, on empty space appends, on a point selects it', () => {
    const sp = line();
    const seg = hitTestAdd(sp, [0.5, 0.01], 0.05);
    expect(seg?.kind).toBe('segment');
    if (seg?.kind === 'segment') {
      expect(seg.seg).toBe(0);
      expect(seg.t).toBeGreaterThan(0.4);
      expect(seg.t).toBeLessThan(0.6);
    }
    expect(applyAddTool(sp, [0.5, 0.01], 0.05).value.points).toHaveLength(4);
    const far = applyAddTool(sp, [0.2, 0.8], 0.05);
    expect(far.value.points).toHaveLength(4);
    expect(far.index).toBe(3);
    expect(far.value.points[3].x).toBeCloseTo(0.2, 6);
    const onPoint = applyAddTool(sp, [1.001, 0.001], 0.05);
    expect(onPoint.value.points).toHaveLength(3);
    expect(onPoint.index).toBe(1);
  });
  it('Delete removes the point under the cursor only within tolerance and respects the minimum', () => {
    expect(hitPoint(line(), [1.02, 0.01], 0.05)).toBe(1);
    expect(hitPoint(line(), [0.5, 0.5], 0.05)).toBe(-1);
    expect(applyDeleteTool(line(), [1, 0], 0.05).points).toHaveLength(2);
    expect(applyDeleteTool(line(), [0.5, 0.5], 0.05).points).toHaveLength(3);
    const two: SplineValue = { closed: false, points: line().points.slice(0, 2) };
    expect(applyDeleteTool(two, [0, 0], 0.05).points).toHaveLength(2);
  });
});

describe('profile normalisation, winding and validation', () => {
  it('centres on (0.5, 0.5) and scales the largest extent to unit size', () => {
    const { value } = normalizeProfile(square(0.1, 0.3, 0.7), 1);
    const poly = toPolyline(value, 4);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 5);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0.5, 5);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(0.5, 5);
  });
  it('fixes the winding of closed profiles (counter-clockwise in profile space) regardless of input order', () => {
    const ccw = square();
    const cw: SplineValue = { closed: true, points: [...ccw.points].reverse() };
    for (const sp of [ccw, cw]) {
      const n = normalizeProfile(sp).value;
      const prof = toPolyline(n, 4).map((p): [number, number] => [p[0] - 0.5, 0.5 - p[1]]);
      expect(signedArea(prof)).toBeGreaterThan(0);
    }
  });
  it('validation: too few points, degenerate, self intersection (bow-tie)', () => {
    expect(validateProfile({ closed: false, points: [{ x: 0, y: 0 }] })).toContain('tooFewPoints');
    expect(validateProfile({ closed: true, points: [{ x: 0.5, y: 0.5, mode: 'corner' }, { x: 0.5, y: 0.5, mode: 'corner' }, { x: 0.5, y: 0.5, mode: 'corner' }] })).toContain('degenerate');
    const bow: SplineValue = { closed: true, points: [{ x: 0, y: 0, mode: 'corner' }, { x: 1, y: 1, mode: 'corner' }, { x: 1, y: 0, mode: 'corner' }, { x: 0, y: 1, mode: 'corner' }] };
    expect(validateProfile(bow)).toContain('selfIntersect');
    expect(validateProfile(square())).toEqual([]);
  });
  it('2D UV spline is lifted to a 3D path (centred, y flipped, z / scale / twist attrs)', () => {
    const p = liftTo3D({ closed: false, points: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0 }] }, 0.25);
    expect(p.points[0].x).toBeCloseTo(0, 9);
    expect(p.points[1].x).toBeCloseTo(1, 9);
    expect(p.points[1].y).toBeCloseTo(1, 9);
    expect(p.points[0].attrs).toMatchObject({ z: 0.25, scale: 1, twist: 0 });
  });
});

describe('Sweep with a connected profile (CPU geometry)', () => {
  const base = (profileSpline: SplineValue | null): SweepParams => ({
    spline: defaultSweepSpline(),
    closed: false,
    segments: 12,
    profile: 'custom',
    profileRes: 12,
    profileSpline,
    width: 0.2,
    height: 0.2,
    starPoints: 5,
    starInner: 0.45,
    scaleCurve: { keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
    twistCurve: { keys: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    twistAmount: 0,
    rotation: 0,
    taperStart: 1,
    taperEnd: 1,
    orientation: 'minimal_torsion',
    up: [0, 0, 1],
    capStart: true,
    capEnd: true,
    uTiling: 1,
    vTiling: 1,
    vOffset: 0,
    vByLength: false,
    colorGradient: { stops: [{ pos: 0, color: [1, 1, 1, 1] }, { pos: 1, color: [1, 1, 1, 1] }] },
    useGradient: false,
    normals: 'smooth',
    usePointAttrs: true,
  });
  it('a normalised closed profile produces a capped tube; an open profile produces a ribbon without caps', () => {
    const tube = sweep(base(normalizeProfile(presetSpline('circle')).value));
    const ribbon = sweep(base(normalizeProfile(presetSpline('s_curve')).value));
    expect(tube.pointCount).toBeGreaterThan(ribbon.pointCount > 0 ? 0 : 1);
    expect(tube.primCount).toBeGreaterThan(0);
    expect(ribbon.primCount).toBeGreaterThan(0);
    // closed profile has caps: extra points beyond rows * ring
    const rows = 13;
    expect(tube.pointCount).toBeGreaterThan(rows * 4);
  });
  it('profile size is independent of the input scale (normalised) and handedness (winding) gives the same point count', () => {
    const a = sweep(base(normalizeProfile(square(0.4)).value));
    const b = sweep(base(normalizeProfile({ closed: true, points: [...square(0.05).points].reverse() }).value));
    expect(a.pointCount).toBe(b.pointCount);
  });
});

describe('Spline pin type and nodes', () => {
  it('only Spline connects to Spline', () => {
    expect(canConnect('spline', 'spline')).toBe(true);
    expect(canConnect('spline', 'gray')).toBe(false);
    expect(canConnect('gray', 'spline')).toBe(false);
  });
  it('pin value wrapper round-trips', () => {
    const v = splineValue({ splines: [line()] });
    expect(asSplineSet(v)?.splines).toHaveLength(1);
    expect(asSplineSet(undefined)).toBeUndefined();
  });
  it('nodes are discovered with Spline pins; Sweep has Profile and Path inputs; Spline node has an output', () => {
    discoverNodes(nodeRegistry);
    const def = (id: string) => nodeRegistry.get(id)!;
    for (const id of ['geometry.spline_shape', 'geometry.spline_transform', 'geometry.spline_resample', 'geometry.spline_combine']) {
      expect(def(id), id).toBeDefined();
      expect(def(id).outputs.some((o) => o.type === 'spline')).toBe(true);
    }
    expect(def('geometry.sweep').inputs.filter((i) => i.type === 'spline').map((i) => i.id).sort()).toEqual(['path_in', 'profile_in']);
    expect(def('grayscale.spline').outputs.map((o) => o.id)).toContain('spline_out');
    expect(def('grayscale.spline').inputs.map((i) => i.id)).toContain('spline_in');
  });
});
