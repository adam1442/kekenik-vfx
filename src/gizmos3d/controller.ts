import { t } from '../shared/i18n';
import type { ParamGesture } from '../engine/commands/gesture';
import type { ParamValue } from '../engine/params/schema';
import type { ToolbarItem } from '../gizmos/spline-tools';
import { geomDistancePx, type Drag3D, type Gizmo3DModel, type Handle3D, type Mods3, type View3D, type Writes } from './core';

export interface Gizmo3DHost {
  /** Start an undoable gesture (live writes, ONE undo step on commit). */
  beginGesture(label: string): ParamGesture;
  invalidate(): void;
  readout?(text: string | null): void;
}
export interface Picked3D {
  model: Gizmo3DModel;
  handle: Handle3D;
  dist: number;
}
/** Picking radius in CSS px. */
export const PICK_RADIUS = 10;

/**
 * Gizmo3DController: hover, picking (priority, then distance; analytic on the projected geometry), drag sessions with
 * absolute writes, Esc to cancel. Pure logic (no DOM / three): the viewport feeds pointer coordinates and a View3D.
 */
export class Gizmo3DController {
  private models: Gizmo3DModel[] = [];
  hover: { key: string; id: string } | null = null;
  private drag: { model: Gizmo3DModel; handle: { id: string; label: string }; session: Drag3D; gesture: ParamGesture } | null = null;
  constructor(private host: Gizmo3DHost) {}

  get dragging(): boolean {
    return this.drag !== null;
  }
  get active(): { key: string; id: string } | null {
    return this.drag ? { key: this.drag.model.key, id: this.drag.handle.id } : null;
  }
  getModels(): readonly Gizmo3DModel[] {
    return this.models;
  }
  setModels(m: Gizmo3DModel[]): void {
    this.models = m;
    if (this.hover && !this.find(this.hover.key, this.hover.id)) this.hover = null;
  }
  private find(key: string, id: string): Handle3D | undefined {
    return this.models.find((m) => m.key === key)?.handles.find((h) => h.id === id);
  }

  pick(view: View3D, x: number, y: number): Picked3D | null {
    let best: Picked3D | null = null;
    for (const model of this.models) {
      for (const handle of model.handles) {
        let d = Infinity;
        for (const g of handle.geom) d = Math.min(d, geomDistancePx(g, view, x, y));
        if (d > PICK_RADIUS) continue;
        if (!best || handle.priority < best.handle.priority || (handle.priority === best.handle.priority && d < best.dist)) best = { model, handle, dist: d };
      }
    }
    return best;
  }

  /** Returns true while the gizmos own the pointer (hovering a handle or dragging). */
  pointerMove(view: View3D, x: number, y: number, mods: Mods3): boolean {
    if (this.drag) {
      const w = this.drag.session.move(view.ray(x, y), mods);
      for (const [k, v] of Object.entries(w)) this.drag.gesture.set(this.drag.model.nodeId, k, v as ParamValue);
      this.host.readout?.(this.drag.session.readout?.() ?? null);
      this.host.invalidate();
      return true;
    }
    const p = this.pick(view, x, y);
    const next = p ? { key: p.model.key, id: p.handle.id } : null;
    if (next?.key !== this.hover?.key || next?.id !== this.hover?.id) {
      this.hover = next;
      this.host.invalidate();
    }
    return !!p;
  }

  pointerDown(view: View3D, x: number, y: number, mods: Mods3): boolean {
    const p = this.pick(view, x, y);
    let model: Gizmo3DModel | undefined = p?.model;
    let handle: { id: string; label: string } | undefined = p?.handle;
    let session = p ? p.handle.begin(view.ray(x, y), view, mods) : null;
    if (!session) {
      // empty space (or a handle that declined): a model may own the click (Add tool)
      for (const m of this.models) {
        const s = m.background?.(view.ray(x, y), view, mods) ?? null;
        if (s) {
          model = m;
          handle = { id: 'background', label: t('spline.addPoint') };
          session = s;
          break;
        }
      }
    }
    if (!session || !model || !handle) return false;
    const gesture = this.host.beginGesture(`${model.label}: ${handle.label}`);
    this.drag = { model, handle, session, gesture };
    if (session.initial) for (const [k, v] of Object.entries(session.initial)) gesture.set(model.nodeId, k, v as ParamValue);
    this.host.invalidate();
    return true;
  }

  /** One-shot writes (toolbar, hotkeys) = one undo step. */
  commitWrites(model: Gizmo3DModel, label: string, w: Writes): void {
    const g = this.host.beginGesture(label);
    for (const [k, v] of Object.entries(w)) g.set(model.nodeId, k, v as ParamValue);
    g.commit();
    this.host.invalidate();
  }
  runToolbar(model: Gizmo3DModel, item: ToolbarItem): void {
    if (item.disabled) return;
    const w = item.run();
    if (w) this.commitWrites(model, `${model.label}: ${item.tip}`, w);
    else this.host.invalidate();
  }
  /** Hotkeys of the models (tool switch, Delete). true = handled. */
  key(key: string, mods: Mods3): boolean {
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
    return false;
  }

  /** Pointer released: commit ONE undo step. */
  pointerUp(): boolean {
    if (!this.drag) return false;
    const d = this.drag;
    this.drag = null;
    d.gesture.commit();
    this.host.readout?.(null);
    this.host.invalidate();
    return true;
  }
  cancel(): void {
    if (!this.drag) return;
    this.drag.gesture.cancel();
    this.drag = null;
    this.host.readout?.(null);
    this.host.invalidate();
  }
}
