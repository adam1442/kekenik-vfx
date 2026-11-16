import { onUiChange } from '../theme/ui-store';
import { BINS, CH_INDEX, gammaFromHandle, gammaHandle, normalizeBins, type HistChannel, type HistRange, type HistResult } from '../../engine/analysis/histogram-core';
import type { HistogramClient, HistogramState } from '../../engine/analysis/histogram-gpu';
import { t } from '../../shared/i18n';
import { h } from '../core/dom';

/**
 * live histogram UI for the Properties panel.
 *  - mode 'levels': canvas with the INPUT histogram (+ faint OUTPUT overlay) and draggable black / gamma / white handles.
 *  - mode 'curve': only the controls; the normalised bins go to `onBins` (the curve editor draws them behind the curve via setHistogram).
 * Only works while visible (IntersectionObserver): hidden widgets cost nothing. Channel / scale / HDR choices persist for the session.
 * Handles write through `LevelsControls` (begin / set / end) = one coalesced undo step per drag.
 */
export interface LevelsControls {
  begin(): void;
  set(id: 'in_low' | 'in_high' | 'gamma', v: number): void;
  end(): void;
  get(id: 'in_low' | 'in_high' | 'gamma'): number;
  /** Auto levels is on: black / white handles are display only. */
  locked(): boolean;
}

export const histPrefs: { channel: HistChannel; log: boolean; hdr: boolean; out: boolean } = { channel: 'luma', log: false, hdr: false, out: false };

export interface StripOptions {
  mode: 'levels' | 'curve';
  levels?: LevelsControls;
  onBins?: (bins: Float32Array | null) => void;
}

const COLORS: Record<HistChannel, string> = { luma: '#cfd3da', r: '#ff6a6a', g: '#6aff8a', b: '#6a9aff', a: '#e0e0e0' };

export class HistogramStrip {
  readonly el: HTMLElement;
  private canvas = h('canvas', { width: '256', height: '72', class: 'k-hist-canvas', style: { width: '100%', height: '6rem', display: 'block', background: 'rgba(0,0,0,0.25)', borderRadius: '0.25rem', touchAction: 'none' } }) as HTMLCanvasElement;
  private hint = h('div', { class: 'k-dim', style: { fontSize: '0.917rem', padding: '0.167rem 0' } });
  private sel = h('select', { class: 'k-sel', style: { fontSize: '0.917rem' } }) as HTMLSelectElement;
  private state: HistogramState = { status: 'idle' };
  private drag: 'in_low' | 'in_high' | 'gamma' | null = null;
  private io?: IntersectionObserver;
  private off: () => void;

  private offUi: () => void = () => undefined;
  constructor(
    private readonly client: HistogramClient,
    private readonly o: StripOptions,
  ) {
    this.offUi = onUiChange(() => this.draw());
    for (const c of ['luma', 'r', 'g', 'b', 'a'] as HistChannel[]) this.sel.append(h('option', { value: c }, t(`hist.${c}`)));
    this.sel.value = histPrefs.channel;
    this.sel.addEventListener('change', () => {
      histPrefs.channel = this.sel.value as HistChannel;
      this.draw();
    });
    const toggle = (label: string, tip: string, get: () => boolean, set: (v: boolean) => void, refresh = false): HTMLElement => {
      const b = h('button', { class: 'k-btn sm', tip, style: { fontSize: '0.917rem', padding: '0 0.5rem' } }, label);
      const upd = (): void => void b.classList.toggle('active', get());
      b.addEventListener('click', () => {
        set(!get());
        upd();
        if (refresh) client.invalidate();
        else this.draw();
      });
      upd();
      return b;
    };
    const controls = h(
      'div',
      { style: { display: 'flex', gap: '0.333rem', alignItems: 'center', marginBottom: '0.25rem' } },
      this.sel,
      toggle(t('hist.log'), t('hist.scale.tip'), () => histPrefs.log, (v) => (histPrefs.log = v)),
      toggle(t('hist.hdr'), t('hist.hdr.tip'), () => histPrefs.hdr, (v) => (histPrefs.hdr = v), true),
      ...(o.mode === 'levels' ? [toggle(t('hist.out'), t('hist.out.tip'), () => histPrefs.out, (v) => (histPrefs.out = v), true)] : []),
    );
    this.el = h('div', { class: 'k-hist', style: { width: '100%' } }, controls, ...(o.mode === 'levels' ? [this.canvas] : []), this.hint);
    this.off = client.onState.on((s) => {
      this.state = s;
      this.draw();
    });
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((es) => {
        for (const e of es) client.setVisible(e.isIntersecting);
      });
      this.io.observe(this.el);
    }
    if (o.mode === 'levels') this.bindHandles();
    this.draw();
  }

  /** Redraw after a parameter changed (handles move). */
  refresh(): void {
    this.draw();
  }

  private res(): HistRange {
    return this.state.input?.range ?? { min: 0, max: 1 };
  }

  private handleX(id: 'in_low' | 'in_high' | 'gamma'): number {
    const L = this.o.levels!;
    const r = this.res();
    const lo = L.get('in_low');
    const hi = L.get('in_high');
    const v = id === 'gamma' ? lo + (hi - lo) * gammaHandle(L.get('gamma')) : L.get(id);
    return ((v - r.min) / (r.max - r.min)) * (this.canvas.width - 1);
  }

  private bindHandles(): void {
    const L = this.o.levels!;
    const toX = (e: PointerEvent): number => {
      const b = this.canvas.getBoundingClientRect();
      return ((e.clientX - b.left) / Math.max(1, b.width)) * (this.canvas.width - 1);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      const x = toX(e);
      let best: 'in_low' | 'in_high' | 'gamma' | null = null;
      let bd = 12;
      for (const id of ['in_low', 'in_high', 'gamma'] as const) {
        if (L.locked() && id !== 'gamma') continue;
        const d = Math.abs(this.handleX(id) - x);
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
      if (!best) return;
      this.drag = best;
      this.canvas.setPointerCapture(e.pointerId);
      L.begin();
      e.preventDefault();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const r = this.res();
      const v = r.min + (toX(e) / (this.canvas.width - 1)) * (r.max - r.min);
      const lo = L.get('in_low');
      const hi = L.get('in_high');
      if (this.drag === 'in_low') L.set('in_low', Math.min(v, hi - 0.001));
      else if (this.drag === 'in_high') L.set('in_high', Math.max(v, lo + 0.001));
      else L.set('gamma', gammaFromHandle((v - lo) / (hi - lo || 1)));
      this.draw();
    });
    const end = (): void => {
      if (!this.drag) return;
      this.drag = null;
      L.end();
      this.client.request(true);
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  private overlayFor(r: HistResult | undefined, ctx: CanvasRenderingContext2D, ch: number, fill: string): void {
    if (!r) return;
    const n = normalizeBins(r.bins, ch, histPrefs.log);
    const W = this.canvas.width;
    const H = this.canvas.height - 10;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < BINS; i++) ctx.lineTo((i / (BINS - 1)) * (W - 1), H - n[i] * (H - 4));
    ctx.lineTo(W - 1, H);
    ctx.closePath();
    ctx.fill();
  }

  private draw(): void {
    const s = this.state;
    const ch = CH_INDEX[histPrefs.channel];
    this.hint.textContent = s.status === 'noinput' ? t('hist.noinput') : s.status === 'unavailable' ? t('hist.unavailable') : '';
    this.hint.title = s.status === 'unavailable' ? t('hist.unavailable') : '';
    if (s.status === 'noinput' || s.status === 'unavailable') this.o.onBins?.(null);
    else if (s.input) this.o.onBins?.(normalizeBins(s.input.bins, ch, histPrefs.log));
    if (this.o.mode !== 'levels') return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (s.status === 'ok') {
      this.overlayFor(s.input, ctx, ch, COLORS[histPrefs.channel] + 'aa');
      if (histPrefs.out) this.overlayFor(s.output, ctx, ch, 'rgba(255,200,80,0.28)');
      const i = s.input!;
      ctx.fillStyle = '#ff6a3a';
      if (i.overHi[ch] > 0) ctx.fillRect(W - 4, 0, 4, 6);
      if (i.overLo[ch] > 0) ctx.fillRect(0, 0, 4, 6);
      if (i.overHi[ch] > 0 || i.overLo[ch] > 0) this.canvas.title = t('hist.overflow');
      else this.canvas.title = '';
    }
    // handles (always drawn, also without data: flat histogram)
    const L = this.o.levels;
    if (L) {
      const tri = (x: number, fill: string, label: string): void => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(x, H - 9);
        ctx.lineTo(x - 5, H);
        ctx.lineTo(x + 5, H);
        ctx.closePath();
        ctx.fill();
        void label;
      };
      const dim = L.locked() ? 0.35 : 1;
      ctx.globalAlpha = dim;
      tri(this.handleX('in_low'), '#111', t('hist.black'));
      tri(this.handleX('in_high'), '#fafafa', t('hist.white'));
      ctx.globalAlpha = 1;
      tri(this.handleX('gamma'), '#8a8a8a', t('hist.gamma'));
    }
  }

  dispose(): void {
    this.offUi();
    this.off();
    this.io?.disconnect();
    this.client.dispose();
  }
}
