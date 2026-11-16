import type { ParamGesture } from '../engine/commands/gesture';
import { ghostOffsets, type Rect, type V2, type ViewTransform } from './geom';
import { hitDistance, shiftHit } from './hit';
import type { Mods } from './snap';
import type { ToolbarItem } from './spline-tools';
import type { DragSession, GizmoAction, GizmoModel, Handle, NumericField, Writes } from './types';

/** What the controller needs from its environment (the 2D viewport implements it; tests use a fake). */
export interface GizmoHost {
  view(): ViewTransform;
  /** Axes along which the gizmos wrap (node tiles or the viewport repeats the image) + the displayed region (ip). */
  tiling(): { wrapX: boolean; wrapY: boolean; region: Rect };
  /** Start an undoable gesture (live writes, one undo step on commit). */
  beginGesture(label: string): ParamGesture;
  /** Gizmo state changed (hover, models, drag): redraw the overlay. */
  invalidate(): void;
  /** Double-click on a handle with numeric fields. */
  requestNumeric?(req: NumericRequest): void;
  readout?(text: string | null): void;
}

export interface NumericRequest {
  model: GizmoModel;
  handle: Handle;
  fields: NumericField[];
  /** Screen position to anchor the popup at. */
  at: V2;
}

export interface Picked {
  model: GizmoModel;
  handle: Handle;
  /** Tile offset (i,j) of the ghost copy that was hit; [0,0] = the canonical one. */
  ghost: V2;
  dist: number;
}

/**
 * GizmoController: hover, picking (priority then distance, analytic, ghost copies included), drag sessions,
 * numeric entry and keyboard. Pure logic: no DOM, no GPU. Models are rebuilt by the viewport whenever params / view
 * change (`setModels`); a running drag keeps its session (closed over the drag-start state), so writes are absolute
 * and never accumulate error.
 */
export class GizmoController {
  private models: GizmoModel[] = [];
  private ghostCache = new Map<string, V2[]>();
  hover: { key: string; handleId: string; ghost: V2 } | null = null;
  private drag: { model: GizmoModel; handle: Handle; ghost: V2; session: DragSession; gesture: ParamGesture; moved: boolean } | null = null;
  cursor = 'default';
  pointerIp: V2 | null = null;

  constructor(private host: GizmoHost) {}

  get dragging(): boolean {
    return this.drag !== null;
  }
  get activeHandle(): { key: string; handleId: string } | null {
    return this.drag ? { key: this.drag.model.key, handleId: this.drag.handle.id } : null;
  }
  getModels(): readonly GizmoModel[] {
    return this.models;
  }

  setModels(models: GizmoModel[]): void {
    this.models = models;
    this.ghostCache.clear();
    if (this.hover && !this.find(this.hover.key, this.hover.handleId)) this.hover = null;
    this.host.invalidate();
  }

  private find(key: string, handleId: string): { model: GizmoModel; handle: Handle } | null {
    const model = this.models.find((m) => m.key === key);
    const handle = model?.handles.find((h) => h.id === handleId);
    return model && handle ? { model, handle } : null;
  }

  ghostsOf(model: GizmoModel): V2[] {
    let g = this.ghostCache.get(model.key);
    if (!g) {
      const t = this.host.tiling();
      const v = this.host.view();
      g = t.wrapX || t.wrapY ? ghostOffsets(model.bounds, v.size, t.region, t.wrapX, t.wrapY) : [];
      this.ghostCache.set(model.key, g);
    }
    return g;
  }

  /** Analytic pick at screen point `sp`. */
  pick(sp: V2): Picked | null {
    const view = this.host.view();
    const size = view.size;
    let best: Picked | null = null;
    let bestPrio = Infinity;
    for (const model of this.models) {
      const ghosts: V2[] = [[0, 0], ...this.ghostsOf(model)];
      for (const handle of model.handles) {
        for (const g of ghosts) {
          const d = hitDistance(shiftHit(handle.hit, [g[0] * size[0], g[1] * size[1]]), sp, view);
          if (d === null) continue;
          if (handle.priority < bestPrio || (handle.priority === bestPrio && best && d < best.dist)) {
            best = { model, handle, ghost: g, dist: d };
            bestPrio = handle.priority;
          }
        }
      }
    }
    return best;
  }

  private toLocal(ip: V2, ghost: V2): V2 {
    const s = this.host.view().size;
    return [ip[0] - ghost[0] * s[0], ip[1] - ghost[1] * s[1]];
  }

  /** Hover / drag update. Returns true while a drag is active (the caller must not pan etc.). */
  pointerMove(sp: V2, mods: Mods): boolean {
    const view = this.host.view();
    const ip = view.toImage(sp);
    this.pointerIp = ip;
    if (this.drag) {
      const d = this.drag;
      const w = d.session.move(this.toLocal(ip, d.ghost), mods);
      this.apply(d.model, d.gesture, w);
      d.moved = true;
      this.host.readout?.(d.session.readout?.() ?? null);
      this.cursor = typeof d.handle.cursor === 'function' ? d.handle.cursor(mods) : d.handle.cursor;
      this.host.invalidate();
      return true;
    }
    const p = this.pick(sp);
    const prev = this.hover;
    this.hover = p ? { key: p.model.key, handleId: p.handle.id, ghost: p.ghost } : null;
    this.cursor = p ? (typeof p.handle.cursor === 'function' ? p.handle.cursor(mods) : p.handle.cursor) : 'default';
    if (prev?.key !== this.hover?.key || prev?.handleId !== this.hover?.handleId || prev?.ghost[0] !== this.hover?.ghost[0] || prev?.ghost[1] !== this.hover?.ghost[1] || this.models.some((m) => m.hoverShapes)) this.host.invalidate();
    return false;
  }

  pointerLeave(): void {
    this.pointerIp = null;
    if (this.hover) this.hover = null;
    this.host.invalidate();
  }

  private apply(model: GizmoModel, gesture: ParamGesture, w: Writes): void {
    for (const [k, v] of Object.entries(w)) gesture.set(model.nodeId, k, v);
  }

  /** Left button press. true = consumed (a drag started). */
  pointerDown(sp: V2, mods: Mods): boolean {
    if (this.drag) return true;
    const p = this.pick(sp);
    if (!p) return false;
    const ip = this.toLocal(this.host.view().toImage(sp), p.ghost);
    const session = p.model.begin(p.handle.id, ip, mods);
    if (!session) return false;
    const gesture = this.host.beginGesture(`${p.model.label}: ${p.handle.label}`);
    this.drag = { model: p.model, handle: p.handle, ghost: p.ghost, session, gesture, moved: false };
    if (session.initial) this.apply(p.model, gesture, session.initial);
    this.hover = { key: p.model.key, handleId: p.handle.id, ghost: p.ghost };
    this.host.invalidate();
    return true;
  }

  /** Left button release: commits the gesture as ONE undo step. */
  pointerUp(): boolean {
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    d.gesture.commit();
    this.host.readout?.(null);
    this.host.invalidate();
    return true;
  }

  /** Esc during a drag: roll everything back. */
  cancel(): boolean {
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    d.gesture.cancel();
    this.host.readout?.(null);
    this.host.invalidate();
    return true;
  }

  doubleClick(sp: V2): boolean {
    const p = this.pick(sp);
    if (!p) return false;
    const ip = this.toLocal(this.host.view().toImage(sp), p.ghost);
    if (p.model.doubleClick) {
      const w = p.model.doubleClick(p.handle.id, ip);
      if (w) {
        this.commitWrites(p.model, `${p.model.label}: ${p.handle.label}`, w);
        return true;
      }
    }
    const fields = p.model.numeric(p.handle.id);
    if (!fields.length || !this.host.requestNumeric) return false;
    this.host.requestNumeric({ model: p.model, handle: p.handle, fields, at: this.host.view().toScreen(p.handle.pos ?? ip) });
    return true;
  }

  /** One-shot writes (numeric entry, menu actions, keys) = one undo step. */
  commitWrites(model: GizmoModel, label: string, w: Writes): void {
    const g = this.host.beginGesture(label);
    this.apply(model, g, w);
    g.commit();
    this.host.invalidate();
  }

  applyNumeric(req: NumericRequest, fieldId: string, value: number): void {
    const w = req.model.applyNumeric(req.handle.id, fieldId, value);
    this.commitWrites(req.model, `${req.model.label}: ${req.handle.label}`, w);
  }

  /** Context-menu actions for the item under `sp` (empty when none). */
  actionsAt(sp: V2): { model: GizmoModel; action: GizmoAction }[] {
    const p = this.pick(sp);
    const ip = this.host.view().toImage(sp);
    const out: { model: GizmoModel; action: GizmoAction }[] = [];
    const models = p ? [p.model] : this.models;
    for (const m of models) for (const a of m.actions?.(p?.handle.id ?? null, p ? this.toLocal(ip, p.ghost) : ip) ?? []) out.push({ model: m, action: a });
    return out;
  }
  /** Overlay toolbar button: writes become one undo step, state-only items just redraw. */
  runToolbar(model: GizmoModel, item: ToolbarItem): void {
    if (item.disabled) return;
    const w = item.run();
    if (w) this.commitWrites(model, `${model.label}: ${item.tip}`, w);
    else this.host.invalidate();
  }
  runAction(model: GizmoModel, action: GizmoAction): void {
    const w = action.run();
    if (w) this.commitWrites(model, `${model.label}: ${action.label}`, w);
  }

  /** Key events (Delete, [ ], Esc). true = handled. */
  key(key: string, mods: Mods): boolean {
    if (key === 'Escape' && this.drag) return this.cancel();
    for (const m of this.models) {
      const w = m.onKey?.(key, mods);
      if (w === 'state') {
        this.host.invalidate();
        return true;
      }
      if (w) {
        this.commitWrites(m, `${m.label}: ${key}`, w);
        return true;
      }
    }
    this.host.invalidate();
    return false;
  }
  wheel(delta: number, mods: Mods): boolean {
    for (const m of this.models) {
      const w = m.onWheel?.(delta, mods);
      if (w) {
        this.commitWrites(m, `${m.label}: size`, w);
        return true;
      }
    }
    return false;
  }

  /** Shapes that depend on the pointer (brush cursor). */
  hoverShapes(mods: Mods): { model: GizmoModel; shapes: ReturnType<NonNullable<GizmoModel['hoverShapes']>> }[] {
    return this.models.filter((m) => m.hoverShapes).map((m) => ({ model: m, shapes: m.hoverShapes!(this.pointerIp, mods) }));
  }
}

