import type { ParamValue, ParamValues } from '../params/schema';

/**
 * GIZMO DECLARATIONS (contract; framework = src/gizmos/). A node DECLARES gizmos bound to parameters; it never
 * draws, hit-tests or touches the undo stack. See docs/CONTRACTS.md "Gizmo API" for 3 worked examples.
 *
 * Native gizmo units (what the framework works in; ParamMap converts from/to the stored parameter):
 *   - positions: UV (0..1, y down, top-left origin); `space:'pixel'` declares that params are stored in image pixels
 *   - lengths:   UV fractions of `lengthRef` (default 'min' of width/height); rect/frame sizes are per-axis UV
 *   - angles:    radians, clockwise on screen (y down)
 */
export type GizmoUnit = 'uv' | 'pixel' | 'percent' | 'degrees' | 'radians' | 'turns';

/** Declarative parameter <-> gizmo value mapping. read: raw -> unit -> native -> *scale+offset -> reciprocal. */
export interface ParamMap {
  /** Unit the PARAM is stored in. Default: 'uv' ('pixel' when decl.space = 'pixel'); angles default to 'degrees'. */
  unit?: GizmoUnit;
  /** gizmo = param * scale + offset (per component when an array). E.g. {scale:-1, offset:0.5} for a pattern offset. */
  scale?: number | [number, number];
  offset?: number | [number, number];
  /** gizmo = 1 / (...) : for params like "cells across" whose gizmo is the cell SIZE. */
  reciprocal?: boolean;
  /** Quantise the WRITTEN param to a multiple of this (1 = integers). */
  round?: number;
  /** Escape hatches (pure functions; receive all current param values). */
  to?: (raw: ParamValue, values: ParamValues) => number | number[];
  from?: (gizmo: number | number[], values: ParamValues) => ParamValue;
}
export type ParamRef = string | { param: string; map?: ParamMap };

export interface GizmoBase {
  /** Unique within the node. */
  id: string;
  label?: string;
  /** Which viewport shows it. */
  viewport: '2d' | '3d' | 'both';
  /** 'uv' = normalised image space (0..1, y down), 'pixel' = image pixels, 'world' = 3D units. */
  space?: 'uv' | 'pixel' | 'world';
  color?: string;
  visibleIf?: (values: ParamValues) => boolean;
  /** Reference axis for scalar lengths (radius...). Default 'min'. */
  lengthRef?: 'width' | 'height' | 'min' | 'max';
}

export type GizmoDecl = GizmoBase &
  (
    | { type: 'point'; param: ParamRef }
    | { type: 'circle'; center?: ParamRef; radius: ParamRef }
    | { type: 'rect'; center: ParamRef; size: ParamRef; rotation?: ParamRef }
    | { type: 'line'; from: ParamRef; to: ParamRef }
    | { type: 'line'; origin: ParamRef; angle: ParamRef; length?: ParamRef }
    | { type: 'angle'; center?: ParamRef; angle: ParamRef }
    | {
        type: 'transform';
        position?: ParamRef;
        rotation?: ParamRef;
        /** Native value = frame size in UV (use `reciprocal` for "cells across" params). float = uniform. */
        scale?: ParamRef;
        /** Pivot for rotate/scale: a bound param or a fixed [u,v]. Default = frame centre. */
        pivot?: ParamRef | [number, number];
        /** Frame size in UV when `scale` is not bound. */
        frame?: [number, number];
        /** When the graph tiles: round scale to whole numbers and rotation to 90 degree steps (seamless noise). */
        tilingSafe?: boolean;
      }
    | { type: 'path'; param: ParamRef }
    | { type: 'box3d'; position: string; size: string }
    /* ---- 3D gizmos (world space, Z up). Params are stored in WORLD units / Euler DEGREES (XYZ). ---- */
    /** Free move handle (axis arrows + plane squares + centre) for a vec3 param. */
    | { type: 'point3d'; param: ParamRef }
    /** Sphere radius handle(s); `center` is a vec3 param (default: origin). */
    | { type: 'radius3d'; center?: ParamRef; radius: ParamRef }
    /** Direction vector param (vec3) drawn as an arrow from `origin` (default: origin). */
    | { type: 'axis3d'; origin?: ParamRef; direction: ParamRef; length?: number }
    /** Translate / rotate / scale gizmo (mode chosen in the viewport toolbar). `uniform` = scalar scale param. */
    | { type: 'transform3d'; position?: ParamRef; rotation?: ParamRef; scale?: ParamRef; uniform?: ParamRef; pivot?: ParamRef }
    /** Spline points in world space: SplineValue with x, y and `attrs.z` / `attrs.scale` / `attrs.twist` per point. */
    | { type: 'spline3d'; param: ParamRef }
    | { type: 'falloff3d'; center?: ParamRef; inner: ParamRef; outer: ParamRef }
    | {
        type: 'range';
        min: ParamRef;
        max: ParamRef;
        /** Axis the range lives on (UV, degrees clockwise from +x, UV length). Default: horizontal, 10% from the bottom. */
        origin?: [number, number];
        angle?: number;
        length?: number;
      }
    | { type: 'falloff'; center?: ParamRef; inner: ParamRef; outer: ParamRef }
    | { type: 'grid'; cells: ParamRef; offset?: ParamRef; tilingSafe?: boolean }
    | { type: 'brush'; radius: ParamRef; hardness?: ParamRef; strokes?: ParamRef }
  );

export const refParam = (r: ParamRef | undefined): string | undefined => (r === undefined ? undefined : typeof r === 'string' ? r : r.param);

/** Every param id a gizmo declaration references (validation, tests). */
export function gizmoParamRefs(g: GizmoDecl): string[] {
  const out: string[] = [];
  const add = (r: unknown): void => {
    if (typeof r === 'string') out.push(r);
    else if (r && typeof r === 'object' && !Array.isArray(r) && typeof (r as { param?: unknown }).param === 'string') out.push((r as { param: string }).param);
  };
  const keys = ['param', 'center', 'radius', 'size', 'rotation', 'from', 'to', 'angle', 'position', 'scale', 'origin', 'length', 'pivot', 'min', 'max', 'inner', 'outer', 'cells', 'offset', 'hardness', 'strokes', 'direction', 'uniform'];
  const rec = g as unknown as Record<string, unknown>;
  for (const k of keys) {
    // range.origin/angle/length and transform.frame are literals, not refs: only strings / {param} objects count
    if (k in rec) add(rec[k]);
  }
  return out;
}
