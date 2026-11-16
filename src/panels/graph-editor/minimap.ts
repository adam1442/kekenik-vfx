import { CATEGORIES } from '../../engine/graph/categories';
import { h } from '../../ui/core/dom';
import type { Pt, Rect } from './core/geometry';
import type { GraphScene } from './core/scene';
import { visibleWorldRect, type View } from './core/viewport';

/** Minimap: coloured blocks for nodes, outlines for frames, the visible rectangle; click/drag to navigate. */
export class Minimap {
  readonly el: HTMLDivElement;
  private canvas = h('canvas', { class: 'k-ge-minimap-canvas' });
  private ctx = this.canvas.getContext('2d')!;
  private W = 210;
  private H = 136;
  private map: { s: number; ox: number; oy: number } = { s: 1, ox: 0, oy: 0 };
  private dragging = false;

  constructor(
    private scene: GraphScene,
    private onNavigate: (worldCentre: Pt) => void,
  ) {
    this.el = h('div', { class: 'k-ge-minimap', 'aria-label': 'Minimap' }, this.canvas);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    const nav = (e: PointerEvent): void => {
      const r = this.canvas.getBoundingClientRect();
      const m = this.map;
      this.onNavigate({ x: (e.clientX - r.left - m.ox) / m.s, y: (e.clientY - r.top - m.oy) / m.s });
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      nav(e);
    });
    this.canvas.addEventListener('pointermove', (e) => this.dragging && nav(e));
    const up = (): void => void (this.dragging = false);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }
  set visible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }
  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  draw(view: View, vw: number, vh: number, selected: ReadonlySet<string>): void {
    if (!this.visible) return;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const g = this.scene.graph;
    this.scene.ensure();
    const content = this.scene.contentBounds();
    const vr = visibleWorldRect(view, vw, vh);
    // fit content ∪ viewport so the viewport rectangle is always visible
    const b = content ? unionRect(content, vr) : vr;
    const pad = 8;
    const s = Math.min((this.W - 2 * pad) / b.w, (this.H - 2 * pad) / b.h);
    const ox = (this.W - b.w * s) / 2 - b.x * s,
      oy = (this.H - b.h * s) / 2 - b.y * s;
    this.map = { s, ox, oy };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = 'rgba(16,17,20,0.92)';
    ctx.fillRect(0, 0, this.W, this.H);
    for (const f of g.annotations.frames) {
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.strokeRect(f.x * s + ox, f.y * s + oy, f.w * s, (f.collapsed ? 28 : f.h) * s);
    }
    ctx.globalAlpha = 1;
    for (const n of g.nodes.values()) {
      if (this.scene.hidden.has(n.id)) continue;
      const r = this.scene.rectOf(n.id);
      const def = g.registry.get(n.type);
      ctx.fillStyle = selected.has(n.id) ? '#b2a8ff' : def ? CATEGORIES[def.category].color : '#666';
      ctx.globalAlpha = selected.has(n.id) ? 1 : 0.8;
      ctx.fillRect(r.x * s + ox, r.y * s + oy, Math.max(1.5, r.w * s), Math.max(1.5, r.h * s));
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.2;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(vr.x * s + ox, vr.y * s + oy, vr.w * s, vr.h * s);
    ctx.strokeRect(vr.x * s + ox, vr.y * s + oy, vr.w * s, vr.h * s);
  }
}

function unionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x),
    y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
}
