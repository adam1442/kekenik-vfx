import { assets } from '../../engine/io/assets';
import { defTypeId } from '../../engine/subgraph/def';
import { getLibrary, cachedThumb, renderThumb } from '../../app/library';
import { download, h, pickFile } from '../../ui/core/dom';
import { contextMenu } from '../../ui/core/menu';
import { confirmDialog, promptDialog, toast } from '../../ui/core/overlay';
import { registerPanel } from '../../ui/dock/panel-registry';
import { icon } from '../../ui/icons';
import { CATEGORIES } from '../../engine/graph/categories';
import { getActiveGraphView, placeNewNode } from '../graph-editor/api';

import { t as tt } from '../../shared/i18n';
/**
 * PRESETS & ASSETS panel. Tabs: Presets (search, folders, favourites, thumbnails, click to add), Subgraphs (project
 * definitions + user library), Assets (imported files of the project), Libraries (JSON bundles for team sharing).
 */
registerPanel({
  id: 'assets',
  title: tt('assets.presetsAssets'),
  icon: 'panel-assets',
  defaultDock: { zone: 'left', size: 0.22 },
  description: tt('assets.nodePresetsSubgraphLibrary'),
  create(host, ctx) {
    const app = ctx.app;
    const lib = getLibrary();
    const root = h('div', { class: 'k-assets', style: { display: 'flex', flexDirection: 'column', height: '100%', fontSize: '1rem' } });
    host.append(root);
    if (!lib) {
      root.append(h('div', { class: 'k-dim', style: { padding: '1rem' } }, 'Library services are starting…'));
      return { dispose: () => root.remove() };
    }
    let tab: 'presets' | 'subgraphs' | 'assets' | 'libs' = 'presets';
    let query = '';
    let folder = '';
    let favOnly = false;
    const tabs = h('div', { style: { display: 'flex', gap: '0.167rem', padding: '0.333rem', borderBottom: '1px solid var(--line)' } });
    const content = h('div', { style: { flex: '1', overflow: 'auto', padding: '0.5rem' } });
    root.append(tabs, content);
    const btn = (t: string, on: () => void, tip?: string): HTMLElement => h('button', { class: 'k-btn sm', tip, onclick: on }, t);
    const rowCss = { display: 'flex', alignItems: 'center', gap: '0.667rem', padding: '0.333rem 0.5rem', borderRadius: '0.333rem', cursor: 'pointer' };

    const renderPresets = (): void => {
      const search = h('input', { type: 'text', placeholder: tt('assets.searchPresetsTags'), value: query, style: { flex: '1' } }) as HTMLInputElement;
      search.addEventListener('input', () => {
        query = search.value;
        list();
      });
      search.addEventListener('keydown', (e) => e.stopPropagation());
      const sel = h('select', {}, h('option', { value: '' }, tt('assets.allFolders')), ...lib.presets.folders().map((f) => h('option', { value: f, selected: f === folder }, f))) as HTMLSelectElement;
      sel.addEventListener('change', () => {
        folder = sel.value;
        list();
      });
      const fav = h('button', { class: `k-btn sm${favOnly ? ' on' : ''}`, tip: tt('assets.favoritesOnly'), onclick: () => ((favOnly = !favOnly), renderPresets()) }, icon('star', 12));
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7.167rem, 1fr))', gap: '0.5rem', marginTop: '0.5rem' } });
      const list = (): void => {
        const found = lib.presets.search(query, { folder: folder || undefined, favoritesOnly: favOnly, limit: 300 });
        grid.replaceChildren(
          ...found.map((p) => {
            const thumb = h('div', { style: { aspectRatio: '1', background: '#000', borderRadius: '0.25rem', border: '1px solid var(--line)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: CATEGORIES[(p.nodeType.split('.')[0] as keyof typeof CATEGORIES) ?? 'utils']?.color ?? '#999' } }, p.thumbnail ? h('img', { src: p.thumbnail, style: { width: '100%', height: '100%', objectFit: 'cover' } }) : icon(`cat-${p.nodeType.split('.')[0]}`, 26));
            if (!p.thumbnail && p.builtin) {
              // factory preset thumbnails are rendered from a one-node graph the first time they are shown, then cached
              void cachedThumb(lib, `preset:${p.id}:v1`, async () => {
                const g = app.engine.newGraph({ width: 256, height: 256 });
                try {
                  const n = g.addNode(p.nodeType, { params: p.params });
                  const ex = g.registry.expanded(p.nodeType);
                  const pin = ex?.outputs.find((o) => o.type === 'gray' || o.type === 'color');
                  return pin && ex?.inputs.every((i) => i.optional) ? await renderThumb(app, g, { nodeId: n.id, pinId: pin.id }, 96) : null;
                } catch {
                  return null;
                }
              }).then((url) => url && thumb.replaceChildren(h('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' } })));
            }
            const star = h('span', { style: { position: 'absolute', right: '0.25rem', top: '0.167rem', cursor: 'pointer', color: p.favorite ? '#e5c07b' : '#666' }, onclick: (e: Event) => (e.stopPropagation(), void lib.presets.toggleFavorite(p.id)) }, icon('star', 11));
            const el = h('div', { style: { position: 'relative', cursor: 'pointer' }, tip: `${p.name} — ${p.folder}${p.tags.length ? ` · ${p.tags.join(', ')}` : ''}\nClick to add to the graph` }, thumb, star, h('div', { style: { fontSize: '0.833rem', marginTop: '0.167rem', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name));
            el.addEventListener('click', () => lib.spawnPreset(p, getActiveGraphView()?.nextNodePosition({ x: 0, y: 0 })));
            el.addEventListener('contextmenu', (e) =>
              contextMenu(e, [
                { label: tt('common.addToGraph'), action: () => lib.spawnPreset(p) },
                { label: p.favorite ? 'Remove from favorites' : 'Add to favorites', action: () => void lib.presets.toggleFavorite(p.id) },
                { separator: true },
                { label: tt('common.rename'), disabled: !!p.builtin, action: async () => { const n = await promptDialog(tt('common.renamePreset'), 'Name', p.name); if (n) void lib.presets.update(p.id, { name: n }); } },
                { label: tt('assets.moveToFolder'), disabled: !!p.builtin, action: async () => { const n = await promptDialog(tt('assets.movePreset'), 'Folder', p.folder); if (n) void lib.presets.update(p.id, { folder: n }); } },
                { label: 'Delete', danger: true, disabled: !!p.builtin, action: async () => { if (await confirmDialog(tt('assets.deletePreset'), `Delete “${p.name}”?`, { danger: true, ok: 'Delete' })) void lib.presets.remove(p.id); } },
              ]),
            );
            return el;
          }),
          found.length ? '' : h('div', { class: 'k-dim', style: { gridColumn: '1/-1', padding: '0.667rem' } }, 'No presets match.'),
        );
      };
      content.replaceChildren(
        h('div', { style: { display: 'flex', gap: '0.333rem' } }, search, fav),
        h('div', { style: { display: 'flex', gap: '0.333rem', marginTop: '0.333rem' } }, sel, btn('Save selected…', () => void app.commands.execute('preset.save'), 'Save the selected node as a preset')),
        grid,
      );
      list();
    };

    const renderSubgraphs = (): void => {
      const sg = app.engine.subgraphs;
      const uses = (id: string): number => app.project.rootGraph.toData().nodes.filter((n) => n.type === defTypeId(id)).length;
      const projectRows = sg.list().map((d) => {
        const el = h('div', { style: rowCss }, icon('cat-subgraph', 14), h('span', { style: { flex: '1' } }, d.name), h('span', { class: 'k-dim' }, `v${d.version} · ${d.graph.nodes.length} nodes · ${uses(d.id)}×`));
        el.addEventListener('click', () => app.project.editor.addNode(defTypeId(d.id), { ...placeNewNode({ x: 0, y: 0 }), name: d.name }));
        el.addEventListener('contextmenu', (e) =>
          contextMenu(e, [
            { label: tt('assets.addInstance'), action: () => el.click() },
            { label: tt('assets.saveToUserLibrary'), action: () => void lib.saveSubgraphToLibrary(d.id) },
            { label: tt('assets.exportFile'), action: () => download(`${d.name.replace(/[^\w-]+/g, '_')}.kvsg`, JSON.stringify(sg.exportBundle(d.id)), 'application/json') },
            { separator: true },
            { label: tt('assets.deleteDefinition'), danger: true, disabled: uses(d.id) > 0, action: () => sg.remove(d.id) },
          ]),
        );
        return el;
      });
      const userRows = lib.userSubgraphList.map((u) => {
        const el = h('div', { style: rowCss }, icon('cat-subgraph', 14), h('span', { style: { flex: '1' } }, u.name), h('span', { class: 'k-dim' }, new Date(u.modified).toLocaleDateString()));
        el.addEventListener('click', () => lib.spawnUserSubgraph(u));
        el.addEventListener('contextmenu', (e) =>
          contextMenu(e, [
            { label: tt('common.addToGraph'), action: () => lib.spawnUserSubgraph(u) },
            { label: tt('assets.removeFromLibrary'), danger: true, action: async () => { await lib.userSubgraphs.del(u.id); lib.userSubgraphList = lib.userSubgraphList.filter((x) => x.id !== u.id); lib.onUserSubgraphs.forEach((f) => f()); } },
          ]),
        );
        return el;
      });
      const hd = (t: string): HTMLElement => h('div', { style: { margin: '0.667rem 0 0.333rem', fontWeight: '600', color: 'var(--accent)' } }, t);
      content.replaceChildren(
        hd('This project'),
        ...(projectRows.length ? projectRows : [h('div', { class: 'k-dim' }, tt('assets.selectNodesAndPress'))]),
        hd('User library'),
        ...(userRows.length ? userRows : [h('div', { class: 'k-dim' }, tt('assets.rightClickAnInstance'))]),
        h('div', { style: { marginTop: '0.667rem' } }, btn('Import file…', () => void app.commands.execute('subgraph.import'))),
      );
    };

    const renderAssets = (): void => {
      const rows = assets.list().map((a) => {
        const el = h('div', { style: rowCss }, icon(a.kind === 'image' ? 'cat-import' : 'cat-geometry', 14), h('span', { style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis' } }, a.name), h('span', { class: 'k-dim' }, a.kind === 'image' ? `${a.width ?? '?'}×${a.height ?? '?'}` : `${a.triangles?.toLocaleString() ?? '?'} tris`), h('span', { class: 'k-dim' }, `${(a.size / 1048576).toFixed(2)} MB`));
        el.addEventListener('click', () => {
          const t = a.kind === 'image' ? 'import.texture' : 'import.model';
          app.project.editor.addNode(t, { ...placeNewNode({ x: 0, y: 0 }), name: a.name.replace(/\.[^.]+$/, ''), params: { asset: { assetId: a.id, name: a.name } } });
        });
        el.addEventListener('contextmenu', (e) => contextMenu(e, [{ label: tt('assets.createImportNode'), action: () => el.click() }, { separator: true }, { label: tt('assets.removeFromProject'), danger: true, action: async () => { await assets.remove(a.id); toast(tt('assets.assetRemovedNodesThat'), { type: 'info' }); } }]));
        return el;
      });
      content.replaceChildren(
        h('div', { class: 'k-dim', style: { marginBottom: '0.5rem' } }, `${rows.length} asset(s) · decoded cache ${(assets.cachedBytes / 1048576).toFixed(1)} MB (capped at ${(assets.cacheBytes / 1048576).toFixed(0)} MB)`),
        ...(rows.length ? rows : [h('div', { class: 'k-dim' }, tt('assets.dropPngJpgWebp'))]),
        h('div', { style: { marginTop: '0.667rem' } }, btn('Import file…', () => void app.commands.execute('file.import'))),
      );
    };

    const renderLibs = (): void => {
      content.replaceChildren(
        h('div', { class: 'k-dim', style: { marginBottom: '0.667rem', lineHeight: '1.5' } }, 'Share your presets, user subgraphs and the curve / gradient preset folders with your team as one .kvlib file.'),
        h('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } }, btn('Export library…', () => void app.commands.execute('preset.export')), btn('Import library…', () => void app.commands.execute('preset.import')), btn('Pick .kvlib…', async () => { const [f] = await pickFile('.kvlib,application/json'); if (f) await app.files.handleFiles([f]); })),
      );
    };

    const render = (): void => {
      tabs.replaceChildren(
        ...(['presets', 'subgraphs', 'assets', 'libs'] as const).map((t) => h('button', { class: `k-btn sm${tab === t ? ' on' : ''}`, onclick: () => ((tab = t), render()) }, { presets: 'Presets', subgraphs: 'Subgraphs', assets: 'Assets', libs: 'Libraries' }[t])),
      );
      ({ presets: renderPresets, subgraphs: renderSubgraphs, assets: renderAssets, libs: renderLibs })[tab]();
    };
    render();
    const offs = [lib.presets.onChange.on(() => tab === 'presets' && renderPresets()), app.engine.subgraphs.onChange.on(() => tab === 'subgraphs' && renderSubgraphs()), assets.onChange.on(() => tab === 'assets' && renderAssets())];
    lib.onUserSubgraphs.add(render);
    return {
      dispose: () => {
        offs.forEach((o) => o());
        lib.onUserSubgraphs.delete(render);
        root.remove();
      },
    };
  },
});
