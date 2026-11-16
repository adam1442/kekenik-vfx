import type { GizmoDecl } from '../engine/graph/gizmo-decl';
import { clampN, DEG, unwrapNear, v2, type V2 } from './geom';
import { arcPoly, arrowHead, bind, bodyHandle, HIT_LINE_PX, lengthUnit, makeModel, pointHandle, toIp, toUv } from './kit';
import { axisLock, snapAngle, snapDirection, snapPoint, snapScalar } from './snap';
import type { DragSession, GizmoEnv, GizmoModel, Handle, NumericField, Shape, Writes } from './types';

import { t as tt } from '../shared/i18n';
type Decl<T extends GizmoDecl['type']> = Extract<GizmoDecl, { type: T }>;

const fmtAngle = (rad: number): string => `${((rad / DEG) % 360).toFixed(1)}°`;
const space = (d: GizmoDecl): 'uv' | 'pixel' | 'world' | undefined => d.space;

/** Numeric fields for a 2-component position (UV, or px when decl.space = 'pixel'). */
function posFields(decl: GizmoDecl, env: GizmoEnv, p: V2, prefix = ''): NumericField[] {
  const px = space(decl) === 'pixel';
  const f = (v: number, axis: 0 | 1): number => (px ? v * env.size[axis] : v);
  return [
    { id: `${prefix}x`, label: `${prefix ? prefix + ' ' : ''}X`, unit: px ? 'px' : '', value: f(p[0], 0), step: px ? 1 : 0.01 },
    { id: `${prefix}y`, label: `${prefix ? prefix + ' ' : ''}Y`, unit: px ? 'px' : '', value: f(p[1], 1), step: px ? 1 : 0.01 },
  ];
}
function posFromField(decl: GizmoDecl, env: GizmoEnv, uv: V2, field: string, value: number): V2 {
  const px = space(decl) === 'pixel';
  const out: V2 = [uv[0], uv[1]];
  const axis = field.endsWith('x') ? 0 : 1;
  out[axis] = px ? value / env.size[axis] : value;
  return out;
}

/* ================================================================================================ point */
export function buildPoint(decl: Decl<'point'>, env: GizmoEnv): GizmoModel {
  const b = bind(decl, env, decl.param, 'pos');
  const uv = b.read2();
  const pos = toIp(uv, env);
  const handles: Handle[] = [pointHandle('p', 'Position', pos, { shape: 'circle' })];
  const shapes: Shape[] = [{ k: 'circle', c: pos, r: 14 / env.zoom, role: 'aux' }];
  return makeModel(
    decl,
    env,
    {
      shapes,
      handles,
      begin(_id, ip): DragSession {
        const off = v2.sub(pos, ip);
        let last = pos;
        return {
          move(p, m) {
            let q = v2.add(p, off);
            if (m.shift) q = axisLock(q, pos);
            q = snapPoint(q, env.size, env.snap, m, env.zoom, !m.alt);
            last = q;
            return { [b.param]: b.write(toUv(q, env)) };
          },
          readout: () => `${(last[0] / env.size[0]).toFixed(3)}, ${(last[1] / env.size[1]).toFixed(3)}`,
        };
      },
      numeric: () => posFields(decl, env, uv),
      applyNumeric: (_id, f, v) => ({ [b.param]: b.write(posFromField(decl, env, uv, f, v)) }),
    },
    'Point',
  );
}

/* ================================================================================================ circle */
export function buildCircle(decl: Decl<'circle'>, env: GizmoEnv): GizmoModel {
  const rb = bind(decl, env, decl.radius, 'len');
  const cb = decl.center ? bind(decl, env, decl.center, 'pos') : null;
  const unit = lengthUnit(decl, env);
  const cUv = cb ? cb.read2() : ([0.5, 0.5] as V2);
  const c = toIp(cUv, env);
  const r = Math.max(rb.read1() * unit, 0);
  const handles: Handle[] = [];
  const cursors = ['ew-resize', 'ns-resize', 'ew-resize', 'ns-resize'];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    handles.push(pointHandle(`r${i}`, 'Radius', v2.add(c, [Math.cos(a) * r, Math.sin(a) * r]), { priority: 1, cursor: cursors[i], shape: 'square' }));
  }
  handles.push({ id: 'ring', label: 'Radius', hit: { t: 'ring', c, r, tol: HIT_LINE_PX }, priority: 3, cursor: 'nesw-resize', shape: 'none' });
  if (cb) {
    handles.push(pointHandle('c', 'Center', c, { shape: 'circle', cursor: 'move' }));
    handles.push(bodyHandle('body', 'Center', { t: 'disk', c, r }, 10));
  }
  const shapes: Shape[] = [{ k: 'circle', c, r, role: 'main' }];
  return makeModel(
    decl,
    env,
    {
      shapes,
      handles,
      begin(id, ip): DragSession | null {
        if (id === 'c' || id === 'body') {
          if (!cb) return null;
          const off = v2.sub(c, ip);
          return {
            move: (p, m) => ({ [cb.param]: cb.write(toUv(snapPoint(v2.add(p, off), env.size, env.snap, m, env.zoom, !m.alt), env)) }),
          };
        }
        const grab = v2.dist(ip, c);
        const off = r - grab;
        let cur = r;
        return {
          move(p, m) {
            let nr = Math.max(0, v2.dist(p, c) + off);
            if (m.ctrl) nr = snapScalar(nr / unit, env.snap.gridUv / 2) * unit;
            cur = nr;
            return { [rb.param]: rb.write(nr / unit) };
          },
          readout: () => `r ${(cur / unit).toFixed(3)}`,
        };
      },
      numeric(id) {
        if (id === 'c' || id === 'body') return cb ? posFields(decl, env, cUv) : [];
        const px = space(decl) === 'pixel';
        return [{ id: 'r', label: 'Radius', unit: px ? 'px' : '', value: px ? r : r / unit, step: px ? 1 : 0.01 }];
      },
      applyNumeric(id, f, v) {
        if (id === 'c' || id === 'body') return cb ? { [cb.param]: cb.write(posFromField(decl, env, cUv, f, v)) } : {};
        return { [rb.param]: rb.write(space(decl) === 'pixel' ? v / unit : v) };
      },
    },
    'Circle',
  );
}

/* ================================================================================================ line */
export function buildLine(decl: Decl<'line'>, env: GizmoEnv): GizmoModel {
  const arrow = 12 / env.zoom;
  if ('from' in decl) {
    const fb = bind(decl, env, decl.from, 'pos');
    const tb = bind(decl, env, decl.to, 'pos');
    const fUv = fb.read2();
    const tUv = tb.read2();
    const a = toIp(fUv, env);
    const b = toIp(tUv, env);
    const shapes: Shape[] = [
      { k: 'poly', pts: [a, b], role: 'main' },
      { k: 'poly', pts: arrowHead(b, v2.sub(b, a), arrow), role: 'main' },
    ];
    const handles: Handle[] = [
      pointHandle('a', 'Start', a, { shape: 'circle' }),
      pointHandle('b', 'End', b, { shape: 'square' }),
      bodyHandle('body', 'Line', { t: 'segment', a, b, tol: HIT_LINE_PX }, 8),
    ];
    return makeModel(
      decl,
      env,
      {
        shapes,
        handles,
        begin(id, ip): DragSession {
          if (id === 'body') {
            const off = v2.sub(a, ip);
            const d = v2.sub(b, a);
            return {
              move(p, m) {
                let q = v2.add(p, off);
                if (m.shift) q = axisLock(q, a);
                q = snapPoint(q, env.size, env.snap, m, env.zoom, !m.alt);
                return { [fb.param]: fb.write(toUv(q, env)), [tb.param]: tb.write(toUv(v2.add(q, d), env)) };
              },
            };
          }
          const mine = id === 'a' ? a : b;
          const other = id === 'a' ? b : a;
          const pb = id === 'a' ? fb : tb;
          const off = v2.sub(mine, ip);
          return {
            move(p, m) {
              let q = v2.add(p, off);
              q = snapPoint(q, env.size, env.snap, m, env.zoom, !m.alt && !m.shift);
              if (m.shift) q = snapDirection(q, other, 45);
              return { [pb.param]: pb.write(toUv(q, env)) };
            },
          };
        },
        numeric: (id) => (id === 'body' ? [] : posFields(decl, env, id === 'a' ? fUv : tUv)),
        applyNumeric(id, f, v) {
          const pb = id === 'a' ? fb : tb;
          return { [pb.param]: pb.write(posFromField(decl, env, id === 'a' ? fUv : tUv, f, v)) };
        },
      },
      'Line',
    );
  }
  // origin + angle (+ length)
  const ob = bind(decl, env, decl.origin, 'pos');
  const ab = bind(decl, env, decl.angle, 'angle');
  const lb = decl.length ? bind(decl, env, decl.length, 'len') : null;
  const unit = lengthUnit(decl, env);
  const o = toIp(ob.read2(), env);
  const ang = ab.read1();
  const len = (lb ? lb.read1() : 0.25) * unit;
  const e = v2.add(o, v2.mul([Math.cos(ang), Math.sin(ang)], len));
  const shapes: Shape[] = [
    { k: 'poly', pts: [o, e], role: 'main' },
    { k: 'poly', pts: arrowHead(e, v2.sub(e, o), arrow), role: 'main' },
  ];
  const handles: Handle[] = [
    pointHandle('o', 'Origin', o, { shape: 'circle' }),
    pointHandle('e', lb ? 'Angle / length' : 'Angle', e, { shape: 'square', cursor: 'crosshair' }),
    bodyHandle('body', 'Line', { t: 'segment', a: o, b: e, tol: HIT_LINE_PX }, 8),
  ];
  return makeModel(
    decl,
    env,
    {
      shapes,
      handles,
      begin(id, ip): DragSession {
        if (id === 'o' || id === 'body') {
          const off = v2.sub(o, ip);
          return { move: (p, m) => ({ [ob.param]: ob.write(toUv(snapPoint(v2.add(p, off), env.size, env.snap, m, env.zoom, !m.alt), env)) }) };
        }
        let prev = ang;
        let cur = ang;
        return {
          move(p, m) {
            const d = v2.sub(p, o);
            let a = unwrapNear(Math.atan2(d[1], d[0]), prev);
            if (m.ctrl || m.shift) a = snapAngle(a, env.snap.angleDeg);
            prev = a;
            cur = a;
            const w: Writes = { [ab.param]: ab.write(a) };
            if (lb) w[lb.param] = lb.write(v2.len(d) / unit);
            return w;
          },
          readout: () => fmtAngle(cur),
        };
      },
      numeric(id) {
        if (id === 'e') {
          const f: NumericField[] = [{ id: 'angle', label: 'Angle', unit: '°', value: ang / DEG, step: 1 }];
          if (lb) f.push({ id: 'len', label: 'Length', unit: '', value: len / unit, step: 0.01 });
          return f;
        }
        return posFields(decl, env, ob.read2());
      },
      applyNumeric(id, f, v) {
        if (id === 'e') return f === 'angle' ? { [ab.param]: ab.write(v * DEG) } : lb ? { [lb.param]: lb.write(v) } : {};
        return { [ob.param]: ob.write(posFromField(decl, env, ob.read2(), f, v)) };
      },
    },
    'Line',
  );
}

/* ================================================================================================ angle */
export function buildAngle(decl: Decl<'angle'>, env: GizmoEnv): GizmoModel {
  const ab = bind(decl, env, decl.angle, 'angle');
  const cb = decl.center ? bind(decl, env, decl.center, 'pos') : null;
  const cUv = cb ? cb.read2() : ([0.5, 0.5] as V2);
  const c = toIp(cUv, env);
  const R = 72 / env.zoom; // constant screen size
  const ang = ab.read1();
  const tip = v2.add(c, [Math.cos(ang) * R, Math.sin(ang) * R]);
  const shapes: Shape[] = [
    { k: 'poly', pts: [c, [c[0] + R * 1.15, c[1]]], role: 'aux', dash: true },
    { k: 'poly', pts: arcPoly(c, R * 0.8, 0, ang), role: 'strong' },
    { k: 'poly', pts: [c, tip], role: 'main' },
    { k: 'circle', c, r: R, role: 'aux', dash: true },
    { k: 'text', p: v2.add(c, v2.rot([R * 0.55, 0], ang / 2)), text: fmtAngle(ang) },
  ];
  const handles: Handle[] = [
    pointHandle('a', 'Angle', tip, { shape: 'circle', cursor: 'crosshair' }),
    { id: 'ring', label: 'Angle', hit: { t: 'ring', c, r: R, tol: HIT_LINE_PX }, priority: 4, cursor: 'crosshair', shape: 'none' },
  ];
  if (cb) handles.push(pointHandle('c', 'Center', c, { shape: 'square' }));
  return makeModel(
    decl,
    env,
    {
      shapes,
      handles,
      begin(id, ip): DragSession | null {
        if (id === 'c') {
          if (!cb) return null;
          const off = v2.sub(c, ip);
          return { move: (p, m) => ({ [cb.param]: cb.write(toUv(snapPoint(v2.add(p, off), env.size, env.snap, m, env.zoom, !m.alt), env)) }) };
        }
        let prev = ang;
        let cur = ang;
        return {
          move(p, m) {
            const d = v2.sub(p, c);
            let a = unwrapNear(Math.atan2(d[1], d[0]), prev);
            if (m.ctrl) a = snapAngle(a, env.snap.angleDeg);
            prev = a;
            cur = a;
            return { [ab.param]: ab.write(a) };
          },
          readout: () => fmtAngle(cur),
        };
      },
      numeric: (id) => (id === 'c' ? posFields(decl, env, cUv) : [{ id: 'angle', label: 'Angle', unit: '°', value: ang / DEG, step: 1 }]),
      applyNumeric: (id, f, v) => (id === 'c' && cb ? { [cb.param]: cb.write(posFromField(decl, env, cUv, f, v)) } : { [ab.param]: ab.write(v * DEG) }),
    },
    'Angle',
  );
}

/* ================================================================================================ falloff */
export function buildFalloff(decl: Decl<'falloff'>, env: GizmoEnv): GizmoModel {
  const ib = bind(decl, env, decl.inner, 'len');
  const ob = bind(decl, env, decl.outer, 'len');
  const cb = decl.center ? bind(decl, env, decl.center, 'pos') : null;
  const unit = lengthUnit(decl, env);
  const cUv = cb ? cb.read2() : ([0.5, 0.5] as V2);
  const c = toIp(cUv, env);
  const ri = ib.read1() * unit;
  const ro = ob.read1() * unit;
  const shapes: Shape[] = [
    { k: 'circle', c, r: ro, role: 'main' },
    { k: 'circle', c, r: ri, role: 'strong', dash: true },
  ];
  const handles: Handle[] = [
    pointHandle('in', 'Inner radius', v2.add(c, [ri, 0]), { priority: 0, shape: 'circle', cursor: 'ew-resize' }),
    pointHandle('out', 'Outer radius', v2.add(c, [ro, 0]), { priority: 0, shape: 'square', cursor: 'ew-resize' }),
    { id: 'ring_in', label: tt('modelsBasic.innerRadius'), hit: { t: 'ring', c, r: ri, tol: HIT_LINE_PX }, priority: 3, cursor: 'nesw-resize', shape: 'none' },
    { id: 'ring_out', label: tt('modelsBasic.outerRadius'), hit: { t: 'ring', c, r: ro, tol: HIT_LINE_PX }, priority: 4, cursor: 'nesw-resize', shape: 'none' },
  ];
  if (cb) {
    handles.push(pointHandle('c', 'Center', c, { priority: 1, shape: 'circle' }));
    handles.push(bodyHandle('body', 'Center', { t: 'disk', c, r: ri }, 10));
  }
  return makeModel(
    decl,
    env,
    {
      shapes,
      handles,
      begin(id, ip): DragSession | null {
        if (id === 'c' || id === 'body') {
          if (!cb) return null;
          const off = v2.sub(c, ip);
          return { move: (p, m) => ({ [cb.param]: cb.write(toUv(snapPoint(v2.add(p, off), env.size, env.snap, m, env.zoom, !m.alt), env)) }) };
        }
        const isIn = id === 'in' || id === 'ring_in';
        const base = isIn ? ri : ro;
        const off = base - v2.dist(ip, c);
        let cur = base;
        return {
          move(p, m) {
            let nr = Math.max(0, v2.dist(p, c) + off);
            if (m.ctrl) nr = snapScalar(nr / unit, env.snap.gridUv / 2) * unit;
            cur = nr;
            if (isIn) return { [ib.param]: ib.write(Math.min(nr, ro) / unit) };
            const w: Writes = { [ob.param]: ob.write(Math.max(nr, 0) / unit) };
            if (m.shift && ro > 1e-9) w[ib.param] = ib.write((ri * nr) / ro / unit); // Shift: scale both
            else if (nr < ri) w[ib.param] = ib.write(nr / unit); // keep inner <= outer
            return w;
          },
          readout: () => `${isIn ? 'inner' : 'outer'} ${(cur / unit).toFixed(3)}`,
        };
      },
      numeric(id) {
        if (id === 'c' || id === 'body') return cb ? posFields(decl, env, cUv) : [];
        return [{ id: id.includes('in') ? 'in' : 'out', label: id.includes('in') ? 'Inner' : 'Outer', unit: '', value: (id.includes('in') ? ri : ro) / unit, step: 0.01 }];
      },
      applyNumeric(id, f, v) {
        if (id === 'c' || id === 'body') return cb ? { [cb.param]: cb.write(posFromField(decl, env, cUv, f, v)) } : {};
        if (f === 'in') return { [ib.param]: ib.write(Math.min(v, ro / unit)) };
        const w: Writes = { [ob.param]: ob.write(v) };
        if (v * unit < ri) w[ib.param] = ib.write(v);
        return w;
      },
    },
    'Falloff',
  );
}

/* ================================================================================================ range */
export function buildRange(decl: Decl<'range'>, env: GizmoEnv): GizmoModel {
  const mb = bind(decl, env, decl.min, 'scalar');
  const xb = bind(decl, env, decl.max, 'scalar');
  const unit = lengthUnit(decl, env);
  const origin = toIp(decl.origin ?? [0.1, 0.9], env);
  const ang = (decl.angle ?? 0) * DEG;
  const dir: V2 = [Math.cos(ang), Math.sin(ang)];
  const len = (decl.length ?? 0.8) * unit;
  const at = (t: number): V2 => v2.add(origin, v2.mul(dir, t * len));
  const tMin = mb.read1();
  const tMax = xb.read1();
  const nrm = v2.mul(v2.perp(dir), 6 / env.zoom);
  const shapes: Shape[] = [{ k: 'poly', pts: [at(0), at(1)], role: 'aux' }, { k: 'poly', pts: [at(tMin), at(tMax)], role: 'strong' }];
  for (let i = 0; i <= 4; i++) shapes.push({ k: 'poly', pts: [v2.sub(at(i / 4), nrm), v2.add(at(i / 4), nrm)], role: 'aux' });
  shapes.push({ k: 'text', p: at(tMin), text: tMin.toFixed(2), dy: 18 }, { k: 'text', p: at(tMax), text: tMax.toFixed(2), dy: 18 });
  const handles: Handle[] = [
    pointHandle('min', 'Range min', at(tMin), { shape: 'diamond', cursor: 'ew-resize' }),
    pointHandle('max', 'Range max', at(tMax), { shape: 'diamond', cursor: 'ew-resize' }),
    bodyHandle('span', 'Range', { t: 'segment', a: at(tMin), b: at(tMax), tol: 8 }, 8, 'grab'),
  ];
  const tOf = (p: V2): number => v2.dot(v2.sub(p, origin), dir) / Math.max(len, 1e-9);
  return makeModel(
    decl,
    env,
    {
      shapes,
      handles,
      begin(id, ip): DragSession {
        const t0 = tOf(ip);
        const off = (id === 'min' ? tMin : id === 'max' ? tMax : 0) - t0;
        let lo = tMin;
        let hi = tMax;
        return {
          move(p, m) {
            const t = tOf(p);
            const snap = (x: number): number => (m.ctrl ? snapScalar(x, 0.05) : x);
            if (id === 'min') lo = Math.min(clampN(snap(t + off), 0, 1), tMax);
            else if (id === 'max') hi = Math.max(clampN(snap(t + off), 0, 1), tMin);
            else {
              const d = snap(t - t0 + tMin) - tMin;
              const span = tMax - tMin;
              lo = clampN(tMin + d, 0, 1 - span);
              hi = lo + span;
            }
            return { [mb.param]: mb.write(id === 'max' ? tMin : lo), [xb.param]: xb.write(id === 'min' ? tMax : hi) };
          },
          readout: () => `${lo.toFixed(3)} – ${hi.toFixed(3)}`,
        };
      },
      numeric: (id) => (id === 'max' ? [{ id: 'max', label: 'Max', unit: '', value: tMax, step: 0.01 }] : id === 'min' ? [{ id: 'min', label: 'Min', unit: '', value: tMin, step: 0.01 }] : [{ id: 'min', label: 'Min', unit: '', value: tMin, step: 0.01 }, { id: 'max', label: 'Max', unit: '', value: tMax, step: 0.01 }]),
      applyNumeric: (_id, f, v) => (f === 'min' ? { [mb.param]: mb.write(Math.min(v, tMax)) } : { [xb.param]: xb.write(Math.max(v, tMin)) }),
    },
    'Range',
  );
}

/* ================================================================================================ grid */
export function buildGrid(decl: Decl<'grid'>, env: GizmoEnv): GizmoModel {
  const cb = bind(decl, env, decl.cells, 'scalar');
  const ob = decl.offset ? bind(decl, env, decl.offset, 'pos') : null;
  const cells = cb.read2();
  const offUv = ob ? ob.read2() : ([0, 0] as V2);
  const [W, H] = env.size;
  const cw = W / Math.max(cells[0], 1e-6);
  const ch = H / Math.max(cells[1], 1e-6);
  const o = toIp(offUv, env);
  const shapes: Shape[] = [];
  const maxLines = 96;
  const stepX = Math.max(1, Math.ceil(cells[0] / maxLines));
  const stepY = Math.max(1, Math.ceil(cells[1] / maxLines));
  const startX = ((o[0] % cw) + cw) % cw;
  const startY = ((o[1] % ch) + ch) % ch;
  for (let i = 0, x = startX; x <= W + 1e-6 && i < 4096; i += stepX, x = startX + i * cw) shapes.push({ k: 'poly', pts: [[x, 0], [x, H]], role: 'aux' });
  for (let j = 0, y = startY; y <= H + 1e-6 && j < 4096; j += stepY, y = startY + j * ch) shapes.push({ k: 'poly', pts: [[0, y], [W, y]], role: 'aux' });
  const corner: V2 = [o[0] + cw, o[1] + ch];
  shapes.push({ k: 'poly', pts: [o, [o[0] + cw, o[1]], corner, [o[0], o[1] + ch]], closed: true, role: 'strong' });
  shapes.push({ k: 'text', p: corner, text: cells[0] === cells[1] ? `${cells[0].toFixed(0)} cells` : `${cells[0].toFixed(0)}×${cells[1].toFixed(0)} cells`, dx: 12, dy: 14 });
  const handles: Handle[] = [pointHandle('cell', 'Cell size', corner, { shape: 'square', cursor: 'nwse-resize' })];
  if (ob) handles.push(pointHandle('o', 'Grid offset', o, { shape: 'circle' }));
  const integer = !!decl.tilingSafe && (env.tile[0] || env.tile[1]);
  return makeModel(
    decl,
    env,
    {
      shapes,
      handles,
      bounds: { x0: 0, y0: 0, x1: W, y1: H },
      begin(id, ip): DragSession | null {
        if (id === 'o') {
          if (!ob) return null;
          const off = v2.sub(o, ip);
          return { move: (p, m) => ({ [ob.param]: ob.write(toUv(snapPoint(v2.add(p, off), env.size, env.snap, m, env.zoom, !m.alt), env)) }) };
        }
        let cur = cells;
        return {
          move(p, m) {
            const dx = Math.max((p[0] - o[0]) / W, 1e-3);
            const dy = Math.max((p[1] - o[1]) / H, 1e-3);
            let nx = 1 / dx;
            let ny = 1 / dy;
            if (m.shift || cb.arity() === 1) ny = nx;
            const int = integer || m.ctrl;
            if (int) {
              nx = Math.max(1, Math.round(nx));
              ny = Math.max(1, Math.round(ny));
            }
            cur = [nx, ny];
            return { [cb.param]: cb.arity() === 1 ? cb.write(nx, { integer: int }) : cb.write([nx, ny], { integer: int }) };
          },
          readout: () => `${cur[0].toFixed(int(cur) ? 0 : 1)} × ${cur[1].toFixed(int(cur) ? 0 : 1)}`,
        };
      },
      numeric: (id) => (id === 'o' ? posFields(decl, env, offUv) : cb.arity() === 1 ? [{ id: 'n', label: 'Cells', unit: '', value: cells[0], step: 1 }] : [{ id: 'nx', label: tt('modelsBasic.cellsX'), unit: '', value: cells[0], step: 1 }, { id: 'ny', label: tt('modelsBasic.cellsY'), unit: '', value: cells[1], step: 1 }]),
      applyNumeric(id, f, v) {
        if (id === 'o') return ob ? { [ob.param]: ob.write(posFromField(decl, env, offUv, f, v)) } : {};
        if (cb.arity() === 1) return { [cb.param]: cb.write(v, { integer }) };
        return { [cb.param]: cb.write(f === 'nx' ? [v, cells[1]] : [cells[0], v], { integer }) };
      },
    },
    'Grid',
  );
}
const int = (c: V2): boolean => Number.isInteger(c[0]) && Number.isInteger(c[1]);

/* ================================================================================================ brush */
interface Stroke {
  r: number;
  h: number;
  pts: number[];
}
export function parseStrokes(s: unknown): Stroke[] {
  if (typeof s !== 'string' || !s) return [];
  try {
    const j = JSON.parse(s) as { strokes?: Stroke[] };
    return Array.isArray(j.strokes) ? j.strokes.filter((k) => Array.isArray(k.pts)) : [];
  } catch {
    return [];
  }
}

/**
 * Mask-brush cursor: a circle (radius) + inner circle (hardness) that follows the pointer. Dragging records stroke
 * samples (UV) into the optional `strokes` string param as JSON {"strokes":[{r,h,pts:[x,y,...]}]}. `[` / `]` or
 * Alt+wheel change the radius. The node interprets the strokes (e.g. paints them into a mask).
 */
export function buildBrush(decl: Decl<'brush'>, env: GizmoEnv): GizmoModel {
  const rb = bind(decl, env, decl.radius, 'len');
  const hb = decl.hardness ? bind(decl, env, decl.hardness, 'scalar') : null;
  const sb = decl.strokes ? decl.strokes : null;
  const unit = lengthUnit(decl, env);
  const r = rb.read1() * unit;
  const hard = hb ? clampN(hb.read1(), 0, 1) : 0.5;
  const strokeParam = sb ? (typeof sb === 'string' ? sb : sb.param) : null;
  const strokes = strokeParam ? parseStrokes(env.values[strokeParam]) : [];
  const handles: Handle[] = [{ id: 'paint', label: 'Brush', hit: { t: 'image', w: env.size[0], h: env.size[1] }, priority: 99, cursor: 'none', shape: 'none' }];
  const resize = (f: number): Writes => ({ [rb.param]: rb.write(clampN((r * f) / unit, 0.002, 1)) });
  return makeModel(
    decl,
    env,
    {
      shapes: [],
      handles,
      bounds: { x0: 0, y0: 0, x1: env.size[0], y1: env.size[1] },
      hoverShapes: (ip) => (ip ? [{ k: 'circle', c: ip, r, role: 'main' }, { k: 'circle', c: ip, r: r * hard, role: 'aux', dash: true }] : []),
      begin(_id, ip): DragSession | null {
        if (!strokeParam) return null;
        const mine: Stroke = { r: r / unit, h: hard, pts: [] };
        let last: V2 | null = null;
        const spacing = Math.max(r * 0.25, 0.5);
        const add = (p: V2): void => {
          mine.pts.push(+(p[0] / env.size[0]).toFixed(5), +(p[1] / env.size[1]).toFixed(5));
          last = p;
        };
        add(ip);
        return {
          move(p) {
            if (!last || v2.dist(p, last) >= spacing) add(p);
            return { [strokeParam]: JSON.stringify({ strokes: [...strokes, mine] }) };
          },
          readout: () => `${mine.pts.length / 2} samples`,
        };
      },
      numeric: () => [{ id: 'r', label: 'Radius', unit: '', value: r / unit, step: 0.005 }, ...(hb ? [{ id: 'h', label: 'Hardness', unit: '', value: hard, step: 0.05 }] : [])],
      applyNumeric: (_id, f, v) => (f === 'r' ? { [rb.param]: rb.write(v) } : hb ? { [hb.param]: hb.write(clampN(v, 0, 1)) } : {}),
      onKey: (k) => (k === '[' ? resize(0.85) : k === ']' ? resize(1 / 0.85) : null),
      onWheel: (d, m) => (m.alt ? resize(d < 0 ? 1.1 : 1 / 1.1) : null),
      actions: () => (strokeParam && strokes.length ? [{ id: 'clear', label: tt('modelsBasic.clearStrokes'), danger: true, run: () => ({ [strokeParam]: '' }) }] : []),
    },
    'Brush',
  );
}

