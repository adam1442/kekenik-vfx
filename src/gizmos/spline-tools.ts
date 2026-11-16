/**
 * Shared spline tool logic for the viewport gizmos. One implementation is used by the 2D path gizmo
 * (`models-spline.ts`), the 3D sweep-path gizmo (`gizmos3d/models.ts`) and the overlay mini-toolbar widget
 * (`ui/widgets/gizmo-toolbar.ts`). PURE: no DOM, no GPU. The editing maths lives in `engine/spline/ops.ts`.
 */
import { convertMode, flipDirection, mirror, setClosed, type TangentMode } from '../engine/spline/ops';
import type { ParamValue, SplineValue } from '../engine/params/schema';
import { t } from '../shared/i18n';

export type SplineTool = 'select' | 'add' | 'delete';
export const SPLINE_TOOLS: readonly SplineTool[] = ['select', 'add', 'delete'];
/** Tool hotkeys (viewport focused, no modifier). */
export const TOOL_HOTKEY: Record<SplineTool, string> = { select: 'v', add: 'a', delete: 'x' };

export const toolFromKey = (key: string): SplineTool | null => {
  const k = key.toLowerCase();
  return SPLINE_TOOLS.find((x) => TOOL_HOTKEY[x] === k) ?? null;
};

/** One button of the overlay mini-toolbar. `run` returns writes to commit (one undo step) or null for UI-state-only changes. */
export interface ToolbarItem {
  id: string;
  /** Short glyph (no external icon font). */
  icon: string;
  tip: string;
  hotkey?: string;
  active?: boolean;
  disabled?: boolean;
  /** Draw a separator before this item. */
  separator?: boolean;
  run(): Record<string, ParamValue> | null;
}

export interface SplineToolbarCtx {
  tool: SplineTool;
  setTool(tool: SplineTool): void;
  sp: SplineValue;
  /** Selected point index (-1 = none). */
  sel: number;
  snapOn: boolean;
  toggleSnap(): void;
  /** Wrap a new spline value into the writes of the owning parameter. */
  write(v: SplineValue): Record<string, ParamValue>;
  /** Mirror axis centre: 0.5 for UV splines, 0 for world-space 3D paths. */
  mirrorCentre: number;
}

const withHotkey = (tip: string, hotkey?: string): string => (hotkey ? `${tip} [${hotkey.toUpperCase()}]` : tip);

/** The common toolbar (Select / Add / Delete | Corner / Smooth / Break | Close-Open / Flip / Mirror | Snap). */
export function splineToolbar(c: SplineToolbarCtx): ToolbarItem[] {
  const n = c.sp.points.length;
  const hasSel = c.sel >= 0 && c.sel < n;
  const toolItem = (tool: SplineTool, icon: string, tip: string): ToolbarItem => ({ id: `tool:${tool}`, icon, tip: withHotkey(tip, TOOL_HOTKEY[tool]), hotkey: TOOL_HOTKEY[tool], active: c.tool === tool, run: () => (c.setTool(tool), null) });
  const convert = (id: string, icon: string, tip: string, mode: TangentMode): ToolbarItem => ({ id, icon, tip, disabled: !hasSel, run: () => c.write(convertMode(c.sp, [c.sel], mode)) });
  return [
    toolItem('select', '↖', t('spline.tool.select')),
    toolItem('add', '＋', t('spline.tool.add')),
    toolItem('delete', '－', t('spline.tool.delete')),
    { ...convert('conv:corner', '◇', t('spline.convert.corner'), 'corner'), separator: true },
    convert('conv:auto', '◠', t('spline.convert.smooth'), 'auto'),
    convert('conv:free', '⌇', t('spline.convert.free'), 'free'),
    { id: 'closed', icon: c.sp.closed ? '◌' : '○', tip: c.sp.closed ? t('spline.open') : t('spline.close'), separator: true, disabled: n < 3, active: !!c.sp.closed, run: () => c.write(setClosed(c.sp, !c.sp.closed)) },
    { id: 'flip', icon: '⇄', tip: t('spline.flip'), disabled: n < 2, run: () => c.write(flipDirection(c.sp)) },
    { id: 'mirror', icon: '⥮', tip: t('spline.mirror'), disabled: n < 2, run: () => c.write(mirror(c.sp, 'x', c.mirrorCentre)) },
    { id: 'snap', icon: '▦', tip: t('spline.snap'), separator: true, active: c.snapOn, run: () => (c.toggleSnap(), null) },
  ];
}

/* ------------------------------------------------------------------------------------------------ 3D helper */
type V3 = [number, number, number];

/**
 * Closest point of a 3D polyline to a pick ray. Returns the polyline segment index, the parameter on it and the ray-to-curve
 * distance. Used by the 3D add tool to insert a point exactly where the user clicked a path segment.
 */
export function closestOnPolylineToRay(pts: readonly V3[], ray: { o: V3; d: V3 }): { seg: number; t: number; point: V3; dist: number } | null {
  let best: { seg: number; t: number; point: V3; dist: number } | null = null;
  const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const u = sub(pts[i + 1], p);
    const w = sub(p, ray.o);
    const a = dot(u, u), b = dot(u, ray.d), cc = dot(ray.d, ray.d), d = dot(u, w), e = dot(ray.d, w);
    const den = a * cc - b * b;
    let s = den > 1e-12 ? (b * e - cc * d) / den : 0;
    s = Math.min(1, Math.max(0, s));
    const q: V3 = [p[0] + u[0] * s, p[1] + u[1] * s, p[2] + u[2] * s];
    const r = Math.max(0, dot(sub(q, ray.o), ray.d) / cc);
    const onRay: V3 = [ray.o[0] + ray.d[0] * r, ray.o[1] + ray.d[1] * r, ray.o[2] + ray.d[2] * r];
    const dd = Math.hypot(q[0] - onRay[0], q[1] - onRay[1], q[2] - onRay[2]);
    if (!best || dd < best.dist) best = { seg: i, t: s, point: q, dist: dd };
  }
  return best;
}
