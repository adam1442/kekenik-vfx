import { CATEGORIES } from '../../engine/graph/categories';
import { trNodeDesc, trNodeLabel, trTerm, t as tt } from '../../shared/i18n';
import { placeNewNode } from '../graph-editor/api';
import { PIN_COLORS } from '../../engine/graph/pins';
import type { NodeDefinition } from '../../engine/graph/node';
import { DND_NODE_MIME } from '../../app/services';
import { Disposer, h } from '../../ui/core/dom';
import { contextMenu } from '../../ui/core/menu';
import { registerPanel } from '../../ui/dock/panel-registry';
import { icon } from '../../ui/icons';
import { SearchField, iconButton } from '../../ui/widgets/controls';

/**
 * NODE LIBRARY: searchable categories, favorites, recent. Items are draggable (HTML5 DnD, MIME DND_NODE_MIME carrying the
 * node type id) onto the graph editor, double-click / Enter adds the node at an offset.
 */
registerPanel({
  id: 'node-library',
  title: tt('nodeLibrary.nodeLibrary'),
  icon: 'panel-library',
  defaultDock: { zone: 'left', size: 0.22 },
  description: tt('nodeLibrary.allRegisteredNodesBy'),
  create(host, ctx) {
    const app = ctx.app;
    const dis = new Disposer();
    const collapsed = new Set<string>(((ctx.initialState as { collapsed?: string[] } | undefined)?.collapsed) ?? []);
    let query = '';
    let favOnly = false;
    let hi = 0;
    let flat: NodeDefinition[] = [];
    const list = h('div', { class: 'k-panel-scroll', tabindex: 0 });
    const search = new SearchField({ placeholder: tt('nodeLibrary.searchNodesEnterAdds') }, {
      onInput: (v) => ((query = v), (hi = 0), render()),
      onEnter: () => flat[hi] && add(flat[hi]),
      onKey: (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          hi = Math.max(0, Math.min(flat.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
          render();
          e.preventDefault();
        }
      },
    });
    const favBtn = iconButton('star', tt('nodeLibrary.showFavoritesOnly'), () => ((favOnly = !favOnly), favBtn.classList.toggle('active', favOnly), render()), { cls: 'sm' });
    host.append(h('div', { class: 'k-toolrow' }, search.el, favBtn), list);

    const favs = (): string[] => app.settings.get('favorites');
    const toggleFav = (d: NodeDefinition): void => {
      const f = favs();
      app.settings.set('favorites', f.includes(d.id) ? f.filter((x) => x !== d.id) : [...f, d.id]);
      render();
    };
    function add(d: NodeDefinition): void {
      const g = app.project.graph;
      const n = g.nodes.size;
      const id = app.project.editor.addNode(d.id, placeNewNode({ x: 60 + (n % 6) * 40, y: 60 + (n % 8) * 30 }));
      app.selection.set([id]);
      const r = [d.id, ...app.settings.get('recentNodes').filter((x) => x !== d.id)].slice(0, 8);
      app.settings.set('recentNodes', r);
      render();
    }
    function item(d: NodeDefinition, idx: number): HTMLElement {
      const cat = CATEGORIES[d.category];
      const isFav = favs().includes(d.id);
      const pins = [...new Set([...d.inputs, ...d.outputs].map((p) => p.type))];
      const star = h('span', { class: `star${isFav ? ' on' : ''}`, tip: isFav ? 'Remove from favorites' : 'Add to favorites', onclick: (e: Event) => (e.stopPropagation(), toggleFav(d)) }, icon(isFav ? 'star-fill' : 'star', 12));
      const el = h('div', { class: `k-lib-item${idx === hi ? ' sel' : ''}`, draggable: 'true', tip: [trNodeDesc(d.id, d.description), d.id].join('\n'), style: { borderLeftColor: cat.color }, 'data-node': d.id },
        h('span', { style: { color: cat.color, display: 'flex' } }, icon(d.icon, 14)), h('span', {}, trNodeLabel(d.id, d.title)),
        h('span', { class: 'pins' }, ...pins.map((t) => h('i', { style: { background: PIN_COLORS[t] } }))), star);
      el.addEventListener('dblclick', () => add(d));
      el.addEventListener('click', () => ((hi = idx), list.querySelectorAll('.k-lib-item.sel').forEach((x) => x.classList.remove('sel')), el.classList.add('sel')));
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(DND_NODE_MIME, d.id);
        e.dataTransfer?.setData('text/plain', d.title);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      el.addEventListener('contextmenu', (e) => contextMenu(e, [{ label: tt('common.addToGraph'), icon: 'plus', action: () => add(d) }, { label: isFav ? 'Remove from favorites' : 'Add to favorites', icon: 'star', action: () => toggleFav(d) }, { label: tt('nodeLibrary.showInNodeGallery'), icon: 'panel-gallery', action: () => void app.dock.openPanel('node-gallery') }]));
      return el;
    }
    function section(title: string, ic: string, defs: NodeDefinition[], color?: string, key = title): HTMLElement | null {
      if (!defs.length) return null;
      const open = query !== '' || !collapsed.has(key);
      const head = h('div', { class: 'k-lib-cat', style: color ? { color } : {} }, icon(open ? 'chevron-down' : 'chevron-right', 10), icon(ic, 13), title, h('span', { class: 'count' }, defs.length));
      head.addEventListener('click', () => {
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        ctx.state.set({ collapsed: [...collapsed] });
        render();
      });
      const wrap = h('div', {}, head);
      if (open) for (const d of defs) wrap.append(item(d, flat.indexOf(d) >= 0 ? flat.length : 0));
      return wrap;
    }
    function render(): void {
      const reg = app.engine.registry;
      const all = reg.search(query).filter((d) => !favOnly || favs().includes(d.id));
      flat = [];
      const parts: (HTMLElement | null)[] = [];
      const push = (title: string, ic: string, defs: NodeDefinition[], color?: string, key?: string): void => {
        if (!defs.length) return;
        const open = query !== '' || !collapsed.has(key ?? title);
        const head = h('div', { class: 'k-lib-cat', style: color ? { color } : {} }, icon(open ? 'chevron-down' : 'chevron-right', 10), icon(ic, 13), title, h('span', { class: 'count' }, defs.length));
        head.addEventListener('click', () => {
          const k = key ?? title;
          if (collapsed.has(k)) collapsed.delete(k);
          else collapsed.add(k);
          ctx.state.set({ collapsed: [...collapsed] });
          render();
        });
        const wrap = h('div', {}, head);
        if (open) for (const d of defs) {
          wrap.append(item(d, flat.length));
          flat.push(d);
        }
        parts.push(wrap);
      };
      if (!query && !favOnly) {
        push(trTerm('Favorites'), 'star-fill', favs().map((id) => reg.get(id)).filter((d): d is NodeDefinition => !!d), 'var(--warn)', 'fav');
        push(trTerm('Recent'), 'clock', app.settings.get('recentNodes').map((id) => reg.get(id)).filter((d): d is NodeDefinition => !!d), undefined, 'recent');
      }
      for (const c of Object.values(CATEGORIES).sort((a, b) => a.order - b.order)) {
        push(trTerm(c.label), `cat-${c.id}`, all.filter((d) => d.category === c.id), c.color, `cat:${c.id}`);
      }
      void section;
      if (!parts.length) parts.push(h('div', { class: 'k-empty' }, query ? `No nodes match “${query}”.` : 'No nodes registered.'));
      const st = list.scrollTop;
      list.replaceChildren(...(parts.filter(Boolean) as HTMLElement[]));
      list.scrollTop = st;
      (list.querySelector('.k-lib-item.sel') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
    }
    dis.add(app.settings.onChange.on((k) => (k === 'favorites' || k === 'recentNodes') && render()));
    render();
    return { dispose: () => dis.dispose(), focus: () => search.focus(), serialize: () => ({ collapsed: [...collapsed] }) };
  },
});
