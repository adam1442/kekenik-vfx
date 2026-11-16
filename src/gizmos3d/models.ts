import { t, t as tt } from '../shared/i18n';
import { refParam, type GizmoDecl } from '../engine/graph/gizmo-decl';
import { cloneValue, type ParamValue, type SplinePoint, type SplineValue } from '../engine/params/schema';
import { mat4Compose, quatAxisAngle, quatFromEulerDeg, quatMul, quatRotate, quatToEulerDeg, v3, type V3 } from '../engine/mesh/math3';
import { splineToolbar, toolFromKey, closestOnPolylineToRay, type SplineTool } from '../gizmos/spline-tools';
import { AXES, AXIS_COLORS, closestOnAxis, rayPlane, snapTo, type Decor, type Drag3D, type Env3D, type Gizmo3DModel, type Handle3D, type Mods3, type Ray, type View3D, type Writes } from './core';

const YELLOW = '#ffd54a';
const CYAN = '#4cc9f0';
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vec = (v: unknown, d: V3 = [0, 0, 0]): V3 => (Array.isArray(v) && v.length >= 3 ? [num(v[0]), num(v[1]), num(v[2])] : d);
const w3 = (id: string, v: V3): Writes => ({ [id]: [v[0], v[1], v[2]] });
const snapOn = (env: Env3D, m: Mods3): boolean => env.settings.snap !== m.ctrl; // Ctrl inverts the toolbar toggle
const fmt = (x: number): string => (Math.abs(x) < 5e-4 ? '0' : x.toFixed(3));

/** Orthonormal basis rotated by Euler degrees (world axes when `rot` is undefined). */
export function basisOf(rot: V3 | undefined): V3[] {
  if (!rot) return AXES.map((a) => [...a] as V3);
  const q = quatFromEulerDeg(rot[0], rot[1], rot[2]);
  return AXES.map((a) => quatRotate(q, a));
}
const circlePts = (c: V3, u: V3, v: V3, r: number, n = 48): V3[] => Array.from({ length: n }, (_, i) => v3.add(c, v3.add(v3.scale(u, Math.cos((i / n) * Math.PI * 2) * r), v3.scale(v, Math.sin((i / n) * Math.PI * 2) * r))));

/** Translate handles (axis arrows, plane squares, free centre) around `O`. `onMove` turns a new position into param writes. */
function moveHandles(prefix: string, O: V3, axes: V3[], env: Env3D, onMove: (p: V3) => Writes): Handle3D[] {
  const upp = env.view.unitsPerPixel(O);
  const L = 90 * upp;
  const out: Handle3D[] = [];
  const mk = (id: string, label: string, priority: number, geom: Handle3D['geom'], color: string, shape: Handle3D['shape'], begin: Handle3D['begin']): void => {
    out.push({ id: `${prefix}${id}`, label, priority, geom, color, shape, begin });
  };
  for (let i = 0; i < 3; i++) {
    const A = axes[i];
    mk(`ax${i}`, `Move ${'XYZ'[i]}`, 1, [{ k: 'segment', a: O, b: v3.add(O, v3.scale(A, L)) }, { k: 'point', p: v3.add(O, v3.scale(A, L)) }], AXIS_COLORS[i], 'arrow', (ray) => {
      const t0 = closestOnAxis(ray, O, A);
      let last = 0;
      return {
        move: (r, m) => {
          last = snapTo(closestOnAxis(r, O, A) - t0, env.settings.moveStep, snapOn(env, m));
          return onMove(v3.add(O, v3.scale(A, last)));
        },
        readout: () => `${'XYZ'[i]} ${last >= 0 ? '+' : ''}${fmt(last)}`,
      };
    });
  }
  for (let k = 0; k < 3; k++) {
    const i = (k + 1) % 3, j = (k + 2) % 3;
    const a = v3.scale(axes[i], 0.28 * L), b = v3.scale(axes[j], 0.28 * L), a2 = v3.scale(axes[i], 0.5 * L), b2 = v3.scale(axes[j], 0.5 * L);
    mk(`pl${k}`, `Move ${'XYZ'[i]}${'XYZ'[j]}`, 2, [{ k: 'quad', pts: [v3.add(O, v3.add(a, b)), v3.add(O, v3.add(a2, b)), v3.add(O, v3.add(a2, b2)), v3.add(O, v3.add(a, b2))] }], AXIS_COLORS[k], 'dot', (ray) => {
      const h0 = rayPlane(ray, O, axes[k]);
      if (!h0) return null;
      let d: V3 = [0, 0, 0];
      return {
        move: (r, m) => {
          const h = rayPlane(r, O, axes[k]);
          if (h) {
            const dd = v3.sub(h, h0);
            const s = snapOn(env, m);
            d = v3.add(v3.scale(axes[i], snapTo(v3.dot(dd, axes[i]), env.settings.moveStep, s)), v3.scale(axes[j], snapTo(v3.dot(dd, axes[j]), env.settings.moveStep, s)));
          }
          return onMove(v3.add(O, d));
        },
        readout: () => `Δ ${fmt(d[0])}, ${fmt(d[1])}, ${fmt(d[2])}`,
      };
    });
  }
  mk('free', 'Move (view plane)', 3, [{ k: 'point', p: O }], YELLOW, 'ring', (ray, view) => {
    const n = view.forward;
    const h0 = rayPlane(ray, O, n);
    if (!h0) return null;
    let d: V3 = [0, 0, 0];
    return {
      move: (r, m) => {
        const h = rayPlane(r, O, n);
        if (h) {
          const dd = v3.sub(h, h0);
          const s = snapOn(env, m);
          d = [snapTo(dd[0], env.settings.moveStep, s), snapTo(dd[1], env.settings.moveStep, s), snapTo(dd[2], env.settings.moveStep, s)];
        }
        return onMove(v3.add(O, d));
      },
      readout: () => `Δ ${fmt(d[0])}, ${fmt(d[1])}, ${fmt(d[2])}`,
    };
  });
  return out;
}

function transform3d(decl: Extract<GizmoDecl, { type: 'transform3d' }>, env: Env3D): Gizmo3DModel | null {
  const pos = refParam(decl.position), rot = refParam(decl.rotation), scl = refParam(decl.scale), uni = refParam(decl.uniform), piv = refParam(decl.pivot);
  const pos0 = pos ? vec(env.values[pos]) : undefined;
  const pivot = piv ? vec(env.values[piv]) : ([0, 0, 0] as V3);
  const O: V3 = pos0 ? v3.add(pos0, pivot) : env.anchor;
  const rot0 = rot ? vec(env.values[rot]) : undefined;
  const supported = (['translate', 'rotate', 'scale'] as const).filter((m) => (m === 'translate' ? !!pos : m === 'rotate' ? !!rot : !!scl || !!uni));
  if (!supported.length) return null;
  const mode = supported.includes(env.settings.mode) ? env.settings.mode : supported[0];
  const handles: Handle3D[] = [];
  const decor: Decor[] = [{ geom: { k: 'point', p: O }, color: YELLOW }];
  const key = `${env.nodeId}/${decl.id}`;
  if (mode === 'translate' && pos) {
    const axes = env.settings.space === 'local' && rot0 ? basisOf(rot0) : basisOf(undefined);
    handles.push(...moveHandles('t', O, axes, env, (p) => w3(pos, v3.sub(p, pivot))));
  } else if (mode === 'rotate' && rot && rot0) {
    const axes = env.settings.space === 'local' ? basisOf(rot0) : basisOf(undefined);
    const R = 80 * env.view.unitsPerPixel(O);
    for (let i = 0; i < 3; i++) {
      const A = axes[i], u = axes[(i + 1) % 3], v = axes[(i + 2) % 3];
      handles.push({
        id: `r${i}`, label: `Rotate ${'XYZ'[i]}`, priority: 1, color: AXIS_COLORS[i], shape: 'dot',
        geom: [{ k: 'poly', pts: circlePts(O, u, v, R), closed: true }],
        begin: (ray) => {
          const h0 = rayPlane(ray, O, A);
          if (!h0) return null;
          const ang = (h: V3): number => Math.atan2(v3.dot(v3.sub(h, O), v), v3.dot(v3.sub(h, O), u));
          const a0 = ang(h0);
          const q0 = quatFromEulerDeg(rot0[0], rot0[1], rot0[2]);
          let deg = 0;
          return {
            move: (r, m) => {
              const h = rayPlane(r, O, A);
              if (h) {
                let d = ang(h) - a0;
                d = Math.atan2(Math.sin(d), Math.cos(d));
                deg = snapTo((d * 180) / Math.PI, env.settings.rotStep, snapOn(env, m));
              }
              const e = quatToEulerDeg(quatMul(quatAxisAngle(A, (deg * Math.PI) / 180), q0));
              // keep the Euler triple continuous with the start values
              const un = e.map((x, k) => x + Math.round((rot0[k] - x) / 360) * 360) as V3;
              return w3(rot, un);
            },
            readout: () => `${'XYZ'[i]} ${deg >= 0 ? '+' : ''}${deg.toFixed(1)}°`,
          };
        },
      });
    }
  } else if (mode === 'scale') {
    const axes = rot0 ? basisOf(rot0) : basisOf(undefined);
    const L = 90 * env.view.unitsPerPixel(O);
    const s0 = scl ? vec(env.values[scl], [1, 1, 1]) : ([1, 1, 1] as V3);
    if (scl) {
      for (let i = 0; i < 3; i++) {
        const A = axes[i];
        handles.push({
          id: `s${i}`, label: `Scale ${'XYZ'[i]}`, priority: 1, color: AXIS_COLORS[i], shape: 'cube',
          geom: [{ k: 'segment', a: O, b: v3.add(O, v3.scale(A, L)) }, { k: 'point', p: v3.add(O, v3.scale(A, L)) }],
          begin: (ray) => {
            const t0 = closestOnAxis(ray, O, A);
            if (Math.abs(t0) < 1e-6) return null;
            let val = s0[i];
            return {
              move: (r, m) => {
                const ratio = closestOnAxis(r, O, A) / t0;
                val = snapTo(s0[i] * ratio, env.settings.scaleStep, snapOn(env, m));
                const n: V3 = [...s0];
                n[i] = val;
                return w3(scl, n);
              },
              readout: () => `${'XYZ'[i]} ×${fmt(val)}`,
            };
          },
        });
      }
    }
    handles.push({
      id: 'su', label: tt('gizmos3dM.scaleUniform'), priority: 2, color: YELLOW, shape: 'cube', geom: [{ k: 'point', p: O }],
      begin: (ray, view) => {
        const h0 = rayPlane(ray, O, view.forward);
        if (!h0) return null;
        const r0 = Math.max(v3.len(v3.sub(h0, O)), 0.25 * L);
        const u0 = uni ? num(env.values[uni], 1) : 1;
        let k = 1;
        return {
          move: (r, m) => {
            const h = rayPlane(r, O, view.forward);
            if (h) k = snapTo(v3.len(v3.sub(h, O)) / r0, env.settings.scaleStep / 4, snapOn(env, m));
            if (uni) return { [uni]: u0 * k };
            return scl ? w3(scl, v3.scale(s0, k)) : {};
          },
          readout: () => `×${fmt(k)}`,
        };
      },
    });
  }
  return { key, nodeId: env.nodeId, label: decl.label ?? 'Transform', handles, decor };
}

function point3d(decl: Extract<GizmoDecl, { type: 'point3d' }>, env: Env3D): Gizmo3DModel | null {
  const id = refParam(decl.param)!;
  const O = vec(env.values[id]);
  const decor: Decor[] = [];
  if (decl.label) decor.push({ geom: { k: 'point', p: O }, color: CYAN });
  return { key: `${env.nodeId}/${decl.id}`, nodeId: env.nodeId, label: decl.label ?? id, handles: moveHandles(`${decl.id}.`, O, basisOf(undefined), env, (p) => w3(id, p)), decor };
}

function sphereHandles(prefix: string, C: V3, paramId: string, r: number, env: Env3D, color: string, label: string): Handle3D[] {
  const out: Handle3D[] = [];
  for (let i = 0; i < 3; i++) for (const sgn of [1, -1]) {
    const A = v3.scale(AXES[i], sgn);
    out.push({
      id: `${prefix}${i}${sgn}`, label, priority: 1, color, shape: 'dot', geom: [{ k: 'point', p: v3.add(C, v3.scale(A, r)) }],
      begin: () => {
        let val = r;
        return {
          move: (ray, m) => {
            val = Math.max(0, snapTo(closestOnAxis(ray, C, A), env.settings.moveStep, snapOn(env, m)));
            return { [paramId]: val };
          },
          readout: () => `${label} ${fmt(val)}`,
        };
      },
    });
  }
  return out;
}
const sphereDecor = (C: V3, r: number, color: string, dash = false): Decor[] => [
  { geom: { k: 'poly', pts: circlePts(C, AXES[0], AXES[1], r, 64), closed: true }, color, dash },
  { geom: { k: 'poly', pts: circlePts(C, AXES[0], AXES[2], r, 64), closed: true }, color, dash },
  { geom: { k: 'poly', pts: circlePts(C, AXES[1], AXES[2], r, 64), closed: true }, color, dash },
];

function radius3d(decl: Extract<GizmoDecl, { type: 'radius3d' }>, env: Env3D): Gizmo3DModel | null {
  const rid = refParam(decl.radius)!;
  const cid = refParam(decl.center);
  const C = cid ? vec(env.values[cid]) : ([0, 0, 0] as V3);
  const r = num(env.values[rid]);
  return { key: `${env.nodeId}/${decl.id}`, nodeId: env.nodeId, label: decl.label ?? 'Radius', handles: sphereHandles(`${decl.id}.`, C, rid, r, env, YELLOW, 'Radius'), decor: sphereDecor(C, r, '#ffd54a99') };
}
function falloff3d(decl: Extract<GizmoDecl, { type: 'falloff3d' }>, env: Env3D): Gizmo3DModel | null {
  const iid = refParam(decl.inner)!, oid = refParam(decl.outer)!, cid = refParam(decl.center);
  const C = cid ? vec(env.values[cid]) : ([0, 0, 0] as V3);
  const ri = num(env.values[iid]), ro = num(env.values[oid]);
  return {
    key: `${env.nodeId}/${decl.id}`, nodeId: env.nodeId, label: decl.label ?? 'Falloff',
    handles: [...sphereHandles(`${decl.id}.i`, C, iid, ri, env, '#7bd88f', 'Inner'), ...sphereHandles(`${decl.id}.o`, C, oid, ro, env, YELLOW, 'Outer')],
    decor: [...sphereDecor(C, ri, '#7bd88f99', true), ...sphereDecor(C, ro, '#ffd54a99')],
  };
}

function axis3d(decl: Extract<GizmoDecl, { type: 'axis3d' }>, env: Env3D): Gizmo3DModel | null {
  const did = refParam(decl.direction)!, oid = refParam(decl.origin);
  const O = oid ? vec(env.values[oid]) : ([0, 0, 0] as V3);
  const len = decl.length ?? 1;
  const dir = vec(env.values[did], [0, 0, 1]);
  const tip = v3.add(O, v3.scale(dir, len));
  const h: Handle3D = {
    id: `${decl.id}.tip`, label: decl.label ?? 'Direction', priority: 1, color: YELLOW, shape: 'arrow', geom: [{ k: 'point', p: tip }],
    begin: (ray, view) => {
      const h0 = rayPlane(ray, tip, view.forward);
      if (!h0) return null;
      let d = dir;
      return {
        move: (r, m) => {
          const h1 = rayPlane(r, tip, view.forward);
          if (h1) {
            const s = snapOn(env, m);
            const t = v3.scale(v3.sub(v3.add(tip, v3.sub(h1, h0)), O), 1 / len);
            d = [snapTo(t[0], env.settings.moveStep / len, s), snapTo(t[1], env.settings.moveStep / len, s), snapTo(t[2], env.settings.moveStep / len, s)];
          }
          return w3(did, d);
        },
        readout: () => `dir ${fmt(d[0])}, ${fmt(d[1])}, ${fmt(d[2])}`,
      };
    },
  };
  return { key: `${env.nodeId}/${decl.id}`, nodeId: env.nodeId, label: decl.label ?? 'Direction', handles: [h], decor: [{ geom: { k: 'segment', a: O, b: tip }, color: YELLOW }] };
}

function box3d(decl: Extract<GizmoDecl, { type: 'box3d' }>, env: Env3D): Gizmo3DModel | null {
  const C = vec(env.values[decl.position]);
  const S = vec(env.values[decl.size], [1, 1, 1]);
  const hs = v3.scale(S, 0.5);
  const corner = (sx: number, sy: number, sz: number): V3 => [C[0] + sx * hs[0], C[1] + sy * hs[1], C[2] + sz * hs[2]];
  const decor: Decor[] = [];
  const cs: V3[] = [];
  for (let k = 0; k < 8; k++) cs.push(corner(k & 1 ? 1 : -1, k & 2 ? 1 : -1, k & 4 ? 1 : -1));
  for (let k = 0; k < 8; k++) for (const bit of [1, 2, 4]) if (!(k & bit)) decor.push({ geom: { k: 'segment', a: cs[k], b: cs[k | bit] }, color: '#ffd54aaa' });
  const handles: Handle3D[] = moveHandles(`${decl.id}.c`, C, basisOf(undefined), env, (p) => w3(decl.position, p)).filter((h) => h.id.endsWith('.cfree'));
  for (let i = 0; i < 3; i++) for (const sgn of [1, -1]) {
    const A = v3.scale(AXES[i], sgn);
    handles.push({
      id: `${decl.id}.f${i}${sgn}`, label: `Size ${'XYZ'[i]}`, priority: 1, color: AXIS_COLORS[i], shape: 'cube', geom: [{ k: 'point', p: v3.add(C, v3.scale(A, hs[i])) }],
      begin: () => {
        let val = S[i];
        return {
          move: (ray, m) => {
            val = Math.max(1e-4, snapTo(2 * closestOnAxis(ray, C, A), env.settings.moveStep, snapOn(env, m)));
            const n: V3 = [...S];
            n[i] = val;
            return w3(decl.size, n);
          },
          readout: () => `Size ${'XYZ'[i]} ${fmt(val)}`,
        };
      },
    });
  }
  return { key: `${env.nodeId}/${decl.id}`, nodeId: env.nodeId, label: decl.label ?? 'Bounds', handles, decor };
}

/* ------------------------------------------------------------------------------------------------ spline3d */
const spPos = (p: SplinePoint): V3 => [p.x, p.y, p.attrs?.z ?? 0];
/** Relative bezier handles (world) of point i: explicit when mode 'free' (x,y + attrs.hinz / houtz), else Catmull-Rom tangents / 6. */
export function splineHandles3(points: SplinePoint[], i: number, closed: boolean): { hin: V3; hout: V3 } {
  const n = points.length;
  const p = points[i];
  if (p.mode === 'free') return { hin: [p.hin?.[0] ?? 0, p.hin?.[1] ?? 0, p.attrs?.hinz ?? 0], hout: [p.hout?.[0] ?? 0, p.hout?.[1] ?? 0, p.attrs?.houtz ?? 0] };
  if (p.mode === 'corner') return { hin: [0, 0, 0], hout: [0, 0, 0] };
  const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
  const m = v3.scale(v3.sub(spPos(next), spPos(prev)), 1 / 6);
  return { hin: v3.scale(m, -1), hout: m };
}
/** Sample the 3D spline (cubic bezier segments), `perSeg` samples per segment. */
export function sampleSpline3(points: SplinePoint[], closed: boolean, perSeg = 16): V3[] {
  const n = points.length;
  if (n < 2) return n === 1 ? [spPos(points[0])] : [];
  const out: V3[] = [];
  const segs = closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const a = points[s], b = points[(s + 1) % n];
    const ha = splineHandles3(points, s, closed), hb = splineHandles3(points, (s + 1) % n, closed);
    const p0 = spPos(a), p3 = spPos(b), p1 = v3.add(p0, ha.hout), p2 = v3.add(p3, hb.hin);
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, u = 1 - t;
      out.push([0, 1, 2].map((c) => u * u * u * p0[c] + 3 * u * u * t * p1[c] + 3 * u * t * t * p2[c] + t * t * t * p3[c]) as V3);
    }
  }
  out.push(spPos(points[closed ? 0 : n - 1]));
  return out;
}

/** Insert a point on segment `seg` at `t` of a 3D spline, preserving the curve exactly (de Casteljau in 3D). Pure; returns a new array. */
export function insertPoint3(points: SplinePoint[], closed: boolean, seg: number, t: number): { points: SplinePoint[]; index: number } {
  const pts: SplinePoint[] = JSON.parse(JSON.stringify(points)) as SplinePoint[];
  const n = pts.length;
  const j = (seg + 1) % n;
  const ha = splineHandles3(points, seg, closed), hb = splineHandles3(points, j, closed);
  const p0 = spPos(points[seg]), p3 = spPos(points[j]);
  const p1 = v3.add(p0, ha.hout), p2 = v3.add(p3, hb.hin);
  const lerp = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const q0 = lerp(p0, p1), q1 = lerp(p1, p2), q2 = lerp(p2, p3);
  const r0 = lerp(q0, q1), r1 = lerp(q1, q2);
  const m = lerp(r0, r1);
  const setH = (pt: SplinePoint, k: 'hin' | 'hout', rel: V3): void => {
    pt[k] = [rel[0], rel[1]];
    pt.attrs = { ...(pt.attrs ?? {}), [k === 'hin' ? 'hinz' : 'houtz']: rel[2] };
  };
  const a = pts[seg], b = pts[j];
  // neighbours keep their look: materialise their handles, then shorten the ones facing the new point
  const matA = splineHandles3(points, seg, closed), matB = splineHandles3(points, j, closed);
  a.mode = 'free';
  b.mode = 'free';
  setH(a, 'hin', matA.hin);
  setH(b, 'hout', matB.hout);
  setH(a, 'hout', v3.sub(q0, p0));
  setH(b, 'hin', v3.sub(q2, p3));
  const lerpAttr = (k: string, d = 0): number => (a.attrs?.[k] ?? d) + ((b.attrs?.[k] ?? d) - (a.attrs?.[k] ?? d)) * t;
  const np: SplinePoint = { x: m[0], y: m[1], mode: 'free', attrs: { z: m[2], scale: lerpAttr('scale', 1), twist: lerpAttr('twist', 0) } };
  setH(np, 'hin', v3.sub(r0, m));
  setH(np, 'hout', v3.sub(r1, m));
  if (a.w !== undefined || b.w !== undefined) np.w = (a.w ?? 0) + ((b.w ?? 0) - (a.w ?? 0)) * t;
  pts.splice(seg + 1, 0, np);
  return { points: pts, index: seg + 1 };
}

function spline3d(decl: Extract<GizmoDecl, { type: 'spline3d' }>, env: Env3D): Gizmo3DModel | null {
  const id = refParam(decl.param)!;
  const sv = env.values[id] as unknown as SplineValue | undefined;
  if (!sv || !Array.isArray(sv.points)) return null;
  const pts = sv.points;
  const sel = typeof env.state.selected === 'number' ? (env.state.selected as number) : -1;
  const tool: SplineTool = env.state.tool === 'add' || env.state.tool === 'delete' ? env.state.tool : 'select';
  const handles: Handle3D[] = [];
  const decor: Decor[] = [{ geom: { k: 'poly', pts: sampleSpline3(pts, !!sv.closed), closed: false }, color: YELLOW }];
  /** Apply `edit` to a deep copy of the spline and write it back. */
  const write = (edit: (pt: SplinePoint[]) => void): Writes => {
    const c = cloneValue(sv as unknown as ParamValue) as unknown as SplineValue;
    edit(c.points);
    return { [id]: c as unknown as ParamValue };
  };
  const planeDrag = (anchor: V3, view: View3D, ray: Ray, apply: (hit: V3, off: V3) => Writes, ro: () => string): Drag3D | null => {
    const h0 = rayPlane(ray, anchor, view.forward);
    if (!h0) return null;
    const off = v3.sub(anchor, h0);
    let last: Writes = {};
    return {
      move: (r, m) => {
        const h = rayPlane(r, anchor, view.forward);
        if (h) {
          const t = v3.add(h, off);
          const s = snapOn(env, m);
          last = apply([snapTo(t[0], env.settings.moveStep, s), snapTo(t[1], env.settings.moveStep, s), snapTo(t[2], env.settings.moveStep, s)], off);
        }
        return last;
      },
      readout: ro,
    };
  };
  pts.forEach((pt, i) => {
    const P = spPos(pt);
    const upp = env.view.unitsPerPixel(P);
    const scale = pt.attrs?.scale ?? 1;
    const twist = ((pt.attrs?.twist ?? 0) * Math.PI) / 180;
    handles.push({
      id: `p${i}`, label: `Point ${i + 1}`, priority: 1, color: i === sel ? '#ffffff' : YELLOW, shape: 'dot', geom: [{ k: 'point', p: P }],
      begin: (ray, view) => {
        if (tool === 'delete') {
          // Delete tool: a click on a point removes it (never below 2 points)
          if (pts.length <= 2) return null;
          env.state.selected = Math.min(i, pts.length - 2);
          return { initial: write((a) => void a.splice(i, 1)), move: () => ({}) };
        }
        env.state.selected = i;
        const d = planeDrag(P, view, ray, (t) => write((a) => {
          a[i].x = t[0];
          a[i].y = t[1];
          a[i].attrs = { ...(a[i].attrs ?? {}), z: t[2] };
        }), () => `Point ${i + 1}`);
        if (d) d.initial = {};
        return d;
      },
    });
    const sPos = v3.sub(P, v3.scale(env.view.right, scale * 40 * upp));
    handles.push({
      id: `s${i}`, label: `Scale ${i + 1}`, priority: 2, color: '#7bd88f', shape: 'cube', geom: [{ k: 'point', p: sPos }],
      begin: (ray, view) => {
        let sc = scale;
        const d = planeDrag(sPos, view, ray, (t) => {
          sc = Math.max(0.01, snapTo(v3.dot(v3.sub(P, t), view.right) / (40 * upp), env.settings.scaleStep, env.settings.snap));
          return write((a) => {
            a[i].attrs = { ...(a[i].attrs ?? {}), scale: sc };
          });
        }, () => `Scale ${sc.toFixed(2)}`);
        return d;
      },
    });
    const tPos = v3.add(P, v3.add(v3.scale(env.view.right, Math.cos(twist) * 52 * upp), v3.scale(env.view.up, Math.sin(twist) * 52 * upp)));
    handles.push({
      id: `w${i}`, label: `Twist ${i + 1}`, priority: 3, color: '#c586c0', shape: 'ring', geom: [{ k: 'point', p: tPos }],
      begin: (ray, view) => {
        let deg = pt.attrs?.twist ?? 0;
        return planeDrag(tPos, view, ray, (t) => {
          const rel = v3.sub(t, P);
          deg = snapTo((Math.atan2(v3.dot(rel, view.up), v3.dot(rel, view.right)) * 180) / Math.PI, env.settings.rotStep, env.settings.snap);
          return write((a) => {
            a[i].attrs = { ...(a[i].attrs ?? {}), twist: deg };
          });
        }, () => `Twist ${deg.toFixed(1)}°`);
      },
    });
    decor.push({ geom: { k: 'segment', a: P, b: sPos }, color: '#7bd88f66', dash: true }, { geom: { k: 'segment', a: P, b: tPos }, color: '#c586c066', dash: true });
    if (i === sel) {
      const hh = splineHandles3(pts, i, !!sv.closed);
      for (const side of ['hin', 'hout'] as const) {
        const rel = hh[side];
        const tp = v3.add(P, rel);
        decor.push({ geom: { k: 'segment', a: P, b: tp }, color: '#4cc9f0aa' });
        handles.push({
          id: `${side}${i}`, label: side === 'hin' ? 'In tangent' : 'Out tangent', priority: 0, color: CYAN, shape: 'dot', geom: [{ k: 'point', p: tp }],
          begin: (ray, view) =>
            planeDrag(tp, view, ray, (t, _off) => {
              const nr = v3.sub(t, P);
              return write((a) => {
                const q = a[i];
                const ho = splineHandles3(pts, i, !!sv.closed);
                q.mode = 'free';
                const set = (k: 'hin' | 'hout', v: V3): void => {
                  q[k] = [v[0], v[1]];
                  q.attrs = { ...(q.attrs ?? {}), [k === 'hin' ? 'hinz' : 'houtz']: v[2] };
                };
                set('hin', side === 'hin' ? nr : ho.hin);
                set('hout', side === 'hout' ? nr : ho.hout);
                if (!env.settings.snap) set(side === 'hin' ? 'hout' : 'hin', v3.scale(nr, -1)); // mirrored unless snapping toggle is on
              });
            }, () => 'Tangent'),
        });
      }
    }
  });
  // Add tool: segments become pickable (insert exactly where clicked) and empty space appends a point
  const PER_SEG = 16;
  const samples = sampleSpline3(pts, !!sv.closed, PER_SEG);
  const segCount = sv.closed ? pts.length : pts.length - 1;
  if (tool === 'add') {
    for (let s = 0; s < segCount; s++) {
      const segPts = samples.slice(s * PER_SEG, s * PER_SEG + PER_SEG + 1);
      handles.push({
        id: `seg${s}`, label: t('spline.insert'), priority: 9, color: YELLOW, shape: 'dot', geom: [{ k: 'poly', pts: segPts }],
        begin: (ray, view) => {
          const hit = closestOnPolylineToRay(segPts, ray);
          if (!hit) return null;
          const r = insertPoint3(pts, !!sv.closed, s, Math.min(0.98, Math.max(0.02, (hit.seg + hit.t) / PER_SEG)));
          env.state.selected = r.index;
          const first = write((a) => void a.splice(0, a.length, ...r.points));
          const idx = r.index;
          // drag the new point in the view plane through its start position
          const anchor: V3 = [r.points[idx].x, r.points[idx].y, r.points[idx].attrs?.z ?? 0];
          const h0 = rayPlane(ray, anchor, view.forward);
          return {
            initial: first,
            move: (rr, m) => {
              const h = rayPlane(rr, anchor, view.forward);
              if (!h || !h0) return first;
              const off = v3.sub(h, h0);
              const sn = snapOn(env, m);
              const t: V3 = [snapTo(anchor[0] + off[0], env.settings.moveStep, sn), snapTo(anchor[1] + off[1], env.settings.moveStep, sn), snapTo(anchor[2] + off[2], env.settings.moveStep, sn)];
              return write((a) => {
                a.splice(0, a.length, ...r.points.map((p) => ({ ...p, attrs: { ...(p.attrs ?? {}) } })));
                a[idx].x = t[0];
                a[idx].y = t[1];
                a[idx].attrs = { ...(a[idx].attrs ?? {}), z: t[2] };
              });
            },
            readout: () => `Point ${idx + 1}`,
          };
        },
      });
    }
  }
  const mkWrite = (v: SplineValue): Writes => ({ [id]: v as unknown as ParamValue });
  return {
    key: `${env.nodeId}/${decl.id}`, nodeId: env.nodeId, label: decl.label ?? 'Spline', handles, decor,
    toolbar: splineToolbar({
      tool,
      setTool: (x) => void (env.state.tool = x),
      sp: sv,
      sel,
      snapOn: env.settings.snap,
      toggleSnap: () => void (env.settings.snap = !env.settings.snap),
      write: mkWrite,
      mirrorCentre: 0,
    }),
    background: tool !== 'add' ? undefined : (ray, view, mods) => {
      // append after the last point, on the view plane through it (or through the anchor for an empty path)
      const last = pts.length ? spPos(pts[pts.length - 1]) : env.anchor;
      const h0 = rayPlane(ray, last, view.forward);
      if (!h0) return null;
      const sn = snapOn(env, mods);
      const place = (h: V3): V3 => [snapTo(h[0], env.settings.moveStep, sn), snapTo(h[1], env.settings.moveStep, sn), snapTo(h[2], env.settings.moveStep, sn)];
      const withPoint = (h: V3): Writes => {
        const q = place(h);
        return write((a) => void a.push({ x: q[0], y: q[1], mode: 'auto', attrs: { z: q[2], scale: 1, twist: 0 } }));
      };
      env.state.selected = pts.length;
      return { initial: withPoint(h0), move: (rr) => withPoint(rayPlane(rr, last, view.forward) ?? h0), readout: () => `Point ${pts.length + 1}` };
    },
    onKey: (key, mods) => {
      const tk = toolFromKey(key);
      if (tk && !mods.ctrl && !mods.alt) {
        env.state.tool = tk;
        return 'state';
      }
      if ((key === 'Delete' || key === 'Backspace') && sel >= 0 && sel < pts.length && pts.length > 2) {
        env.state.selected = Math.min(sel, pts.length - 2);
        return write((a) => void a.splice(sel, 1));
      }
      return null;
    },
  };
}

/** Builds the 3D model of one declaration (null: not a 3D gizmo / hidden / not for this viewport). Never throws. */
export function buildModel3D(decl: GizmoDecl, env: Env3D): Gizmo3DModel | null {
  if (decl.viewport === '2d') return null;
  if (decl.visibleIf) {
    try {
      if (!decl.visibleIf(env.values)) return null;
    } catch {
      return null;
    }
  }
  try {
    switch (decl.type) {
      case 'transform3d':
        return transform3d(decl, env);
      case 'point3d':
        return point3d(decl, env);
      case 'radius3d':
        return radius3d(decl, env);
      case 'falloff3d':
        return falloff3d(decl, env);
      case 'axis3d':
        return axis3d(decl, env);
      case 'box3d':
        return box3d(decl, env);
      case 'spline3d':
        return spline3d(decl, env);
      default:
        return null;
    }
  } catch (e) {
    console.error(`[gizmo3d] ${decl.id} (${decl.type}) failed to build:`, e);
    return null;
  }
}

/** Matrix helper for tests / drawing a local frame. */
export const frameMatrix = (pos: V3, rot: V3) => mat4Compose(pos, quatFromEulerDeg(rot[0], rot[1], rot[2]), [1, 1, 1]);
