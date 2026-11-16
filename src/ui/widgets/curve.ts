import { evalCurve } from '../../engine/params/curve';
import type { CurveValue } from '../../engine/params/schema';
import { h, observeSize } from '../core/dom';
import type { Widget, WidgetCallbacks } from './types';

/**
 * CURVE WIDGET API. The full editor (`curve-editor.ts`) installs itself by calling `registerCurveWidgetFactory(...)` at module
 * load; every consumer (Properties panel, Curve Editor panel) goes through `createCurveWidget`, so nothing else changes.
 *
 * Contract: the widget edits a CurveValue (keys with x/y, optional mode/tin/tout), reports changes through
 * onBegin/onInput/onEnd (same semantics as all widgets), supports `set()` without callbacks, and may open the full
 * Curve Editor panel via `ctx.openEditor`. The fallback implementation renders a read-only preview and clicking it shows a hint.
 */
export interface CurveWidgetOptions {
  /** Called when the user asks for the large editor (double-click / expand button). */
  openEditor?: (value: CurveValue) => void;
  /** Value range of the y axis (default 0..1). */
  yRange?: [number, number];
  height?: number;
  /** Fill the parent (large editor panel) instead of using a fixed height. */
  fill?: boolean;
  /** Keep the first / last key at x = 0 / 1 (default true). */
  lockEnds?: boolean;
  /** Optional histogram backdrop (bin heights; normalised by the widget). */
  histogram?: ArrayLike<number> | null;
}
/** Optional extension implemented by the real editor. */
export interface CurveWidgetExtras {
  setHistogram?(bins: ArrayLike<number> | null): void;
}
export type CurveWidget = Widget<CurveValue> & CurveWidgetExtras;
export type CurveWidgetFactory = (value: CurveValue, cb: WidgetCallbacks<CurveValue>, opts: CurveWidgetOptions) => CurveWidget;

let factory: CurveWidgetFactory = (value, _cb, opts) => new PreviewCurveWidget(value, opts);

export function registerCurveWidgetFactory(f: CurveWidgetFactory): void {
  factory = f;
}
export function createCurveWidget(value: CurveValue, cb: WidgetCallbacks<CurveValue> = {}, opts: CurveWidgetOptions = {}): CurveWidget {
  return factory(value, cb, opts);
}

/** Read-only preview used when no editor implementation has been registered. */
class PreviewCurveWidget implements CurveWidget {
  readonly el: HTMLElement;
  private canvas = h('canvas');
  private v: CurveValue;
  private off: () => void;
  constructor(value: CurveValue, private opts: CurveWidgetOptions) {
    this.v = value;
    this.el = h('div', { class: 'k-curve', tip: 'Curve preview' }, this.canvas, h('span', { class: 'note' }, 'preview'));
    if (opts.height) this.el.style.height = `${opts.height / 12}rem`;
    this.off = observeSize(this.el, () => this.draw());
  }
  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.el.clientWidth * dpr));
    const hh = Math.max(1, Math.round(this.el.clientHeight * dpr));
    this.canvas.width = w;
    this.canvas.height = hh;
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, w, hh);
    g.strokeStyle = '#2b2f36';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo((w * i) / 4, 0);
      g.lineTo((w * i) / 4, hh);
      g.moveTo(0, (hh * i) / 4);
      g.lineTo(w, (hh * i) / 4);
      g.stroke();
    }
    const [y0, y1] = this.opts.yRange ?? [0, 1];
    g.strokeStyle = '#9a8dff';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      const y = (evalCurve(this.v, x) - y0) / (y1 - y0);
      const px = x * w;
      const py = (1 - Math.min(1, Math.max(0, y))) * hh;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = '#fff';
    for (const k of this.v.keys) {
      g.beginPath();
      g.arc(k.x * w, (1 - Math.min(1, Math.max(0, (k.y - y0) / (y1 - y0)))) * hh, 3 * dpr, 0, 7);
      g.fill();
    }
  }
  get(): CurveValue {
    return this.v;
  }
  set(v: CurveValue): void {
    this.v = v;
    this.draw();
  }
  dispose(): void {
    this.off();
  }
}
