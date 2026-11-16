import { CATEGORIES } from '../../engine/graph/categories';
import type { ExpandedNode } from '../../engine/graph/expand';
import { PIN_COLORS } from '../../engine/graph/pins';
import { cloneValue, isParamVisible, valuesEqual, type ParamDef, type ParamValue } from '../../engine/params/schema';
import { Disposer, h } from '../../ui/core/dom';
import { contextMenu } from '../../ui/core/menu';
import { toast } from '../../ui/core/overlay';
import { registerPanel } from '../../ui/dock/panel-registry';
import { icon } from '../../ui/icons';
import { Checkbox, Collapsible, TabStrip, iconButton } from '../../ui/widgets/controls';
import { createParamWidget, type ParamWidget } from '../../ui/widgets/param-widget';
import { animOf, autoKey } from '../../app/anim';
import { hasKeyAtFrame, isAnimated, valueAt } from '../../engine/anim/animator';
import { isAnimatableDef } from '../../engine/anim/tracks';
import './properties-anim.css';
import { trNodeGroup, trNodeParam, trNodeTab, trNodeTip, trTerm, t as tt } from '../../shared/i18n';
import { buildSimSection } from './sim-panel';
import { HistogramClient } from '../../engine/analysis/histogram-gpu';
import { HistogramStrip, histPrefs, type LevelsControls } from '../../ui/widgets/histogram-strip';

/** In-app clipboard for parameter values (also mirrored to the system clipboard as JSON, best effort). */
let valueClipboard: { type: string; paramId?: string; value?: ParamValue; params?: Record<string, ParamValue> } | null = null;
const collapsedGroups = new Set<string>();
const tabByType = new Map<string, string>();

interface Row {
  /** keyframe button (animatable params only). */
  key?: HTMLButtonElement;
  def: ParamDef;
  widget: ParamWidget;
  el: HTMLElement;
}

/**
 * PROPERTIES PANEL: generated entirely from the expanded ParamSchema (common Texture/Blending tabs included).
 * Tabs, collapsible groups, visibleIf / showWhenConnected, modulation rows, reset-to-default, copy/paste (single value
 * or all), undo transactions (a drag is ONE undo step), multi-node editing of shared params, error banner per node.
 */
registerPanel({
  id: 'properties',
  title: 'Properties',
  icon: 'panel-properties',
  defaultDock: { zone: 'right', size: 0.28 },
  description: tt('properties.parametersOfTheSelected'),
  create(host, ctx) {
    const app = ctx.app;
    const dis = new Disposer();
    const body = h('div', { class: 'k-panel-scroll' });
    host.append(body);
    let rows: Row[] = [];
    let ids: string[] = [];
    let ex: ExpandedNode | null = null;
    let dragging = false;
    let selfEdit = false;
    let pendingRebuild = false;
    let visSig = '';
    let banner: HTMLElement | null = null;
    let sub: HTMLElement | null = null;
    const graph = (): typeof app.project.graph => app.project.graph;

    const apply = (def: ParamDef, v: ParamValue): void => {
      selfEdit = true;
      try {
        const frame = Math.round(app.engine.playback.frame);
        for (const id of ids) {
          if (!graph().nodes.has(id)) continue;
          // animated params (or auto-key) write a KEY at the playhead; everything else writes the static value
          if (isAnimatableDef(def)) animOf(app).editValue(id, def.id, frame, cloneValue(v), autoKey.get(), dragging);
          else app.project.editor.setParam(id, def.id, cloneValue(v));
        }
      } finally {
        selfEdit = false;
      }
    };

    const visibleDefs = (): ParamDef[] => {
      if (!ex) return [];
      const n = graph().nodes.get(ids[0]);
      if (!n) return [];
      const connected = graph().connectedInputs(ids[0]);
      return ex.params.filter((d) => isParamVisible(d, n.params, connected));
    };

    const sharedDefs = (): ParamDef[] => {
      const exs = ids.map((id) => graph().expandedOf(id)).filter((e): e is ExpandedNode => !!e);
      if (!exs.length) return [];
      const first = exs[0];
      if (exs.every((e) => e.def.id === first.def.id)) return visibleDefs();
      return visibleDefs().filter((d) => exs.every((e) => e.params.some((p) => p.id === d.id && p.type === d.type)));
    };

    function refreshValues(): void {
      const g = graph();
      for (const r of rows) {
        const frame = app.engine.playback.frame;
        const vals = ids.map((id) => valueAt(g, id, r.def.id, frame)).filter((v) => v !== undefined) as ParamValue[];
        if (!vals.length) continue;
        r.widget.set(vals[0]);
        r.widget.setMixed(vals.some((v) => !valuesEqual(v, vals[0])));
        r.el.classList.toggle('changed', vals.some((v) => !valuesEqual(v, r.def.default as ParamValue)));
        if (r.key) {
          const an = ids.some((id) => isAnimated(g, id, r.def.id));
          const kd = ids.length > 0 && ids.every((id) => hasKeyAtFrame(g, id, r.def.id, frame));
          r.key.classList.toggle('animated', an && !kd);
          r.key.classList.toggle('keyed', kd);
          r.el.classList.toggle('anim', an);
        }
      }
    }

    /** Add a key at the playhead, or remove it when one exists there (all edited nodes). */
    function toggleKey(def: ParamDef, mode: 'toggle' | 'add' | 'remove' = 'toggle'): void {
      const f = Math.round(app.engine.playback.frame);
      const a = animOf(app);
      app.project.editor.stack.transaction(`Key ${def.label}`, () => {
        for (const id of ids) {
          const has = hasKeyAtFrame(graph(), id, def.id, f);
          if (has && mode !== 'add') a.removeKey(id, def.id, f);
          else if (!has && mode !== 'remove') a.setKey(id, def.id, f);
        }
      });
      refreshValues();
    }
    function jumpKey(def: ParamDef, dir: 1 | -1): void {
      const g = graph();
      const frames: number[] = [];
      for (const id of ids) {
        const tr = g.nodes.get(id)?.anim?.[def.id];
        if (!tr) continue;
        if (tr.kind === 'snap') tr.snaps.forEach((s) => frames.push(s.t));
        else tr.ch.forEach((c) => c.keys.forEach((k) => frames.push(k.t)));
      }
      app.engine.playback.jumpToKey(frames, dir);
    }

    /**
     * live input histogram. Levels: strip with draggable black / gamma / white handles in the Gamma row; Curve: histogram backdrop of the
     * curve editor. Only for a single selected node with a connected-or-not `input` pin; computes only while the widget is visible.
     */
    function attachHistogram(def: ParamDef, row: Row, pw: ReturnType<typeof createParamWidget>): void {
      const type = ex!.def.id;
      const isLevels = type.startsWith('utils.levels') && def.id === 'gamma';
      const isCurve = def.type === 'curve' && ex!.inputs.some((p) => p.id === 'input' && (p.type === 'gray' || p.type === 'color'));
      if ((!isLevels && !isCurve) || ids.length !== 1) return;
      const nodeId = ids[0];
      const client = new HistogramClient({ engine: app.engine, graph, nodeId: () => nodeId, wantOutput: () => isLevels && histPrefs.out, hdr: () => histPrefs.hdr });
      const defOf = (id: string): ParamDef => ex!.params.find((p) => p.id === id)!;
      const levels: LevelsControls | undefined = isLevels
        ? {
            begin: () => {
              dragging = true;
              app.engine.scheduler.beginInteraction();
              app.project.editor.stack.begin('Edit Levels');
            },
            set: (id, v) => {
              apply(defOf(id), v);
              refreshValues();
            },
            end: () => {
              dragging = false;
              app.project.editor.stack.commit();
              app.engine.scheduler.endInteraction();
              refreshAfterEdit();
            },
            get: (id) => Number(graph().nodes.get(nodeId)?.params[id] ?? defOf(id).default),
            locked: () => !!graph().nodes.get(nodeId)?.params.auto,
          }
        : undefined;
      const strip = new HistogramStrip(client, { mode: isLevels ? 'levels' : 'curve', levels, onBins: isCurve ? (b) => pw.curve?.setHistogram?.(b) : undefined });
      row.el.querySelector('.ctl')?.prepend(strip.el);
      const off = graph().events.on(() => client.request());
      client.request(true);
      const inner = pw.dispose;
      pw.dispose = () => {
        off();
        strip.dispose();
        inner();
      };
    }

    function makeRow(def: ParamDef, defsAll: ParamDef[]): Row {
      const n = graph().nodes.get(ids[0])!;
      const pw = createParamWidget(def, valueAt(graph(), ids[0], def.id, app.engine.playback.frame) ?? n.params[def.id], {
        onBegin: () => {
          dragging = true;
          app.engine.scheduler.beginInteraction();
          app.project.editor.stack.begin(`Edit ${def.label}${ids.length > 1 ? ` (${ids.length} nodes)` : ''}`);
        },
        onInput: (v) => {
          if (dragging) apply(def, v);
          else app.project.editor.stack.transaction(`Edit ${def.label}`, () => apply(def, v));
          row.el.classList.toggle('changed', !valuesEqual(v, def.default as ParamValue));
          if (!dragging) refreshAfterEdit();
        },
        onEnd: () => {
          dragging = false;
          app.project.editor.stack.commit();
          app.engine.scheduler.endInteraction();
          refreshAfterEdit();
        },
      });
      const reset = iconButton('reset', tt('properties.resetToDefault'), () => {
        app.project.editor.stack.transaction(`Reset ${def.label}`, () => apply(def, def.default as ParamValue));
        refreshAfterEdit(true);
      }, { size: 12, cls: 'sm reset' });
      const keyBtn = isAnimatableDef(def) ? iconButton('key', tt('properties.keyframeAddRemove'), () => toggleKey(def), { size: 12, cls: 'sm k-key' }) : null;
      const isMod = defsAll.some((d) => def.id === `${d.id}_mod_k`);
      const label = h('div', { class: 'lbl', tip: def.tooltip ? trNodeTip(ex!.def.id, def.id, def.tooltip) : trNodeParam(ex!.def.id, def.id, def.label) }, isMod ? h('span', { class: 'k-dim' }, '↳') : null, h('span', {}, trNodeParam(ex!.def.id, def.id, def.label)));
      const row: Row = { def, widget: pw, el: h('div', { class: 'k-prow' }, label, h('div', { class: 'ctl' }, pw.el), h('div', { class: 'acts' }, keyBtn, reset)), key: keyBtn ?? undefined };
      row.el.addEventListener('contextmenu', (e) =>
        contextMenu(e, [
          { label: tt('properties.copyValue'), icon: 'copy', action: () => copyValue(def) },
          { label: tt('properties.pasteValue'), icon: 'paste', disabled: !valueClipboard || valueClipboard.paramId !== def.id, action: () => pasteValue(def) },
          { separator: true },
          { label: tt('common.resetToDefault'), icon: 'reset', action: () => reset.click() },
          ...(app.project.activeDefId && ids.length === 1 ? [{ separator: true as const }, { label: tt('properties.exposeAsSubgraphParameter'), icon: 'plus', action: () => void app.commands.execute('subgraph.expose', { node: ids[0], param: def.id }) }] : []),
          ...(isAnimatableDef(def)
            ? [
                { separator: true as const },
                { label: tt('common.addKeyAtPlayhead'), icon: 'key', action: () => toggleKey(def, 'add') },
                { label: tt('properties.deleteKeyAtPlayhead'), action: () => toggleKey(def, 'remove') },
                { label: tt('properties.jumpToPreviousKey'), action: () => jumpKey(def, -1) },
                { label: tt('properties.jumpToNextKey'), action: () => jumpKey(def, 1) },
                { label: tt('common.resetAnimationKeepCurrent'), action: () => ids.forEach((id) => animOf(app).resetAnimation(id, def.id, app.engine.playback.frame)) },
              ]
            : []),
        ]),
      );
      attachHistogram(def, row, pw);
      if (keyBtn) {
        const g = graph();
        const f = app.engine.playback.frame;
        const an = ids.some((id) => isAnimated(g, id, def.id));
        const kd = ids.every((id) => hasKeyAtFrame(g, id, def.id, f));
        keyBtn.classList.toggle('animated', an && !kd);
        keyBtn.classList.toggle('keyed', kd && an);
        row.el.classList.toggle('anim', an);
      }
      return row;
    }

    function copyValue(def: ParamDef): void {
      const v = graph().nodes.get(ids[0])?.params[def.id];
      if (v === undefined) return;
      valueClipboard = { type: ex!.def.id, paramId: def.id, value: cloneValue(v) };
      void navigator.clipboard?.writeText(JSON.stringify({ param: def.id, value: v })).catch(() => undefined);
      toast(tt('properties.copied', { label: def.label }), { timeout: 1200 });
    }
    function pasteValue(def: ParamDef): void {
      if (valueClipboard?.paramId !== def.id || valueClipboard.value === undefined) return;
      app.project.editor.stack.transaction(`Paste ${def.label}`, () => apply(def, valueClipboard!.value!));
      refreshAfterEdit();
    }
    function copyAll(): void {
      const n = graph().nodes.get(ids[0]);
      if (!n) return;
      valueClipboard = { type: n.type, params: JSON.parse(JSON.stringify(n.params)) as Record<string, ParamValue> };
      void navigator.clipboard?.writeText(JSON.stringify({ node: n.type, params: n.params })).catch(() => undefined);
      toast(tt('properties.copiedAllValuesOf', { name: n.name }), { timeout: 1400 });
    }
    function pasteAll(): void {
      const c = valueClipboard;
      if (!c?.params) return void toast(tt('properties.nothingToPasteUse'), { type: 'warn' });
      app.project.editor.stack.transaction('Paste values', () => {
        for (const id of ids) {
          const n = graph().nodes.get(id);
          if (!n || n.type !== c.type) continue;
          for (const [k, v] of Object.entries(c.params!)) app.project.editor.setParam(id, k, cloneValue(v));
        }
      });
      refreshAfterEdit(true);
    }
    function resetAll(): void {
      app.project.editor.stack.transaction('Reset parameters', () => {
        for (const r of rows) apply(r.def, r.def.default as ParamValue);
      });
      refreshAfterEdit(true);
    }

    /** After an edit: refresh widgets and rebuild when the visible parameter set changed. */
    function refreshAfterEdit(force = false): void {
      const sig = visibleDefs().map((d) => d.id).join('|');
      if (force || sig !== visSig) rebuild();
      else refreshValues();
    }

    function rebuild(): void {
      if (dragging) {
        pendingRebuild = true;
        return;
      }
      pendingRebuild = false;
      const scroll = body.scrollTop;
      rows.forEach((r) => r.widget.dispose());
      rows = [];
      ids = app.selection.get().filter((id) => graph().nodes.has(id));
      banner = null;
      sub = null;
      if (!ids.length) {
        ex = null;
        body.replaceChildren(h('div', { class: 'k-empty' }, nodeArt(), h('div', {}, tt('properties.toViewAndEdit')), h('div', {}, tt('properties.selectItInThe'))));
        return;
      }
      const g = graph();
      ex = g.expandedOf(ids[0]) ?? null;
      const first = g.nodes.get(ids[0])!;
      if (!ex) {
        body.replaceChildren(h('div', { class: 'k-banner' }, tt('properties.nodeType', { type: first.type })));
        return;
      }
      const multi = ids.length > 1;
      const mixedTypes = ids.some((id) => g.nodes.get(id)?.type !== first.type);
      const def = ex.def;
      const defs = multi ? sharedDefs() : visibleDefs();
      visSig = visibleDefs().map((d) => d.id).join('|');
      const cat = CATEGORIES[def.category];

      // header
      const nameInput = h('input', { class: 'name', value: multi ? `${ids.length} nodes selected` : first.name, spellcheck: 'false', 'aria-label': 'Node name' });
      nameInput.disabled = multi;
      nameInput.addEventListener('keydown', (e) => (e.stopPropagation(), e.key === 'Enter' && nameInput.blur()));
      nameInput.addEventListener('change', () => {
        const v = nameInput.value.trim();
        if (v && v !== first.name) app.project.editor.setNodeField(first.id, 'name', v);
      });
      const bypass = new Checkbox({ value: !!first.bypass, label: 'Bypass', tip: tt('properties.passTheFirstCompatible') }, {
        onInput: (v) => app.project.editor.stack.transaction('Bypass', () => ids.forEach((id) => app.project.editor.setNodeField(id, 'bypass', v))),
      });
      const head = h(
        'div',
        { class: 'k-props-head' },
        h('div', { class: 'ico', style: { color: cat.color } }, icon(def.icon, 16)),
        nameInput,
        bypass.el,
        iconButton('copy', tt('properties.copyAllValues'), copyAll, { cls: 'sm' }),
        iconButton('paste', tt('properties.pasteValues'), pasteAll, { cls: 'sm' }),
        iconButton('reset', tt('properties.resetAllParameters'), resetAll, { cls: 'sm' }),
      );
      sub = h('div', { class: 'k-props-sub' }, `${cat.label} · ${def.title}${mixedTypes ? ' · mixed types: showing shared parameters' : ''}`);
      banner = h('div', { class: 'k-banner', style: { display: 'none' } });
      const parts: HTMLElement[] = [head, sub, banner];
      if (!multi && def.simulation) {
        const nid = first.id;
        const sec = buildSimSection({
          engine: app.engine,
          nodeId: nid,
          defId: first.type,
          paused: () => graph().nodes.get(nid)?.params.paused === true,
          setParams: (vals) => app.project.editor.stack.transaction('Simulation', () => Object.entries(vals).forEach(([k, v]) => app.project.editor.setParam(nid, k, v as ParamValue))),
        });
        parts.push(sec.el);
      }

      // pins (single node only)
      if (!multi) {
        const conn = g.connectedInputs(first.id);
        parts.push(new Collapsible('Pins', { open: false }).el);
        const pinBody = (parts[parts.length - 1].querySelector('.k-group-body') as HTMLElement);
        for (const p of ex.inputs) pinBody.append(h('div', { class: 'k-pin-row', tip: p.tooltip ? trNodeTip(ex.def.id, p.id, p.tooltip) : undefined }, h('span', { class: 'k-pin-dot', style: { background: PIN_COLORS[p.type], opacity: conn.has(p.id) ? '1' : '0.35' } }), trTerm(p.name), h('span', { class: 'k-dim' }, `${p.type}${p.optional ? ' · optional' : ' · required'}${conn.has(p.id) ? ' · connected' : ''}`)));
        for (const p of ex.outputs) pinBody.append(h('div', { class: 'k-pin-row' }, h('span', { class: 'k-pin-dot', style: { background: PIN_COLORS[p.type] } }), trTerm(p.name), h('span', { class: 'k-dim' }, tt('properties.output', { type: p.type }))));
      }

      // tabs
      const tabs = [...new Set(defs.map((d) => d.tab ?? 'Main'))];
      const order = (t: string): number => (t === 'Texture' ? 0 : t === 'Blending' ? 2 : 1);
      tabs.sort((a, b) => order(a) - order(b));
      const remembered = tabByType.get(def.id);
      let active = remembered && tabs.includes(remembered) ? remembered : (tabs.find((t) => t !== 'Texture' && t !== 'Blending') ?? tabs[0]);
      const content = h('div');
      const draw = (): void => {
        rows.forEach((r) => r.widget.dispose());
        rows = [];
        content.replaceChildren();
        let cur: Collapsible | null = null;
        let curGroup: string | undefined | null = null;
        const groupHost = (d: ParamDef): HTMLElement => {
          if (!d.group) {
            cur = null;
            curGroup = undefined;
            return content;
          }
          if (cur && curGroup === d.group) return cur.body;
          const key = `${def.id}/${active}/${d.group}`;
          cur = new Collapsible(trNodeGroup(def.id, d.group), { open: !collapsedGroups.has(key), onToggle: (o) => (o ? collapsedGroups.delete(key) : collapsedGroups.add(key)) });
          curGroup = d.group;
          content.append(cur.el);
          return cur.body;
        };
        for (const d of defs.filter((x) => (x.tab ?? 'Main') === active)) {
          const r = makeRow(d, defs);
          rows.push(r);
          groupHost(d).append(r.el);
        }
        refreshValues();
        if (!rows.length) content.append(h('div', { class: 'k-empty' }, tt('properties.noParameters')));
      };
      if (tabs.length > 1) parts.push(new TabStrip(tabs, active, (t) => ((active = t), tabByType.set(def.id, t), draw()), trNodeTab).el);
      parts.push(content);
      body.replaceChildren(...parts);
      draw();
      body.scrollTop = scroll;
      showErrors();
    }

    function showErrors(res?: Map<string, string>, status?: string): void {
      if (!banner || !ids.length) return;
      const err = res?.get(ids[0]);
      banner.style.display = err ? '' : 'none';
      banner.textContent = err ?? '';
      if (sub && status) sub.textContent = sub.textContent!.replace(/ · (ok|cached|error|blocked|bypassed).*$/, '') + ` · ${status}`;
    }

    function nodeArt(): SVGSVGElement {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      t.setAttribute('class', 'art');
      t.setAttribute('viewBox', '0 0 120 80');
      t.innerHTML = '<g fill="none" stroke="currentColor" stroke-width="1.5"><rect x="8" y="24" width="36" height="26" rx="5"/><rect x="62" y="4" width="40" height="30" rx="5" stroke="#9a8dff"/><rect x="70" y="52" width="34" height="24" rx="5"/><path d="M44 36 62 20M44 40l26 22" stroke-dasharray="3 3"/></g>';
      return t as unknown as SVGSVGElement;
    }

    // wiring
    let unGraph: (() => void) | null = null;
    const bindGraph = (): void => {
      unGraph?.();
      unGraph = graph().events.on((e) => {
        if (selfEdit && e.type === 'param') return;
        if (dragging) return;
        if (e.type === 'param') {
          // external change (undo/redo, paste from elsewhere): update in place unless visibility changed
          if (ids.some((id) => e.dirty.has(id))) refreshAfterEdit();
        } else if (e.type === 'structure' || e.type === 'meta' || e.type === 'reset') rebuild();
      });
      rebuild();
    };
    const openCurve = (): void => void app.dock.openPanel('curve-editor');
    window.addEventListener('kk-open-curve-editor', openCurve);
    dis.add(() => window.removeEventListener('kk-open-curve-editor', openCurve));
    dis.add(app.selection.onChange.on(() => rebuild()));
    dis.add(app.project.onChange.on(bindGraph));
    dis.add(app.project.editor.stack.onChange.on(() => undefined));
    dis.add(ctx.app.engine.scheduler.onResult.on(({ result }) => {
      if (ids.length) showErrors(result.errors, (() => { const s = result.stats.nodes.get(ids[0]); return s ? `${s.status}${s.cpuMs ? ` ${s.cpuMs.toFixed(1)} ms` : ''}${s.gpuMs !== undefined ? ` · gpu ${s.gpuMs.toFixed(2)} ms` : ''}` : undefined; })());
    }));
    // while the playhead moves, animated rows follow it (only animated rows: typing elsewhere is never disturbed)
    dis.add(app.engine.playback.onChange.on(() => {
      if (dragging || !ids.length) return;
      const g = graph();
      const f = app.engine.playback.frame;
      for (const r of rows) {
        if (!r.el.classList.contains('anim')) continue;
        const v = valueAt(g, ids[0], r.def.id, f);
        if (v !== undefined) r.widget.set(v);
        if (r.key) {
          const kd = ids.every((id) => hasKeyAtFrame(g, id, r.def.id, f));
          r.key.classList.toggle('keyed', kd);
          r.key.classList.toggle('animated', !kd);
        }
      }
    }));
    dis.add(autoKey.subscribe(() => body.classList.toggle('autokey', autoKey.get())));
    bindGraph();
    void pendingRebuild;
    return {
      dispose: () => {
        unGraph?.();
        dis.dispose();
        rows.forEach((r) => r.widget.dispose());
      },
    };
  },
});
