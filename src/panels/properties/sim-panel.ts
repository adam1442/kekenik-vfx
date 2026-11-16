/**
 * Simulation controls: the section every simulation node shows at the top of its properties, and the small
 * "Simulation HUD" of the 2D viewport. Strings go through i18n, colours through theme tokens (CSS vars), sizes in rem.
 */
import type { Engine } from '../../engine/engine';
import type { SimInfo } from '../../engine/sim/service';
import { simPresetsFor } from '../../engine/sim/presets';
import { getLocale, t as tt } from '../../shared/i18n';
import { h } from '../../ui/core/dom';

const mb = (b: number): string => (b / 1048576).toFixed(b < 10485760 ? 1 : 0);

export function statusLabel(i: SimInfo): string {
  if (i.error && (i.status === 'error' || i.status === 'over-budget')) return i.status === 'error' ? tt('sim.status.error') : tt('sim.status.over');
  if (i.baked) return tt('sim.status.baked');
  if (i.paused) return tt('sim.status.paused');
  if (i.status === 'simulating') return tt('sim.status.simulating', { pct: Math.round(i.progress * 100) });
  if (i.status === 'over-budget') return tt('sim.status.over');
  return tt('sim.status.idle');
}
const statusColor = (i: SimInfo): string => (i.status === 'error' ? 'var(--bad)' : i.status === 'over-budget' ? 'var(--warn)' : i.baked ? 'var(--info)' : i.status === 'simulating' ? 'var(--accent2)' : 'var(--ok)');

export function describeInfo(i: SimInfo): { res: string; cache: string; hud: string; frame: string } {
  const c = i.cache;
  return {
    frame: tt('sim.hudFrame', { frame: Math.max(0, i.cursor), total: i.frames, ms: i.stepMs.toFixed(i.stepMs < 10 ? 1 : 0) }),
    res: tt('sim.res', { w: i.w, h: i.h, mb: mb(i.stateBytes) }) + (i.note ? ` · ${tt('sim.limited')}` : ''),
    cache: tt('sim.cache', { used: mb(c.usedBytes), budget: mb(c.budgetBytes), frames: c.frames, k: c.interval }),
    hud: tt('sim.hud', { sub: i.hud.substeps ?? 0, res: (i.hud.residual ?? 0).toExponential(1), speed: (i.hud.maxSpeed ?? 0).toFixed(2) }),
  };
}

export interface SimSectionDeps {
  engine: Engine;
  nodeId: string;
  /** Node definition id: selects the node's own preset list (`registerSimPresets`). */
  defId: string;
  setParams(values: Record<string, unknown>): void;
  paused(): boolean;
}

/** Controls section: status badge, progress, Reset / Resimulate / Bake / Unbake / Pause, loop seam verifier, presets, readouts. */
export function buildSimSection(d: SimSectionDeps): { el: HTMLElement; dispose(): void } {
  const sims = d.engine.sims;
  const badge = h('span', { class: 'k-sim-badge' });
  const resim = h('span', { class: 'k-sim-resim' });
  const bar = h('div', { class: 'k-sim-bar' }, h('div', { class: 'k-sim-bar-fill' }));
  const l1 = h('div', { class: 'k-sim-line' });
  const l2 = h('div', { class: 'k-sim-line' });
  const l3 = h('div', { class: 'k-sim-line' });
  const lf = h('div', { class: 'k-sim-line' });
  const err = h('div', { class: 'k-sim-err' });
  const seam = h('div', { class: 'k-sim-line' });
  const btn = (key: Parameters<typeof tt>[0], fn: () => void, cls = ''): HTMLButtonElement => {
    const b = h('button', { class: `k-sim-btn ${cls}`, type: 'button' }, tt(key));
    b.addEventListener('click', fn);
    return b;
  };
  const pauseBtn = btn('sim.pause', () => d.setParams({ paused: !d.paused() }));
  const bakeBtn = btn('sim.bake', () => sims.bake(d.nodeId));
  const unbakeBtn = btn('sim.unbake', () => sims.unbake(d.nodeId));
  const cancelBtn = btn('sim.cancel', () => sims.cancel(d.nodeId));
  const verify = btn('sim.verify', () => {
    seam.textContent = '…';
    void sims.verifySeam(d.nodeId).then((r) => {
      seam.textContent = r ? tt('sim.seam', { err: r.error.toExponential(2), ratio: Number.isFinite(r.ratio) ? r.ratio.toFixed(2) : '∞' }) : '';
    });
  });
  const fa = getLocale() === 'fa';
  const presets = simPresetsFor(d.defId) ?? [];
  const sel = h('select', { class: 'k-sim-select', 'aria-label': tt('sim.preset') }, h('option', { value: '' }, tt('sim.preset')), ...presets.map((p) => h('option', { value: p.id, title: fa ? p.description.fa : p.description.en }, fa ? p.name.fa : p.name.en)));
  const presetDesc = h('div', { class: 'k-sim-line' });
  sel.addEventListener('change', () => {
    const p = presets.find((x) => x.id === sel.value);
    presetDesc.textContent = p ? (fa ? p.description.fa : p.description.en) : '';
    if (p) d.setParams(p.params);
  });
  const row1 = h('div', { class: 'k-sim-row' }, btn('sim.reset', () => sims.reset(d.nodeId)), btn('sim.resimulate', () => sims.resimulate(d.nodeId)), bakeBtn, unbakeBtn, pauseBtn, cancelBtn);
  const el = h('div', { class: 'k-sim' }, h('div', { class: 'k-sim-head' }, h('b', {}, tt('sim.title')), badge, resim), bar, l1, l2, l3, lf, err, row1, h('div', { class: 'k-sim-row' }, verify, ...(presets.length ? [sel] : [])), seam, presetDesc);
  const refresh = (): void => {
    const i = sims.info(d.nodeId);
    if (!i) {
      badge.textContent = tt('sim.status.idle');
      badge.style.color = 'var(--dim)';
      l1.textContent = tt('sim.waiting');
      l2.textContent = '';
      l3.textContent = '';
      lf.textContent = '';
      return;
    }
    badge.textContent = statusLabel(i);
    badge.style.color = statusColor(i);
    resim.textContent = i.resimulating ? tt('sim.resimulating') : '';
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round((i.status === 'simulating' ? i.progress : i.baked ? 1 : 0) * 100)}%`;
    const t = describeInfo(i);
    l1.textContent = t.res;
    l2.textContent = t.cache;
    l3.textContent = t.hud;
    lf.textContent = t.frame;
    err.textContent = i.error ?? '';
    bakeBtn.disabled = i.baked;
    unbakeBtn.disabled = !i.baked;
    cancelBtn.disabled = i.status !== 'simulating';
    pauseBtn.textContent = d.paused() ? tt('sim.resume') : tt('sim.pause');
  };
  refresh();
  const off = sims.onChange.on((e) => {
    if (!el.isConnected) return off();
    if (e.nodeId === d.nodeId) refresh();
  });
  return { el, dispose: off };
}

/** Viewport "Simulation HUD": frame, cache MB, sub-steps, pressure residual of the busiest simulation node. */
export function attachSimHud(host: HTMLElement, engine: Engine): void {
  const el = h('div', { class: 'k-sim-hud' });
  el.style.display = 'none';
  host.append(el);
  const off = engine.sims.onChange.on(() => {
    if (!host.isConnected) return off();
    const ids = engine.sims.nodeIds();
    const id = ids.find((x) => engine.sims.info(x)?.status === 'simulating') ?? ids[ids.length - 1];
    const i = id ? engine.sims.info(id) : null;
    if (!i) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const t = describeInfo(i);
    const parts = [i.nodeName, statusLabel(i), t.frame, t.hud, tt('sim.hudCache', { mb: mb(engine.sims.totalCacheBytes()) })];
    el.textContent = parts.join(' · ');
  });
}
