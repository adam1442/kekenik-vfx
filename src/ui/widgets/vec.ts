import { clamp } from '../../shared/util';
import { dragPointer, h } from '../core/dom';
import { icon } from '../icons';
import { NumberField, type NumberOptions } from './number-field';
import type { Widget, WidgetCallbacks } from './types';

import { t } from '../../shared/i18n';
/** N numeric fields side by side (vec2/vec3). Optional link toggle keeps components equal (uniform scale). */
export class VecFields implements Widget<number[]> {
  readonly el: HTMLElement;
  private fields: NumberField[];
  private linked = false;
  private linkBtn: HTMLButtonElement | null = null;
  private v: number[];
  constructor(n: number, o: NumberOptions & { labels?: string[]; linkable?: boolean }, private cb: WidgetCallbacks<number[]> = {}) {
    this.v = Array.from({ length: n }, () => 0);
    this.fields = Array.from({ length: n }, (_, i) => {
      const f = new NumberField({ ...o, tip: o.labels?.[i] }, {
        onBegin: () => this.cb.onBegin?.(),
        onEnd: () => this.cb.onEnd?.(),
        onInput: (x) => {
          if (this.linked) {
            const old = this.v[i] || 1;
            const ratio = old !== 0 ? x / old : 1;
            this.v = this.v.map((c, j) => (j === i ? x : old !== 0 ? c * ratio : x));
            this.fields.forEach((ff, j) => ff.set(this.v[j]));
          } else this.v[i] = x;
          this.cb.onInput?.([...this.v]);
        },
      });
      return f;
    });
    this.el = h('div', { class: 'k-vec' }, ...this.fields.map((f) => f.el));
    if (o.linkable) {
      this.linkBtn = h('button', { class: 'k-ibtn sm', tip: t('vec.linkComponentsUniform'), onclick: () => this.toggleLink() }, icon('unlink', 12));
      this.el.append(this.linkBtn);
    }
  }
  private toggleLink(): void {
    this.linked = !this.linked;
    this.linkBtn?.classList.toggle('active', this.linked);
    this.linkBtn?.replaceChildren(icon(this.linked ? 'link' : 'unlink', 12));
  }
  get(): number[] {
    return [...this.v];
  }
  set(v: number[]): void {
    this.v = [...v];
    this.fields.forEach((f, i) => f.set(v[i] ?? 0));
  }
  setMixed(m: boolean): void {
    this.fields.forEach((f) => f.setMixed(m));
  }
  dispose(): void {
    this.fields.forEach((f) => f.dispose());
  }
}

/** 2D pad: drag a point inside [minX,maxX] x [minY,maxY]. Y grows upwards. */
export class Vec2Pad implements Widget<[number, number]> {
  readonly el: HTMLElement;
  private dot = h('div', { class: 'dot' });
  private v: [number, number];
  constructor(private o: { min?: number; max?: number; value?: [number, number] } = {}, private cb: WidgetCallbacks<[number, number]> = {}) {
    this.v = o.value ?? [0, 0];
    this.el = h('div', { class: 'k-pad', tabindex: 0, role: 'slider' }, this.dot);
    this.el.addEventListener('pointerdown', (e) => {
      this.cb.onBegin?.();
      this.fromEvent(e);
      dragPointer(e, (_a, _b, ev) => this.fromEvent(ev), () => this.cb.onEnd?.());
    });
    this.el.addEventListener('keydown', (e) => {
      const st = ((this.o.max ?? 1) - (this.o.min ?? 0)) / 50 * (e.shiftKey ? 0.1 : 1);
      const d: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] };
      if (d[e.key]) {
        e.preventDefault();
        this.v = [this.clampV(this.v[0] + d[e.key][0]), this.clampV(this.v[1] + d[e.key][1])];
        this.render();
        this.cb.onInput?.([...this.v]);
      }
    });
    this.render();
  }
  private clampV(x: number): number {
    return clamp(x, this.o.min ?? 0, this.o.max ?? 1);
  }
  private fromEvent(e: PointerEvent): void {
    const r = this.el.getBoundingClientRect();
    const lo = this.o.min ?? 0;
    const hi = this.o.max ?? 1;
    const x = lo + clamp((e.clientX - r.left) / r.width, 0, 1) * (hi - lo);
    const y = lo + (1 - clamp((e.clientY - r.top) / r.height, 0, 1)) * (hi - lo);
    this.v = [x, y];
    this.render();
    this.cb.onInput?.([x, y]);
  }
  private render(): void {
    const lo = this.o.min ?? 0;
    const hi = this.o.max ?? 1;
    this.dot.style.left = `${((this.v[0] - lo) / (hi - lo)) * 100}%`;
    this.dot.style.top = `${(1 - (this.v[1] - lo) / (hi - lo)) * 100}%`;
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

/** Integer seed field with a dice button (random new seed). */
export class SeedField implements Widget<number> {
  readonly el: HTMLElement;
  private f: NumberField;
  constructor(value: number, private cb: WidgetCallbacks<number> = {}) {
    this.f = new NumberField({ value, integer: true, noFill: true, min: -2147483648, max: 2147483647, tip: 'Seed' }, cb);
    const dice = h('button', { class: 'k-ibtn sm', tip: t('vec.randomizeSeed'), onclick: () => {
      const v = Math.floor(Math.random() * 100000);
      this.f.set(v);
      this.cb.onInput?.(v);
    } }, icon('dice', 14));
    this.el = h('div', { class: 'k-seed' }, this.f.el, dice);
  }
  get(): number {
    return this.f.get();
  }
  set(v: number): void {
    this.f.set(v);
  }
  setMixed(m: boolean): void {
    this.f.setMixed(m);
  }
  dispose(): void {}
}
