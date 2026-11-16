import { refParam, type GizmoDecl } from '../engine/graph/gizmo-decl';
import { cloneValue, type SplinePoint, type SplineValue } from '../engine/params/schema';
import { v2, type V2 } from './geom';
import { closestOnPolyline } from './hit';
import { bodyHandle, lengthUnit, makeModel, pointHandle, toIp, toUv } from './kit';
import { bezierTangent, deletePoint, insertPoint, resolveHandles, reverseSpline, sampleSpline, segmentBezier, segmentCount } from './spline';
import { snapPoint } from './snap';
import { splineToolbar, toolFromKey, type SplineTool } from './spline-tools';
import type { DragSession, GizmoAction, GizmoEnv, GizmoModel, Handle, NumericField, Shape, Writes } from './types';

import { t as tt } from '../shared/i18n';
type Decl = Extract<GizmoDecl, { type: 'path' }>;

const emptySpline = (): SplineValue => ({ closed: false, points: [] });

/**
 * Spline editor. Value = SplineValue (UV). Interactions:
 *  - drag anchor / segment-handle / bezier handle / width handle; Alt while dragging a bezier handle breaks the mirror
 *  - double-click a segment: insert a point (curve preserved); double-click an anchor: numeric X/Y/width
 *  - Shift+click on empty space: append a point (drag to place it); Delete/Backspace: delete the selected point
 *  - context menu: delete, smooth/corner/free, close/open, reverse
 * Selected point lives in env.state.sel (UI state, never in the project).
 */
export function buildPath(decl: Decl, env: GizmoEnv): GizmoModel {
  const param = refParam(decl.param)!;
  const raw = env.values[param] as SplineValue | undefined;
  const sp: SplineValue = raw && Array.isArray(raw.points) ? raw : emptySpline();
  const n = sp.points.length;
  const unit = lengthUnit(decl, env);
  let sel = typeof env.state.sel === 'number' ? (env.state.sel as number) : -1;
  if (sel >= n) sel = n - 1;
  env.state.sel = sel;
  const setSel = (i: number): void => void (env.state.sel = i);
  // overlay-toolbar tool + snap toggle (UI state, never in the project)
  const tool: SplineTool = env.state.tool === 'add' || env.state.tool === 'delete' ? env.state.tool : 'select';
  const snapOn = env.state.snapOn === true;
  const ipOf = (p: SplinePoint): V2 => toIp([p.x, p.y], env);
  const write = (v: SplineValue): Writes => ({ [param]: v });

  const shapes: Shape[] = [];
  const handles: Handle[] = [];

  // curve
  const smp = sampleSpline(sp);
  const ipts = smp.pts.map((p) => toIp(p, env));
  if (ipts.length > 1) shapes.push({ k: 'poly', pts: ipts, role: 'main' });
  // width ribbon
  if (sp.points.some((p) => (p.w ?? 0) > 0) && ipts.length > 1) {
    const L: V2[] = [];
    const R: V2[] = [];
    for (let k = 0; k < smp.pts.length; k++) {
      const s = smp.seg[k];
      const bez = segmentBezier(sp, s);
      const a = sp.points[s];
      const b = sp.points[(s + 1) % n];
      const w = ((a.w ?? 0) + ((b.w ?? 0) - (a.w ?? 0)) * smp.t[k]) * unit * 0.5;
      const tg = v2.norm(v2.mulv(bezierTangent(bez, smp.t[k]), env.size));
      const nm = v2.perp(tg);
      L.push(v2.add(ipts[k], v2.mul(nm, w)));
      R.push(v2.sub(ipts[k], v2.mul(nm, w)));
    }
    shapes.push({ k: 'poly', pts: L, role: 'aux' }, { k: 'poly', pts: R, role: 'aux' });
  }

  // segment hit areas (grouped per segment)
  for (let s = 0; s < segmentCount(sp); s++) {
    const seg: V2[] = [];
    for (let k = 0; k < smp.pts.length; k++) if (smp.seg[k] === s) seg.push(ipts[k]);
    if (s > 0) {
      const prev = ipts[smp.seg.indexOf(s) - 1];
      if (prev) seg.unshift(prev);
    }
    if (seg.length > 1) handles.push(bodyHandle(`seg${s}`, 'Spline segment', { t: 'polyline', pts: seg, tol: 7 }, 6, tool === 'add' ? 'crosshair' : 'copy'));
  }

  // anchors
  for (let i = 0; i < n; i++) handles.push(pointHandle(`p${i}`, `Point ${i + 1}`, ipOf(sp.points[i]), { priority: 0, shape: 'square', active: i === sel, ...(tool === 'delete' ? { cursor: 'not-allowed' } : {}) }));

  // selected point extras: bezier handles + width handles
  if (sel >= 0) {
    const p = sp.points[sel];
    const a = ipOf(p);
    if (p.mode !== 'corner') {
      const h = resolveHandles(sp, sel);
      const hin = v2.add(a, v2.mulv(h.hin, env.size));
      const hout = v2.add(a, v2.mulv(h.hout, env.size));
      shapes.push({ k: 'poly', pts: [hin, a, hout], role: 'aux' });
      handles.push(pointHandle(`hi${sel}`, 'Handle in', hin, { priority: 1, shape: 'circle', cursor: 'crosshair' }), pointHandle(`ho${sel}`, 'Handle out', hout, { priority: 1, shape: 'circle', cursor: 'crosshair' }));
    }
    // width handles along the normal
    const si = sel < segmentCount(sp) ? sel : Math.max(0, segmentCount(sp) - 1);
    if (segmentCount(sp) > 0) {
      const bez = segmentBezier(sp, si);
      const tg = v2.norm(v2.mulv(bezierTangent(bez, sel < segmentCount(sp) ? 0 : 1), env.size));
      const nm = v2.perp(tg);
      const half = ((p.w ?? 0) * unit) / 2;
      const off = Math.max(half, 18 / env.zoom);
      handles.push(
        pointHandle(`wa${sel}`, 'Width', v2.add(a, v2.mul(nm, off)), { priority: 1, shape: 'diamond', cursor: 'ns-resize' }),
        pointHandle(`wb${sel}`, 'Width', v2.sub(a, v2.mul(nm, off)), { priority: 1, shape: 'diamond', cursor: 'ns-resize' }),
      );
    }
  }

  // catch-all: Shift+click appends
  handles.push({ id: 'canvas', label: tt('modelsSpline.addPoint'), hit: { t: 'image', w: env.size[0], h: env.size[1] }, priority: 99, cursor: (m) => (tool === 'add' || m.shift ? 'crosshair' : 'default'), shape: 'none' });

  const clone = (): SplineValue => cloneValue(sp) as SplineValue;
  const snapUv = (p: V2, m: Parameters<typeof snapPoint>[3]): V2 => toUv(snapPoint(p, env.size, env.snap, snapOn && !m.ctrl ? { ...m, ctrl: true } : m, env.zoom, !m.alt), env);

  const parseId = (id: string): { kind: string; i: number } | null => {
    const m = /^(p|hi|ho|wa|wb|seg)(\d+)$/.exec(id);
    return m ? { kind: m[1], i: +m[2] } : null;
  };

  const setMode = (i: number, mode: 'auto' | 'corner' | 'free'): Writes => {
    const v = clone();
    const p = v.points[i];
    if (mode === 'free') {
      const h = resolveHandles(sp, i);
      p.hin = h.hin;
      p.hout = h.hout;
    } else {
      delete p.hin;
      delete p.hout;
    }
    p.mode = mode;
    return write(v);
  };

  return makeModel(
    decl,
    env,
    {
      shapes,
      handles,
      bounds: { x0: 0, y0: 0, x1: env.size[0], y1: env.size[1] },
      begin(id, ip, mods): DragSession | null {
        if (id === 'canvas') {
          if (!mods.shift && tool !== 'add') return null;
          const v = clone();
          const uv = snapUv(ip, mods);
          v.points.push({ x: uv[0], y: uv[1], mode: 'auto' });
          const idx = v.points.length - 1;
          setSel(idx);
          return {
            initial: write(v),
            move(p, m) {
              const q = snapUv(p, m);
              const w = cloneValue(v) as SplineValue;
              w.points[idx].x = q[0];
              w.points[idx].y = q[1];
              return write(w);
            },
          };
        }
        const pid = parseId(id);
        if (!pid) return null;
        const { kind, i } = pid;
        if (kind === 'seg') {
          if (tool === 'add') {
            // Add tool: insert exactly where the segment was clicked, then drag the new point
            const w = doubleClickInsert(ip);
            const idx = typeof env.state.sel === 'number' ? (env.state.sel as number) : -1;
            const ins = w?.[param] as SplineValue | undefined;
            if (!w || !ins || idx < 0) return null;
            return {
              initial: w,
              move(p, m) {
                const q = snapUv(p, m);
                const nv = cloneValue(ins) as SplineValue;
                nv.points[idx].x = q[0];
                nv.points[idx].y = q[1];
                return write(nv);
              },
            };
          }
          // dragging a segment moves nothing: it only selects the segment's start point (double-click inserts)
          setSel(i);
          return { move: () => ({}) };
        }
        if (kind === 'p' && tool === 'delete') {
          // Delete tool: a click on a point removes it (never below 2 points)
          if (n <= 2) return null;
          setSel(Math.min(i, n - 2));
          return { initial: write(deletePoint(sp, i)), move: () => ({}) };
        }
        setSel(i);
        const p0 = sp.points[i];
        const a = ipOf(p0);
        if (kind === 'p') {
          const off = v2.sub(a, ip);
          return {
            move(p, m) {
              const q = snapUv(v2.add(p, off), m);
              const v = clone();
              v.points[i].x = q[0];
              v.points[i].y = q[1];
              return write(v);
            },
            readout: () => `${p0.x.toFixed(3)}, ${p0.y.toFixed(3)}`,
          };
        }
        if (kind === 'hi' || kind === 'ho') {
          const startH = resolveHandles(sp, i);
          return {
            move(p, m) {
              const q = m.ctrl ? snapUv(p, m) : toUv(p, env);
              const rel: V2 = [q[0] - p0.x, q[1] - p0.y];
              const v = clone();
              const pt = v.points[i];
              pt.mode = 'free';
              if (kind === 'ho') {
                pt.hout = rel;
                pt.hin = m.alt ? startH.hin : v2.mul(rel, -1);
              } else {
                pt.hin = rel;
                pt.hout = m.alt ? startH.hout : v2.mul(rel, -1);
              }
              return write(v);
            },
          };
        }
        // width handles
        const seg = Math.min(i, Math.max(0, segmentCount(sp) - 1));
        const tg = v2.norm(v2.mulv(bezierTangent(segmentBezier(sp, seg), i < segmentCount(sp) ? 0 : 1), env.size));
        const nm = v2.perp(tg);
        return {
          move(p) {
            const v = clone();
            v.points[i].w = Math.max(0, (2 * Math.abs(v2.dot(v2.sub(p, a), nm))) / unit);
            return write(v);
          },
          readout: () => `width ${(p0.w ?? 0).toFixed(3)}`,
        };
      },
      doubleClick(id, ip) {
        const pid = parseId(id);
        if (pid?.kind === 'seg') return doubleClickInsert(ip);
        return undefined;
      },
      numeric(id) {
        const pid = parseId(id);
        if (!pid || pid.kind !== 'p') return [];
        const p = sp.points[pid.i];
        const f: NumericField[] = [
          { id: 'x', label: 'X', unit: '', value: p.x, step: 0.01 },
          { id: 'y', label: 'Y', unit: '', value: p.y, step: 0.01 },
          { id: 'w', label: 'Width', unit: '', value: p.w ?? 0, step: 0.005 },
        ];
        for (const [k, vv] of Object.entries(p.attrs ?? {})) f.push({ id: `a:${k}`, label: k, unit: '', value: vv, step: 0.01 });
        return f;
      },
      applyNumeric(id, f, v) {
        const pid = parseId(id);
        if (!pid) return {};
        const out = clone();
        const p = out.points[pid.i];
        if (f === 'x') p.x = v;
        else if (f === 'y') p.y = v;
        else if (f === 'w') p.w = Math.max(0, v);
        else if (f.startsWith('a:')) p.attrs = { ...(p.attrs ?? {}), [f.slice(2)]: v };
        return write(out);
      },
      actions(id, ip): GizmoAction[] {
        const pid = id ? parseId(id) : null;
        const acts: GizmoAction[] = [];
        if (pid && pid.kind === 'p') {
          const i = pid.i;
          const mode = sp.points[i].mode ?? 'auto';
          acts.push(
            { id: 'del', label: tt('modelsSpline.deletePoint'), danger: true, disabled: n <= 2, run: () => (setSel(Math.min(i, n - 2)), write(deletePoint(sp, i))) },
            { id: 'auto', label: tt('modelsSpline.smoothAutoHandles'), disabled: mode === 'auto', run: () => setMode(i, 'auto') },
            { id: 'corner', label: 'Corner', disabled: mode === 'corner', run: () => setMode(i, 'corner') },
            { id: 'free', label: tt('modelsSpline.freeHandles'), disabled: mode === 'free', run: () => setMode(i, 'free') },
          );
        }
        if (pid && pid.kind === 'seg') {
          acts.push({ id: 'ins', label: tt('modelsSpline.insertPointHere'), run: () => (doubleClickInsert(ip) ?? null) });
        }
        acts.push({ id: 'close', label: sp.closed ? 'Open path' : 'Close path', disabled: n < 3, run: () => write({ ...clone(), closed: !sp.closed }) }, { id: 'rev', label: tt('modelsSpline.reverseDirection'), disabled: n < 2, run: () => write(reverseSpline(sp)) });
        return acts;
      },
      toolbar: splineToolbar({
        tool,
        setTool: (x) => void (env.state.tool = x),
        sp,
        sel,
        snapOn,
        toggleSnap: () => void (env.state.snapOn = !snapOn),
        write,
        mirrorCentre: 0.5,
      }),
      onKey(key, mods) {
        const tk = toolFromKey(key);
        if (tk && !mods.ctrl && !mods.alt) {
          env.state.tool = tk;
          return 'state';
        }
        if ((key === 'Delete' || key === 'Backspace') && sel >= 0 && n > 2) {
          setSel(Math.min(sel, n - 2));
          return write(deletePoint(sp, sel));
        }
        if (key === 'Escape') {
          setSel(-1);
          return null;
        }
        return null;
      },
    },
    'Spline',
  );

  function doubleClickInsert(ip: V2): Writes | undefined {
    const cp = closestOnPolyline(ipts, ip);
    const k = Math.min(cp.seg, smp.seg.length - 2);
    const s = smp.seg[Math.max(0, k)];
    const t0 = smp.t[Math.max(0, k)];
    const t1 = smp.t[Math.min(k + 1, smp.t.length - 1)];
    const t = t1 > t0 ? t0 + (t1 - t0) * cp.t : (t0 + 1) / 2;
    const r = insertPoint(sp, s, Math.min(0.98, Math.max(0.02, t)));
    setSel(r.index);
    return write(r.value);
  }
}
