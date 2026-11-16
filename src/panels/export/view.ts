import type { ParamValue } from '../../engine/params/schema';
import { ExportRunner, formatEstimate, scanExports, type ExportEntry, type JobRecord } from '../../export/queue';
import { EXPORT_PRESETS, presetsFor } from '../../export/presets';
import { DirectoryTarget, DownloadTarget, hasDirectoryPicker, type ExportTarget } from '../../export/targets';
import { formatBytes } from '../../shared/util';
import { Disposer, h } from '../../ui/core/dom';
import { toast } from '../../ui/core/overlay';
import { definePanelView } from '../../ui/dock/panel-lazy';

import { t as tt } from '../../shared/i18n';
/**
 * EXPORT PANEL: lists every Export node of the graph with validation warnings and memory / size estimates,
 * runs selected or all exports (batch), shows progress, per-job log, pause / resume / cancel and applies presets for
 * Unreal / Unity / Godot. Output goes to a folder (File System Access API) or to a download / ZIP (capped).
 */
const CSS = `
.k-exp{display:flex;flex-direction:column;flex:1;min-height:0;font-size:1rem}
.k-exp-bar{display:flex;gap:0.5rem;align-items:center;padding:0.5rem;border-bottom:1px solid var(--bg4);flex-wrap:wrap}
.k-exp-list{flex:1;min-height:0;overflow:auto;padding:0.5rem;display:flex;flex-direction:column;gap:0.5rem}
.k-exp-card{border:1px solid var(--bg4);background:var(--bg2);border-radius:0.333rem;padding:0.5rem 0.667rem;display:flex;flex-direction:column;gap:0.333rem}
.k-exp-card.sel{border-color:var(--accent)}
.k-exp-row{display:flex;gap:0.667rem;align-items:center}
.k-exp-title{font-weight:600;flex:1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.k-exp-tag{font-size:0.833rem;padding:1px 0.417rem;border-radius:0.25rem;background:var(--bg4);opacity:.9}
.k-exp-sub{opacity:.7;font-size:0.917rem}
.k-exp-issue{font-size:0.917rem;padding:0.083rem 0}
.k-exp-issue.error{color:#ff7a70}.k-exp-issue.warn{color:#f2c14e}.k-exp-issue.info{opacity:.65}
.k-exp-prog{height:0.333rem;background:var(--bg4);border-radius:0.167rem;overflow:hidden}
.k-exp-prog i{display:block;height:100%;background:var(--accent);width:0;transition:width .12s}
.k-exp-state.done{color:#6fcf97}.k-exp-state.error{color:#ff7a70}.k-exp-state.cancelled{color:#f2c14e}
.k-exp-log{font-family:ui-monospace,monospace;font-size:0.875rem;max-height:10.833rem;overflow:auto;background:var(--bg0);padding:0.333rem 0.5rem;border-radius:0.25rem;white-space:pre-wrap}
.k-exp-log .error{color:#ff7a70}.k-exp-log .warn{color:#f2c14e}
.k-exp-empty{padding:1.5rem;opacity:.7;line-height:1.5}
.k-exp select{background:var(--bg3);color:var(--text);border:1px solid var(--bg4);border-radius:0.25rem;padding:0.167rem 0.333rem;font-size:0.917rem;max-width:18.333rem}
`;

export const { create } = definePanelView({
  create(host, ctx) {
    const app = ctx.app;
    const dis = new Disposer();
    const style = h('style', {});
    style.textContent = CSS;
    const root = h('div', { class: 'k-exp' });
    host.append(style, root);
    const runner = new ExportRunner(ctx.engine);
    let entries: ExportEntry[] = [];
    const checked = new Set<string>();
    const knownIds = new Set<string>();
    let openLog: string | null = null;
    let queued = false;
    let unsubGraph: (() => void) | null = null;

    const graph = () => app.project.graph;
    const gname = (): string => app.project.name || 'graph';

    function rescan(): void {
      entries = scanExports(ctx.engine, graph(), gname());
      for (const e of entries) {
        if (!knownIds.has(e.nodeId)) {
          knownIds.add(e.nodeId);
          if (e.enabled) checked.add(e.nodeId);
        }
      }
      for (const id of [...checked]) if (!entries.some((e) => e.nodeId === id)) checked.delete(id);
      draw();
    }
    const scheduleRescan = (): void => {
      if (queued || runner.running) return;
      queued = true;
      setTimeout(() => ((queued = false), rescan()), 120);
    };
    const bindGraph = (): void => {
      unsubGraph?.();
      unsubGraph = graph().events.on((e) => {
        if (e.type !== 'meta') scheduleRescan();
      });
      knownIds.clear();
      checked.clear();
      rescan();
    };
    dis.add(app.project.onChange.on(bindGraph));
    dis.add(() => unsubGraph?.());
    dis.add(app.selection.onChange.on(() => draw()));
    dis.add(runner.onChange.on(() => draw()));

    async function pickTarget(ids: string[]): Promise<ExportTarget | null> {
      if (hasDirectoryPicker()) {
        const t = await DirectoryTarget.pick();
        return t;
      }
      // fallback: count the files up front so a single file is downloaded as is
      const total = entries.filter((e) => ids.includes(e.nodeId)).reduce((n, e) => n + e.files, 0);
      const cap = Math.max(64, Math.min(1536, Math.floor(ctx.engine.mm.budgetBytes / 1048576 / 3))) * 1048576;
      return new DownloadTarget(`${gname().replace(/[^\w.-]+/g, '_')}_export`, total, cap);
    }

    async function start(ids: string[]): Promise<void> {
      ids = ids.filter((id) => entries.find((e) => e.nodeId === id));
      if (!ids.length) return toast(tt('export.noExportNodesSelected'), { type: 'warn' });
      const blocked = entries.filter((e) => ids.includes(e.nodeId) && e.issues.some((i) => i.level === 'error'));
      if (blocked.length) return toast(`Fix the errors first: ${blocked.map((b) => b.nodeName).join(', ')}`, { type: 'error' });
      let target: ExportTarget | null;
      try {
        target = await pickTarget(ids); // must stay inside the click handler (user gesture)
      } catch (e) {
        return toast(`Cannot open the destination: ${(e as Error).message}`, { type: 'error' });
      }
      if (!target) return;
      const done = app.tasks.begin(`Export (${ids.length} job${ids.length > 1 ? 's' : ''})`);
      try {
        const summary = await runner.run(graph(), gname(), ids, target);
        const failed = runner.jobs.filter((j) => j.state === 'error').length;
        toast(summary, { type: failed ? 'warn' : 'ok', title: failed ? `Export finished with ${failed} error(s)` : 'Export finished', timeout: 6000 });
      } catch (e) {
        toast((e as Error).message, { type: 'error', title: tt('export.exportFailed') });
      } finally {
        done();
        rescan();
      }
    }

    function applyPreset(entry: ExportEntry, id: string): void {
      const p = EXPORT_PRESETS.find((x) => x.id === id);
      if (!p) return;
      ctx.editor.stack.transaction(`Export preset: ${p.label}`, () => {
        for (const [k, v] of Object.entries(p.params)) ctx.editor.setParam(entry.nodeId, k, v as ParamValue);
      });
      toast(tt('export.appliedTo', { label: p.label, nodeName: entry.nodeName }), { timeout: 1800 });
    }

    const stateLabel = (j: JobRecord | undefined): string => (j ? j.state : '');

    function draw(): void {
      const mm = ctx.engine.mm;
      const bar = h('div', { class: 'k-exp-bar' },
        h('button', { class: 'k-btn primary', tip: tt('export.exportTheCheckedNodes'), disabled: runner.running, onclick: () => void start([...checked]) }, tt('export.exportChecked')),
        h('button', { class: 'k-btn', tip: tt('export.exportEveryEnabledExport'), disabled: runner.running, onclick: () => void start(entries.filter((e) => e.enabled).map((e) => e.nodeId)) }, tt('export.exportAll')),
        h('button', { class: 'k-btn', tip: tt('export.exportTheNodeSelected'), disabled: runner.running, onclick: () => { const id = app.selection.primary; if (id && entries.some((e) => e.nodeId === id)) void start([id]); else toast(tt('export.selectAnExportNode'), { type: 'info' }); } }, 'Export selected'),
        runner.running ? h('button', { class: 'k-btn', onclick: () => (runner.paused ? runner.resume() : runner.pause()) }, runner.paused ? 'Resume' : 'Pause') : null,
        runner.running ? h('button', { class: 'k-btn', onclick: () => runner.cancel() }, 'Cancel') : null,
        h('span', { class: 'k-exp-sub', style: { marginInlineStart: 'auto' } }, hasDirectoryPicker() ? 'Destination: folder (asked on export)' : 'Destination: browser download / ZIP (size-capped)'),
        h('span', { class: 'k-exp-sub', tip: tt('export.gpuMeshMemory') }, `Mem ${formatBytes(mm.usedBytes)} / ${formatBytes(mm.budgetBytes)}`),
      );
      const list = h('div', { class: 'k-exp-list' });
      if (!entries.length) {
        list.append(h('div', { class: 'k-exp-empty' }, tt('export.noExportNodesIn'), h('br', {}), 'Add Export Color / Mask / Multimask / Normal / Warp / Mesh / Viewport nodes from the Node Library (category Export), connect a result and come back here. ', h('br', {}), 'Tip: select an export node in the graph to see its presets.'));
      }
      for (const e of entries) {
        const job = runner.jobs.find((j) => j.nodeId === e.nodeId);
        const sel = app.selection.has(e.nodeId);
        const presets = presetsFor(e.type);
        const errs = e.issues.filter((i) => i.level === 'error').length;
        const warns = e.issues.filter((i) => i.level === 'warn').length;
        const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
        cb.checked = checked.has(e.nodeId);
        cb.addEventListener('change', () => (cb.checked ? checked.add(e.nodeId) : checked.delete(e.nodeId)));
        const sel2 = h('select', { tip: tt('export.applyAPresetTo') }, h('option', { value: '' }, tt('export.preset')), ...presets.map((p) => h('option', { value: p.id }, p.label))) as HTMLSelectElement;
        sel2.addEventListener('change', () => {
          if (sel2.value) applyPreset(e, sel2.value);
          sel2.value = '';
        });
        const card = h('div', { class: `k-exp-card${sel ? ' sel' : ''}` },
          h('div', { class: 'k-exp-row' }, cb,
            h('span', { class: 'k-exp-title', tip: tt('export.selectTheNodeIn'), onclick: () => (app.selection.set([e.nodeId]), app.active.set({ nodeId: e.nodeId })) }, e.nodeName),
            h('span', { class: 'k-exp-tag' }, e.label),
            errs ? h('span', { class: 'k-exp-tag', style: { color: '#ff7a70' } }, `${errs} error${errs > 1 ? 's' : ''}`) : null,
            warns ? h('span', { class: 'k-exp-tag', style: { color: '#f2c14e' } }, `${warns} warning${warns > 1 ? 's' : ''}`) : null,
            job ? h('span', { class: `k-exp-state ${job.state}` }, stateLabel(job)) : null,
            h('button', { class: 'k-btn', disabled: runner.running, onclick: () => void start([e.nodeId]) }, 'Run')),
          h('div', { class: 'k-exp-sub' }, e.summary),
          h('div', { class: 'k-exp-sub' }, formatEstimate(e)),
          ...e.issues.map((i) => h('div', { class: `k-exp-issue ${i.level}` }, `${i.level === 'error' ? '✖' : i.level === 'warn' ? '⚠' : 'ℹ'} ${i.message}`)),
          job && (job.state === 'running' || job.state === 'queued') ? h('div', { class: 'k-exp-prog' }, h('i', { style: { width: `${(job.progress * 100).toFixed(1)}%` } })) : null,
          job && job.state === 'running' ? h('div', { class: 'k-exp-sub' }, `${(job.progress * 100).toFixed(0)}% ${job.label}`) : null,
          job?.error ? h('div', { class: 'k-exp-issue error' }, job.error) : null,
          h('div', { class: 'k-exp-row' }, presets.length ? sel2 : null,
            job ? h('button', { class: 'k-btn', onclick: () => ((openLog = openLog === e.nodeId ? null : e.nodeId), draw()) }, openLog === e.nodeId ? 'Hide log' : `Log (${job.log.length})`) : null),
          job && openLog === e.nodeId ? h('div', { class: 'k-exp-log' }, ...job.log.map((l) => h('div', { class: l.level }, l.message)), job.files.length ? h('div', {}, `files: ${job.files.join(', ')}`) : null) : null,
        );
        list.append(card);
      }
      const keepScroll = (root.querySelector('.k-exp-list') as HTMLElement | null)?.scrollTop ?? 0;
      root.replaceChildren(bar, list);
      list.scrollTop = keepScroll;
    }

    bindGraph();
    const timer = setInterval(() => ctx.visible.get() && !runner.running && draw(), 2000);
    dis.add(() => clearInterval(timer));
    return {
      dispose() {
        runner.cancel();
        dis.dispose();
      },
    };
  },
});

