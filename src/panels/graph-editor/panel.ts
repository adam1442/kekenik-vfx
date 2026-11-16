import { registerPanel } from '../../ui/dock/panel-registry';
import type { AppServices } from '../../app/app';
import { setActiveGraphView } from './api';
import { GraphView, type GraphHost } from './view';
import type { View } from './core/viewport';
import type { AlignMode } from './core/snap';
import type { LinkStyle } from './core/geometry';

import { t as tt, trNodeParam } from '../../shared/i18n';
import { openSplineEditor } from '../../ui/widgets/spline-editor';
import type { ParamGesture } from '../../engine/commands/gesture';
import type { ParamValue, SplineValue } from '../../engine/params/schema';
/**
 * GRAPH EDITOR PANEL. Thin adapter: wires GraphView to the app services, registers the `graph.*` commands
 * (so every shortcut is in the keymap / palette / shortcuts dialog) and persists the camera in the workspace.
 */
function hostFor(app: AppServices, visible: GraphHost['visible']): GraphHost {
  return {
    registry: app.engine.registry,
    engine: app.engine,
    editor: () => app.project.editor,
    selection: app.selection,
    active: app.active,
    onProjectChange: app.project.onChange,
    visible,
    openViewport: (kind) => {
      const id = kind === '2d' ? 'viewport-2d' : 'viewport-3d';
      if (!app.dock.isOpen(id)) app.dock.openPanel(id);
    },
    editSpline: (nodeId, paramId) => {
      const node = app.project.graph.nodes.get(nodeId);
      const def = app.engine.registry.expanded(node?.type ?? '')?.params.find((d) => d.id === paramId);
      if (!node || !def || def.type !== 'spline') return;
      const cur = node.params[paramId] as unknown as SplineValue;
      let gesture: ParamGesture | null = null;
      openSplineEditor({
        title: trNodeParam(node.type, def.id, def.label),
        value: cur,
        minPoints: def.minPoints ?? 2,
        dim3: false,
        profile: true,
        onBegin: () => void (gesture ??= app.project.editor.beginGesture(tt('spline.profileEditor'))),
        onChange: (v) => (gesture ??= app.project.editor.beginGesture(tt('spline.profileEditor'))).set(nodeId, paramId, v as unknown as ParamValue),
        onEnd: () => {
          gesture?.commit();
          gesture = null;
        },
      });
    },
    setHint: (t) => app.hint.set(t),
  };
}

function registerGraphCommands(app: AppServices, view: GraphView): Array<() => void> {
  const un: Array<() => void> = [];
  const on = (): boolean => view.isActive();
  const reg = (id: string, title: string, keys: string[] | undefined, run: () => void, icon?: string, extra: { hidden?: boolean } = {}): void => {
    un.push(app.commands.register({ id: `graph.${id}`, title, category: 'Graph', icon, keys, enabled: on, run, ...extra }));
  };
  reg('frameAll', 'Graph: Frame All', ['A'], () => view.fitAll(), 'fit');
  reg('frameSelected', 'Graph: Frame Selected', ['F'], () => view.fitSelection(), 'zoom-in');
  reg('search', 'Graph: Add Node (search)', ['Tab'], () => view.openSearchAtCursor(), 'search');
  reg('find', 'Graph: Find in Graph', ['Mod+F'], () => view.openFind(), 'search');
  reg('deleteHeal', 'Graph: Delete and Reconnect', ['Mod+Delete', 'Mod+Backspace'], () => view.deleteSelection(true), 'delete');
  reg('group', 'Graph: Comment Frame around Selection', ['Mod+Shift+G'], () => view.addFrameForSelection(), 'tile');
  reg('note', 'Graph: Add Sticky Note', ['Shift+N'], () => view.addNoteAt(), 'file');
  reg('collapse', 'Graph: Collapse / Expand Nodes', ['C'], () => view.toggleCollapse(), 'chevron-down');
  reg('lock', 'Graph: Lock / Unlock Nodes', ['L'], () => view.toggleLock(), 'lock');
  reg('autoLayout', 'Graph: Auto Layout', ['Shift+L'], () => view.autoLayout(), 'layout');
  reg('selectUp', 'Graph: Select Upstream', ['Alt+['], () => view.selectStream('up'));
  reg('selectDown', 'Graph: Select Downstream', ['Alt+]'], () => view.selectStream('down'));
  reg('view2d', 'Graph: View Node in 2D', ['2'], () => view.sel.nodes.size && view.viewNode([...view.sel.nodes].pop()!, '2d'), 'panel-2d');
  reg('view3d', 'Graph: View Node in 3D', ['3'], () => view.sel.nodes.size && view.viewNode([...view.sel.nodes].pop()!, '3d'), 'panel-3d');
  reg('copy', 'Graph: Copy Selection (JSON)', undefined, () => void view.copySelection(), 'copy');
  reg('paste', 'Graph: Paste (JSON)', undefined, () => void view.pasteFromClipboard(), 'paste');
  const aligns: [string, AlignMode][] = [['Left', 'left'], ['Right', 'right'], ['Top', 'top'], ['Bottom', 'bottom'], ['Centres Horizontally', 'hcenter'], ['Centres Vertically', 'vcenter']];
  for (const [t, m] of aligns) reg(`align.${m}`, `Graph: Align ${t}`, undefined, () => view.align(m));
  reg('distribute.x', 'Graph: Distribute Horizontally', undefined, () => view.distribute('x'));
  reg('distribute.y', 'Graph: Distribute Vertically', undefined, () => view.distribute('y'));
  for (const s of ['bezier', 'orthogonal', 'straight'] as LinkStyle[]) reg(`linkStyle.${s}`, `Graph: Link Style ${s[0].toUpperCase()}${s.slice(1)}`, undefined, () => view.setLinkStyle(s));
  reg('toggleFlow', 'Graph: Toggle Data-flow Animation', undefined, () => view.setPref('flow', !view.prefs.flow));
  reg('toggleSnap', 'Graph: Toggle Snap to Grid', undefined, () => view.setPref('snap', !view.prefs.snap));
  reg('toggleMinimap', 'Graph: Toggle Minimap', undefined, () => view.setPref('minimap', !view.prefs.minimap));
  for (let i = 0; i < 9; i++) {
    reg(`bookmark.jump.${i + 1}`, `Graph: Jump to Bookmark ${i + 1}`, [`Shift+${i + 1}`], () => view.jumpBookmark(i), 'key', { hidden: true });
    reg(`bookmark.set.${i + 1}`, `Graph: Save Bookmark ${i + 1} (current view)`, [`Mod+Shift+${i + 1}`], () => view.setBookmarkHere(i), 'key', { hidden: true });
  }
  reg('exit', 'Graph: Exit Subgraph', ['Alt+ArrowUp'], () => void import('./navigation').then((m) => m.graphNavigation.exit()));
  return un;
}

registerPanel({
  id: 'graph-editor',
  title: tt('graphEditor.nodeGraph'),
  icon: 'panel-graph',
  defaultDock: { zone: 'center' },
  description: tt('graphEditor.nodeGraphEditorLive'),
  create(host, ctx) {
    const app = ctx.app;
    const view = new GraphView(hostFor(app, ctx.visible), host);
    setActiveGraphView(view);
    const un = registerGraphCommands(app, view);
    const saved = (ctx.initialState as { view?: View } | undefined)?.view;
    if (saved && Number.isFinite(saved.zoom) && Number.isFinite(saved.x) && Number.isFinite(saved.y)) view.setView(saved);
    else view.fitAll(false);
    return {
      dispose: () => {
        un.forEach((u) => u());
        setActiveGraphView(null);
        view.dispose();
      },
      resize: (w, h) => view.resize(w, h),
      focus: () => view.focus(),
      serialize: () => ({ view: view.view }),
    };
  },
});
