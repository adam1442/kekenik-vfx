import { onUiChange, uiState } from '../ui/theme/ui-store';
import type { GizmoDecl } from '../engine/graph/gizmo-decl';
import { Binding, type BindKind } from './bindings';
import { circleRect, rectGrow, rectOf, rectUnion, v2, type Rect, type V2 } from './geom';
import type { Hit } from './hit';
import type { Handle, HandleShape, GizmoEnv, GizmoModel, Shape } from './types';
import type { ParamRef } from '../engine/graph/gizmo-decl';

/** Shared helpers for gizmo model builders. */
/**
 * Hit tolerances in CSS pixels, scaled by the UI scale (live bindings: `setGizmoMetrics` runs on every UI change; the viewport
 * rebuilds its models afterwards so handles pick up the new values).
 */
export let HIT_POINT_PX = 10;
export let HIT_LINE_PX = 6;
export function setGizmoMetrics(scale: number): void {
  HIT_POINT_PX = 10 * scale;
  HIT_LINE_PX = 6 * scale;
}
setGizmoMetrics(uiState().scale);
onUiChange((st) => setGizmoMetrics(st.scale));

export const bind = (decl: GizmoDecl, env: GizmoEnv, ref: ParamRef, kind: BindKind): Binding =>
  new Binding(ref, kind, { size: env.size, space: decl.space, lengthRef: decl.lengthRef, values: env.values });

/** Length (ip) of one native length unit for scalar lengths (radius...). */
export function lengthUnit(decl: GizmoDecl, env: GizmoEnv): number {
  const [w, h] = env.size;
  switch (decl.lengthRef ?? 'min') {
    case 'width':
      return w;
    case 'height':
      return h;
    case 'max':
      return Math.max(w, h);
    default:
      return Math.min(w, h);
  }
}

export const toIp = (uv: V2, env: GizmoEnv): V2 => v2.mulv(uv, env.size);
export const toUv = (ip: V2, env: GizmoEnv): V2 => v2.divv(ip, env.size);

export function pointHandle(id: string, label: string, pos: V2, opts: { priority?: number; shape?: HandleShape; cursor?: Handle['cursor']; r?: number; active?: boolean } = {}): Handle {
  return { id, label, hit: { t: 'point', p: pos, r: opts.r ?? HIT_POINT_PX }, priority: opts.priority ?? 0, cursor: opts.cursor ?? 'move', shape: opts.shape ?? 'square', pos, active: opts.active };
}
export const bodyHandle = (id: string, label: string, hit: Hit, priority = 10, cursor = 'move'): Handle => ({ id, label, hit, priority, cursor, shape: 'none' });

export const circlePoly = (c: V2, r: number, n = 64): V2[] => Array.from({ length: n }, (_, i) => [c[0] + Math.cos((i / n) * Math.PI * 2) * r, c[1] + Math.sin((i / n) * Math.PI * 2) * r] as V2);
export const arcPoly = (c: V2, r: number, a0: number, a1: number): V2[] => {
  const n = Math.max(4, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 64));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r] as V2;
  });
};
/** Arrow head polygon at `tip` pointing along `dir`, size in ip. */
export const arrowHead = (tip: V2, dir: V2, size: number): V2[] => {
  const d = v2.norm(dir);
  const n = v2.perp(d);
  const back = v2.sub(tip, v2.mul(d, size));
  return [v2.add(back, v2.mul(n, size * 0.45)), tip, v2.sub(back, v2.mul(n, size * 0.45))];
};

export function shapesBounds(shapes: Shape[], handles: Handle[], pad: number): Rect {
  let r: Rect | null = null;
  const add = (x: Rect): void => void (r = r ? rectUnion(r, x) : x);
  for (const s of shapes) {
    if (s.k === 'poly' && s.pts.length) add(rectOf(s.pts));
    else if (s.k === 'circle') add(circleRect(s.c, s.r));
  }
  for (const h of handles) if (h.pos) add({ x0: h.pos[0], y0: h.pos[1], x1: h.pos[0], y1: h.pos[1] });
  return rectGrow(r ?? { x0: 0, y0: 0, x1: 0, y1: 0 }, pad);
}

export type ModelParts = Omit<GizmoModel, 'key' | 'nodeId' | 'decl' | 'label' | 'color' | 'bounds'> & { bounds?: Rect };

export function makeModel(decl: GizmoDecl, env: GizmoEnv, parts: ModelParts, defaultLabel: string): GizmoModel {
  return {
    key: `${env.nodeId}/${decl.id}`,
    nodeId: env.nodeId,
    decl,
    label: decl.label ?? defaultLabel,
    color: decl.color,
    bounds: parts.bounds ?? shapesBounds(parts.shapes, parts.handles, 4 / Math.max(env.zoom, 1e-6)),
    ...parts,
  };
}
