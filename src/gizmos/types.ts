import type { ToolbarItem } from './spline-tools';
import type { ParamValue, ParamValues } from '../engine/params/schema';
import type { GizmoDecl } from '../engine/graph/gizmo-decl';
import type { Rect, V2 } from './geom';
import type { Hit } from './hit';
import type { Mods, SnapSettings } from './snap';

/** Param writes produced by a drag step: paramId -> new (uncoerced) value. */
export type Writes = Record<string, ParamValue>;

/** Everything a gizmo model needs to know about the world (rebuilt on every refresh; cheap). */
export interface GizmoEnv {
  nodeId: string;
  values: ParamValues;
  /** Reference image size (ip). */
  size: V2;
  /** Node/graph tiling per axis. */
  tile: [boolean, boolean];
  snap: SnapSettings;
  /** CSS px per image px (constant screen-size handles). */
  zoom: number;
  /** Model-private persistent UI state (e.g. selected spline point), survives refreshes. */
  state: Record<string, unknown>;
}

export type HandleShape = 'square' | 'circle' | 'diamond' | 'ring' | 'none';

export interface Handle {
  /** Unique inside the model. */
  id: string;
  label: string;
  hit: Hit;
  /** Lower wins when several handles are under the pointer (points 0, edges 5, bodies 10, catch-all 99). */
  priority: number;
  /** CSS cursor; may depend on modifiers (e.g. crosshair while Shift adds a spline point). */
  cursor: string | ((m: Mods) => string);
  shape: HandleShape;
  /** Draw position in ip (undefined = invisible handle: pure hit area). */
  pos?: V2;
  /** Drawn bigger/brighter (selected spline point, active). */
  active?: boolean;
}

export type Shape =
  | { k: 'poly'; pts: V2[]; closed?: boolean; role: 'main' | 'aux' | 'fill' | 'strong'; dash?: boolean }
  | { k: 'circle'; c: V2; r: number; role: 'main' | 'aux' | 'fill' | 'strong'; dash?: boolean }
  | { k: 'text'; p: V2; text: string; dx?: number; dy?: number };

export interface NumericField {
  id: string;
  label: string;
  unit: string;
  value: number;
  step?: number;
}

export interface DragSession {
  /** Writes applied immediately when the drag starts (e.g. a spline point created by Shift+click). */
  initial?: Writes;
  /** Absolute writes for the pointer position `ip` (already corrected for the ghost the drag started on). */
  move(ip: V2, mods: Mods): Writes;
  /** Optional on-screen readout while dragging ("Rotation 45.0°"). */
  readout?(): string | null;
}

export interface GizmoAction {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  run(): Writes | null;
}

/** A built gizmo ready for drawing, hit testing and dragging. Pure data + closures (no DOM, no GPU). */
export interface GizmoModel {
  /** `${nodeId}/${decl.id}` */
  key: string;
  nodeId: string;
  decl: GizmoDecl;
  label: string;
  color?: string;
  shapes: Shape[];
  handles: Handle[];
  /** ip bounds of everything drawn (ghost computation). */
  bounds: Rect;
  /** Shapes depending on the pointer (brush cursor); `ip` null when the pointer left. */
  hoverShapes?(ip: V2 | null, mods: Mods): Shape[];
  /** Start a drag on a handle. null = not consumed (e.g. Shift is needed). */
  begin(handleId: string, ip: V2, mods: Mods): DragSession | null;
  /** Double-click behaviour: Writes to apply immediately, or undefined to open numeric entry. */
  doubleClick?(handleId: string, ip: V2): Writes | undefined;
  numeric(handleId: string): NumericField[];
  applyNumeric(handleId: string, fieldId: string, value: number): Writes;
  actions?(handleId: string | null, ip: V2): GizmoAction[];
  /** Writes to commit, `'state'` = handled (UI-state only: tool switch), null = not handled. */
  onKey?(key: string, mods: Mods): Writes | 'state' | null;
  /** Overlay mini-toolbar items (spline tools). Rendered by the viewport (`ui/widgets/gizmo-toolbar.ts`). */
  toolbar?: ToolbarItem[];
  onWheel?(delta: number, mods: Mods): Writes | null;
}
