import type { GizmoDecl } from '../engine/graph/gizmo-decl';
import { clampN, DEG, unwrapNear, v2, type V2 } from './geom';
import { bind, bodyHandle, makeModel, pointHandle, toIp, toUv } from './kit';
import { axisLock, snapAngle, snapPoint, snapScalar } from './snap';
import type { DragSession, GizmoEnv, GizmoModel, Handle, NumericField, Shape, Writes } from './types';

import { t as tt } from '../shared/i18n';
type Decl<T extends GizmoDecl['type']> = Extract<GizmoDecl, { type: T }>;

/** [sx, sy] sign of each scale handle: which edge/corner it grabs. */
export const SCALE_HANDLES: Record<string, V2> = { tl: [-1, -1], t: [0, -1], tr: [1, -1], r: [1, 0], br: [1, 1], b: [0, 1], bl: [-1, 1], l: [-1, 0] };

/** Resize cursor for a handle with sign `s` on a frame rotated by `rot` radians. */
export function resizeCursor(s: V2, rot: number): string {
  const a = Math.atan2(s[1], s[0]) + rot; // direction the handle points to
  const k = (((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8) % 4; // 0: ew, 1: nwse, 2: ns, 3: nesw
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][k];
}

const frameCorners = (c: V2, half: V2, rot: number): V2[] =>
  ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as V2[]).map((s) => v2.add(c, v2.rot([s[0] * half[0], s[1] * half[1]], rot)));

/**
 * Shared scale solver. `s` = handle sign, `l` = pointer in the frame's local axes relative to the anchor/pivot,
 * `g0` = grab position in the same space. Returns per-axis factors.
 */
export function scaleFactors(s: V2, l: V2, g0: V2, uniform: boolean): V2 {
  const f: V2 = [1, 1];
  for (let a = 0; a < 2; a++) if (s[a] !== 0 && Math.abs(g0[a]) > 1e-9) f[a] = clampN(l[a] / g0[a], 0.01, 100);
  if (uniform) {
    const act = (s[0] !== 0 ? 1 : 0) + (s[1] !== 0 ? 1 : 0);
    const u = act === 2 ? clampN(v2.dot(l, g0) / Math.max(v2.dot(g0, g0), 1e-12), 0.01, 100) : s[0] !== 0 ? f[0] : f[1];
    return [u, u];
  }
  return f;
}

/* ================================================================================================ rect */
export function buildRect(decl: Decl<'rect'>, env: GizmoEnv): GizmoModel {
  const cb = bind(decl, env, decl.center, 'pos');
  const sb = bind(decl, env, decl.size, 'size');
  const rb = decl.rotation ? bind(decl, env, decl.rotation, 'angle') : null;
  const c = toIp(cb.read2(), env);
  const sizeIp = v2.mulv(sb.read2(), env.size);
  const half: V2 = [Math.max(sizeIp[0] / 2, 0), Math.max(sizeIp[1] / 2, 0)];
  const rot = rb ? rb.read1() : 0;
  const W = (l: V2): V2 => v2.add(c, v2.rot(l, rot));
  const handles: Handle[] = [];
  for (const [id, s] of Object.entries(SCALE_HANDLES)) {
    handles.push(pointHandle(id, 'Size', W([s[0] * half[0], s[1] * half[1]]), { priority: 1, shape: 'square', cursor: resizeCursor(s, rot) }));
  }
  const shapes: Shape[] = [{ k: 'poly', pts: frameCorners(c, half, rot), closed: true, role: 'main' }];
  const rotOff = 30 / env.zoom;
  if (rb) {
    const top = W([0, -half[1]]);
    const knob = W([0, -half[1] - rotOff]);
    shapes.push({ k: 'poly', pts: [top, knob], role: 'aux' });
    handles.push(pointHandle('rotate', 'Rotate', knob, { priority: 0, shape: 'circle', cursor: 'alias' }));
  }
  handles.push(bodyHandle('body', 'Move', { t: 'box', c, half, rot }, 10));
  handles.push(pointHandle('c', 'Center', c, { priority: 2, shape: 'circle' }));
  return makeModel(
    decl,
    env,
    {
      shapes,
      handles,
      begin(id, ip): DragSession | null {
        if (id === 'body' || id === 'c') {
          const off = v2.sub(c, ip);
          return {
            move(p, m) {
              let q = v2.add(p, off);
              if (m.shift) q = axisLock(q, c);
              return { [cb.param]: cb.write(toUv(snapPoint(q, env.size, env.snap, m, env.zoom, !m.alt), env)) };
            },
          };
        }
        if (id === 'rotate' && rb) {
          const a0 = Math.atan2(ip[1] - c[1], ip[0] - c[0]);
          let cur = rot;
          return {
            move(p, m) {
              let r = unwrapNear(Math.atan2(p[1] - c[1], p[0] - c[0]) - a0 + rot, rot);
              if (m.ctrl || m.shift) r = snapAngle(r, env.snap.angleDeg);
              cur = r;
              return { [rb.param]: rb.write(r) };
            },
            readout: () => `${((cur / DEG) % 360).toFixed(1)}°`,
          };
        }
        const s = SCALE_HANDLES[id];
        if (!s) return null;
        const aspect = half[0] / Math.max(half[1], 1e-9);
        let curSize = sizeIp;
        return {
          move(p, m) {
            // pointer in the frame's local axes, relative to the ORIGINAL centre
            const q = m.ctrl ? snapPoint(p, env.size, env.snap, m, env.zoom, false) : p;
            const l = v2.rot(v2.sub(q, c), -rot);
            const ns: V2 = [half[0] * 2, half[1] * 2];
            const shift: V2 = [0, 0];
            for (let a = 0; a < 2; a++) {
              if (s[a] === 0) continue;
              if (m.alt) ns[a] = Math.max(2 * s[a] * l[a], 1e-3); // from centre: symmetric
              else {
                ns[a] = Math.max(s[a] * l[a] + half[a], 1e-3); // opposite edge anchored
                shift[a] = -s[a] * half[a] + (s[a] * ns[a]) / 2;
              }
            }
            if (m.shift) {
              // uniform: keep the starting aspect ratio, anchored at the opposite corner/edge (or centre with Alt)
              const k = Math.max(s[0] !== 0 ? ns[0] / (half[0] * 2) : 0, s[1] !== 0 ? ns[1] / (half[1] * 2) : 0, 1e-3);
              ns[0] = half[0] * 2 * k;
              ns[1] = (half[0] * 2 * k) / Math.max(aspect, 1e-9);
              if (!m.alt) {
                shift[0] = s[0] !== 0 ? (s[0] * (ns[0] - half[0] * 2)) / 2 : 0;
                shift[1] = s[1] !== 0 ? (s[1] * (ns[1] - half[1] * 2)) / 2 : 0;
              } else {
                shift[0] = 0;
                shift[1] = 0;
              }
            }
            curSize = ns;
            const nc = m.alt ? c : v2.add(c, v2.rot(shift, rot));
            return { [cb.param]: cb.write(toUv(nc, env)), [sb.param]: sb.write(v2.divv(ns, env.size)) };
          },
          readout: () => `${(curSize[0] / env.size[0]).toFixed(3)} × ${(curSize[1] / env.size[1]).toFixed(3)}`,
        };
      },
      numeric(id) {
        if (id === 'rotate' && rb) return [{ id: 'rot', label: 'Rotation', unit: '°', value: rot / DEG, step: 1 }];
        if (id === 'body' || id === 'c') return [{ id: 'x', label: 'X', unit: '', value: cb.read2()[0], step: 0.01 }, { id: 'y', label: 'Y', unit: '', value: cb.read2()[1], step: 0.01 }];
        const sz = sb.read2();
        const f: NumericField[] = [{ id: 'w', label: 'Width', unit: '', value: sz[0], step: 0.01 }, { id: 'h', label: 'Height', unit: '', value: sz[1], step: 0.01 }];
        if (rb) f.push({ id: 'rot', label: 'Rotation', unit: '°', value: rot / DEG, step: 1 });
        return f;
      },
      applyNumeric(_id, f, v) {
        const sz = sb.read2();
        const cuv = cb.read2();
        if (f === 'rot' && rb) return { [rb.param]: rb.write(v * DEG) };
        if (f === 'x') return { [cb.param]: cb.write([v, cuv[1]]) };
        if (f === 'y') return { [cb.param]: cb.write([cuv[0], v]) };
        return { [sb.param]: sb.write(f === 'w' ? [v, sz[1]] : [sz[0], v]) };
      },
    },
    'Rect',
  );
}

/* ================================================================================================ transform */
/**
 * Transform2D: translate (centre/body), rotate (knob), non-uniform scale (edges / corners; Shift = uniform), all about
 * a pivot (default = frame centre; Alt = force centre). `scale`'s native value is the FRAME SIZE in UV, so e.g. noise
 * "cells across" binds with {reciprocal:true} and the frame shows one cell. tilingSafe: while the graph tiles, scale is
 * rounded to whole numbers and rotation to 90 degrees (what the shader does anyway), so the gizmo never lies.
 */
export function buildTransform(decl: Decl<'transform'>, env: GizmoEnv): GizmoModel {
  const pb = decl.position ? bind(decl, env, decl.position, 'pos') : null;
  const rb = decl.rotation ? bind(decl, env, decl.rotation, 'angle') : null;
  const sb = decl.scale ? bind(decl, env, decl.scale, 'size') : null;
  const pivB = decl.pivot && !Array.isArray(decl.pivot) ? bind(decl, env, decl.pivot, 'pos') : null;
  const pivFixed = Array.isArray(decl.pivot) ? (decl.pivot as V2) : null;
  const tiled = !!decl.tilingSafe && (env.tile[0] || env.tile[1]);
  const c = toIp(pb ? pb.read2() : [0.5, 0.5], env);
  const frameUv: V2 = sb ? sb.read2() : (decl.frame ?? [0.25, 0.25]);
  const half: V2 = [Math.max((frameUv[0] * env.size[0]) / 2, 0), Math.max((frameUv[1] * env.size[1]) / 2, 0)];
  const rot = rb ? rb.read1() : 0;
  const pivot: V2 = pivB ? toIp(pivB.read2(), env) : pivFixed ? toIp(pivFixed, env) : c;
  const W = (l: V2): V2 => v2.add(c, v2.rot(l, rot));
  const handles: Handle[] = [];
  const shapes: Shape[] = [{ k: 'poly', pts: frameCorners(c, half, rot), closed: true, role: 'main' }];
  // axes cross at the centre
  const ax = 14 / env.zoom;
  shapes.push({ k: 'poly', pts: [W([-ax, 0]), W([ax, 0])], role: 'aux' }, { k: 'poly', pts: [W([0, -ax]), W([0, ax])], role: 'aux' });
  if (sb) for (const [id, s] of Object.entries(SCALE_HANDLES)) handles.push(pointHandle(id, 'Scale', W([s[0] * half[0], s[1] * half[1]]), { priority: 1, shape: 'square', cursor: resizeCursor(s, rot) }));
  if (rb) {
    const top = W([0, -half[1]]);
    const knob = W([0, -half[1] - 32 / env.zoom]);
    shapes.push({ k: 'poly', pts: [top, knob], role: 'aux' });
    handles.push(pointHandle('rotate', 'Rotate', knob, { priority: 0, shape: 'circle', cursor: 'alias' }));
  }
  if (pb) {
    handles.push(pointHandle('c', 'Move', c, { priority: 2, shape: 'circle' }));
    handles.push(bodyHandle('body', 'Move', { t: 'box', c, half, rot }, 10));
  }
  if (pivB || pivFixed) handles.push(pointHandle('pivot', 'Pivot', pivot, { priority: 1, shape: 'diamond', cursor: pivB ? 'move' : 'default' }));

  const writeScale = (size: V2): Writes => {
    if (!sb) return {};
    const uv = v2.divv(size, env.size);
    return { [sb.param]: sb.arity() === 1 ? sb.write(uv[0], { integer: tiled }) : sb.write(uv, { integer: tiled }) };
  };

  return makeModel(
    decl,
    env,
    {
      shapes,
      handles,
      begin(id, ip): DragSession | null {
        if (id === 'c' || id === 'body') {
          if (!pb) return null;
          const off = v2.sub(c, ip);
          return {
            move(p, m) {
              let q = v2.add(p, off);
              if (m.shift) q = axisLock(q, c);
              return { [pb.param]: pb.write(toUv(snapPoint(q, env.size, env.snap, m, env.zoom, !m.alt), env)) };
            },
          };
        }
        if (id === 'pivot') {
          if (!pivB) return null;
          const off = v2.sub(pivot, ip);
          return { move: (p, m) => ({ [pivB.param]: pivB.write(toUv(snapPoint(v2.add(p, off), env.size, env.snap, m, env.zoom, !m.alt), env)) }) };
        }
        if (id === 'rotate' && rb) {
          const P = pivot;
          const a0 = Math.atan2(ip[1] - P[1], ip[0] - P[0]);
          let cur = rot;
          return {
            move(p, m) {
              const useP = m.alt ? c : P;
              const a0u = m.alt ? Math.atan2(ip[1] - c[1], ip[0] - c[0]) : a0;
              let r = unwrapNear(Math.atan2(p[1] - useP[1], p[0] - useP[0]) - a0u + rot, rot);
              if (tiled) r = snapAngle(r, 90);
              else if (m.ctrl) r = snapAngle(r, env.snap.angleDeg);
              cur = r;
              const w: Writes = { [rb.param]: rb.write(r) };
              if (pb && !v2.eq(useP, c, 1e-6)) w[pb.param] = pb.write(toUv(v2.add(useP, v2.rot(v2.sub(c, useP), r - rot)), env));
              return w;
            },
            readout: () => `${((cur / DEG) % 360).toFixed(1)}°`,
          };
        }
        const s = SCALE_HANDLES[id];
        if (!s || !sb) return null;
        let cur = frameUv;
        return {
          move(p, m) {
            const P = m.alt ? c : pivot;
            const g0 = v2.rot(v2.sub(ip, P), -rot);
            const l = v2.rot(v2.sub(p, P), -rot);
            const f = scaleFactors(s, l, g0, m.shift);
            let ns: V2 = [half[0] * 2 * f[0], half[1] * 2 * f[1]];
            if (m.ctrl && !tiled) ns = [Math.max(snapScalar(ns[0] / env.size[0], env.snap.gridUv / 2), 1e-3) * env.size[0], Math.max(snapScalar(ns[1] / env.size[1], env.snap.gridUv / 2), 1e-3) * env.size[1]];
            cur = v2.divv(ns, env.size);
            const w = writeScale(ns);
            if (pb && !v2.eq(P, c, 1e-6)) {
              const local = v2.mulv(v2.rot(v2.sub(c, P), -rot), f);
              w[pb.param] = pb.write(toUv(v2.add(P, v2.rot(local, rot)), env));
            }
            return w;
          },
          readout: () => `frame ${cur[0].toFixed(3)} × ${cur[1].toFixed(3)}`,
        };
      },
      numeric(id) {
        if (id === 'rotate' && rb) return [{ id: 'rot', label: 'Rotation', unit: '°', value: +(rot / DEG).toFixed(4), step: 1 }];
        if (id === 'c' || id === 'body') return [{ id: 'x', label: 'X', unit: '', value: c[0] / env.size[0], step: 0.01 }, { id: 'y', label: 'Y', unit: '', value: c[1] / env.size[1], step: 0.01 }];
        if (id === 'pivot') return [{ id: 'px', label: tt('modelsShape.pivotX'), unit: '', value: pivot[0] / env.size[0], step: 0.01 }, { id: 'py', label: tt('modelsShape.pivotY'), unit: '', value: pivot[1] / env.size[1], step: 0.01 }];
        if (sb) {
          const raw = env.values[sb.param];
          const arr = Array.isArray(raw) ? (raw as number[]) : [raw as number];
          return arr.length === 1 ? [{ id: 'sx', label: 'Scale', unit: '', value: arr[0], step: 0.1 }] : [{ id: 'sx', label: tt('modelsShape.scaleX'), unit: '', value: arr[0], step: 0.1 }, { id: 'sy', label: tt('modelsShape.scaleY'), unit: '', value: arr[1], step: 0.1 }];
        }
        return [];
      },
      applyNumeric(_id, f, v) {
        if (f === 'rot' && rb) return { [rb.param]: rb.write(v * DEG) };
        if (f === 'x' || f === 'y') return pb ? { [pb.param]: pb.write(f === 'x' ? [v, c[1] / env.size[1]] : [c[0] / env.size[0], v]) } : {};
        if (f === 'px' || f === 'py') return pivB ? { [pivB.param]: pivB.write(f === 'px' ? [v, pivot[1] / env.size[1]] : [pivot[0] / env.size[0], v]) } : {};
        if (sb) {
          const raw = env.values[sb.param];
          if (!Array.isArray(raw)) return { [sb.param]: v };
          return { [sb.param]: f === 'sx' ? [v, (raw as number[])[1]] : [(raw as number[])[0], v] };
        }
        return {};
      },
      actions: () =>
        sb && rb
          ? [{ id: 'reset-rot', label: tt('modelsShape.resetRotation'), run: () => ({ [rb.param]: rb.write(0) }) }]
          : [],
    },
    'Transform',
  );
}
