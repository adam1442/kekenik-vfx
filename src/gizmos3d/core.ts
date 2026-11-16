import type { ParamValue, ParamValues } from '../engine/params/schema';
import { cameraBasis, type CameraData } from '../engine/mesh/camera';
import { v3, type V3 } from '../engine/mesh/math3';

/**
 * 3D GIZMO FRAMEWORK — pure logic: no DOM, no three.js, no GPU (unit-tested).
 * Nodes DECLARE gizmos (engine/graph/gizmo-decl.ts: point3d, radius3d, axis3d, transform3d, box3d, spline3d, falloff3d);
 * `models.ts` turns a declaration + current params + camera view into handles; `controller.ts` picks / drags them and writes
 * params through a ParamGesture (ONE undo step per drag). Rendering = Canvas2D overlay (draw.ts), so handles keep a constant
 * screen size, are always on top and never touch the three.js scene.
 */
export interface Ray {
  o: V3;
  d: V3;
}
export interface View3D {
  readonly width: number;
  readonly height: number;
  readonly eye: V3;
  readonly forward: V3;
  readonly right: V3;
  readonly up: V3;
  /** CSS px + depth along the view axis; null when behind the camera. */
  project(p: V3): [number, number, number] | null;
  ray(x: number, y: number): Ray;
  /** World units covered by one CSS pixel at point p (constant screen size handles). */
  unitsPerPixel(p: V3): number;
}

/** Concrete view from a camera description + viewport size. Mirrors three.js PerspectiveCamera / OrthographicCamera exactly. */
export class CameraView implements View3D {
  readonly eye: V3;
  readonly forward: V3;
  readonly right: V3;
  readonly up: V3;
  private tanHalf: number;
  private aspect: number;
  constructor(
    readonly cam: CameraData,
    readonly width: number,
    readonly height: number,
  ) {
    const b = cameraBasis(cam);
    this.eye = cam.position;
    this.forward = b.forward;
    this.right = b.right;
    this.up = b.up;
    this.aspect = width / Math.max(1, height);
    this.tanHalf = Math.tan((cam.fovY * Math.PI) / 360);
  }
  project(p: V3): [number, number, number] | null {
    const v = v3.sub(p, this.eye);
    const x = v3.dot(v, this.right), y = v3.dot(v, this.up), z = v3.dot(v, this.forward);
    let nx: number, ny: number;
    if (this.cam.ortho) {
      const half = this.cam.orthoSize / 2;
      nx = x / (half * this.aspect);
      ny = y / half;
    } else {
      if (z < 1e-5) return null;
      nx = x / (z * this.tanHalf * this.aspect);
      ny = y / (z * this.tanHalf);
    }
    return [((nx + 1) / 2) * this.width, ((1 - ny) / 2) * this.height, z];
  }
  ray(sx: number, sy: number): Ray {
    const nx = (sx / this.width) * 2 - 1, ny = 1 - (sy / this.height) * 2;
    if (this.cam.ortho) {
      const half = this.cam.orthoSize / 2;
      const o = v3.add(this.eye, v3.add(v3.scale(this.right, nx * half * this.aspect), v3.scale(this.up, ny * half)));
      return { o, d: this.forward };
    }
    const d = v3.norm(v3.add(this.forward, v3.add(v3.scale(this.right, nx * this.tanHalf * this.aspect), v3.scale(this.up, ny * this.tanHalf))));
    return { o: this.eye, d };
  }
  unitsPerPixel(p: V3): number {
    if (this.cam.ortho) return this.cam.orthoSize / this.height;
    const z = Math.max(1e-4, v3.dot(v3.sub(p, this.eye), this.forward));
    return (z * 2 * this.tanHalf) / this.height;
  }
}

import type { ToolbarItem } from '../gizmos/spline-tools';
export type Geom = { k: 'segment'; a: V3; b: V3 } | { k: 'point'; p: V3 } | { k: 'poly'; pts: V3[]; closed?: boolean } | { k: 'quad'; pts: [V3, V3, V3, V3] };
export interface Mods3 {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}
export type Writes = Record<string, ParamValue>;
export interface Drag3D {
  /** Absolute writes for the current pointer ray (relative to the drag start: never accumulates error). */
  move(ray: Ray, mods: Mods3): Writes;
  readout?(): string | null;
  /** Writes applied when the drag starts (selection etc.). */
  initial?: Writes;
}
export interface Handle3D {
  id: string;
  label: string;
  priority: number; // lower wins ties
  geom: Geom[];
  color: string;
  /** How the first `point` geometry is drawn. */
  shape?: 'dot' | 'cube' | 'arrow' | 'ring';
  begin(ray: Ray, view: View3D, mods: Mods3): Drag3D | null;
}
export interface Decor {
  geom: Geom;
  color: string;
  dash?: boolean;
}
export interface Gizmo3DModel {
  key: string;
  nodeId: string;
  label: string;
  handles: Handle3D[];
  decor: Decor[];
  /** Overlay mini-toolbar (spline tools), rendered by the viewport. */
  toolbar?: ToolbarItem[];
  /** Hotkeys: writes to commit, `'state'` = handled (UI state only), null = not handled. */
  onKey?(key: string, mods: Mods3): Writes | 'state' | null;
  /** Press on empty space (no handle hit): the Add tool appends a point here. null = not consumed (orbit). */
  background?(ray: Ray, view: View3D, mods: Mods3): Drag3D | null;
}
export interface GizmoSettings3D {
  mode: 'translate' | 'rotate' | 'scale';
  space: 'world' | 'local';
  snap: boolean;
  moveStep: number;
  rotStep: number;
  scaleStep: number;
}
export const defaultGizmoSettings3D = (): GizmoSettings3D => ({ mode: 'translate', space: 'world', snap: false, moveStep: 0.1, rotStep: 15, scaleStep: 0.1 });
export interface Env3D {
  nodeId: string;
  values: ParamValues;
  view: View3D;
  settings: GizmoSettings3D;
  /** World position used when a gizmo has no position param (centre of the target's bounds). */
  anchor: V3;
  /** Persistent per-gizmo UI state (selected spline point...). */
  state: Record<string, unknown>;
}

/* ------------------------------------------------------------------------------------------------ math */
/** Parameter t of the point on the line (o + t*a) closest to the ray. */
export function closestOnAxis(ray: Ray, o: V3, a: V3): number {
  const w0 = v3.sub(o, ray.o);
  const b = v3.dot(a, ray.d), d = v3.dot(a, w0), e = v3.dot(ray.d, w0);
  const den = v3.dot(a, a) - b * b;
  if (Math.abs(den) < 1e-6) return 0; // ray parallel to the axis
  return (b * e - d) / den;
}
export function rayPlane(ray: Ray, p0: V3, n: V3): V3 | null {
  const den = v3.dot(n, ray.d);
  if (Math.abs(den) < 1e-7) return null;
  const s = v3.dot(n, v3.sub(p0, ray.o)) / den;
  if (s < 0) return null;
  return v3.add(ray.o, v3.scale(ray.d, s));
}
export const snapTo = (x: number, step: number, on: boolean): number => (on && step > 0 ? Math.round(x / step) * step : x);

/** Pixel distance from point (px,py) to the projected geometry (0 inside quads), Infinity when nothing is visible. */
export function geomDistancePx(g: Geom, view: View3D, px: number, py: number): number {
  const pr = (p: V3) => view.project(p);
  const segDist = (a: [number, number, number], b: [number, number, number]): number => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
    return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
  };
  switch (g.k) {
    case 'point': {
      const a = pr(g.p);
      return a ? Math.hypot(a[0] - px, a[1] - py) : Infinity;
    }
    case 'segment': {
      const a = pr(g.a), b = pr(g.b);
      return a && b ? segDist(a, b) : Infinity;
    }
    case 'poly': {
      let best = Infinity;
      const n = g.pts.length;
      for (let i = 0; i < (g.closed ? n : n - 1); i++) {
        const a = pr(g.pts[i]), b = pr(g.pts[(i + 1) % n]);
        if (a && b) best = Math.min(best, segDist(a, b));
      }
      return best;
    }
    case 'quad': {
      const q = g.pts.map(pr);
      if (q.some((x) => !x)) return Infinity;
      const pts = q as [number, number, number][];
      let inside = false;
      for (let i = 0, j = 3; i < 4; j = i++) {
        if (pts[i][1] > py !== pts[j][1] > py && px < ((pts[j][0] - pts[i][0]) * (py - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
      }
      if (inside) return 0;
      let best = Infinity;
      for (let i = 0; i < 4; i++) best = Math.min(best, segDist(pts[i], pts[(i + 1) % 4]));
      return best;
    }
  }
}
export const AXIS_COLORS = ['#e5484d', '#46a758', '#3e63dd'] as const;
export const AXES: V3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
