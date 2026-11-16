import type { AppServices } from './app';
import { formatBytes } from '../shared/util';
import { h } from '../ui/core/dom';

/**
 * Performance HUD: a small, click-through overlay (top-right) with the numbers that matter while authoring:
 * frame time (UI), last evaluation CPU / GPU ms, nodes run vs cached, preview scale, memory vs budget, pool + cache hit rates,
 * bind-group cache, pending shader compiles. Toggle: F3 or Settings. Costs one rAF + one DOM text update per 250 ms while visible.
 */
export class PerfHud {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private raf = 0;
  private release: (() => void) | null = null;
  private visible = false;
  private frames = 0;
  private worst = 0;
  private lastFrame = 0;
  private t0 = 0;
  private fpsText = '— fps';

  constructor(private app: AppServices) {
    this.body = h('pre', { class: 'k-hud-body' });
    this.el = h('div', { class: 'k-hud', role: 'status', 'aria-label': 'Performance HUD', style: { display: 'none' } }, this.body);
    document.body.append(this.el);
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.el.style.display = v ? '' : 'none';
    if (v) {
      this.release = this.app.engine.perf.acquire();
      this.t0 = this.lastFrame = performance.now();
      this.frames = 0;
      this.worst = 0;
      const tick = (now: number): void => {
        this.raf = requestAnimationFrame(tick);
        this.frames++;
        this.worst = Math.max(this.worst, now - this.lastFrame);
        this.lastFrame = now;
        if (now - this.t0 >= 250) {
          const fps = (this.frames * 1000) / (now - this.t0);
          this.fpsText = `${fps.toFixed(0)} fps · ${(1000 / Math.max(1, fps)).toFixed(1)} ms · worst ${this.worst.toFixed(0)} ms`;
          this.frames = 0;
          this.worst = 0;
          this.t0 = now;
          this.draw();
        }
      };
      this.raf = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(this.raf);
      this.release?.();
      this.release = null;
    }
  }
  get isVisible(): boolean {
    return this.visible;
  }

  private draw(): void {
    const e = this.app.engine;
    const m = e.mm.stats();
    const last = e.perf.evals.last();
    const r = e.perf.hitRates();
    const pc = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)}%`);
    const bgTotal = e.runner.bgHits + e.runner.bgMisses;
    const lines = [
      `UI    ${this.fpsText}`,
      last ? `EVAL  ${last.cpuMs.toFixed(1)} ms CPU${last.gpuMs !== undefined ? ` · ${last.gpuMs.toFixed(2)} ms GPU` : ''}` : 'EVAL  —',
      last ? `NODES ${last.ran} run · ${last.cached} cached · ${Math.round(last.scale * 100)}% res${e.adaptive.enabled ? ` (adaptive ${Math.round(e.adaptive.scale * 100)}%)` : ''}` : 'NODES —',
      `MEM   ${formatBytes(m.usedBytes)} / ${formatBytes(m.budgetBytes)} (peak ${formatBytes(m.peakBytes)})`,
      `HIT   pool ${pc(r.pool)} · cache ${pc(r.cache)} · bindgrp ${bgTotal ? Math.round((e.runner.bgHits / bgTotal) * 100) + '%' : '—'}`,
      `PIPE  ${e.pipelines.compiledCount} built · ${e.pipelines.pendingCount} pending · ${e.evaluator.identitySkips} identity skips`,
    ];
    this.body.textContent = lines.join('\n');
  }

  dispose(): void {
    this.setVisible(false);
    this.el.remove();
  }
}
