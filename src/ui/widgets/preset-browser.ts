import { h } from '../core/dom';
import { download, pickFile } from '../core/dom';
import { contextMenu } from '../core/menu';
import { promptDialog, toast } from '../core/overlay';
import { icon } from '../icons';
import type { PresetItem, PresetLibrary } from './presets';

import { t } from '../../shared/i18n';
/**
 * Popup browser for a PresetLibrary (curves, gradients): folders with thumbnails, apply with a click, "Save current as…",
 * new / rename / delete folders and presets (user folders only), import / export JSON (shareable files).
 */
export interface PresetBrowserOptions<T> {
  title: string;
  current(): T;
  apply(v: T): void;
  /** Draw a thumbnail of the value into a canvas of w x h CSS pixels (already scaled by dpr). */
  preview(g: CanvasRenderingContext2D, w: number, h: number, value: T): void;
}

let open: { close(): void } | null = null;

export function openPresetBrowser<T>(anchor: HTMLElement, lib: PresetLibrary<T>, o: PresetBrowserOptions<T>): void {
  open?.close();
  const collapsed = new Set<string>();
  let filter = '';
  const list = h('div', { class: 'pb-list' });
  const search = h('input', { type: 'text', class: 'k-text', placeholder: t('presetBrowser.searchPresets') });
  const pop = h('div', { class: 'k-presetpop', role: 'dialog', 'aria-label': o.title });

  const thumb = (value: T): HTMLCanvasElement => {
    const dpr = window.devicePixelRatio || 1;
    const c = h('canvas', { class: 'pb-thumb' });
    c.width = Math.round(64 * dpr);
    c.height = Math.round(28 * dpr);
    const g = c.getContext('2d');
    if (g) {
      g.scale(dpr, dpr);
      o.preview(g, 64, 28, value);
    }
    return c;
  };
  const askFolder = async (): Promise<void> => {
    const n = await promptDialog(t('presetBrowser.newFolder'), t('presetBrowser.folderName'), 'My presets');
    if (n) lib.addFolder(n);
  };
  const rowMenu = (e: MouseEvent, it: PresetItem<T>, readonly: boolean): void => {
    e.preventDefault();
    contextMenu(e, [
      { label: 'Apply', action: () => (o.apply(it.value), close()) },
      { label: t('common.rename'), disabled: readonly, action: () => void promptDialog(t('common.renamePreset'), 'Name', it.name).then((n) => n && lib.renamePreset(it.id, n)) },
      {
        label: t('presetBrowser.moveTo'),
        disabled: readonly,
        submenu: () => lib.folders().filter((f) => !f.readonly).map((f) => ({ label: f.name, action: () => lib.movePreset(it.id, f.id) })),
      },
      { separator: true },
      { label: 'Delete', danger: true, disabled: readonly, action: () => lib.deletePreset(it.id) },
    ]);
  };
  const render = (): void => {
    const q = filter.trim().toLowerCase();
    list.replaceChildren();
    for (const f of lib.folders()) {
      const items = f.items.filter((i) => !q || i.name.toLowerCase().includes(q));
      if (q && items.length === 0) continue;
      const open_ = q ? true : !collapsed.has(f.id);
      const head = h(
        'div',
        {
          class: 'pb-folder',
          onclick: () => (collapsed.has(f.id) ? collapsed.delete(f.id) : collapsed.add(f.id), render()),
          oncontextmenu: (e: Event) => {
            e.preventDefault();
            contextMenu(e as MouseEvent, [
              { label: t('presetBrowser.renameFolder'), disabled: !!f.readonly, action: () => void promptDialog(t('presetBrowser.renameFolder2'), 'Name', f.name).then((n) => n && lib.renameFolder(f.id, n)) },
              { label: t('presetBrowser.exportFolder'), action: () => download(`${f.name.replace(/[^\w-]+/g, '_')}.kkpresets.json`, lib.exportJson(f.id), 'application/json') },
              { separator: true },
              { label: t('presetBrowser.deleteFolder'), danger: true, disabled: !!f.readonly, action: () => lib.deleteFolder(f.id) },
            ]);
          },
        },
        icon(open_ ? 'chevron-down' : 'chevron-right', 11),
        icon('folder', 12),
        h('span', { class: 'pb-fname' }, f.name),
        h('span', { class: 'k-dim' }, String(f.items.length)),
      );
      list.append(head);
      if (!open_) continue;
      for (const it of items) {
        const row = h('div', { class: 'pb-item', tabindex: 0, onclick: () => (o.apply(it.value), close()), oncontextmenu: (e: Event) => rowMenu(e as MouseEvent, it, !!f.readonly) }, thumb(it.value), h('span', { class: 'pb-name' }, it.name));
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            o.apply(it.value);
            close();
          }
        });
        list.append(row);
      }
    }
    if (!list.firstChild) list.append(h('div', { class: 'k-dim', style: { padding: '0.667rem' } }, 'No presets'));
  };
  const saveCurrent = async (): Promise<void> => {
    const name = await promptDialog(t('presetBrowser.savePreset', { kind: lib.kind }), 'Preset name', 'My preset');
    if (!name) return;
    const folders = lib.folders().filter((f) => !f.readonly);
    lib.addPreset(folders[0]?.id ?? null, name, o.current());
    toast(t('presetBrowser.saved', { name }), { type: 'ok', timeout: 1500 });
  };
  const btn = (label: string, tip: string, fn: () => void): HTMLElement => h('button', { class: 'k-mini', tip, onclick: fn }, label);
  pop.append(
    h('div', { class: 'pb-head' }, h('b', {}, o.title), h('span', { style: { flex: '1' } }), btn(t('presetBrowser.saveCurrent'), t('presetBrowser.storeTheCurrentValue'), () => void saveCurrent())),
    search,
    list,
    h(
      'div',
      { class: 'pb-foot' },
      btn(t('presetBrowser.newFolder'), t('presetBrowser.createAFolder'), () => void askFolder()),
      btn(t('presetBrowser.import'), t('presetBrowser.importAPresetJson'), () => {
        void pickFile('.json,application/json').then(async (files) => {
          if (!files[0]) return;
          try {
            toast(`Imported ${lib.importJson(await files[0].text())} presets`, { type: 'ok' });
          } catch (err) {
            toast((err as Error).message, { type: 'error' });
          }
        });
      }),
      btn(t('presetBrowser.exportAll'), t('presetBrowser.downloadAllYourFolders'), () => download(`${lib.kind}-presets.kkpresets.json`, lib.exportJson(), 'application/json')),
    ),
  );
  search.addEventListener('input', () => ((filter = search.value), render()));
  search.addEventListener('keydown', (e) => e.stopPropagation());
  render();
  const off = lib.onChange.on(render);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = 280;
  pop.style.width = `${w}px`;
  const ph = Math.min(380, window.innerHeight - 16);
  pop.style.maxHeight = `${ph}px`;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  const below = r.bottom + 4;
  pop.style.top = `${below + ph > window.innerHeight ? Math.max(8, r.top - ph - 4) : below}px`;
  const onDown = (e: PointerEvent): void => {
    if (!pop.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.k-menu, .k-modal-back, .k-modal')) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  function close(): void {
    off();
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    pop.remove();
    if (open === handle) open = null;
  }
  const handle = { close };
  open = handle;
  search.focus();
}
