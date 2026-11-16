import { h } from '../../ui/core/dom';
import type { AnalysisResult } from './analysis';
import type { PixelKind } from './display';

const CH = [
  { name: 'R', color: '#ff5a5a' },
  { name: 'G', color: '#5aff7a' },
  { name: 'B', color: '#5a8cff' },
  { name: 'A', color: '#c8c8c8' },
  { name: 'L', color: '#e6e6e6' },
];
const channelsFor = (kind: PixelKind): number[] => (kind === 1 ? [0] : kind === 2 ? [0, 1] : kind === 3 ? [0, 1, 2] : [0, 1, 2, 3, 4]);
const labelsFor = (kind: PixelKind): string[] => (kind === 1 ? ['Gray'] : kind === 2 ? ['U', 'V'] : kind === 3 ? ['X', 'Y', 'Z'] : ['R', 'G', 'B', 'A']);

/** Histogram + region statistics box (DOM + a 256x96 Canvas2D). Data comes from the GPU compute analysis. */
export class HistogramBox {
  readonly el: HTMLElement;
  private canvas = h('canvas', { width: '256', height: '96' });
  private table = h('table');
  private head = h('div', { class: 'head' });
  log = false;
  private last: { r: AnalysisResult; kind: PixelKind } | null = null;

  constructor() {
    this.el = h('div', { class: 'k-vp2-hist' }, this.head, this.canvas, this.table);
  }

  setData(r: AnalysisResult, kind: PixelKind): void {
    this.last = { r, kind };
    this.draw();
  }
  redraw(): void {
    this.draw();
  }

  private draw(): void {
    if (!this.last) return;
    const { r, kind } = this.last;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 96);
    const chans = kind === 0 ? [0, 1, 2, 4] : channelsFor(kind);
    const f = (v: number): number => (this.log ? Math.log1p(v) : v);
    let mx = 1;
    for (const c of chans) for (let i = 1; i < 255; i++) mx = Math.max(mx, f(r.hist[c * 256 + i]));
    if (mx <= 1) for (const c of chans) for (let i = 0; i < 256; i++) mx = Math.max(mx, f(r.hist[c * 256 + i]));
    ctx.globalCompositeOperation = 'lighter';
    for (const c of chans) {
      const solo = kind === 1 || c === 4;
      ctx.fillStyle = kind === 1 ? '#cfd3da' : c === 4 ? 'rgba(255,255,255,0.18)' : CH[c].color + '99';
      ctx.beginPath();
      ctx.moveTo(0, 96);
      for (let i = 0; i < 256; i++) ctx.lineTo(i, 96 - Math.min(1, f(r.hist[c * 256 + i]) / mx) * 92);
      ctx.lineTo(255, 96);
      ctx.closePath();
      ctx.fill();
      void solo;
    }
    ctx.globalCompositeOperation = 'source-over';
    const names = labelsFor(kind);
    const fmt = (n: number): string => (Math.abs(n) >= 1000 ? n.toExponential(2) : n.toFixed(4));
    this.head.textContent = '';
    this.head.append(h('span', {}, `Histogram${this.log ? ' (log)' : ''} · ${r.region.w}×${r.region.h}${r.step > 1 ? ` · 1/${r.step} samples` : ''}`), h('span', {}, `${Math.round(r.count).toLocaleString()} px`));
    this.table.replaceChildren(h('tr', {}, h('th', {}, ''), h('th', {}, 'min'), h('th', {}, 'max'), h('th', {}, 'mean')));
    names.forEach((n, i) => this.table.append(h('tr', {}, h('td', { style: { color: CH[kind === 1 ? 4 : i].color } }, n), h('td', {}, fmt(r.min[i])), h('td', {}, fmt(r.max[i])), h('td', {}, fmt(r.mean[i])))));
  }
}
