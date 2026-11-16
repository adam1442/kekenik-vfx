import { evalCurve } from '../../engine/params/curve';
import {
  addKey,
  curveToText,
  flattenTangents,
  flipCurve,
  invertCurve,
  keySlopes,
  moveKey,
  normalizeCurve,
  parseCurveText,
  removeKey,
  resetTangents,
  setAllModes,
  setKeyMode,
  setSlope,
  type EditBounds,
  type KeyMode,
} from '../../engine/params/curve-ops';
import type { CurveValue } from '../../engine/params/schema';
import { clamp } from '../../shared/util';
import { dragPointer, h, observeSize } from '../core/dom';
import { contextMenu } from '../core/menu';
import { toast } from '../core/overlay';
import { icon } from '../icons';
import { Dropdown } from './controls';
import { registerCurveWidgetFactory, type CurveWidget, type CurveWidgetOptions } from './curve';
import { openPresetBrowser } from './preset-browser';
import { curvePresets } from './presets';
import type { WidgetCallbacks } from './types';
import { onUiChange, px as uiPx } from '../theme/ui-store';

import { t as tt } from '../../shared/i18n';
/**
 * THE curve widget. Edits a CurveValue: bezier ("smooth", Hermite with tangent handles) / linear / step keys.
 *  - click empty space = add key (and drag it), drag key / handle, double-click or Delete = remove key
 *  - tangent handles of the selected key (joined by default, Alt = one side only); right-click: mode, reset / flatten tangents
 *  - snap (Off, 1/4 ... 1/32; Ctrl toggles while dragging), Shift = axis lock while dragging
 *  - Flip (mirror x), Invert (mirror y), Normalize, Copy / Paste (JSON on the system clipboard), preset browser with folders
 *  - optional histogram backdrop (`setHistogram`), 256-entry LUT via bakeCurveLut / bakeCurveUniform256 for shaders
 * Contract: same Widget callbacks as every widget (onBegin/onEnd bracket drags; discrete edits only call onInput).
 * Reused by the Properties panel (compact) and the Curve Editor panel (fill); reuses it for animation curves.
 */
/** Canvas metrics in CSS px at 100% UI scale; read through `pad()` / `keyR()` so the UI scale applies live. */
const PAD_BASE = 10;
const KEY_R_BASE = 5;
const pad = (): number => uiPx(PAD_BASE);
const keyR = (): number => uiPx(KEY_R_BASE);
let memClipboard: string | null = null;
const GRIDS = [
  { value: '0', label: tt('curveEditor.snapOff') },
  { value: '0.25', label: tt('curveEditor.snap14') },
  { value: '0.125', label: tt('curveEditor.snap18') },
  { value: '0.0625', label: tt('curveEditor.snap116') },
  { value: '0.03125', label: tt('curveEditor.snap132') },
];
type Hit = { kind: 'key'; i: number } | { kind: 'in' | 'out'; i: number } | null;

export class CurveEditor implements CurveWidget {
  readonly el: HTMLElement;
  private v: CurveValue;
  private sel = 0;
  private offUi: () => void = () => undefined;
  private canvas = h('canvas');
  private area: HTMLElement;
  private grid = 0;
  private hist: ArrayLike<number> | null;
  private hover: Hit = null;
  private cssW = 1;
  private cssH = 1;
  private disabled = false;
  private modeBtns: HTMLElement[] = [];
  private off: () => void;
  private bounds: EditBounds;
  private lockEnds: boolean;
  private dragBase: CurveValue;

  constructor(value: CurveValue, private cb: WidgetCallbacks<CurveValue>, opts: CurveWidgetOptions) {
    this.v = JSON.parse(JSON.stringify(value)) as CurveValue;
    this.dragBase = this.v;
    this.hist = opts.histogram ?? null;
    this.bounds = { xRange: [0, 1], yRange: opts.yRange ?? [0, 1] };
    this.lockEnds = opts.lockEnds ?? true;
    this.area = h('div', { class: 'cv-area' }, this.canvas);
    if (opts.fill) this.area.style.flex = '1';
    else this.area.style.height = `${opts.height ?? 150}px`;
    const mode = (m: KeyMode, label: string, tip: string): HTMLElement => {
      const b = h('button', { class: 'k-mini', tip, onclick: () => this.setMode(m) }, label);
      this.modeBtns.push(b);
      return b;
    };
    const snap = new Dropdown({ options: GRIDS, value: '0', tip: tt('curveEditor.snapKeysToA') }, { onInput: (g) => ((this.grid = +g), this.draw()) });
    const mini = (label: string, tip: string, fn: () => void): HTMLElement => h('button', { class: 'k-mini', tip, onclick: fn }, label);
    const ibtn = (name: string, tip: string, fn: () => void): HTMLElement => h('button', { class: 'k-ibtn sm', tip, onclick: fn }, icon(name, 12));
    const bar = h(
      'div',
      { class: 'cv-bar' },
      h('div', { class: 'cv-seg' }, mode('smooth', 'Bezier', 'Smooth (Hermite) segment after the selected key'), mode('linear', 'Linear', 'Straight segment'), mode('step', 'Step', 'Constant until the next key')),
      snap.el,
      mini('Flip', 'Mirror horizontally (x -> 1 - x)', () => this.apply(flipCurve(this.v, this.bounds))),
      mini('Invert', 'Mirror vertically (y -> 1 - y)', () => this.apply(invertCurve(this.v, this.bounds))),
      mini('Normalize', 'Stretch so the curve spans the full range', () => this.apply(normalizeCurve(this.v, this.bounds))),
      ibtn('copy', 'Copy curve (Ctrl+C)', () => void this.copy()),
      ibtn('paste', 'Paste curve (Ctrl+V)', () => void this.paste()),
      ibtn('folder', 'Presets', () => this.presets(bar)),
      ibtn('fullscreen', 'Open in the Curve Editor panel', () => (opts.openEditor ? opts.openEditor(this.get()) : window.dispatchEvent(new CustomEvent('kk-open-curve-editor')))),
    );
    this.el = h('div', { class: `k-curve2${opts.fill ? ' fill' : ''}`, tabindex: 0 }, this.area, bar);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerleave', () => ((this.hover = null), this.draw()));
    this.canvas.addEventListener('dblclick', (e) => this.dbl(e));
    this.canvas.addEventListener('contextmenu', (e) => this.ctxMenu(e));
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.off = observeSize(this.area, (w, hh) => {
      this.cssW = Math.max(1, w);
      this.cssH = Math.max(1, hh);
      this.draw();
    });
    this.offUi = onUiChange(() => this.draw()); // theme / scale change: repaint with the new tokens and metrics
  }

  /* ------------------------------------------------------------------------ geometry */
  private px(x: number, y: number): [number, number] {
    const [x0, x1] = this.bounds.xRange;
    const [y0, y1] = this.bounds.yRange;
    return [pad() + ((x - x0) / (x1 - x0)) * (this.cssW - 2 * pad()), pad() + (1 - (y - y0) / (y1 - y0)) * (this.cssH - 2 * pad())];
  }
  private fromPx(px: number, py: number): [number, number] {
    const [x0, x1] = this.bounds.xRange;
    const [y0, y1] = this.bounds.yRange;
    return [x0 + ((px - pad()) / (this.cssW - 2 * pad())) * (x1 - x0), y0 + (1 - (py - pad()) / (this.cssH - 2 * pad())) * (y1 - y0)];
  }
  private handleLen(i: number, side: 'in' | 'out'): number {
    const k = this.v.keys;
    const nb = side === 'out' ? k[i + 1] : k[i - 1];
    const span = this.bounds.xRange[1] - this.bounds.xRange[0];
    return Math.min(0.1 * span, nb ? 0.45 * Math.abs(nb.x - k[i].x) : 0.1 * span);
  }
  private handlePos(i: number, side: 'in' | 'out'): [number, number] | null {
    const k = this.v.keys;
    if (side === 'out' ? i >= k.length - 1 || (k[i].mode ?? 'smooth') !== 'smooth' : i <= 0 || (k[i - 1].mode ?? 'smooth') !== 'smooth') return null;
    const s = keySlopes(this.v, i);
    const l = this.handleLen(i, side);
    return side === 'out' ? this.px(k[i].x + l, k[i].y + s.tout * l) : this.px(k[i].x - l, k[i].y - s.tin * l);
  }
  private hit(p: [number, number]): Hit {
    const d2 = (q: [number, number]): number => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    for (const side of ['out', 'in'] as const) {
      const hp = this.handlePos(this.sel, side);
      if (hp && d2(hp) < 8 * 8) return { kind: side, i: this.sel };
    }
    let best = -1;
    let bd = 10 * 10;
    this.v.keys.forEach((k, i) => {
      const d = d2(this.px(k.x, k.y));
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best >= 0 ? { kind: 'key', i: best } : null;
  }

  /* ------------------------------------------------------------------------ editing */
  private apply(c: CurveValue): void {
    this.v = c;
    this.sel = clamp(this.sel, 0, c.keys.length - 1);
    this.refreshBar();
    this.draw();
    this.cb.onInput?.(this.get());
  }
  private setMode(m: KeyMode): void {
    this.apply(setKeyMode(this.v, this.sel, m));
  }
  private down(e: PointerEvent): void {
    if (this.disabled || e.button !== 0) return;
    this.el.focus({ preventScroll: true });
    const r = this.canvas.getBoundingClientRect();
    const p: [number, number] = [e.clientX - r.left, e.clientY - r.top];
    const hit = this.hit(p);
    this.cb.onBegin?.();
    this.dragBase = this.v;
    const snapOf = (ev: PointerEvent): number => (ev.ctrlKey || ev.metaKey ? (this.grid > 0 ? 0 : 0.0625) : this.grid);
    if (hit && (hit.kind === 'in' || hit.kind === 'out')) {
      const i = hit.i;
      const side = hit.kind;
      dragPointer(
        e,
        (_dx, _dy, ev) => {
          const [x, y] = this.fromPx(ev.clientX - r.left, ev.clientY - r.top);
          const k = this.dragBase.keys[i];
          const minDx = 0.004;
          const dx = side === 'out' ? Math.max(x - k.x, minDx) : Math.min(x - k.x, -minDx);
          this.apply(setSlope(this.dragBase, i, side, (y - k.y) / dx, !ev.altKey));
        },
        () => this.cb.onEnd?.(),
      );
      return;
    }
    let idx: number;
    if (hit) {
      idx = hit.i;
      this.sel = idx;
      this.refreshBar();
      this.draw();
    } else {
      const [x, y] = this.fromPx(p[0], p[1]);
      const onCurve = Math.abs(this.px(x, evalCurve(this.v, x))[1] - p[1]) < 12;
      const added = addKey(this.v, clamp(x, this.bounds.xRange[0], this.bounds.xRange[1]), onCurve ? undefined : clamp(y, this.bounds.yRange[0], this.bounds.yRange[1]));
      this.sel = added.index;
      idx = added.index;
      this.apply(added.curve);
    }
    const base = this.v;
    dragPointer(
      e,
      (dx, dy, ev) => {
        let [x, y] = this.fromPx(ev.clientX - r.left, ev.clientY - r.top);
        if (ev.shiftKey) {
          const k0 = base.keys[idx];
          if (Math.abs(dx) > Math.abs(dy)) y = k0.y;
          else x = k0.x;
        }
        this.apply(moveKey(base, idx, x, y, { bounds: this.bounds, lockEnds: this.lockEnds, snap: snapOf(ev) }));
      },
      () => this.cb.onEnd?.(),
    );
  }
  private move(e: PointerEvent): void {
    if (e.buttons) return;
    const r = this.canvas.getBoundingClientRect();
    const hv = this.hit([e.clientX - r.left, e.clientY - r.top]);
    const same = (!hv && !this.hover) || (hv && this.hover && hv.kind === this.hover.kind && hv.i === this.hover.i);
    this.canvas.style.cursor = hv ? (hv.kind === 'key' ? 'grab' : 'crosshair') : 'copy';
    if (!same) {
      this.hover = hv;
      this.draw();
    }
  }
  private dbl(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const hit = this.hit([e.clientX - r.left, e.clientY - r.top]);
    if (hit && hit.kind === 'key') this.deleteKey(hit.i);
  }
  private deleteKey(i: number): void {
    const edge = this.lockEnds && (i === 0 || i === this.v.keys.length - 1);
    if (edge) return toast(tt('curveEditor.theEndKeysCannot'), { type: 'info', timeout: 1200 });
    const next = removeKey(this.v, i, 2);
    if (next !== this.v) this.apply(next);
  }
  private key(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') this.deleteKey(this.sel);
    else if (mod && e.key.toLowerCase() === 'c') void this.copy();
    else if (mod && e.key.toLowerCase() === 'v') void this.paste();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  private ctxMenu(e: MouseEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const hit = this.hit([e.clientX - r.left, e.clientY - r.top]);
    if (hit) {
      this.sel = hit.i;
      this.refreshBar();
      this.draw();
    }
    const i = this.sel;
    const cur = this.v.keys[i].mode ?? 'smooth';
    contextMenu(e, [
      { header: `Key ${i + 1}` },
      { label: tt('curveEditor.bezierSegment'), checked: cur === 'smooth', action: () => this.apply(setKeyMode(this.v, i, 'smooth')) },
      { label: tt('curveEditor.linearSegment'), checked: cur === 'linear', action: () => this.apply(setKeyMode(this.v, i, 'linear')) },
      { label: tt('curveEditor.stepSegment'), checked: cur === 'step', action: () => this.apply(setKeyMode(this.v, i, 'step')) },
      { separator: true },
      { label: tt('curveEditor.autoTangents'), action: () => this.apply(resetTangents(this.v, i)) },
      { label: tt('curveEditor.flatTangents'), action: () => this.apply(flattenTangents(this.v, i)) },
      { label: tt('curveEditor.deleteKey'), danger: true, disabled: !hit, action: () => this.deleteKey(i) },
      { separator: true },
      { header: tt('curveEditor.allKeys') },
      { label: tt('curveEditor.allBezier'), action: () => this.apply(setAllModes(this.v, 'smooth')) },
      { label: tt('curveEditor.allLinear'), action: () => this.apply(setAllModes(this.v, 'linear')) },
      { label: tt('curveEditor.allStep'), action: () => this.apply(setAllModes(this.v, 'step')) },
    ]);
  }
  private async copy(): Promise<void> {
    memClipboard = curveToText(this.v);
    try {
      await navigator.clipboard?.writeText(memClipboard);
    } catch {
      /* in-app clipboard still works */
    }
    toast(tt('curveEditor.curveCopied'), { type: 'ok', timeout: 1000 });
  }
  private async paste(): Promise<void> {
    let text = memClipboard;
    try {
      const t = await navigator.clipboard?.readText();
      if (t && parseCurveText(t)) text = t;
    } catch {
      /* permission denied: fall back to the in-app clipboard */
    }
    const c = text ? parseCurveText(text) : null;
    if (!c) return toast(tt('curveEditor.noCurveOnThe'), { type: 'warn', timeout: 1500 });
    this.apply(c);
  }
  private presets(anchor: HTMLElement): void {
    openPresetBrowser(anchor, curvePresets(), {
      title: tt('curveEditor.curvePresets'),
      current: () => this.get(),
      apply: (c) => this.apply(JSON.parse(JSON.stringify(c)) as CurveValue),
      preview: (g, w, hh, c) => {
        g.fillStyle = '#16181c';
        g.fillRect(0, 0, w, hh);
        g.strokeStyle = '#8f83ff';
        g.lineWidth = 1.5;
        g.beginPath();
        for (let i = 0; i <= 40; i++) {
          const y = clamp(evalCurve(c, i / 40), 0, 1);
          if (i === 0) g.moveTo(2, hh - 2 - y * (hh - 4));
          else g.lineTo(2 + (i / 40) * (w - 4), hh - 2 - y * (hh - 4));
        }
        g.stroke();
      },
    });
  }
  private refreshBar(): void {
    const m = this.v.keys[this.sel]?.mode ?? 'smooth';
    ['smooth', 'linear', 'step'].forEach((id, i) => this.modeBtns[i]?.classList.toggle('on', id === m));
  }

  /* ------------------------------------------------------------------------ drawing */
  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(this.cssW * dpr);
    const H = Math.round(this.cssH * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.cssW, this.cssH);
    const css = getComputedStyle(this.el);
    const accent = css.getPropertyValue('--accent').trim() || '#8f83ff';
    const [x0, y0] = this.px(0, this.bounds.yRange[0]);
    const [x1, y1] = this.px(1, this.bounds.yRange[1]);
    // histogram backdrop
    if (this.hist && this.hist.length > 1) {
      let mx = 0;
      for (let i = 0; i < this.hist.length; i++) mx = Math.max(mx, this.hist[i]);
      g.fillStyle = 'rgba(160,170,190,0.18)';
      const bw = (x1 - x0) / this.hist.length;
      for (let i = 0; i < this.hist.length; i++) {
        const hh = mx > 0 ? (this.hist[i] / mx) * (y0 - y1) : 0;
        g.fillRect(x0 + i * bw, y0 - hh, Math.max(bw, 1), hh);
      }
    }
    // grid
    g.lineWidth = 1;
    const lines = (n: number, color: string): void => {
      g.strokeStyle = color;
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const gx = Math.round(x0 + ((x1 - x0) * i) / n) + 0.5;
        const gy = Math.round(y1 + ((y0 - y1) * i) / n) + 0.5;
        g.moveTo(gx, y1);
        g.lineTo(gx, y0);
        g.moveTo(x0, gy);
        g.lineTo(x1, gy);
      }
      g.stroke();
    };
    lines(4, 'rgba(255,255,255,0.09)');
    if (this.grid > 0 && this.grid < 0.25) lines(Math.round(1 / this.grid), 'rgba(255,255,255,0.04)');
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash([]);
    // curve
    const N = Math.max(64, Math.round(x1 - x0));
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      const [px, py] = this.px(x, evalCurve(this.v, x));
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.lineJoin = 'round';
    g.strokeStyle = accent;
    g.lineWidth = 2;
    g.stroke();
    g.lineTo(x1, y0);
    g.lineTo(x0, y0);
    g.closePath();
    g.fillStyle = 'rgba(143,131,255,0.07)';
    g.fill();
    // handles of the selected key
    g.lineWidth = 1;
    const kp = this.v.keys[this.sel] ? this.px(this.v.keys[this.sel].x, this.v.keys[this.sel].y) : null;
    for (const side of ['in', 'out'] as const) {
      const hp = kp && this.handlePos(this.sel, side);
      if (!hp || !kp) continue;
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.moveTo(kp[0], kp[1]);
      g.lineTo(hp[0], hp[1]);
      g.stroke();
      const hov = this.hover && this.hover.kind === side;
      g.fillStyle = hov ? '#fff' : accent;
      g.fillRect(hp[0] - 3.5, hp[1] - 3.5, 7, 7);
    }
    // keys
    this.v.keys.forEach((k, i) => {
      const [kx, ky] = this.px(k.x, k.y);
      const selected = i === this.sel;
      const hov = this.hover && this.hover.kind === 'key' && this.hover.i === i;
      g.beginPath();
      if ((k.mode ?? 'smooth') === 'smooth') g.arc(kx, ky, keyR() + (hov ? 1 : 0), 0, Math.PI * 2);
      else g.rect(kx - keyR(), ky - keyR(), keyR() * 2, keyR() * 2);
      g.fillStyle = selected ? '#fff' : '#1b1d22';
      g.fill();
      g.strokeStyle = selected ? accent : '#d6d9e0';
      g.lineWidth = 1.5;
      g.stroke();
    });
    if (this.disabled) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, 0, this.cssW, this.cssH);
    }
  }

  /* ------------------------------------------------------------------------ Widget API */
  get(): CurveValue {
    return JSON.parse(JSON.stringify(this.v)) as CurveValue;
  }
  set(v: CurveValue): void {
    this.v = JSON.parse(JSON.stringify(v)) as CurveValue;
    this.sel = clamp(this.sel, 0, this.v.keys.length - 1);
    this.refreshBar();
    this.draw();
  }
  setHistogram(bins: ArrayLike<number> | null): void {
    this.hist = bins;
    this.draw();
  }
  setMixed(m: boolean): void {
    this.el.classList.toggle('mixed', m);
  }
  setDisabled(d: boolean): void {
    this.disabled = d;
    this.el.classList.toggle('disabled', d);
    this.draw();
  }
  dispose(): void {
    this.off();
    this.offUi();
  }
}

registerCurveWidgetFactory((value, cb, opts) => new CurveEditor(value, cb, opts));
