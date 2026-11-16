import { evalGradient } from '../../engine/params/curve';
import type { GradientInterp, GradientStop, GradientValue } from '../../engine/params/schema';
import { clamp } from '../../shared/util';
import type { RGBA } from '../../shared/util';
import { dragPointer, h } from '../core/dom';
import { icon } from '../icons';
import { cssFromLinear, openColorPicker, type ColorPickerHandle } from './color';
import { Dropdown } from './controls';
import { NumberField } from './number-field';
import { openPresetBrowser } from './preset-browser';
import { gradientPresets } from './presets';
import type { Widget, WidgetCallbacks } from './types';

import { t } from '../../shared/i18n';
const INTERPS: { value: GradientInterp; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'oklab', label: 'OKLab' },
  { value: 'step', label: 'Step' },
];

/**
 * Gradient editor: color bar + alpha strip + draggable stops. Click the bar to add a stop (color sampled from the
 * gradient), drag a stop to move it, double-click (or Delete/Backspace) removes it, click the selected stop's swatch to
 * edit RGBA (alpha is a normal channel of the stop). Interpolation: linear | smooth | oklab | step.
 */
export class GradientEditor implements Widget<GradientValue> {
  readonly el: HTMLElement;
  private v: GradientValue;
  private sel = 0;
  private bar = h('div', { class: 'bar' });
  private fill = h('i');
  private abar = h('div', { class: 'abar' });
  private stopsEl = h('div', { class: 'stops' });
  private posField: NumberField;
  private alphaField: NumberField;
  private colorBtn = h('button', { class: 'k-swatch', style: { flex: '0 0 3rem' } });
  private colorFill = h('i');
  private interp: Dropdown;
  private picker: ColorPickerHandle | null = null;
  private pickerStop = -1;
  private lastDown = { t: 0, i: -1 };

  constructor(value: GradientValue, private cb: WidgetCallbacks<GradientValue> = {}) {
    this.v = JSON.parse(JSON.stringify(value)) as GradientValue;
    this.bar.append(this.fill);
    this.colorBtn.append(this.colorFill);
    this.posField = new NumberField({ min: 0, max: 1, scale: 100, unit: '%', precision: 1, step: 0.01, tip: t('gradient.stopPosition') }, this.fieldCb(() => ((this.cur().pos = this.posField.get()), this.sortKeepSel())));
    this.alphaField = new NumberField({ min: 0, max: 1, scale: 100, unit: '%', precision: 0, step: 0.01, tip: t('gradient.stopAlphaANormal') }, this.fieldCb(() => (this.cur().color[3] = this.alphaField.get())));
    this.interp = new Dropdown({ options: INTERPS, value: this.v.interp ?? 'linear', tip: 'Interpolation' }, { onInput: (m) => this.apply(() => (this.v.interp = m as GradientInterp)) });
    const detail = h(
      'div',
      { class: 'detail' },
      this.colorBtn,
      this.posField.el,
      this.alphaField.el,
      h('button', { class: 'k-ibtn sm', tip: t('gradient.deleteStop'), onclick: () => this.removeStop(this.sel) }, icon('delete', 12)),
      h('button', { class: 'k-ibtn sm', tip: 'Reverse', onclick: () => this.apply(() => this.reverse()) }, icon('refresh', 12)),
    );
    this.el = h('div', { class: 'k-grad', tabindex: 0 }, this.bar, this.abar, this.stopsEl, detail, h('div', { class: 'detail' }, this.interp.el, h('button', { class: 'k-mini', tip: t('gradient.gradientPresetsFoldersImport'), onclick: (e: Event) => this.presets(e.currentTarget as HTMLElement) }, 'Presets')));
    this.bar.addEventListener('pointerdown', (e) => this.barDown(e));
    this.el.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && (e.target as HTMLElement).tagName !== 'INPUT') {
        this.removeStop(this.sel);
        e.preventDefault();
      }
    });
    this.colorBtn.addEventListener('click', () => this.editColor());
    this.render();
  }

  private fieldCb(mut: () => void): WidgetCallbacks<number> {
    return { onBegin: () => this.cb.onBegin?.(), onInput: () => this.apply(mut), onEnd: () => this.cb.onEnd?.() };
  }
  private cur(): GradientStop {
    return this.v.stops[clamp(this.sel, 0, this.v.stops.length - 1)];
  }
  private apply(mut: () => void): void {
    mut();
    this.render();
    this.cb.onInput?.(this.get());
  }
  private sortKeepSel(): void {
    const c = this.cur();
    this.v.stops.sort((a, b) => a.pos - b.pos);
    this.sel = this.v.stops.indexOf(c);
  }
  private reverse(): void {
    this.v.stops = this.v.stops.map((s) => ({ ...s, pos: 1 - s.pos })).sort((a, b) => a.pos - b.pos);
    this.sel = this.v.stops.length - 1 - this.sel;
  }
  private removeStop(i: number): void {
    if (this.v.stops.length <= 1) return;
    this.apply(() => {
      this.v.stops.splice(i, 1);
      this.sel = clamp(i - 1, 0, this.v.stops.length - 1);
    });
  }
  private addStop(pos: number): void {
    const c = evalGradient(this.v, pos);
    this.apply(() => {
      const s: GradientStop = { pos, color: c };
      this.v.stops.push(s);
      this.v.stops.sort((a, b) => a.pos - b.pos);
      this.sel = this.v.stops.indexOf(s);
    });
  }
  private barDown(e: PointerEvent): void {
    const r = this.bar.getBoundingClientRect();
    this.cb.onBegin?.();
    this.picker?.close();
    this.addStop(clamp((e.clientX - r.left) / r.width, 0, 1));
    dragPointer(e, (_dx, _dy, ev) => this.apply(() => ((this.cur().pos = clamp((ev.clientX - r.left) / r.width, 0, 1)), this.sortKeepSel())), () => this.cb.onEnd?.());
  }
  private editColor(): void {
    if (this.picker) return void this.picker.close();
    // IMPORTANT: never keep a reference to a stop object here. The Properties panel calls set() with a deep copy after
    // every finished edit, which replaces `this.v`; a captured stop would be detached and later edits would be lost
    // (the stop would stay at the first colour it got). Always address the CURRENT selected stop.
    this.pickerStop = this.sel;
    this.picker = openColorPicker(this.colorBtn, this.cur().color, {
      hdr: true,
      onBegin: () => this.cb.onBegin?.(),
      onEnd: () => this.cb.onEnd?.(),
      onInput: (c) => this.apply(() => (this.cur().color = [c[0], c[1], c[2], c[3]] as RGBA)),
      onClose: () => (this.picker = null),
    });
  }

  private presets(anchor: HTMLElement): void {
    openPresetBrowser(anchor, gradientPresets(), {
      title: t('gradient.gradientPresets'),
      current: () => this.get(),
      apply: (g) => this.apply(() => ((this.v = JSON.parse(JSON.stringify(g)) as GradientValue), (this.sel = 0))),
      preview: (ctx, w, hh, g) => {
        for (let x = 0; x < w; x++) {
          const c = evalGradient(g, x / (w - 1));
          ctx.fillStyle = cssFromLinear(c);
          ctx.fillRect(x, 0, 1, hh);
        }
      },
    });
  }

  private render(): void {
    const n = 48;
    const cols: string[] = [];
    const acols: string[] = [];
    for (let i = 0; i <= n; i++) {
      const c = evalGradient(this.v, i / n);
      cols.push(`${cssFromLinear(c)} ${((i / n) * 100).toFixed(1)}%`);
      acols.push(`rgb(${Math.round(clamp(c[3], 0, 1) * 255)},${Math.round(clamp(c[3], 0, 1) * 255)},${Math.round(clamp(c[3], 0, 1) * 255)}) ${((i / n) * 100).toFixed(1)}%`);
    }
    this.fill.style.background = `linear-gradient(90deg, ${cols.join(',')})`;
    this.abar.style.background = `linear-gradient(90deg, ${acols.join(',')})`;
    this.stopsEl.replaceChildren(
      ...this.v.stops.map((s, i) => {
        const el = h('div', { class: `stop${i === this.sel ? ' sel' : ''}`, style: { left: `${s.pos * 100}%`, '--c': cssFromLinear(s.color, false) } as Partial<CSSStyleDeclaration> });
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          // render() below replaces the stop elements, so a native dblclick never fires: detect it manually.
          const now = performance.now();
          if (this.lastDown.i === i && now - this.lastDown.t < 350 && this.v.stops.length > 1) {
            this.lastDown = { t: 0, i: -1 };
            this.removeStop(i);
            return;
          }
          this.lastDown = { t: now, i };
          if (this.sel !== i && this.picker) this.picker.close(); // the picker edits one stop: close on selection change
          this.sel = i;
          const r = this.stopsEl.getBoundingClientRect();
          this.cb.onBegin?.();
          this.render();
          const cur = this.v.stops[i];
          dragPointer(
            e,
            (_dx, dy, ev) => {
              if (dy > 40 && this.v.stops.length > 1) return; // pull away to delete (applied on release)
              this.apply(() => ((cur.pos = clamp((ev.clientX - r.left) / r.width, 0, 1)), this.sortKeepSel()));
            },
            (_c, ev) => {
              if (ev.clientY - e.clientY > 40 && this.v.stops.length > 1) this.removeStop(this.v.stops.indexOf(cur));
              this.cb.onEnd?.();
            },
          );
        });
        el.addEventListener('dblclick', () => this.removeStop(i));
        return el;
      }),
    );
    const s = this.cur();
    this.colorFill.style.background = cssFromLinear(s.color);
    this.posField.set(s.pos);
    this.alphaField.set(s.color[3]);
    this.interp.set(this.v.interp ?? 'linear');
  }

  get(): GradientValue {
    return JSON.parse(JSON.stringify(this.v)) as GradientValue;
  }
  set(v: GradientValue): void {
    this.v = JSON.parse(JSON.stringify(v)) as GradientValue;
    this.sel = clamp(this.sel, 0, this.v.stops.length - 1);
    if (this.picker && this.pickerStop !== this.sel) this.picker.close();
    this.render();
  }
  dispose(): void {
    this.picker?.close();
  }
}
