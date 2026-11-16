import { clamp } from '../../shared/util';
import type { RGBA } from '../../shared/util';
import { dragPointer, h, listen } from '../core/dom';
import { icon } from '../icons';
import { NumberField } from './number-field';
import type { Widget, WidgetCallbacks } from './types';

import { t as tt } from '../../shared/i18n';
/* ---------------------------------------------------------------- color math (pure) */
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

export function hsvToRgb(hh: number, s: number, v: number): [number, number, number] {
  const h6 = (((hh % 1) + 1) % 1) * 6;
  const i = Math.floor(h6);
  const f = h6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6] as [number, number, number];
}
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let hh = 0;
  if (d > 1e-9) {
    if (mx === r) hh = ((g - b) / d + 6) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh /= 6;
  }
  return [hh, mx <= 0 ? 0 : d / mx, mx];
}

/** Linear RGBA (param value) -> CSS color string in sRGB (HDR clipped for display). */
export function cssFromLinear(c: ArrayLike<number>, withAlpha = true): string {
  const e = (x: number): number => Math.round(clamp(linearToSrgb(clamp(x, 0, 1)), 0, 1) * 255);
  return withAlpha ? `rgba(${e(c[0])},${e(c[1])},${e(c[2])},${clamp(c[3] ?? 1, 0, 1).toFixed(3)})` : `rgb(${e(c[0])},${e(c[1])},${e(c[2])})`;
}
export function hexFromLinear(c: ArrayLike<number>): string {
  const e = (x: number): string => Math.round(clamp(linearToSrgb(clamp(x, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${e(c[0])}${e(c[1])}${e(c[2])}`;
}
export function linearFromHex(hex: string, alpha = 1): RGBA | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  const n = (i: number): number => srgbToLinear(parseInt(s.slice(i, i + 2), 16) / 255);
  return [n(0), n(2), n(4), s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : alpha];
}

/* ---------------------------------------------------------------- picker popup */
interface PickerState {
  h: number;
  s: number;
  v: number;
  a: number;
  /** HDR multiplier (>= 1 only used when hdr). */
  k: number;
}

function stateFromLinear(c: ArrayLike<number>, hdr: boolean, prevHue = 0): PickerState {
  const mx = Math.max(c[0], c[1], c[2]);
  const k = hdr && mx > 1 ? mx : 1;
  const enc = [0, 1, 2].map((i) => linearToSrgb(clamp(c[i] / k, 0, 1))) as [number, number, number];
  const [hh, s, v] = rgbToHsv(...enc);
  return { h: s < 1e-4 || v < 1e-4 ? prevHue : hh, s, v, a: c[3] ?? 1, k };
}
function linearFromState(st: PickerState): RGBA {
  const [r, g, b] = hsvToRgb(st.h, st.s, st.v);
  return [srgbToLinear(r) * st.k, srgbToLinear(g) * st.k, srgbToLinear(b) * st.k, st.a];
}

/** Last hue the user picked: grey colours carry no hue, so a fresh picker starts from it instead of always red. */
let lastHue = 0;

export interface ColorPickerHandle {
  close(): void;
}

/**
 * Color picker popup. Alpha is an ordinary channel (it has its own slider/field like R, G, B). Works in sRGB-encoded
 * HSV/RGB (what artists expect) while the value is LINEAR RGBA. `hdr` adds an intensity multiplier (values > 1).
 */
export function openColorPicker(anchor: HTMLElement, initial: ArrayLike<number>, opts: { hdr?: boolean; noAlpha?: boolean; onInput: (c: RGBA) => void; onBegin?: () => void; onEnd?: () => void; onClose?: () => void }): ColorPickerHandle {
  const hdr = !!opts.hdr;
  let st = stateFromLinear(initial, hdr, lastHue);
  const original = [...Array.from(initial), 1].slice(0, 4) as RGBA;
  const W = 220;
  const sv = h('canvas', { width: W, height: 150 });
  const svCtx = sv.getContext('2d')!;
  const hueStrip = h('div', { class: 'strip' }, h('i', { style: { background: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' } }), h('b'));
  const alphaFill = h('i');
  const alphaStrip = h('div', { class: 'strip alpha' }, alphaFill, h('b'));
  const newSw = h('i');
  const oldSw = h('i', { style: { background: cssFromLinear(original) } });
  const prev = h('div', { class: 'prev' }, oldSw, newSw);
  const hex = h('input', { class: 'hex', type: 'text', spellcheck: 'false', maxlength: '9' });
  const mode: { v: 'RGB' | 'HSV' } = { v: 'RGB' };
  const fields = h('div', { class: 'row' });
  const modeBtn = h('button', { class: 'k-btn', style: { padding: '0 0.5rem', height: '1.5rem' }, onclick: () => ((mode.v = mode.v === 'RGB' ? 'HSV' : 'RGB'), buildFields(), refresh()) }, 'RGB');
  const nfs: NumberField[] = [];
  const kField = new NumberField({ value: 1, min: 1, max: 1000, softMin: 1, softMax: 16, precision: 2, step: 0.1, tip: tt('color.hdrIntensityMultiplier') }, { onBegin: () => opts.onBegin?.(), onInput: (v) => ((st.k = v), emit()), onEnd: () => opts.onEnd?.() });

  const root = h('div', { class: 'k-picker', role: 'dialog' }, sv, hueStrip, opts.noAlpha ? null : alphaStrip, prev, h('div', { class: 'row' }, hex, modeBtn, 'EyeDropper' in window ? h('button', { class: 'k-ibtn sm', tip: tt('color.pickColorFromScreen'), onclick: () => void pick() }, icon('eyedropper', 13)) : null), fields, hdr ? h('div', { class: 'row' }, h('label', { style: { width: '3.5rem' } }, 'HDR ×'), kField.el) : null);

  function enc(): [number, number, number] {
    return hsvToRgb(st.h, st.s, st.v);
  }
  function buildFields(): void {
    modeBtn.textContent = mode.v;
    nfs.length = 0;
    fields.replaceChildren();
    const labels = mode.v === 'RGB' ? ['R', 'G', 'B'] : ['H', 'S', 'V'];
    if (!opts.noAlpha) labels.push('A');
    labels.forEach((l, i) => {
      const nf = new NumberField({ min: 0, max: 255, softMin: 0, softMax: i === 3 ? 100 : 255, integer: true, noFill: false, scale: 1, tip: l }, {
        onBegin: () => opts.onBegin?.(),
        onEnd: () => opts.onEnd?.(),
        onInput: (v) => {
          if (i === 3) st.a = clamp(v / 100, 0, 1);
          else if (mode.v === 'RGB') {
            const e = enc();
            e[i] = clamp(v / 255, 0, 1);
            const [hh, s, vv] = rgbToHsv(...e);
            st = { ...st, h: s < 1e-4 || vv < 1e-4 ? st.h : hh, s, v: vv };
          } else if (i === 0) st.h = clamp(v / 360, 0, 1);
          else if (i === 1) st.s = clamp(v / 100, 0, 1);
          else st.v = clamp(v / 100, 0, 1);
          emit();
        },
      });
      nf.setOptions({ softMax: i === 3 || mode.v === 'HSV' ? (i === 0 && mode.v === 'HSV' ? 360 : 100) : 255, max: i === 3 || mode.v === 'HSV' ? (i === 0 && mode.v === 'HSV' ? 360 : 100) : 255 });
      nfs.push(nf);
      fields.append(h('label', { class: 'k-dim', style: { fontSize: 'var(--fs-xs)' } }, l), nf.el);
    });
  }
  function drawSV(): void {
    const w = sv.width;
    const hh = sv.height;
    const [r, g, b] = hsvToRgb(st.h, 1, 1);
    svCtx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    svCtx.fillRect(0, 0, w, hh);
    const gw = svCtx.createLinearGradient(0, 0, w, 0);
    gw.addColorStop(0, '#fff');
    gw.addColorStop(1, 'rgba(255,255,255,0)');
    svCtx.fillStyle = gw;
    svCtx.fillRect(0, 0, w, hh);
    const gb = svCtx.createLinearGradient(0, 0, 0, hh);
    gb.addColorStop(0, 'rgba(0,0,0,0)');
    gb.addColorStop(1, '#000');
    svCtx.fillStyle = gb;
    svCtx.fillRect(0, 0, w, hh);
    const x = st.s * w;
    const y = (1 - st.v) * hh;
    svCtx.strokeStyle = '#000';
    svCtx.lineWidth = 3;
    svCtx.beginPath();
    svCtx.arc(x, y, 5, 0, 7);
    svCtx.stroke();
    svCtx.strokeStyle = '#fff';
    svCtx.lineWidth = 1.5;
    svCtx.beginPath();
    svCtx.arc(x, y, 5, 0, 7);
    svCtx.stroke();
  }
  function refresh(): void {
    drawSV();
    const lin = linearFromState(st);
    const [r, g, b] = enc();
    (hueStrip.lastElementChild as HTMLElement).style.left = `${st.h * 100}%`;
    (alphaStrip.lastElementChild as HTMLElement).style.left = `${st.a * 100}%`;
    alphaFill.style.background = `linear-gradient(90deg, rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},0), rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}))`;
    newSw.style.background = cssFromLinear(lin);
    if (document.activeElement !== hex) hex.value = hexFromLinear(lin) + (opts.noAlpha ? '' : Math.round(st.a * 255).toString(16).padStart(2, '0'));
    const vals = mode.v === 'RGB' ? [r * 255, g * 255, b * 255] : [st.h * 360, st.s * 100, st.v * 100];
    vals.forEach((v, i) => nfs[i]?.set(Math.round(v)));
    if (!opts.noAlpha) nfs[3]?.set(Math.round(st.a * 100));
    kField.set(st.k);
  }
  function emit(): void {
    if (st.s > 1e-4 && st.v > 1e-4) lastHue = st.h;
    refresh();
    opts.onInput(linearFromState(st));
  }
  async function pick(): Promise<void> {
    try {
      const ED = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
      const r = await new ED().open();
      const c = linearFromHex(r.sRGBHex, st.a);
      if (c) {
        st = stateFromLinear(c, hdr, st.h);
        emit();
      }
    } catch {
      /* cancelled */
    }
  }

  // interactions
  const svDrag = (e: PointerEvent): void => {
    const r = sv.getBoundingClientRect();
    const f = (ev: PointerEvent): void => {
      st.s = clamp((ev.clientX - r.left) / r.width, 0, 1);
      st.v = 1 - clamp((ev.clientY - r.top) / r.height, 0, 1);
      emit();
    };
    opts.onBegin?.();
    f(e);
    dragPointer(e, (_a, _b, ev) => f(ev), () => opts.onEnd?.());
  };
  sv.addEventListener('pointerdown', svDrag);
  const strip = (el: HTMLElement, set: (t: number) => void): void => {
    el.addEventListener('pointerdown', (e) => {
      const r = el.getBoundingClientRect();
      const f = (ev: PointerEvent): void => {
        set(clamp((ev.clientX - r.left) / r.width, 0, 1));
        emit();
      };
      opts.onBegin?.();
      f(e);
      dragPointer(e, (_a, _b, ev) => f(ev), () => opts.onEnd?.());
    });
  };
  strip(hueStrip, (t) => (st.h = t >= 1 ? 0.9999 : t));
  strip(alphaStrip, (t) => (st.a = t));
  hex.addEventListener('keydown', (e) => e.stopPropagation());
  hex.addEventListener('change', () => {
    const c = linearFromHex(hex.value, st.a);
    if (c) {
      st = stateFromLinear(c, hdr, st.h);
      emit();
    }
  });

  buildFields();
  refresh();
  document.body.append(root);
  const place = (): void => {
    const b = anchor.getBoundingClientRect();
    const w = root.offsetWidth;
    const hh = root.offsetHeight;
    let x = Math.min(b.left, window.innerWidth - w - 6);
    let y = b.bottom + 4;
    if (y + hh > window.innerHeight - 6) y = Math.max(6, b.top - hh - 4);
    x = Math.max(6, x);
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
  };
  place();
  const offs = [
    listen(window, 'pointerdown', (e: PointerEvent) => {
      if (!root.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
    }, { capture: true }),
    listen(window, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    }),
    listen(window, 'resize', place),
  ];
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    offs.forEach((o) => o());
    root.remove();
    opts.onClose?.();
  }
  return { close };
}

/* ---------------------------------------------------------------- swatch widget */
export class ColorSwatch implements Widget<RGBA> {
  readonly el: HTMLButtonElement;
  private solid = h('i', { class: 'solid' });
  private full = h('i');
  private v: RGBA;
  private picker: ColorPickerHandle | null = null;
  constructor(private o: { value?: RGBA; hdr?: boolean; noAlpha?: boolean } = {}, private cb: WidgetCallbacks<RGBA> = {}) {
    this.v = (o.value ?? [1, 1, 1, 1]).slice() as RGBA;
    this.el = h('button', { class: 'k-swatch', 'aria-label': 'Color' }, this.full, this.solid);
    this.el.addEventListener('click', () => this.toggle());
    this.render();
  }
  private toggle(): void {
    if (this.picker) {
      this.picker.close();
      return;
    }
    this.picker = openColorPicker(this.el, this.v, {
      hdr: this.o.hdr,
      noAlpha: this.o.noAlpha,
      onBegin: () => this.cb.onBegin?.(),
      onEnd: () => this.cb.onEnd?.(),
      onInput: (c) => {
        this.v = c;
        this.render();
        this.cb.onInput?.(c);
      },
      onClose: () => (this.picker = null),
    });
  }
  private render(): void {
    this.full.style.background = cssFromLinear(this.v);
    this.solid.style.background = cssFromLinear(this.v, false);
    this.el.classList.toggle('hdr', Math.max(this.v[0], this.v[1], this.v[2]) > 1);
  }
  get(): RGBA {
    return [...this.v] as RGBA;
  }
  set(v: RGBA): void {
    this.v = [...v] as RGBA;
    this.render();
  }
  dispose(): void {
    this.picker?.close();
  }
}
