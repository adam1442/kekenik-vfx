import { beforeAll, describe, expect, it } from 'vitest';
import { GraphEditor } from '../src/engine/commands/graph-commands';
import { Graph } from '../src/engine/graph/graph';
import type { GizmoDecl } from '../src/engine/graph/gizmo-decl';
import type { NodeRegistry } from '../src/engine/graph/registry';
import type { SplineValue } from '../src/engine/params/schema';
import { Binding, buildGizmoModel, buildNodeGizmos, closestOnPolyline, defaultSnap, fitView, ghostOffsets, GizmoController, GizmoStateStore, hitDistance, NO_MODS, snapAngle, snapPoint, tileRegion, ViewTransform, zoomAt, axisLock, sampleSpline, insertPoint, deletePoint, segmentBezier, bezierAt, type GizmoEnv, type Hit, type Mods, type V2, type ViewState } from '../src/gizmos';
import { makeRegistry } from './helpers';

let reg: NodeRegistry;
beforeAll(() => {
  reg = makeRegistry();
});

const baseView = (o: Partial<ViewState> = {}): ViewState => ({ zoom: 1, cx: 300, cy: 300, rot: 0, flipX: false, flipY: false, imgW: 512, imgH: 512, ...o });
const close = (a: number, b: number, eps = 1e-6): void => expect(Math.abs(a - b)).toBeLessThan(eps);
const mods = (o: Partial<Mods> = {}): Mods => ({ ctrl: false, shift: false, alt: false, ...o });

describe('gizmos: coordinate conversion', () => {
  it('ip <-> screen round-trips for every rotation / flip / zoom', () => {
    for (const rot of [0, 1, 2, 3] as const)
      for (const fx of [false, true])
        for (const fy of [false, true]) {
          const v = new ViewTransform(baseView({ rot, flipX: fx, flipY: fy, zoom: 2.5, imgW: 640, imgH: 360, cx: 411, cy: 123 }));
          for (const p of [[0, 0], [640, 360], [13.5, 200.25], [-50, 900]] as V2[]) {
            const back = v.toImage(v.toScreen(p));
            close(back[0], p[0]);
            close(back[1], p[1]);
          }
        }
  });
  it('the image centre maps to (cx,cy); 90 degree rotation is clockwise on screen', () => {
    const v = new ViewTransform(baseView({ rot: 1 }));
    expect(v.toScreen([256, 256])).toEqual([300, 300]);
    const right = v.toScreen([512, 256]); // image right-middle goes to the bottom
    close(right[0], 300);
    close(right[1], 300 + 256);
  });
  it('inverseMatrix agrees with toImage', () => {
    const v = new ViewTransform(baseView({ rot: 3, flipX: true, zoom: 4 }));
    const m = v.inverseMatrix();
    const sp: V2 = [350, 280];
    const q: V2 = [(sp[0] - 300) / 4, (sp[1] - 300) / 4];
    const ip: V2 = [m[0] * q[0] + m[1] * q[1] + 256, m[2] * q[0] + m[3] * q[1] + 256];
    const ref = v.toImage(sp);
    close(ip[0], ref[0]);
    close(ip[1], ref[1]);
  });
  it('zoomAt keeps the point under the cursor fixed; fitView fits', () => {
    const s = baseView();
    const sp: V2 = [123, 456];
    const before = new ViewTransform(s).toImage(sp);
    const z = zoomAt(s, sp, 3.7);
    const after = new ViewTransform(z).toImage(sp);
    close(before[0], after[0], 1e-6);
    close(before[1], after[1], 1e-6);
    const f = fitView(baseView({ imgW: 1000, imgH: 500 }), 800, 600, 0);
    close(f.zoom, 0.8);
  });
  it('param <-> gizmo bindings: pattern offset, reciprocal cells, degrees, pixels', () => {
    const values = { offset: [0.25, -0.1], scale: [4, 8], rotation: 90, px: [128, 64] };
    const ctx = { size: [512, 256] as V2, values };
    const off = new Binding({ param: 'offset', map: { scale: -1, offset: 0.5 } }, 'pos', ctx);
    expect(off.read2()).toEqual([0.25, 0.6]);
    expect(off.write([0.25, 0.6])).toEqual([0.25, -0.1].map((x) => expect.closeTo(x, 9)));
    const sc = new Binding({ param: 'scale', map: { reciprocal: true } }, 'size', ctx);
    expect(sc.read2()).toEqual([0.25, 0.125]);
    expect(sc.write([0.5, 0.25])).toEqual([2, 4]);
    expect(sc.write([0.3, 0.3], { integer: true })).toEqual([3, 3]);
    const rot = new Binding('rotation', 'angle', ctx);
    close(rot.read1(), Math.PI / 2);
    close(rot.write(Math.PI) as number, 180);
    const px = new Binding('px', 'pos', { ...ctx, space: 'pixel' });
    expect(px.read2()).toEqual([0.25, 0.25]);
    expect(px.write([0.5, 0.5])).toEqual([256, 128]);
  });
});

describe('gizmos: hit testing', () => {
  const v = new ViewTransform(baseView({ zoom: 2 }));
  it('point / ring / segment / box / polyline distances are in screen pixels', () => {
    const c = v.toScreen([100, 100]);
    expect(hitDistance({ t: 'point', p: [100, 100], r: 10 }, [c[0] + 6, c[1]], v)).toBeCloseTo(6);
    expect(hitDistance({ t: 'point', p: [100, 100], r: 10 }, [c[0] + 11, c[1]], v)).toBeNull();
    // ring radius 50 ip = 100 px on screen at zoom 2
    expect(hitDistance({ t: 'ring', c: [100, 100], r: 50, tol: 5 }, [c[0] + 103, c[1]], v)).toBeCloseTo(3);
    expect(hitDistance({ t: 'ring', c: [100, 100], r: 50, tol: 5 }, [c[0] + 120, c[1]], v)).toBeNull();
    expect(hitDistance({ t: 'segment', a: [0, 0], b: [100, 0], tol: 4 }, [v.toScreen([50, 0])[0], v.toScreen([50, 0])[1] + 3], v)).toBeCloseTo(3);
    const box: Hit = { t: 'box', c: [100, 100], half: [20, 10], rot: Math.PI / 2 }; // rotated: 10 wide, 20 tall
    expect(hitDistance(box, v.toScreen([100, 115]), v)).toBe(0);
    expect(hitDistance(box, v.toScreen([115, 100]), v)).toBeNull();
    expect(hitDistance({ t: 'polyline', pts: [[0, 0], [100, 0], [100, 100]], tol: 4 }, v.toScreen([100, 50]), v)).toBe(0);
    expect(hitDistance({ t: 'disk', c: [10, 10], r: 5 }, v.toScreen([14, 10]), v)).not.toBeNull();
  });
  it('hit tolerance is constant in screen space (zoom independent)', () => {
    for (const zoom of [0.25, 1, 8]) {
      const vz = new ViewTransform(baseView({ zoom }));
      const p = vz.toScreen([200, 200]);
      expect(hitDistance({ t: 'point', p: [200, 200], r: 10 }, [p[0] + 9, p[1]], vz)).not.toBeNull();
      expect(hitDistance({ t: 'point', p: [200, 200], r: 10 }, [p[0] + 11, p[1]], vz)).toBeNull();
    }
  });
  it('closestOnPolyline finds segment and parameter', () => {
    const r = closestOnPolyline([[0, 0], [10, 0], [10, 10]], [10, 4]);
    expect(r.seg).toBe(1);
    close(r.t, 0.4);
    expect(r.dist).toBeCloseTo(0);
  });
});

describe('gizmos: snapping', () => {
  const size: V2 = [512, 512];
  it('Ctrl snaps to the grid, magnets pull only within range', () => {
    const s = defaultSnap();
    const p = snapPoint([100, 203], size, s, mods({ ctrl: true }), 1);
    expect(p).toEqual([96, 192]); // multiples of 512/16 = 32
    const near = snapPoint([258, 100], size, s, mods(), 1); // within 6 px of the centre line
    expect(near[0]).toBe(256);
    const far = snapPoint([270, 100], size, s, mods(), 1);
    expect(far[0]).toBe(270);
    expect(snapPoint([258, 100], size, s, mods(), 1, false)[0]).toBe(258); // magnet off (Alt)
  });
  it('angle snap and axis lock', () => {
    close(snapAngle((37 * Math.PI) / 180, 15), (30 * Math.PI) / 180);
    expect(axisLock([10, 3], [0, 0])).toEqual([10, 0]);
    expect(axisLock([2, 9], [0, 0])).toEqual([0, 9]);
  });
});

describe('gizmos: tiling ghosts', () => {
  const size: V2 = [100, 100];
  it('a gizmo at the right edge gets a ghost in the left neighbour tile (1x1 view)', () => {
    const region = tileRegion({ nx: 1, ny: 1 }, size, { x0: -50, y0: -50, x1: 150, y1: 150 });
    expect(region).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 });
    // circle at x=98, radius 10 -> bounds 88..108 : shifted by -1 tile it covers -12..8, inside the region
    const g = ghostOffsets({ x0: 88, y0: 40, x1: 108, y1: 60 }, size, region, true, true);
    expect(g).toEqual([[-1, 0]]);
  });
  it('nothing in the middle, nothing when the node does not wrap', () => {
    const region = tileRegion({ nx: 1, ny: 1 }, size, { x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(ghostOffsets({ x0: 40, y0: 40, x1: 60, y1: 60 }, size, region, true, true)).toEqual([]);
    expect(ghostOffsets({ x0: 88, y0: 40, x1: 108, y1: 60 }, size, region, false, false)).toEqual([]);
  });
  it('corner gizmo gets 3 ghosts; per-axis wrap limits them', () => {
    const region = tileRegion({ nx: 1, ny: 1 }, size, { x0: 0, y0: 0, x1: 100, y1: 100 });
    const b = { x0: 90, y0: 90, x1: 110, y1: 110 };
    expect(ghostOffsets(b, size, region, true, true)).toHaveLength(3);
    expect(ghostOffsets(b, size, region, true, false)).toEqual([[-1, 0]]);
  });
  it('3x3 preview region is centred on the canonical tile and yields 8 ghosts', () => {
    const region = tileRegion({ nx: 3, ny: 3 }, size, { x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(region).toEqual({ x0: -100, y0: -100, x1: 200, y1: 200 });
    expect(ghostOffsets({ x0: 40, y0: 40, x1: 60, y1: 60 }, size, region, true, true)).toHaveLength(8);
  });
  it('infinite repeat is capped', () => {
    const region = tileRegion({ nx: 0, ny: 0 }, size, { x0: -5000, y0: -5000, x1: 5000, y1: 5000 });
    expect(ghostOffsets({ x0: 40, y0: 40, x1: 60, y1: 60 }, size, region, true, true).length).toBeLessThanOrEqual(48);
  });
});

/* -------------------------------------------------------------------------------------------- commands */
function newEditor() {
  const ed = new GraphEditor(new Graph(reg, { width: 512, height: 512 }));
  let t = 0;
  ed.stack.now = () => t;
  return { ed, tick: (ms: number) => (t += ms) };
}

describe('gizmos: command coalescing', () => {
  it('a gesture with 200 live writes is exactly ONE undo step, even with long pauses', () => {
    const { ed, tick } = newEditor();
    const id = ed.addNode('grayscale.noise');
    ed.stack.sealTop();
    const depth = (): number => {
      let n = 0;
      const s = ed.stack;
      const saved: string[] = [];
      while (s.canUndo) {
        s.undo();
        n++;
        saved.push(s.redoLabel ?? '');
      }
      for (let i = 0; i < n; i++) s.redo();
      return n;
    };
    const base = depth();
    const g = ed.beginGesture('Noise transform: Move');
    for (let i = 1; i <= 200; i++) {
      g.set(id, 'offset', [i * 0.001, 0]);
      g.set(id, 'rotation', i);
      tick(i === 100 ? 5000 : 10); // a pause far beyond the 600 ms time-based coalescing window
    }
    expect(ed.graph.nodes.get(id)!.params.offset).toEqual([0.2, 0]); // live (before commit)
    expect(g.commit()).toBe(true);
    expect(depth()).toBe(base + 1);
    ed.stack.undo();
    expect(ed.graph.nodes.get(id)!.params.offset).toEqual([0, 0]);
    expect(ed.graph.nodes.get(id)!.params.rotation).toBe(0);
    ed.stack.redo();
    expect(ed.graph.nodes.get(id)!.params.offset).toEqual([0.2, 0]);
    expect(ed.graph.nodes.get(id)!.params.rotation).toBe(200);
  });
  it('cancel restores, a no-op gesture records nothing, one gesture can touch several nodes', () => {
    const { ed } = newEditor();
    const a = ed.addNode('grayscale.noise');
    const b = ed.addNode('grayscale.noise');
    const g = ed.beginGesture('x');
    g.set(a, 'rotation', 45);
    g.cancel();
    expect(ed.graph.nodes.get(a)!.params.rotation).toBe(0);
    const g2 = ed.beginGesture('noop');
    g2.set(a, 'rotation', 0);
    expect(g2.commit()).toBe(false);
    const g3 = ed.beginGesture('both');
    g3.set(a, 'rotation', 10);
    g3.set(b, 'rotation', 20);
    g3.commit();
    ed.stack.undo();
    expect(ed.graph.nodes.get(a)!.params.rotation).toBe(0);
    expect(ed.graph.nodes.get(b)!.params.rotation).toBe(0);
  });
  it('plain setParam still coalesces within 600 ms and splits after', () => {
    const { ed, tick } = newEditor();
    const id = ed.addNode('grayscale.noise');
    ed.stack.sealTop();
    ed.setParam(id, 'rotation', 1);
    tick(100);
    ed.setParam(id, 'rotation', 2);
    ed.stack.undo();
    expect(ed.graph.nodes.get(id)!.params.rotation).toBe(0);
    ed.stack.redo();
    tick(2000);
    ed.setParam(id, 'rotation', 3);
    ed.stack.undo();
    expect(ed.graph.nodes.get(id)!.params.rotation).toBe(2);
  });
});

/* -------------------------------------------------------------------------------------------- controller */
function rig(opts: { tile?: boolean; zoom?: number } = {}) {
  const { ed } = newEditor();
  const id = ed.addNode('grayscale.noise');
  ed.stack.sealTop();
  const def = reg.get('grayscale.noise')!;
  const state = baseView({ zoom: opts.zoom ?? 1, cx: 256, cy: 256 });
  const view = new ViewTransform(state);
  const states = new GizmoStateStore();
  const tile = !!opts.tile;
  const ctrl: GizmoController = new GizmoController({
    view: () => view,
    tiling: () => ({ wrapX: tile, wrapY: tile, region: { x0: 0, y0: 0, x1: 512, y1: 512 } }),
    beginGesture: (l) => ed.beginGesture(l),
    invalidate: () => {},
  });
  const rebuild = (): void => {
    const node = ed.graph.nodes.get(id)!;
    const models = buildNodeGizmos([{ nodeId: id, decls: def.gizmos ?? [], values: node.params }], { size: [512, 512], tile: [tile, tile], snap: defaultSnap(), zoom: view.zoom }, states);
    ctrl.setModels(models);
  };
  rebuild();
  const P = (): Record<string, unknown> => ed.graph.nodes.get(id)!.params;
  return { ed, id, ctrl, view, P, rebuild };
}

describe('gizmos: Noise Transform2D end to end', () => {
  it('declares a valid transform gizmo bound to offset / rotation / scale', () => {
    const d = reg.get('grayscale.noise')!.gizmos![0];
    expect(d.type).toBe('transform');
    const r = rig();
    expect(r.ctrl.getModels()).toHaveLength(1);
    // gizmo centre = 0.5 - offset => image centre for offset 0; frame = one cell = 1/4 of the image
    const m = r.ctrl.getModels()[0];
    const c = m.handles.find((h) => h.id === 'c')!;
    expect(c.pos).toEqual([256, 256]);
    const br = m.handles.find((h) => h.id === 'br')!;
    expect(br.pos).toEqual([256 + 64, 256 + 64]);
  });
  it('dragging the centre moves the pattern (offset = 0.5 - position) as ONE undo step', () => {
    const r = rig();
    const sp = r.view.toScreen([256, 256]);
    expect(r.ctrl.pointerDown(sp, mods())).toBe(true);
    for (let i = 1; i <= 20; i++) r.ctrl.pointerMove([sp[0] + i * 5, sp[1] + i * 2], mods({ alt: true }));
    r.ctrl.pointerUp();
    const off = r.P().offset as number[];
    close(off[0], -100 / 512, 1e-6);
    close(off[1], -40 / 512, 1e-6);
    r.ed.stack.undo();
    expect(r.P().offset).toEqual([0, 0]);
  });
  it('rotate handle writes degrees; Esc cancels; Ctrl snaps to 15 degrees', () => {
    const r = rig();
    const knob = r.ctrl.getModels()[0].handles.find((h) => h.id === 'rotate')!.pos!;
    const sp = r.view.toScreen(knob);
    r.ctrl.pointerDown(sp, mods());
    // rotate from "up" to "right": +90 degrees clockwise
    r.ctrl.pointerMove([r.view.toScreen([256, 256])[0] + 80, r.view.toScreen([256, 256])[1]], mods());
    close(r.P().rotation as number, 90, 1e-6);
    r.ctrl.cancel();
    expect(r.P().rotation).toBe(0);
    r.ctrl.pointerDown(sp, mods({ ctrl: true }));
    r.ctrl.pointerMove([sp[0] + 20, sp[1] + 10], mods({ ctrl: true }));
    r.ctrl.pointerUp();
    const rr = r.P().rotation as number;
    expect(Math.abs(rr / 15 - Math.round(rr / 15))).toBeLessThan(1e-9);
  });
  it('scale corner: pattern scale = 1 / cell size; tilingSafe rounds to whole numbers and 90 degree steps', () => {
    const r = rig({ tile: true });
    const br = r.ctrl.getModels()[0].handles.find((h) => h.id === 'br')!.pos!;
    const sp = r.view.toScreen(br);
    r.ctrl.pointerDown(sp, mods());
    // frame half size 64 -> pull the corner to 100: cell = 200/512 -> scale 2.56 -> 3 (rounded: tiling)
    r.ctrl.pointerMove(r.view.toScreen([256 + 100, 256 + 100]), mods());
    r.ctrl.pointerUp();
    expect(r.P().scale).toEqual([3, 3]);
    const r2 = rig();
    const sp2 = r2.view.toScreen(r2.ctrl.getModels()[0].handles.find((h) => h.id === 'br')!.pos!);
    r2.ctrl.pointerDown(sp2, mods());
    r2.ctrl.pointerMove(r2.view.toScreen([256 + 100, 256 + 100]), mods());
    r2.ctrl.pointerUp();
    close((r2.P().scale as number[])[0], 512 / 200, 1e-6); // no tiling: exact
  });
  it('Shift on a corner scales uniformly; an edge scales one axis', () => {
    const r = rig();
    const e = r.ctrl.getModels()[0].handles.find((h) => h.id === 'r')!.pos!;
    r.ctrl.pointerDown(r.view.toScreen(e), mods());
    r.ctrl.pointerMove(r.view.toScreen([256 + 128, 256]), mods());
    r.ctrl.pointerUp();
    const s = r.P().scale as number[];
    close(s[0], 2, 1e-6);
    expect(s[1]).toBe(4);
    const r2 = rig();
    const c = r2.ctrl.getModels()[0].handles.find((h) => h.id === 'tr')!.pos!;
    r2.ctrl.pointerDown(r2.view.toScreen(c), mods({ shift: true }));
    r2.ctrl.pointerMove(r2.view.toScreen([256 + 128, 256 - 128]), mods({ shift: true }));
    r2.ctrl.pointerUp();
    const s2 = r2.P().scale as number[];
    close(s2[0], s2[1], 1e-9);
    close(s2[0], 2, 1e-6);
  });
  it('picks ghost copies when tiling: grabbing the ghost of an edge gizmo drags the real one', () => {
    const r = rig({ tile: true });
    // move the pattern so the gizmo sits near the right edge: position x = 500
    r.ed.setParam(r.id, 'offset', [0.5 - 500 / 512, 0]);
    r.rebuild();
    const ghostSp = r.view.toScreen([500 - 512, 256]); // the copy at the left edge (tile offset -1)
    const picked = r.ctrl.pick(ghostSp)!;
    expect(picked.ghost).toEqual([-1, 0]);
    r.ctrl.pointerDown(ghostSp, mods());
    r.ctrl.pointerMove([ghostSp[0] + 10, ghostSp[1]], mods({ alt: true }));
    r.ctrl.pointerUp();
    close(((r.P().offset as number[])[0]), 0.5 - 510 / 512, 1e-6);
  });
  it('priority: a small handle wins over the body; numeric entry is requested on double click', () => {
    const r = rig();
    let req: unknown = null;
    (r.ctrl as unknown as { host: { requestNumeric: (q: unknown) => void } }).host.requestNumeric = (q) => (req = q);
    const p = r.ctrl.pick(r.view.toScreen([256, 256]))!;
    expect(p.handle.id).toBe('c');
    expect(r.ctrl.doubleClick(r.view.toScreen([256, 256]))).toBe(true);
    expect(req).not.toBeNull();
  });
});

describe('gizmos: other types build and drag', () => {
  const env = (values: GizmoEnv['values']): GizmoEnv => ({ nodeId: 'n', values, size: [512, 512], tile: [false, false], snap: defaultSnap(), zoom: 1, state: {} });
  it('circle radius, rect resize (anchored / Alt from centre), line, angle, falloff, range, grid', () => {
    const circle = buildGizmoModel({ id: 'c', type: 'circle', viewport: '2d', center: 'c', radius: 'r' }, env({ c: [0.5, 0.5], r: 0.25 }))!;
    expect(circle.begin('r0', [384, 256], NO_MODS)!.move([256 + 200, 256], NO_MODS)).toEqual({ r: 200 / 512 });
    const rect = buildGizmoModel({ id: 'r', type: 'rect', viewport: '2d', center: 'c', size: 's', rotation: 'a' }, env({ c: [0.5, 0.5], s: [0.5, 0.5], a: 0 }))!;
    const w1 = rect.begin('r', [384, 256], NO_MODS)!.move([448, 256], NO_MODS);
    expect(w1.s).toEqual([(448 - 128) / 512, 0.5]);
    close((w1.c as number[])[0], (128 + 448) / 2 / 512);
    const w2 = rect.begin('r', [384, 256], NO_MODS)!.move([448, 256], mods({ alt: true }));
    expect(w2.c).toEqual([0.5, 0.5]);
    close((w2.s as number[])[0], 384 / 512);
    const line = buildGizmoModel({ id: 'l', type: 'line', viewport: '2d', from: 'a', to: 'b' }, env({ a: [0.1, 0.1], b: [0.9, 0.1] }))!;
    expect(line.begin('b', [460.8, 51.2], NO_MODS)!.move([300, 51.2], NO_MODS)).toEqual({ b: [300 / 512, 0.1] });
    const ang = buildGizmoModel({ id: 'a', type: 'angle', viewport: '2d', angle: 'a' }, env({ a: 0 }))!;
    close(ang.begin('a', [328, 256], NO_MODS)!.move([256, 356], NO_MODS).a as number, 90);
    const fo = buildGizmoModel({ id: 'f', type: 'falloff', viewport: '2d', inner: 'i', outer: 'o' }, env({ i: 0.1, o: 0.3 }))!;
    const wi = fo.begin('in', [256 + 51.2, 256], NO_MODS)!.move([256 + 400, 256], NO_MODS); // inner clamped to outer
    expect(wi.i).toBeCloseTo(0.3);
    const rg = buildGizmoModel({ id: 'g', type: 'range', viewport: '2d', min: 'lo', max: 'hi' }, env({ lo: 0.2, hi: 0.6 }))!;
    const wr = rg.begin('max', [0.1 * 512 + 0.6 * 0.8 * 512, 0.9 * 512], NO_MODS)!.move([0.1 * 512 + 0.1 * 0.8 * 512, 0.9 * 512], NO_MODS);
    expect(wr.hi).toBeCloseTo(0.2); // cannot cross min
    const grid = buildGizmoModel({ id: 'g', type: 'grid', viewport: '2d', cells: 'n' }, env({ n: [4, 4] }))!;
    expect(grid.begin('cell', [128, 128], NO_MODS)!.move([64, 64], mods({ ctrl: true }))).toEqual({ n: [8, 8] });
  });
  it('3D-only gizmos are skipped by the 2D viewport; invisible (visibleIf) gizmos too; broken ones never throw', () => {
    expect(buildGizmoModel({ id: 'b', type: 'box3d', viewport: '3d', position: 'p', size: 's' }, env({}))).toBeNull();
    expect(buildGizmoModel({ id: 'p', type: 'point', viewport: '2d', param: 'p', visibleIf: () => false }, env({ p: [0, 0] }))).toBeNull();
    expect(() => buildGizmoModel({ id: 'x', type: 'point', viewport: '2d', param: 'missing' } as GizmoDecl, env({}))).not.toThrow();
  });
  it('brush: wheel resizes, drag records strokes into the string param', () => {
    const m = buildGizmoModel({ id: 'b', type: 'brush', viewport: '2d', radius: 'r', strokes: 's' }, env({ r: 0.1, s: '' }))!;
    expect(m.onWheel!(-1, mods({ alt: true }))!.r).toBeGreaterThan(0.1);
    const s = m.begin('paint', [100, 100], NO_MODS)!;
    const w = s.move([140, 100], NO_MODS);
    const parsed = JSON.parse(w.s as string) as { strokes: { pts: number[] }[] };
    expect(parsed.strokes[0].pts.length).toBeGreaterThanOrEqual(4);
  });
});

describe('gizmos: spline editing', () => {
  const sp: SplineValue = { closed: false, points: [{ x: 0.1, y: 0.5, mode: 'auto' }, { x: 0.5, y: 0.2, mode: 'auto' }, { x: 0.9, y: 0.5, mode: 'auto' }] };
  const mkEnv = (v: SplineValue): GizmoEnv => ({ nodeId: 'n', values: { path: v }, size: [512, 512], tile: [false, false], snap: defaultSnap(), zoom: 1, state: {} });
  it('insertPoint preserves the curve exactly; delete respects the minimum', () => {
    const before = sampleSpline(sp, 40).pts;
    const { value, index } = insertPoint(sp, 0, 0.5);
    expect(value.points).toHaveLength(4);
    expect(index).toBe(1);
    // every sample of the new curve lies on the old one: compare midpoints of the two halves
    const oldMid = bezierAt(segmentBezier(sp, 0), 0.5);
    close(value.points[1].x, oldMid[0]);
    close(value.points[1].y, oldMid[1]);
    const a = bezierAt(segmentBezier(value, 0), 0.5);
    const o = bezierAt(segmentBezier(sp, 0), 0.25);
    close(a[0], o[0], 1e-9);
    close(a[1], o[1], 1e-9);
    expect(before.length).toBeGreaterThan(10);
    expect(deletePoint({ closed: false, points: sp.points.slice(0, 2) }, 0).points).toHaveLength(2);
    expect(deletePoint(sp, 1).points).toHaveLength(2);
  });
  it('drag an anchor, drag a bezier handle (mirrored, Alt breaks), width handle, Shift+click appends', () => {
    const m = buildGizmoModel({ id: 'p', type: 'path', viewport: '2d', param: 'path' }, mkEnv(sp))!;
    const w = m.begin('p1', [256, 102.4], NO_MODS)!.move([300, 150], NO_MODS);
    const v = w.path as SplineValue;
    close(v.points[1].x, 300 / 512);
    expect(v.points[0]).toEqual(sp.points[0]);
    // selected point now shows bezier + width handles
    const m2 = buildGizmoModel({ id: 'p', type: 'path', viewport: '2d', param: 'path' }, { ...mkEnv(sp), state: { sel: 1 } })!;
    const ho = m2.handles.find((h) => h.id === 'ho1')!;
    const hv = m2.begin('ho1', ho.pos!, NO_MODS)!.move([ho.pos![0] + 40, ho.pos![1] + 10], NO_MODS).path as SplineValue;
    expect(hv.points[1].mode).toBe('free');
    expect(hv.points[1].hin![0]).toBeCloseTo(-hv.points[1].hout![0]);
    const hv2 = m2.begin('ho1', ho.pos!, NO_MODS)!.move([ho.pos![0] + 40, ho.pos![1] + 10], mods({ alt: true })).path as SplineValue;
    expect(hv2.points[1].hin![0]).not.toBeCloseTo(-hv2.points[1].hout![0]);
    const wa = m2.handles.find((h) => h.id === 'wa1')!;
    const wv = m2.begin('wa1', wa.pos!, NO_MODS)!.move([wa.pos![0], wa.pos![1] + 30], NO_MODS).path as SplineValue;
    expect(wv.points[1].w).toBeGreaterThan(0);
    expect(m.begin('canvas', [10, 10], NO_MODS)).toBeNull(); // plain click on empty space is not consumed
    const add = m.begin('canvas', [100, 400], mods({ shift: true }))!;
    expect((add.initial!.path as SplineValue).points).toHaveLength(4);
    expect(m.onKey!('Delete', NO_MODS)).toBeNull(); // nothing selected yet
    const sel = buildGizmoModel({ id: 'p', type: 'path', viewport: '2d', param: 'path' }, { ...mkEnv(sp), state: { sel: 2 } })!;
    expect(((sel.onKey!('Delete', NO_MODS) as Record<string, unknown>).path as SplineValue).points).toHaveLength(2);
    expect(m.doubleClick!('seg0', [150, 200])).toBeDefined();
  });
});
