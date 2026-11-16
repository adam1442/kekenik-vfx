import type { ExpandedNode } from '../../engine/graph/expand';
import { cloneValue, type CurveValue, type ParamDef } from '../../engine/params/schema';
import { Disposer, h } from '../../ui/core/dom';
import { registerPanel } from '../../ui/dock/panel-registry';
import { Dropdown } from '../../ui/widgets/controls';
import { createCurveWidget, type CurveWidget } from '../../ui/widgets/curve';
import '../../ui/widgets/curve-editor';

import { t } from '../../shared/i18n';
/**
 * CURVE EDITOR panel: the large version of the curve widget bound to a curve parameter of the selected node
 * (pick the parameter in the drop-down when the node has several). Edits go through GraphEditor (undo, one step per drag).
 * The same widget is used by the Properties panel; reuses it for animation curves.
 */
registerPanel({
  id: 'curve-editor',
  title: t('curveEditor.curveEditor'),
  icon: 'panel-curve',
  defaultDock: { zone: 'bottom', size: 0.3 },
  description: t('curveEditor.largeEditorForThe'),
  create(host, ctx) {
    const app = ctx.app;
    const dis = new Disposer();
    const note = h('div', { class: 'k-dim', style: { padding: '1rem' } }, 'Select a node with a curve parameter (Curve, Gradient remap, Interpolate, Spline width profile…).');
    const bar = h('div', { class: 'k-toolrow' });
    const body = h('div', { style: { flex: '1', minHeight: '0', padding: '0.5rem', display: 'flex' } });
    host.append(bar, body, note);
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    let widget: CurveWidget | null = null;
    let nodeId: string | null = null;
    let paramId: string | null = null;
    let selfEdit = false;
    const graph = (): typeof app.project.graph => app.project.graph;

    const curveParams = (ex: ExpandedNode | undefined): ParamDef[] => (ex?.params.filter((p) => p.type === 'curve') ?? []) as ParamDef[];
    const clear = (): void => {
      widget?.dispose();
      widget = null;
      body.replaceChildren();
      bar.replaceChildren();
    };
    const rebuild = (): void => {
      clear();
      const id = app.selection.primary;
      const node = id ? graph().nodes.get(id) : undefined;
      const ex = id ? graph().expandedOf(id) : undefined;
      const defs = curveParams(ex);
      if (!id || !node || defs.length === 0) {
        nodeId = paramId = null;
        note.style.display = '';
        return;
      }
      note.style.display = 'none';
      if (nodeId !== id || !defs.some((d) => d.id === paramId)) paramId = defs[0].id;
      nodeId = id;
      const def = defs.find((d) => d.id === paramId)!;
      bar.append(h('b', { style: { padding: '0 0.5rem' } }, `${node.name} · `));
      if (defs.length > 1) bar.append(new Dropdown({ options: defs.map((d) => ({ value: d.id, label: d.label })), value: paramId! }, { onInput: (v) => ((paramId = v), rebuild()) }).el);
      else bar.append(h('span', {}, def.label));
      const value = node.params[def.id] as CurveValue;
      widget = createCurveWidget(
        value,
        {
          onBegin: () => {
            app.engine.scheduler.beginInteraction();
            app.project.editor.stack.begin(`Edit ${def.label}`);
          },
          onInput: (v) => {
            selfEdit = true;
            try {
              app.project.editor.setParam(id, def.id, cloneValue(v));
            } finally {
              selfEdit = false;
            }
          },
          onEnd: () => {
            app.project.editor.stack.commit();
            app.engine.scheduler.endInteraction();
          },
        },
        { fill: true },
      );
      body.append(widget.el);
    };
    const refreshValue = (): void => {
      if (selfEdit || !widget || !nodeId || !paramId) return;
      const node = graph().nodes.get(nodeId);
      if (node) widget.set(node.params[paramId] as CurveValue);
    };
    dis.add(app.selection.onChange.on(rebuild));
    let unGraph: (() => void) | null = null;
    const bindGraph = (): void => {
      unGraph?.();
      unGraph = graph().events.on((e) => {
        if (e.type === 'param') refreshValue();
        else if (e.type === 'reset' || e.type === 'structure') rebuild();
      });
      rebuild();
    };
    dis.add(app.project.onChange.on(bindGraph));
    bindGraph();
    return {
      dispose() {
        unGraph?.();
        clear();
        dis.dispose();
      },
    };
  },
});
