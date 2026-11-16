import { formatCapabilityReport } from '../../engine/gpu/caps';
import { consoleBus, type LogEntry, type LogLevel } from '../../shared/log';
import { formatBytes } from '../../shared/util';
import { Disposer, download, h } from '../../ui/core/dom';
import { toast } from '../../ui/core/overlay';
import { registerPanel } from '../../ui/dock/panel-registry';
import { Dropdown, SearchField, TabStrip, iconButton } from '../../ui/widgets/controls';

import { t as tt } from '../../shared/i18n';
import { describeInfo, statusLabel } from '../properties/sim-panel';
/**
 * CONSOLE / DIAGNOSTICS: log with level filters + node links (shader errors show node id/name, file:line and the offending
 * source line), GPU memory & pool stats with budget control, last-evaluation table, capability report.
 */
registerPanel({
  id: 'console',
  title: 'Console',
  icon: 'panel-console',
  defaultDock: { zone: 'bottom', size: 0.28 },
  description: tt('console.logsShaderErrorsGpu'),
  create(host, ctx) {
    const app = ctx.app;
    const eng = app.engine;
    const dis = new Disposer();
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } });
    let tab = (ctx.initialState as { tab?: string } | undefined)?.tab ?? 'Log';
    const tabs = new TabStrip(['Log', 'Memory', 'Evaluation', 'Capabilities'], tab, (t) => ((tab = t), ctx.state.set({ tab }), draw()));
    host.append(tabs.el, body);
    const onTab = (e: Event): void => {
      tab = (e as CustomEvent<string>).detail;
      tabs.select(tab);
      draw();
    };
    window.addEventListener('kk-console-tab', onTab);
    dis.add(() => window.removeEventListener('kk-console-tab', onTab));
    let tick: (() => void) | null = null;
    const timer = setInterval(() => ctx.visible.get() && tick?.(), 500);
    dis.add(() => clearInterval(timer));
    let off: (() => void) | null = null;

    const levels: Record<LogLevel, boolean> = { error: true, warn: true, info: true };
    let filter = '';

    function drawLog(): void {
      const list = h('div', { class: 'k-panel-scroll k-log' });
      const rowFor = (e: LogEntry): HTMLElement => {
        const link = e.nodeId && app.project.graph.nodes.has(e.nodeId) ? h('a', { onclick: () => (app.selection.set([e.nodeId!]), app.active.set({ nodeId: e.nodeId! })) }, `[${e.nodeName ?? e.nodeId}]`) : e.nodeId ? h('span', {}, `[${e.nodeName ?? e.nodeId}]`) : null;
        const loc = e.file ? h('span', { class: 'k-dim' }, ` ${e.file}${e.line ? `:${e.line}${e.column ? `:${e.column}` : ''}` : ''}`) : null;
        return h('div', { class: `k-log-row ${e.level}` }, h('span', { class: 't' }, new Date(e.time).toISOString().slice(11, 23)), h('span', { class: 'src' }, e.source), h('div', {}, h('span', {}, e.message), ' ', link, loc, e.detail ? h('pre', {}, e.detail) : null));
      };
      const vis = (e: LogEntry): boolean => levels[e.level] && (!filter || `${e.message} ${e.nodeName ?? ''} ${e.file ?? ''}`.toLowerCase().includes(filter));
      const fill = (): void => {
        list.replaceChildren(...consoleBus.entries.filter(vis).slice(-600).map(rowFor));
        list.scrollTop = list.scrollHeight;
      };
      const mkToggle = (lv: LogLevel, ic: string, tip: string): HTMLButtonElement => {
        const b = iconButton(ic, tip, () => ((levels[lv] = !levels[lv]), b.classList.toggle('active', levels[lv]), fill()), { cls: 'sm', active: levels[lv] });
        return b;
      };
      const search = new SearchField({ placeholder: tt('console.filterLog') }, { onInput: (v) => ((filter = v.toLowerCase()), fill()) });
      const bar = h('div', { class: 'k-toolrow' }, mkToggle('error', 'error', 'Errors'), mkToggle('warn', 'warning', 'Warnings'), mkToggle('info', 'info', 'Info'), search.el,
        iconButton('copy', 'Copy log', () => void navigator.clipboard?.writeText(consoleBus.entries.map((e) => consoleBus.format(e)).join('\n')).then(() => toast('Log copied', { timeout: 1200 })), { cls: 'sm' }),
        iconButton('download', 'Save log to file', () => download('kekenik-log.txt', consoleBus.entries.map((e) => consoleBus.format(e)).join('\n'), 'text/plain'), { cls: 'sm' }),
        iconButton('delete', 'Clear', () => (consoleBus.clear(), fill()), { cls: 'sm' }));
      body.replaceChildren(bar, list);
      fill();
      off = consoleBus.onEntry.on((e) => {
        if (!vis(e)) return;
        const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
        list.append(rowFor(e));
        while (list.children.length > 600) list.firstElementChild?.remove();
        if (atEnd) list.scrollTop = list.scrollHeight;
      });
    }

    function drawMemory(): void {
      const mm = eng.mm;
      const meterLive = h('i');
      const meterIdle = h('i', { class: 'idle' });
      const kv = h('div', { class: 'k-kv' });
      const budgets = [['default', 'Budget: auto'], ['256', '256 MB'], ['512', '512 MB'], ['1024', '1 GB'], ['2048', '2 GB'], ['4096', '4 GB'], ['8192', '8 GB']];
      const dd = new Dropdown({ options: budgets.map(([value, label]) => ({ value, label })), value: app.settings.get('budgetMB') ? String(app.settings.get('budgetMB')) : 'default' }, {
        onInput: (v) => {
          app.settings.set('budgetMB', v === 'default' ? null : +v);
          mm.setBudget(v === 'default' ? eng.gpu.caps.defaultBudgetBytes : +v * 1024 * 1024);
        },
      });
      const bar = h('div', { class: 'k-toolrow' }, h('span', { class: 'k-dim' }, tt('console.memoryBudget')), dd.el,
        h('button', { onclick: () => (mm.reclaim(Number.MAX_SAFE_INTEGER), tick?.()), tip: tt('console.evictCachedNodeOutputs') }, tt('common.freeMemoryNow')));
      body.replaceChildren(bar, h('div', { class: 'k-bigmeter' }, meterLive, meterIdle), h('div', { class: 'k-panel-scroll' }, kv));
      tick = (): void => {
        const s = mm.stats();
        const live = s.textureLiveBytes + s.bufferLiveBytes;
        meterLive.style.width = `${Math.min(100, (live / s.budgetBytes) * 100)}%`;
        meterIdle.style.left = meterLive.style.width;
        meterIdle.style.width = `${Math.min(100 - (live / s.budgetBytes) * 100, ((s.usedBytes - live) / s.budgetBytes) * 100)}%`;
        meterIdle.style.position = 'absolute';
        const hit = s.textureHits + s.textureMisses ? Math.round((s.textureHits / (s.textureHits + s.textureMisses)) * 100) : 0;
        const rows: [string, string][] = [
          ['Used / budget', `${formatBytes(s.usedBytes)} / ${formatBytes(s.budgetBytes)} (${Math.round((s.usedBytes / s.budgetBytes) * 100)}%)`],
          ['Peak', formatBytes(s.peakBytes)], ['Textures live', formatBytes(s.textureLiveBytes)], ['Textures idle (pooled)', formatBytes(s.textureIdleBytes)],
          ['Buffers live', formatBytes(s.bufferLiveBytes)], ['Buffers idle (pooled)', formatBytes(s.bufferIdleBytes)], ['Texture pool hits', `${s.textureHits} hits / ${s.textureMisses} misses (${hit}%)`],
          ['Max texture 2D', String(eng.gpu.caps.limits.maxTextureDimension2D ?? '?')], ['Max buffer size', formatBytes(eng.gpu.caps.limits.maxBufferSize ?? 0)],
          ['Device generation', String(eng.gpu.generation)],
        ];
        // per-node simulation cache usage (hard per-node budgets, see docs/CONTRACTS.md section 16)
        const sims = eng.sims;
        const simRows = sims.nodeIds().flatMap((id): [string, string][] => {
          const i = sims.info(id);
          return i ? [[i.nodeName, `${describeInfo(i).cache} · ${statusLabel(i)}`]] : [];
        });
        if (simRows.length) rows.push([tt('console.simCachesTotal'), formatBytes(sims.totalCacheBytes())], ...simRows);
        kv.replaceChildren(...rows.flatMap(([k, v]) => [h('span', { class: 'k' }, k), h('span', {}, v)]));
      };
      tick();
    }

    function drawEval(): void {
      const tbl = h('div', { class: 'k-panel-scroll' });
      body.replaceChildren(tbl);
      let last: Map<string, import('../../engine/graph/evaluator').NodeStat> | null = null;
      const paint = (): void => {
        if (!last) return void tbl.replaceChildren(h('div', { class: 'k-empty' }, tt('console.noEvaluationYetSelect')));
        const g = app.project.graph;
        tbl.replaceChildren(h('table', { class: 'k-table' }, h('thead', {}, h('tr', {}, ...['Node', 'Status', 'Size', 'CPU ms', 'GPU ms'].map((c) => h('th', {}, c)))), h('tbody', {}, ...[...last].map(([id, s]) => h('tr', { style: s.status === 'error' ? { color: '#ff8b84' } : {} }, h('td', {}, g.nodes.get(id)?.name ?? id), h('td', {}, s.status), h('td', {}, `${s.width}×${s.height}`), h('td', {}, s.cpuMs.toFixed(2)), h('td', {}, s.gpuMs?.toFixed(2) ?? '—'))))));
      };
      off = eng.scheduler.onResult.on(({ result }) => ((last = new Map(result.stats.nodes)), paint()));
      paint();
    }

    function drawCaps(): void {
      const text = formatCapabilityReport(eng.gpu.caps);
      body.replaceChildren(h('div', { class: 'k-toolrow' }, h('button', { onclick: () => void navigator.clipboard?.writeText(text).then(() => toast(tt('console.capabilityReportCopied'), { type: 'ok', timeout: 1500 })) }, 'Copy report')), h('div', { class: 'k-panel-scroll' }, h('pre', { class: 'k-pre' }, text)));
    }

    function draw(): void {
      off?.();
      off = null;
      tick = null;
      if (tab === 'Memory') drawMemory();
      else if (tab === 'Evaluation') drawEval();
      else if (tab === 'Capabilities') drawCaps();
      else drawLog();
    }
    draw();
    return { dispose: () => (off?.(), dis.dispose()), serialize: () => ({ tab }) };
  },
});
