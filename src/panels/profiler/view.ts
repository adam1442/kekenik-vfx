import type { PerfStats, NodeTiming } from '../../engine/perf/stats';
import { t } from '../../shared/i18n';
import { formatBytes } from '../../shared/util';
import { fitCanvas } from '../../ui/core/canvas';
import { Disposer, h } from '../../ui/core/dom';
import { toast } from '../../ui/core/overlay';
import { definePanelView } from '../../ui/dock/panel-lazy';
import { TabStrip } from '../../ui/widgets/controls';

/**
 * PROFILER: flame-style per-node timings (node bars sized by GPU ms when timestamp queries exist, else CPU ms; pass segments
 * underneath), evaluation history vs the 8 ms interaction budget, memory timeline, pool / cache hit rates, bind-group cache,
 * pipeline compile times. Data comes from `engine.perf` (PerfStats); the panel only samples while it is visible.
 */
const TABS = ['Nodes', 'Memory', 'Caches', 'Pipelines'] as const;
const hue = (s: string): number => {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360;
  return x;
};
const nodeMs = (n: NodeTiming): number => n.gpuMs ?? n.cpuMs;
const pc = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  nodeId?: string;
}

export const { create } = definePanelView({
  create(host, ctx) {
    const app = ctx.app;
    const eng = app.engine;
    const perf: PerfStats = eng.perf;
    const dis = new Disposer();
    let tab: (typeof TABS)[number] = (ctx.initialState as { tab?: (typeof TABS)[number] } | undefined)?.tab ?? 'Nodes';
    let paused = false;
    let release: (() => void) | null = null;
    let w = 400;
    let hh = 200;
    let hits: Hit[] = [];
    let raf = 0;

    const canvas = h('canvas', { class: 'k-prof-canvas' });
    const info = h('div', { class: 'k-prof-info k-dim' }, '\u00a0');
    const table = h('div', { class: 'k-panel-scroll k-prof-table' });
    const area = h('div', { class: 'k-prof-area' });
    const tabs = new TabStrip([...TABS], tab, (x) => ((tab = x as typeof tab), ctx.state.set({ tab }), layout(), schedule()));
    const pauseBtn = h('button', { tip: t('profiler.freezeTheDisplayCollection'), onclick: () => ((paused = !paused), pauseBtn.classList.toggle('active', paused), schedule()) }, 'Pause');
    const bar = h(
      'div',
      { class: 'k-toolrow' },
      tabs.el,
      h('span', { class: 'k-sp' }),
      pauseBtn,
      h('button', { tip: t('profiler.forgetAllRecordedSamples'), onclick: () => perf.clear() }, 'Clear'),
      h('button', { tip: 'Copy a JSON report (timings, memory, caches, pipelines) to the clipboard', onclick: () => void copyReport() }, t('common.copy')),
    );
    host.append(bar, area);

    function layout(): void {
      area.replaceChildren();
      if (tab === 'Nodes' || tab === 'Memory') area.append(canvas, info, table);
      else area.append(table);
    }

    async function copyReport(): Promise<void> {
      const m = eng.mm.stats();
      const rep = {
        version: 1,
        time: new Date().toISOString(),
        gpuTimestamps: perf.hasGpuTimes,
        evals: perf.evals.toArray().slice(-60),
        nodes: perf.nodes.map((n) => ({ ...n, passes: n.passes })),
        memory: { ...m, leak: eng.mm.leakReport() },
        hitRates: { window: perf.hitRates(), lifetime: perf.lifetimeRates() },
        bindGroups: { hits: eng.runner.bgHits, misses: eng.runner.bgMisses, size: eng.runner.bindGroupCacheSize },
        identitySkips: eng.evaluator.identitySkips,
        pipelines: perf.compiles.slice(-100),
      };
      try {
        await navigator.clipboard.writeText(JSON.stringify(rep, null, 2));
        toast(t('profiler.profilerReportCopied'), { type: 'ok', timeout: 1500 });
      } catch {
        toast(t('profiler.clipboardIsNotAvailable'), { type: 'warn' });
      }
    }

    /* ------------------------------------------------------------------ drawing */
    function drawNodes(): void {
      const g = fitCanvas(canvas, w, Math.min(190, hh * 0.5));
      if (!g) return;
      const W = w;
      g.clearRect(0, 0, W, 190);
      g.fillStyle = '#17191d';
      g.fillRect(0, 0, W, 190);
      hits = [];
      // 1. history strip
      const hist = perf.evals.toArray();
      const stripH = 46;
      const maxMs = Math.max(16, ...hist.map((e) => e.gpuMs ?? e.cpuMs));
      const bw = 3;
      const n = Math.min(hist.length, Math.floor(W / bw));
      for (let i = 0; i < n; i++) {
        const e = hist[hist.length - n + i];
        const ms = e.gpuMs ?? e.cpuMs;
        const bh = Math.max(1, (ms / maxMs) * (stripH - 6));
        g.fillStyle = ms < 8 ? '#4cc38a' : ms < 16 ? '#e0a23c' : '#e5534b';
        g.fillRect(i * bw, stripH - bh, bw - 1, bh);
      }
      const by = stripH - (8 / maxMs) * (stripH - 6);
      g.strokeStyle = '#7b828d';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(0, by);
      g.lineTo(W, by);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#7b828d';
      g.font = '10px ui-monospace, monospace';
      g.fillText('8 ms budget', W - 70, by - 2);
      g.fillText(`${maxMs.toFixed(0)} ms`, 2, 10);
      // 2. flame
      const nodes = perf.nodes.filter((x) => nodeMs(x) > 0);
      const total = nodes.reduce((s, x) => s + nodeMs(x), 0);
      const y0 = stripH + 6;
      const rowH = 20;
      g.fillStyle = '#2f343b';
      g.fillRect(0, y0, W, rowH - 2);
      g.fillStyle = '#d8dbe0';
      const last = perf.evals.last();
      g.fillText(last ? `Evaluation · ${total.toFixed(2)} ms ${perf.hasGpuTimes ? 'GPU' : 'CPU'} · ${last.ran} run / ${last.cached} cached · ${Math.round(last.scale * 100)}%` : t('perf.empty'), 6, y0 + 13);
      let x = 0;
      for (const nd of nodes) {
        const wd = total > 0 ? (nodeMs(nd) / total) * W : 0;
        g.fillStyle = `hsl(${hue(nd.type)} 45% 38%)`;
        g.fillRect(x, y0 + rowH, Math.max(1, wd - 1), rowH - 2);
        if (wd > 46) {
          g.fillStyle = '#fff';
          g.save();
          g.beginPath();
          g.rect(x, y0 + rowH, wd - 2, rowH);
          g.clip();
          g.fillText(`${nd.name} ${nodeMs(nd).toFixed(2)}`, x + 4, y0 + rowH + 13);
          g.restore();
        }
        hits.push({ x, y: y0 + rowH, w: wd, h: rowH, text: `${nd.name} (${nd.type}) · ${nd.gpuMs !== undefined ? `${nd.gpuMs.toFixed(3)} ms GPU · ` : ''}${nd.cpuMs.toFixed(2)} ms CPU · ${nd.width}×${nd.height} · ${nd.passes.length} pass(es)`, nodeId: nd.id });
        // passes (CPU recording time) distributed over the node's width
        const ps = nd.passes.reduce((s, p) => s + p.cpuMs, 0);
        let px = x;
        for (const p of nd.passes) {
          const pw = ps > 0 ? (p.cpuMs / ps) * wd : 0;
          g.fillStyle = p.kind === 'cs' ? `hsl(${hue(nd.type) + 40} 55% 50%)` : `hsl(${hue(nd.type)} 55% 52%)`;
          g.fillRect(px, y0 + rowH * 2, Math.max(1, pw - 1), rowH - 2);
          hits.push({ x: px, y: y0 + rowH * 2, w: pw, h: rowH, text: `pass “${p.label}” (${p.kind === 'cs' ? 'compute' : 'fragment'}) · ${p.cpuMs.toFixed(3)} ms CPU record`, nodeId: nd.id });
          px += pw;
        }
        x += wd;
      }
      // table
      const rows = [...perf.nodes].sort((a, b) => nodeMs(b) - nodeMs(a)).slice(0, 40);
      table.replaceChildren(
        ...(rows.length
          ? [
              h('div', { class: 'k-prof-row head' }, h('span', {}, 'Node'), h('span', {}, 'Type'), h('span', {}, 'Size'), h('span', {}, t('profiler.gpuMs')), h('span', {}, t('profiler.cpuMs')), h('span', {}, 'Passes'), h('span', {}, 'Status')),
              ...rows.map((r) =>
                h('div', { class: `k-prof-row ${r.status}`, onclick: () => (app.selection.set([r.id]), app.active.set({ nodeId: r.id })) }, h('span', {}, r.name), h('span', { class: 'k-dim' }, r.type), h('span', {}, `${r.width}×${r.height}`), h('span', {}, r.gpuMs !== undefined ? r.gpuMs.toFixed(3) : '—'), h('span', {}, r.cpuMs.toFixed(2)), h('span', {}, String(r.passes.length)), h('span', {}, r.status)),
              ),
            ]
          : [h('div', { class: 'k-empty' }, t('perf.empty'))]),
      );
      info.textContent = hits.length ? (perf.hasGpuTimes ? 'Hover a bar for details · click a bar to select the node' : t('perf.noGpuTimes')) : '\u00a0';
    }

    function drawMemory(): void {
      const H = Math.min(170, hh * 0.45);
      const g = fitCanvas(canvas, w, H);
      if (!g) return;
      g.fillStyle = '#17191d';
      g.fillRect(0, 0, w, H);
      const a = perf.mem.toArray();
      if (a.length > 1) {
        const budget = a[a.length - 1].budget;
        const max = Math.max(budget, ...a.map((s) => s.used)) * 1.05;
        const px = (i: number): number => (i / (perf.mem.capacity - 1)) * w;
        const off = perf.mem.capacity - a.length;
        const py = (v: number): number => H - 14 - (v / max) * (H - 24);
        const area = (sel: (s: (typeof a)[number]) => number, col: string): void => {
          g.beginPath();
          g.moveTo(px(off), H - 14);
          a.forEach((s, i) => g.lineTo(px(off + i), py(sel(s))));
          g.lineTo(px(off + a.length - 1), H - 14);
          g.closePath();
          g.fillStyle = col;
          g.fill();
        };
        area((s) => s.used, 'rgba(124,108,240,0.28)');
        area((s) => s.live, 'rgba(76,195,138,0.55)');
        g.strokeStyle = '#e5534b';
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(0, py(budget));
        g.lineTo(w, py(budget));
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = '#a7adb7';
        g.font = '10px ui-monospace, monospace';
        const l = a[a.length - 1];
        g.fillText(`used ${formatBytes(l.used)} · live ${formatBytes(l.live)} · idle ${formatBytes(l.idle)} · budget ${formatBytes(budget)}  (last ${Math.round(a.length / 4)} s)`, 6, H - 3);
      }
      const m = eng.mm.stats();
      const lk = eng.mm.leakReport();
      const kv = (k: string, v: string, bad = false): HTMLElement => h('div', { class: `k-prof-kv${bad ? ' bad' : ''}` }, h('span', { class: 'k-dim' }, k), h('b', {}, v));
      table.replaceChildren(
        kv('Used / budget', `${formatBytes(m.usedBytes)} / ${formatBytes(m.budgetBytes)}`),
        kv('Peak', formatBytes(m.peakBytes)),
        kv('Textures live / idle', `${lk.liveTextures} / ${lk.idleTextures}  (${formatBytes(m.textureLiveBytes)} / ${formatBytes(m.textureIdleBytes)})`),
        kv('Buffers live / idle', `${lk.liveBuffers} / ${lk.idleBuffers}  (${formatBytes(m.bufferLiveBytes)} / ${formatBytes(m.bufferIdleBytes)})`),
        kv('CPU payloads (meshes…)', formatBytes(m.externalBytes)),
        kv('GPU objects created / destroyed', `${lk.texturesCreated + lk.buffersCreated} / ${lk.texturesDestroyed + lk.buffersDestroyed}`),
        kv('Accounting balance (must be 0)', `${lk.textureBalance} tex · ${lk.bufferBalance} buf`, lk.textureBalance !== 0 || lk.bufferBalance !== 0),
        kv('Uniform arena held', formatBytes(eng.arena.heldBytes)),
        kv('Frame cache', `${formatBytes(eng.scheduler.frameCache.bytes)}`),
        h('div', { class: 'k-prof-row' }, h('button', { onclick: () => (eng.mm.reclaim(Number.MAX_SAFE_INTEGER), eng.runner.clearBindGroups(), schedule()) }, t('common.freeMemoryNow'))),
      );
      info.textContent = t('profiler.purpleUsedLive');
    }

    function drawCaches(): void {
      const r = perf.hitRates();
      const life = perf.lifetimeRates();
      const bg = eng.runner.bgHits + eng.runner.bgMisses;
      const kv = (k: string, v: string, tip?: string): HTMLElement => h('div', { class: 'k-prof-kv', tip }, h('span', { class: 'k-dim' }, k), h('b', {}, v));
      table.replaceChildren(
        kv('Texture pool hit rate (10 s)', pc(r.pool), 'Fraction of texture requests served from the pool without a GPU allocation'),
        kv('Texture pool hit rate (lifetime)', pc(life.pool)),
        kv('Output cache hit rate (10 s)', pc(r.cache), 'Fraction of node outputs reused through the version-hash cache'),
        kv('Output cache hit rate (lifetime)', pc(life.cache)),
        kv('Bind group cache', bg ? `${pc(eng.runner.bgHits / bg)} of ${bg} · ${eng.runner.bindGroupCacheSize} cached` : eng.runner.bindGroupCache ? '—' : 'disabled (?nobgcache)'),
        kv('Identity short-cuts taken', String(eng.evaluator.identitySkips), 'Nodes skipped because their parameters make them a no-op'),
        ...fusionRows(),
        kv('Adaptive preview scale', eng.adaptive.enabled ? `${Math.round(eng.adaptive.scale * 100)}%  (cost ${eng.adaptive.costPerArea?.toFixed(2) ?? '—'} ms @100%, budget ${eng.adaptive.opts.budgetMs} ms)` : 'off'),
        kv('Evaluations recorded', String(perf.evals.length)),
        kv('GPU timestamps', perf.hasGpuTimes ? 'available' : eng.gpu.caps.has.timestampQuery ? 'waiting for first sample' : 'not supported by this device'),
      );
    }


    /** pass fusion diagnostics (passes before / after for the largest recent evaluation, segments, pipeline LRU, fallbacks). */
    function fusionRows(): HTMLElement[] {
      const kv = (k: string, v: string, tip?: string): HTMLElement => h('div', { class: 'k-prof-kv', tip }, h('span', { class: 'k-dim' }, k), h('b', {}, v));
      const fu = eng.evaluator.fusion;
      const sum = fu.summary;
      const toggle = h('button', { tip: t('perf.fusion.toggleTip'), onclick: () => (fu.setEnabled(!fu.enabled), eng.scheduler.invalidate(), schedule()) }, fu.enabled ? t('perf.fusion.disable') : t('perf.fusion.enable'));
      const rows: HTMLElement[] = [
        h('div', { class: 'k-prof-kv' }, h('span', { class: 'k-dim' }, t('perf.fusion.title')), toggle),
        kv(t('perf.fusion.passes'), sum ? `${sum.before} → ${sum.after}` : '—', t('perf.fusion.passesTip')),
        kv(t('perf.fusion.segments'), String(sum?.segments.length ?? 0)),
        ...(sum?.segments ?? []).slice(0, 12).map((sg) => kv('  ' + sg.ids.length + '×', sg.names.join(' → '))),
        kv(t('perf.fusion.cache'), `${fu.moduleCount} / ${fu.limitModules} modules · ${eng.pipelines.size} pipelines`),
        kv(t('perf.fusion.fallbacks'), `${fu.fallbacks} (${fu.broken.size} broken)`, t('perf.fusion.fallbacksTip')),
        kv(t('perf.fusion.saved'), `${fu.fusedPasses} fused passes, ${fu.passesSaved} passes saved`),
      ];
      return rows;
    }

    function drawPipelines(): void {
      const list = [...perf.compiles].reverse().slice(0, 120);
      const total = perf.compiles.reduce((s, c) => s + c.ms, 0);
      const max = perf.compiles.reduce((s, c) => Math.max(s, c.ms), 0);
      table.replaceChildren(
        h('div', { class: 'k-prof-kv' }, h('span', { class: 'k-dim' }, t('profiler.builtPending')), h('b', {}, `${eng.pipelines.compiledCount} / ${eng.pipelines.pendingCount} / ${perf.compiles.filter((c) => !c.ok).length}`)),
        h('div', { class: 'k-prof-kv' }, h('span', { class: 'k-dim' }, t('profiler.totalAverage')), h('b', {}, `${total.toFixed(0)} ms / ${perf.compiles.length ? (total / perf.compiles.length).toFixed(1) : '—'} ms / ${max.toFixed(0)} ms`)),
        h('div', { class: 'k-prof-row head p2' }, h('span', {}, t('profiler.pipelineShader')), h('span', {}, t('profiler.compileMs')), h('span', {}, 'Result')),
        ...list.map((c) => h('div', { class: `k-prof-row p2 ${c.ok ? '' : 'error'}` }, h('span', {}, c.label), h('span', {}, c.ms.toFixed(1)), h('span', {}, c.ok ? 'ok' : 'FAILED'))),
        ...(list.length ? [] : [h('div', { class: 'k-empty' }, t('profiler.noPipelineWasBuilt'))]),
      );
    }

    function draw(): void {
      raf = 0;
      if (!ctx.visible.get() || paused) return;
      if (tab === 'Nodes') drawNodes();
      else if (tab === 'Memory') drawMemory();
      else if (tab === 'Caches') drawCaches();
      else drawPipelines();
    }
    function schedule(): void {
      if (!raf) raf = requestAnimationFrame(draw);
    }

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const hit = hits.find((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
      if (hit) info.textContent = hit.text;
      canvas.style.cursor = hit?.nodeId ? 'pointer' : 'default';
    });
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const hit = hits.find((q) => e.clientX - r.left >= q.x && e.clientX - r.left <= q.x + q.w && e.clientY - r.top >= q.y && e.clientY - r.top <= q.y + q.h);
      if (hit?.nodeId) (app.selection.set([hit.nodeId]), app.active.set({ nodeId: hit.nodeId }));
    });

    dis.add(perf.onUpdate.on(schedule));
    dis.add(
      ctx.visible.subscribe((v) => {
        if (v && !release) release = perf.acquire();
        else if (!v && release) (release(), (release = null));
        if (v) schedule();
      }, true),
    );
    layout();
    return {
      resize(nw, nh) {
        w = Math.max(100, nw);
        hh = Math.max(80, nh - 28);
        schedule();
      },
      serialize: () => ({ tab }),
      dispose() {
        if (raf) cancelAnimationFrame(raf);
        release?.();
        dis.dispose();
      },
    };
  },
});
