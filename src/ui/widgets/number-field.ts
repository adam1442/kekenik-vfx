import { clamp } from '../../shared/util';
import { dragPointer, h } from '../core/dom';
import type { Widget, WidgetCallbacks } from './types';

/** Safe arithmetic expression parser for typed values: "50%", "1/3", "2*(3+4)", "12px". Returns NaN on failure. */
export function parseExpr(src: string): number {
  const s = src.replace(/[%°]|px|deg|ms|s\b/gi, '').replace(/,/g, '.').replace(/\s+/g, '');
  let i = 0;
  const peek = (): string => s[i] ?? '';
  const num = (): number => {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) return NaN;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const atom = (): number => {
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') return NaN;
      i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -atom();
    }
    if (peek() === '+') {
      i++;
      return atom();
    }
    return num();
  };
  const term = (): number => {
    let v = atom();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const r = atom();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  function expr(): number {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  if (!s) return NaN;
  const v = expr();
  return i === s.length ? v : NaN;
}

export interface NumberOptions {
  value?: number;
  /** Hard range (typing / commit clamps to it). */
  min?: number;
  max?: number;
  /** Soft range = slider range, scrubbing clamps to it. */
  softMin?: number;
  softMax?: number;
  step?: number;
  precision?: number;
  integer?: boolean;
  unit?: string;
  /** Display multiplier (percent fields store fractions: scale 100). */
  scale?: number;
  disabled?: boolean;
  tip?: string;
  /** Hide the fill bar. */
  noFill?: boolean;
}

/**
 * Drag-scrub number field. Drag horizontally to scrub (Shift = fine x0.1, Ctrl = coarse x10), double-click (or Enter
 * while focused) to type (expressions allowed), arrow keys step. Soft range limits scrubbing, hard range limits typing.
 * Callbacks: onBegin/onInput.../onEnd bracket a scrub; typed commits call onInput alone.
 */
export class NumberField implements Widget<number> {
  readonly el: HTMLElement;
  private txt: HTMLElement;
  private fill: HTMLElement;
  private value: number;
  private mixed = false;
  private editing = false;
  private o: Required<Pick<NumberOptions, 'scale' | 'step'>> & NumberOptions;

  constructor(opts: NumberOptions = {}, private cb: WidgetCallbacks<number> = {}) {
    this.o = { scale: 1, step: opts.integer ? 1 : 0.01, ...opts };
    this.value = opts.value ?? 0;
    this.fill = h('div', { class: 'fill' });
    this.txt = h('div', { class: 'txt' });
    this.el = h('div', { class: 'k-num', tabindex: 0, role: 'spinbutton', tip: opts.tip }, this.fill, this.txt);
    if (opts.disabled) this.el.classList.add('disabled');
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('dblclick', () => this.edit());
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.render();
  }

  get(): number {
    return this.value;
  }
  set(v: number): void {
    if (this.editing) return;
    this.value = v;
    this.mixed = false;
    this.render();
  }
  setMixed(m: boolean): void {
    this.mixed = m;
    this.render();
  }
  setDisabled(d: boolean): void {
    this.el.classList.toggle('disabled', d);
  }
  setOptions(o: Partial<NumberOptions>): void {
    Object.assign(this.o, o);
    this.render();
  }
  dispose(): void {
    /* no global listeners */
  }

  private sMin(): number {
    return this.o.softMin ?? this.o.min ?? -Infinity;
  }
  private sMax(): number {
    return this.o.softMax ?? this.o.max ?? Infinity;
  }
  private hard(v: number): number {
    if (this.o.integer) v = Math.round(v);
    return clamp(v, this.o.min ?? -Infinity, this.o.max ?? Infinity);
  }
  private fmt(v: number): string {
    const d = v * this.o.scale;
    if (this.o.integer) return String(Math.round(d));
    const p = this.o.precision ?? 3;
    return d.toFixed(p);
  }
  private render(): void {
    this.txt.replaceChildren(this.mixed ? '—' : this.fmt(this.value), this.o.unit ? h('span', { class: 'unit' }, this.o.unit) : '');
    this.el.classList.toggle('mixed', this.mixed);
    const lo = this.sMin();
    const hi = this.sMax();
    const showFill = !this.o.noFill && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
    this.fill.style.display = showFill && !this.mixed ? '' : 'none';
    if (showFill) this.fill.style.width = `${clamp((this.value - lo) / (hi - lo), 0, 1) * 100}%`;
    this.el.setAttribute('aria-valuenow', String(this.value));
  }
  private commit(v: number, live: boolean): void {
    const nv = this.hard(v);
    if (nv === this.value && !this.mixed) return;
    this.value = nv;
    this.mixed = false;
    this.render();
    void live;
    this.cb.onInput?.(nv);
  }

  private down(e: PointerEvent): void {
    if (this.editing || e.button !== 0 || this.el.classList.contains('disabled')) return;
    const startV = this.value;
    const rect = this.el.getBoundingClientRect();
    const lo = this.sMin();
    const hi = this.sMax();
    const finite = Number.isFinite(lo) && Number.isFinite(hi);
    const perPx = finite ? (hi - lo) / Math.max(rect.width, 80) : Math.max(this.o.step, Math.abs(startV) * 0.01);
    let began = false;
    let acc = 0;
    let lastX = 0;
    this.el.focus();
    dragPointer(
      e,
      (dx, _dy, ev) => {
        if (!began) {
          if (Math.abs(dx) < 3) return;
          began = true;
          lastX = dx;
          this.el.classList.add('scrubbing');
          this.cb.onBegin?.();
          document.body.style.cursor = 'ew-resize';
        }
        const mul = ev.shiftKey ? 0.1 : ev.ctrlKey || ev.metaKey ? 10 : 1;
        acc += (dx - lastX) * perPx * mul;
        lastX = dx;
        let v = clamp(startV + acc, lo, hi);
        const snap = this.o.integer ? 1 : ev.ctrlKey || ev.metaKey ? this.o.step * 10 : 0;
        if (snap) v = Math.round(v / snap) * snap;
        this.commit(v, true);
      },
      () => {
        document.body.style.cursor = '';
        this.el.classList.remove('scrubbing');
        if (began) this.cb.onEnd?.();
      },
    );
  }

  /** Switch to typing mode. */
  edit(): void {
    if (this.editing) return;
    this.editing = true;
    this.el.classList.add('editing');
    const input = h('input', { type: 'text', value: this.mixed ? '' : this.fmt(this.value), spellcheck: 'false' });
    this.el.append(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (apply: boolean): void => {
      if (done) return;
      done = true;
      this.editing = false;
      this.el.classList.remove('editing');
      if (apply) {
        const v = parseExpr(input.value);
        if (Number.isFinite(v)) {
          const raw = v / this.o.scale;
          this.commit(raw, false);
        }
      }
      input.remove();
      this.render();
      this.el.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  private key(e: KeyboardEvent): void {
    if (this.editing) return;
    const mul = e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this.commit(this.value + this.o.step * mul, false);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this.commit(this.value - this.o.step * mul, false);
    else if (e.key === 'Enter' || e.key === 'F2') this.edit();
    else return;
    e.preventDefault();
  }
}

/** Horizontal slider with a thumb. */
export class Slider implements Widget<number> {
  readonly el: HTMLElement;
  private thumb: HTMLElement;
  private range: HTMLElement;
  private v: number;
  constructor(private o: { min: number; max: number; step?: number; value?: number }, private cb: WidgetCallbacks<number> = {}) {
    this.v = o.value ?? o.min;
    this.range = h('div', { class: 'range' });
    this.thumb = h('div', { class: 'thumb', tabindex: 0, role: 'slider' });
    this.el = h('div', { class: 'k-slider' }, h('div', { class: 'track' }), this.range, this.thumb);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.fromEvent(e);
      this.thumb.classList.add('drag');
      this.cb.onBegin?.();
      dragPointer(e, (_dx, _dy, ev) => this.fromEvent(ev), () => {
        this.thumb.classList.remove('drag');
        this.cb.onEnd?.();
      });
    });
    this.thumb.addEventListener('keydown', (e) => {
      const st = (this.o.step ?? (this.o.max - this.o.min) / 100) * (e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1);
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this.setV(this.v + st, true);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this.setV(this.v - st, true);
      else return;
      e.preventDefault();
    });
    this.render();
  }
  private fromEvent(e: PointerEvent): void {
    const r = this.el.getBoundingClientRect();
    const t = clamp((e.clientX - r.left) / Math.max(r.width, 1), 0, 1);
    this.setV(this.o.min + t * (this.o.max - this.o.min), true);
  }
  private setV(v: number, emit: boolean): void {
    const st = this.o.step;
    if (st) v = Math.round((v - this.o.min) / st) * st + this.o.min;
    v = clamp(v, this.o.min, this.o.max);
    if (v === this.v) return;
    this.v = v;
    this.render();
    if (emit) this.cb.onInput?.(v);
  }
  private render(): void {
    const t = (this.v - this.o.min) / (this.o.max - this.o.min || 1);
    this.thumb.style.left = `${t * 100}%`;
    this.range.style.left = '0';
    this.range.style.width = `${t * 100}%`;
  }
  get(): number {
    return this.v;
  }
  set(v: number): void {
    this.setV(v, false);
  }
  dispose(): void {}
}

/** Two-thumb range slider (value = [lo, hi]). */
export class RangeSlider implements Widget<[number, number]> {
  readonly el: HTMLElement;
  private t0: HTMLElement;
  private t1: HTMLElement;
  private range: HTMLElement;
  private v: [number, number];
  constructor(private o: { min: number; max: number; step?: number; value?: [number, number] }, private cb: WidgetCallbacks<[number, number]> = {}) {
    this.v = o.value ?? [o.min, o.max];
    this.range = h('div', { class: 'range' });
    this.t0 = h('div', { class: 'thumb', tabindex: 0 });
    this.t1 = h('div', { class: 'thumb', tabindex: 0 });
    this.el = h('div', { class: 'k-slider' }, h('div', { class: 'track' }), this.range, this.t0, this.t1);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = this.el.getBoundingClientRect();
      const val = (ev: PointerEvent): number => this.o.min + clamp((ev.clientX - r.left) / Math.max(r.width, 1), 0, 1) * (this.o.max - this.o.min);
      const x = val(e);
      const which = Math.abs(x - this.v[0]) <= Math.abs(x - this.v[1]) ? 0 : 1;
      const apply = (ev: PointerEvent): void => {
        let n = val(ev);
        if (this.o.step) n = Math.round(n / this.o.step) * this.o.step;
        const nv: [number, number] = [...this.v];
        nv[which] = which === 0 ? Math.min(n, this.v[1]) : Math.max(n, this.v[0]);
        if (nv[0] !== this.v[0] || nv[1] !== this.v[1]) {
          this.v = nv;
          this.render();
          this.cb.onInput?.(nv);
        }
      };
      apply(e);
      this.cb.onBegin?.();
      dragPointer(e, (_a, _b, ev) => apply(ev), () => this.cb.onEnd?.());
    });
    this.render();
  }
  private render(): void {
    const s = this.o.max - this.o.min || 1;
    const a = (this.v[0] - this.o.min) / s;
    const b = (this.v[1] - this.o.min) / s;
    this.t0.style.left = `${a * 100}%`;
    this.t1.style.left = `${b * 100}%`;
    this.range.style.left = `${a * 100}%`;
    this.range.style.width = `${(b - a) * 100}%`;
  }
  get(): [number, number] {
    return [...this.v];
  }
  set(v: [number, number]): void {
    this.v = [...v];
    this.render();
  }
  dispose(): void {}
}
