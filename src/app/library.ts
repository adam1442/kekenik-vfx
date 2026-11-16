import { targetKey, type EvalTarget } from '../engine/graph/evaluator';
import type { Graph } from '../engine/graph/graph';
import { assets, kindOfFile, MODEL_EXTENSIONS } from '../engine/io/assets';
import { IMAGE_EXTENSIONS, detectGrid } from '../engine/io/decode';
import { projectToJson } from '../engine/io/project';
import { readTextureFloat32 } from '../engine/resources/readback';
import { FACTORY_PRESETS } from '../engine/presets/factory';
import vfxPresets from '../engine/presets/vfx-presets.generated.json';
import { PresetStore, presetFromNode, spawnPreset, type NodePreset, type PresetBackend } from '../engine/presets/presets';
import { defTypeId, isBoundary } from '../engine/subgraph/def';
import { buildMakeSubgraph, buildUnlinkInstance } from '../engine/subgraph/make';
import type { SubgraphBundle } from '../engine/subgraph/library';
import { consoleBus } from '../shared/log';
import { getActiveGraphView, placeNewNode } from '../panels/graph-editor/api';
import { graphExtensions, type SearchExtra } from '../panels/graph-editor/extensions';
import { graphNavigation } from '../panels/graph-editor/navigation';
import { download, h, pickFile } from '../ui/core/dom';
import { showMenu, type MenuItem } from '../ui/core/menu';
import { promptDialog, showModal, toast, confirmDialog } from '../ui/core/overlay';
import { assetUi } from '../ui/widgets/asset-hooks';
import { curvePresets, gradientPresets } from '../ui/widgets/presets';
import type { AppServices } from './app';
import { openInterfaceEditor, exposeParamFlow } from './subgraph-ui';

import { t as tt } from '../shared/i18n';
/* ================================================================================================ storage */
type Row = Record<string, unknown>;
const mem = new Map<string, Map<string, Row>>();
let dbp: Promise<IDBDatabase | null> | null = null;
const STORES = ['presets', 'recents', 'versions', 'thumbs', 'subgraphs'];
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open('kekenik-vfx-lib', 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}
/** Tiny key-value store on IndexedDB with an in-memory fallback (private mode / tests): never throws. */
export class Kv<T extends Row> {
  constructor(private store: string) {}
  private m(): Map<string, Row> {
    if (!mem.has(this.store)) mem.set(this.store, new Map());
    return mem.get(this.store)!;
  }
  private async run<R>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R>): Promise<R | undefined> {
    const d = await db();
    if (!d) return undefined;
    return new Promise((res) => {
      try {
        const r = fn(d.transaction(this.store, mode).objectStore(this.store));
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(undefined);
      } catch {
        res(undefined);
      }
    });
  }
  async all(): Promise<{ key: string; value: T }[]> {
    const d = await db();
    if (!d) return [...this.m()].map(([key, value]) => ({ key, value: value as T }));
    const keys = (await this.run('readonly', (s) => s.getAllKeys())) as string[] | undefined;
    const vals = (await this.run('readonly', (s) => s.getAll())) as T[] | undefined;
    return (keys ?? []).map((k, i) => ({ key: String(k), value: (vals ?? [])[i] }));
  }
  async get(key: string): Promise<T | undefined> {
    if (!(await db())) return this.m().get(key) as T | undefined;
    return (await this.run('readonly', (s) => s.get(key))) as T | undefined;
  }
  async put(key: string, value: T): Promise<void> {
    if (!(await db())) this.m().set(key, value);
    else await this.run('readwrite', (s) => s.put(value, key));
  }
  async del(key: string): Promise<void> {
    if (!(await db())) this.m().delete(key);
    else await this.run('readwrite', (s) => s.delete(key));
  }
}

class IdbPresetBackend implements PresetBackend {
  private kv = new Kv<NodePreset & Row>('presets');
  async all(): Promise<NodePreset[]> {
    return (await this.kv.all()).map((r) => r.value);
  }
  put(p: NodePreset): Promise<void> {
    return this.kv.put(p.id, p as NodePreset & Row);
  }
  delete(id: string): Promise<void> {
    return this.kv.del(id);
  }
}

export interface RecentEntry extends Row {
  name: string;
  modified: number;
  json: string;
  thumb?: string;
}
export interface VersionEntry extends Row {
  name: string;
  modified: number;
  json: string;
}
export interface UserSubgraph extends Row {
  id: string;
  name: string;
  modified: number;
  bundle: SubgraphBundle;
}

/* ================================================================================================ thumbnails */
/** Renders one texture output of a graph to a small PNG data URL (GPU read-back via mapAsync, never blocks the render path). */
export async function renderThumb(app: AppServices, graph: Graph, target: EvalTarget, size = 96, time = 0): Promise<string | null> {
  try {
    const e = app.engine;
    const scale = Math.min(1, size / Math.max(graph.settings.width, graph.settings.height));
    return await e.scheduler.runExclusiveForce(async () => {
      const res = await e.evaluator.evaluate(graph, [target], { scale, time, useCache: true });
      try {
        const v = res.values.get(targetKey(target));
        if (!v || v.kind !== 'texture') return null;
        const px = await readTextureFloat32(e.gpu, e.mm, v.tex.texture, v.tex.format, v.width, v.height);
        const ch = v.pin === 'gray' ? 1 : v.pin === 'uv' ? 2 : 4;
        const cv = document.createElement('canvas');
        cv.width = v.width;
        cv.height = v.height;
        const g2 = cv.getContext('2d');
        if (!g2) return null;
        const img = g2.createImageData(v.width, v.height);
        const enc = (x: number): number => {
          const c = Math.max(0, Math.min(1, x));
          return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
        };
        for (let i = 0; i < v.width * v.height; i++) {
          const o = i * 4;
          if (ch === 1) img.data[o] = img.data[o + 1] = img.data[o + 2] = enc(px[i]);
          else if (ch === 2) {
            img.data[o] = enc(px[i * 2]);
            img.data[o + 1] = enc(px[i * 2 + 1]);
            img.data[o + 2] = 0;
          } else {
            const a = px[i * 4 + 3];
            img.data[o] = enc(px[i * 4] * Math.min(1, Math.max(0, a)));
            img.data[o + 1] = enc(px[i * 4 + 1] * Math.min(1, Math.max(0, a)));
            img.data[o + 2] = enc(px[i * 4 + 2] * Math.min(1, Math.max(0, a)));
          }
          img.data[o + 3] = 255;
        }
        g2.putImageData(img, 0, 0);
        return cv.toDataURL('image/png');
      } finally {
        res.release();
      }
    });
  } catch (err) {
    consoleBus.warn(`Thumbnail failed: ${(err as Error).message}`, { source: 'app' });
    return null;
  }
}

/* ================================================================================================ services */
export interface LibraryServices {
  readonly app: AppServices;
  readonly presets: PresetStore;
  readonly recents: Kv<RecentEntry>;
  readonly versions: Kv<VersionEntry>;
  readonly thumbs: Kv<{ url: string }>;
  readonly userSubgraphs: Kv<UserSubgraph>;
  userSubgraphList: UserSubgraph[];
  onUserSubgraphs: Set<() => void>;
  spawnPreset(p: NodePreset, pos?: { x: number; y: number }): void;
  spawnUserSubgraph(u: UserSubgraph, pos?: { x: number; y: number }): void;
  saveSubgraphToLibrary(defId: string): Promise<void>;
  importAssetFiles(files: File[], pos?: { x: number; y: number }): Promise<void>;
  openHome(): void;
}
let services: LibraryServices | null = null;
export const getLibrary = (): LibraryServices | null => services;

/** localStorage flag of the Home screen's "show on startup" checkbox ('0' = off). Lives here so the startup check does not pull the Home screen + samples into the main chunk. */
export const HOME_STARTUP_KEY = 'kk-home-start';

/** Opens the Home screen after startup (unless disabled or another modal — e.g. crash recovery — is already showing). The screen itself is lazy-loaded. */
export function maybeShowHomeOnStart(app: AppServices, lib: LibraryServices): void {
  if (localStorage.getItem(HOME_STARTUP_KEY) === '0') return;
  setTimeout(() => {
    if (document.querySelector('.k-modal-back') || app.project.isDirty) return;
    lib.openHome();
  }, 700);
}

const cached = new Map<string, string>();
export async function cachedThumb(lib: LibraryServices, key: string, make: () => Promise<string | null>): Promise<string | null> {
  if (cached.has(key)) return cached.get(key)!;
  const hit = await lib.thumbs.get(key);
  if (hit?.url) {
    cached.set(key, hit.url);
    return hit.url;
  }
  const url = await make();
  if (url) {
    cached.set(key, url);
    void lib.thumbs.put(key, { url });
  }
  return url;
}

/** Drops cached thumbnails whose key starts with `prefix` (memory + IndexedDB): the Home screen's "Regenerate thumbnails". */
export async function clearCachedThumbs(lib: LibraryServices, prefix: string): Promise<void> {
  for (const k of [...cached.keys()]) if (k.startsWith(prefix)) cached.delete(k);
  for (const row of await lib.thumbs.all()) if (row.key.startsWith(prefix)) await lib.thumbs.del(row.key);
}

export function registerLibrary(app: AppServices): LibraryServices {
  const { project, engine, commands: C, selection } = app;
  const lib = engine.subgraphs;
  const presets = new PresetStore(new IdbPresetBackend(), [...FACTORY_PRESETS, ...(vfxPresets as unknown as typeof FACTORY_PRESETS)]);
  void presets.init();
  const svc: LibraryServices = {
    app,
    presets,
    recents: new Kv<RecentEntry>('recents'),
    versions: new Kv<VersionEntry>('versions'),
    thumbs: new Kv<{ url: string }>('thumbs'),
    userSubgraphs: new Kv<UserSubgraph>('subgraphs'),
    userSubgraphList: [],
    onUserSubgraphs: new Set(),
    spawnPreset: (p, pos) => {
      try {
        const id = spawnPreset(project.editor, lib, p, pos ?? placeNewNode({ x: 0, y: 0 }));
        selection.set([id]);
      } catch (e) {
        toast((e as Error).message, { type: 'error', title: tt('library.cannotAddPreset') });
      }
    },
    spawnUserSubgraph: (u, pos) => {
      try {
        const { root } = lib.importBundle(JSON.parse(JSON.stringify(u.bundle)));
        const p = pos ?? placeNewNode({ x: 0, y: 0 });
        const id = project.editor.addNode(defTypeId(root), { x: p.x, y: p.y, name: lib.get(root)?.name });
        selection.set([id]);
      } catch (e) {
        toast((e as Error).message, { type: 'error', title: tt('library.cannotAddSubgraph') });
      }
    },
    saveSubgraphToLibrary: async (defId) => {
      const d = lib.get(defId);
      if (!d) return;
      await svc.userSubgraphs.put(defId, { id: defId, name: d.name, modified: Date.now(), bundle: lib.exportBundle(defId) });
      await refreshUserSubgraphs();
      toast(tt('library.savedTo', { name: d.name }), { type: 'ok' });
    },
    importAssetFiles,
    openHome: () => void import('./home').then((m) => m.openHome(app, svc)),
  };
  services = svc;

  async function refreshUserSubgraphs(): Promise<void> {
    svc.userSubgraphList = (await svc.userSubgraphs.all()).map((r) => r.value).sort((a, b) => a.name.localeCompare(b.name));
    svc.onUserSubgraphs.forEach((f) => f());
  }
  void refreshUserSubgraphs();

  /* ----------------------------------------------------------------------------- navigation (subgraphs) */
  graphNavigation.enterHandler = (id) => project.enterSubgraph(id);
  graphNavigation.exitHandler = (d) => project.exitToDepth(d);
  graphNavigation.canEnterHook = (g, id) => {
    const n = g.nodes.get(id);
    return !!n && !!lib.isInstance(n.type);
  };

  /* ----------------------------------------------------------------------------- import (files) */
  async function importAssetFiles(files: File[], pos?: { x: number; y: number }): Promise<void> {
    const drop = graphExtensions.lastDrop;
    let at = pos ?? (drop && performance.now() - drop.t < 1500 ? drop.world : placeNewNode({ x: 0, y: 0 }));
    for (const f of files) {
      try {
        const rec = await assets.add(f, f.name);
        const type = rec.kind === 'image' ? 'import.texture' : 'import.model';
        const id = project.editor.addNode(type, { x: at.x, y: at.y, name: rec.name.replace(/\.[^.]+$/, ''), params: { asset: { assetId: rec.id, name: rec.name } } });
        selection.set([id]);
        at = { x: at.x + 30, y: at.y + 40 };
        const note = rec.kind === 'image' ? `${rec.width}×${rec.height}` : `${rec.triangles?.toLocaleString()} triangles`;
        toast(tt('library.imported', { name: rec.name, note }), { type: 'ok' });
      } catch (e) {
        consoleBus.error(`Import of ${f.name} failed: ${(e as Error).message}`, { source: 'io' });
        toast((e as Error).message, { type: 'error', title: tt('library.cannotImport', { name: f.name }) });
      }
    }
  }
  app.files.register({ id: 'assets', extensions: [...IMAGE_EXTENSIONS, ...MODEL_EXTENSIONS], handle: async (files) => (await importAssetFiles(files), true) });
  app.files.register({
    id: 'subgraph-file',
    extensions: ['kvsg'],
    handle: async (files) => {
      for (const f of files) importSubgraphText(await f.text());
      return true;
    },
  });
  app.files.register({
    id: 'library-bundle',
    extensions: ['kvlib'],
    handle: async (files) => {
      for (const f of files) await importLibraryText(await f.text());
      return true;
    },
  });
  assetUi.hooks = {
    pick(kind, anchor) {
      const r = anchor.getBoundingClientRect();
      const existing = assets.list(kind === 'any' ? undefined : kind);
      const items: MenuItem[] = [
        {
          label: tt('library.importFile'),
          icon: 'open',
          action: async () => {
            const exts = kind === 'model' ? MODEL_EXTENSIONS : kind === 'image' ? IMAGE_EXTENSIONS : [...IMAGE_EXTENSIONS, ...MODEL_EXTENSIONS];
            const [f] = await pickFile(exts.map((e) => `.${e}`).join(','));
            if (!f) return;
            try {
              const rec = await assets.add(f, f.name);
              assetUi.onPicked?.({ assetId: rec.id, name: rec.name });
            } catch (e) {
              toast((e as Error).message, { type: 'error', title: tt('library.cannotImport', { name: f.name }) });
            }
          },
        },
        ...(existing.length ? [{ separator: true } as MenuItem] : []),
        ...existing.map((a) => ({ label: a.name, icon: a.kind === 'image' ? 'cat-import' : 'cat-geometry', action: () => assetUi.onPicked?.({ assetId: a.id, name: a.name }) })),
      ];
      showMenu(items, r.left, r.bottom + 2);
    },
  };

  /* ----------------------------------------------------------------------------- subgraph import / export */
  function importSubgraphText(text: string, at?: { x: number; y: number }): void {
    try {
      const { root } = lib.importBundle(JSON.parse(text));
      const p = at ?? placeNewNode({ x: 0, y: 0 });
      const id = project.editor.addNode(defTypeId(root), { x: p.x, y: p.y, name: lib.get(root)?.name });
      selection.set([id]);
      toast(`Imported subgraph “${lib.get(root)?.name}”.`, { type: 'ok' });
    } catch (e) {
      toast((e as Error).message, { type: 'error', title: tt('library.cannotImportSubgraph') });
    }
  }
  async function importLibraryText(text: string): Promise<void> {
    try {
      const { presets: n, bundle } = await presets.importBundle(text, { overwrite: true });
      for (const d of bundle.subgraphs) await svc.userSubgraphs.put(d.id, { id: d.id, name: d.name, modified: Date.now(), bundle: { format: 'kekenik-subgraph', version: 1, root: d.id, defs: bundle.subgraphs } });
      let extra = 0;
      if (bundle.curves) extra += curvePresets().importJson(JSON.stringify(bundle.curves));
      if (bundle.gradients) extra += gradientPresets().importJson(JSON.stringify(bundle.gradients));
      await refreshUserSubgraphs();
      toast(tt('library.importedPresetSSubgraphSCurv', { n, length: bundle.subgraphs.length, extra }), { type: 'ok' });
    } catch (e) {
      toast((e as Error).message, { type: 'error', title: tt('library.cannotImportLibrary') });
    }
  }
  const exportSubgraph = (defId: string): void => {
    const d = lib.get(defId);
    if (d) download(`${d.name.replace(/[^\w-]+/g, '_')}.kvsg`, JSON.stringify(lib.exportBundle(defId)), 'application/json');
  };
  const exportLibrary = (): void => {
    const b = presets.exportBundle(lib, { curves: JSON.parse(curvePresets().exportJson()), gradients: JSON.parse(gradientPresets().exportJson()) });
    b.subgraphs = svc.userSubgraphList.flatMap((u) => u.bundle.defs);
    download('kekenik-library.kvlib', JSON.stringify(b), 'application/json');
  };

  /* ----------------------------------------------------------------------------- presets */
  async function savePresetFlow(nodeId: string): Promise<void> {
    const n = project.graph.nodes.get(nodeId);
    if (!n) return;
    const name = h('input', { type: 'text', value: n.name, style: { width: '100%' } });
    const folder = h('input', { type: 'text', value: 'My Presets', list: 'kk-preset-folders', style: { width: '100%' } });
    const tags = h('input', { type: 'text', placeholder: 'fire, mask, tiling', style: { width: '100%' } });
    const dl = h('datalist', { id: 'kk-preset-folders' }, ...presets.folders().map((f) => h('option', { value: f })));
    const row = (l: string, el: HTMLElement): HTMLElement => h('label', { style: { display: 'block', margin: '0.5rem 0' } }, h('div', { class: 'k-dim' }, l), el);
    const ok = await showModal<boolean>({ title: tt('library.saveNodeAsPreset'), body: h('div', {}, row('Name', name), row('Folder', folder), row('Tags (comma separated)', tags), dl), buttons: [{ label: 'Cancel', value: false }, { label: tt('library.savePreset'), value: true, primary: true }], onMount: () => name.focus() });
    if (!ok || !name.value.trim()) return;
    const ex = project.graph.registry.expanded(n.type);
    const pin = ex?.outputs.find((o) => o.type === 'gray' || o.type === 'color' || o.type === 'normal' || o.type === 'uv');
    const thumbnail = pin ? ((await renderThumb(app, project.graph, { nodeId, pinId: pin.id }, 96)) ?? undefined) : undefined;
    const p = await presets.add(presetFromNode(project.graph, nodeId, lib, { name: name.value.trim(), folder: folder.value.trim() || 'My Presets', tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean), thumbnail }));
    toast(tt('library.presetSaved', { name: p.name, folder: p.folder }), { type: 'ok' });
  }

  /* ----------------------------------------------------------------------------- commands */
  const graphActive = (): boolean => !!getActiveGraphView()?.isActive();
  const reg = C.register.bind(C);
  reg({
    id: 'subgraph.make',
    title: tt('library.makeSubgraphFromSelection'),
    category: 'Subgraph',
    icon: 'cat-subgraph',
    keys: ['Mod+G'],
    enabled: () => graphActive() && selection.get().length > 0,
    run: async () => {
      const ids = [...selection.get()].filter((i) => !isBoundary(project.graph.nodes.get(i)?.type ?? ''));
      const name = await promptDialog(tt('library.makeSubgraph'), tt('library.nameOfTheSubgraph'), 'Subgraph');
      if (!name) return;
      const r = buildMakeSubgraph(project.graph, lib, ids, name);
      if (typeof r === 'string') return void toast(r, { type: 'warn', title: tt('library.cannotMakeSubgraph') });
      project.editor.stack.execute(r.command);
      selection.set([r.instanceId]);
      toast(tt('library.subgraphCreatedDoubleClickIt'), { type: 'ok' });
    },
  });
  reg({ id: 'subgraph.enter', title: tt('library.enterSubgraph'), category: 'Subgraph', icon: 'cat-subgraph', keys: ['Alt+ArrowDown'], enabled: () => selection.get().length === 1 && !!lib.isInstance(project.graph.nodes.get(selection.get()[0])?.type ?? ''), run: () => void graphNavigation.enter(project.graph, selection.get()[0]) });
  reg({ id: 'subgraph.interface', title: tt('library.editSubgraphInterfacePins'), category: 'Subgraph', icon: 'cat-subgraph', enabled: () => !!project.activeDefId, run: () => openInterfaceEditor(app) });
  reg({ id: 'subgraph.expose', title: tt('library.exposeParameterToSubgraph'), category: 'Subgraph', hidden: true, enabled: () => !!project.activeDefId, run: (arg) => void exposeParamFlow(app, arg as { node: string; param: string }) });
  reg({
    id: 'subgraph.unlink',
    title: tt('library.unlinkSubgraphToUnique'),
    category: 'Subgraph',
    enabled: () => selection.get().length === 1 && !!lib.isInstance(project.graph.nodes.get(selection.get()[0])?.type ?? ''),
    run: () => {
      const r = buildUnlinkInstance(project.graph, lib, selection.get()[0]);
      if (typeof r === 'string') return void toast(r, { type: 'warn' });
      project.editor.stack.execute(r.command);
      toast(tt('library.thisInstanceNowHas'), { type: 'ok' });
    },
  });
  reg({ id: 'subgraph.save', title: tt('library.saveSubgraphToUser'), category: 'Subgraph', enabled: () => selection.get().length === 1 && !!lib.isInstance(project.graph.nodes.get(selection.get()[0])?.type ?? ''), run: () => void svc.saveSubgraphToLibrary(lib.isInstance(project.graph.nodes.get(selection.get()[0])!.type)!) });
  reg({ id: 'subgraph.export', title: tt('library.exportSubgraphFileKvsg'), category: 'Subgraph', enabled: () => selection.get().length === 1 && !!lib.isInstance(project.graph.nodes.get(selection.get()[0])?.type ?? ''), run: () => exportSubgraph(lib.isInstance(project.graph.nodes.get(selection.get()[0])!.type)!) });
  reg({ id: 'subgraph.import', title: tt('library.importSubgraphFileKvsg'), category: 'Subgraph', run: async () => void (await pickFile('.kvsg,application/json').then(async ([f]) => f && importSubgraphText(await f.text()))) });
  reg({ id: 'preset.save', title: tt('library.saveSelectedNodeAs'), category: 'Presets', icon: 'star', enabled: () => selection.get().length === 1, run: () => void savePresetFlow(selection.get()[0]) });
  reg({ id: 'preset.export', title: tt('library.exportPresetLibraryKvlib'), category: 'Presets', run: exportLibrary });
  reg({ id: 'preset.import', title: tt('library.importPresetLibraryKvlib'), category: 'Presets', run: async () => void (await pickFile('.kvlib,application/json').then(async ([f]) => f && importLibraryText(await f.text()))) });
  reg({ id: 'home.open', title: tt('library.homeStartScreen'), category: 'File', icon: 'panel-graph', keys: ['Mod+Shift+H'], run: () => svc.openHome() });
  reg({
    id: 'import.detectGrid',
    title: tt('library.detectFlipbookGridOf'),
    category: 'Import',
    enabled: () => selection.get().length === 1 && project.graph.nodes.get(selection.get()[0])?.type === 'import.texture',
    run: () => {
      const n = project.graph.nodes.get(selection.get()[0])!;
      const ref = n.params.asset as { assetId: string } | null;
      const img = ref && assets.image(ref.assetId, parseInt(String(n.params.max_size), 10) || 0);
      if (!img) return void toast(tt('library.theImageIsStill'), { type: 'info' });
      const g = detectGrid(img);
      if (g.cols * g.rows < 2) return void toast(tt('library.noFlipbookGridDetected'), { type: 'info' });
      const ed = project.editor;
      ed.stack.transaction('Detect flipbook grid', () => {
        ed.setParam(n.id, 'grid_mode', 'manual');
        ed.setParam(n.id, 'cols', g.cols);
        ed.setParam(n.id, 'rows', g.rows);
        ed.setParam(n.id, 'frames', g.frames);
      });
      toast(`Detected a ${g.cols} × ${g.rows} grid (confidence ${(g.confidence * 100).toFixed(0)}%).`, { type: 'ok' });
    },
  });

  /* ----------------------------------------------------------------------------- graph editor hooks */
  const isInstance = (g: Graph, id: string): boolean => !!lib.isInstance(g.nodes.get(id)?.type ?? '');
  graphExtensions.nodeMenu = (g, ids) => {
    const items: MenuItem[] = [];
    const run = (id: string): MenuItem['action'] => () => void C.execute(id);
    items.push({ label: tt('library.makeSubgraph'), icon: 'cat-subgraph', shortcut: 'Ctrl+G', action: run('subgraph.make') });
    if (ids.length === 1 && isInstance(g, ids[0])) {
      items.push({ label: tt('library.enterSubgraph2'), icon: 'cat-subgraph', shortcut: 'Alt+↓', action: run('subgraph.enter') }, { label: tt('library.unlinkToUnique'), action: run('subgraph.unlink') }, { label: tt('library.saveSubgraphToLibrary'), action: run('subgraph.save') }, { label: tt('library.exportSubgraphFile'), action: run('subgraph.export') });
    }
    if (ids.length === 1) {
      items.push({ label: tt('library.saveAsPreset'), icon: 'star', action: run('preset.save') });
      if (g.nodes.get(ids[0])?.type === 'import.texture') items.push({ label: tt('library.detectFlipbookGrid'), action: run('import.detectGrid') });
    }
    if (project.activeDefId && ids.length === 1) items.push({ label: tt('library.editSubgraphInterface'), action: run('subgraph.interface') });
    items.push({ separator: true });
    return items;
  };
  graphExtensions.backgroundMenu = (world) => {
    const fav = presets.search('', { favoritesOnly: true, limit: 12 });
    const byFolder = new Map<string, NodePreset[]>();
    for (const p of presets.all()) {
      if (!byFolder.has(p.folder)) byFolder.set(p.folder, []);
      byFolder.get(p.folder)!.push(p);
    }
    const pi = (p: NodePreset): MenuItem => ({ label: p.name, icon: p.favorite ? 'star' : undefined, action: () => svc.spawnPreset(p, world) });
    const items: MenuItem[] = [
      {
        label: 'Presets',
        icon: 'star',
        submenu: () => [
          ...(fav.length ? [{ label: 'Favorites', disabled: true } as MenuItem, ...fav.map(pi), { separator: true } as MenuItem] : []),
          ...[...byFolder].map(([f, ps]) => ({ label: f, submenu: ps.slice(0, 60).map(pi) }) as MenuItem),
        ],
      },
      {
        label: 'Subgraphs',
        icon: 'cat-subgraph',
        submenu: () => [
          { label: tt('library.thisProject'), disabled: true },
          ...(lib.list().length ? lib.list().map((d) => ({ label: d.name, icon: 'cat-subgraph', action: () => void project.editor.addNode(defTypeId(d.id), { x: world.x, y: world.y, name: d.name }) }) as MenuItem) : [{ label: tt('library.noneYet'), disabled: true } as MenuItem]),
          { separator: true },
          { label: tt('library.userLibrary'), disabled: true },
          ...(svc.userSubgraphList.length ? svc.userSubgraphList.map((u) => ({ label: u.name, action: () => svc.spawnUserSubgraph(u, world) }) as MenuItem) : [{ label: '(empty)', disabled: true } as MenuItem]),
          { separator: true },
          { label: tt('library.importSubgraphFile'), action: run0('subgraph.import') },
        ],
      },
      { label: tt('library.importFile'), icon: 'open', shortcut: 'Ctrl+I', action: run0('file.import') },
      { separator: true },
    ];
    return items;
  };
  function run0(id: string): () => void {
    return () => void C.execute(id);
  }
  graphExtensions.searchExtras = (q) => {
    const out: SearchExtra[] = [];
    const ql = q.trim().toLowerCase();
    const found = presets.search(q, { limit: q ? 10 : 6, favoritesOnly: !q });
    for (const p of found) out.push({ title: p.name, subtitle: `Preset · ${p.folder}`, icon: p.favorite ? 'star' : 'cat-utils', color: '#e5c07b', thumb: p.thumbnail, pick: (w) => svc.spawnPreset(p, w) });
    if (ql) for (const u of svc.userSubgraphList) if (u.name.toLowerCase().includes(ql)) out.push({ title: u.name, subtitle: 'Library subgraph', icon: 'cat-subgraph', color: '#7fd1c8', pick: (w) => svc.spawnUserSubgraph(u, w) });
    return out;
  };

  /* ----------------------------------------------------------------------------- versions + recents */
  let lastVersion = '';
  const saveVersion = (): void => {
    if (!project.isDirty) return;
    const json = projectToJson(project.snapshot());
    if (json === lastVersion) return;
    lastVersion = json;
    const key = String(Date.now());
    void svc.versions.put(key, { name: project.name, modified: Date.now(), json }).then(async () => {
      const all = (await svc.versions.all()).sort((a, b) => b.value.modified - a.value.modified);
      for (const old of all.slice(12)) await svc.versions.del(old.key);
    });
  };
  setInterval(saveVersion, 60_000);
  window.addEventListener('pagehide', saveVersion);
  let recentTimer: ReturnType<typeof setTimeout> | null = null;
  project.onSaved.on(() => {
    if (recentTimer) clearTimeout(recentTimer);
    recentTimer = setTimeout(async () => {
      if (project.scopeDepth > 0) return;
      const json = projectToJson(project.snapshot());
      if (json.length > 40_000_000) return;
      let thumb: string | undefined;
      const g = project.rootGraph;
      const exp = [...g.nodes.values()].find((n) => n.type === 'export.color' || n.type === 'export.mask');
      const l = exp && g.linksTo(exp.id)[0];
      if (l) thumb = (await renderThumb(app, g, { nodeId: l.from.node, pinId: l.from.pin }, 160)) ?? undefined;
      await svc.recents.put(project.name, { name: project.name, modified: Date.now(), json, thumb });
      const all = (await svc.recents.all()).sort((a, b) => b.value.modified - a.value.modified);
      for (const old of all.slice(12)) await svc.recents.del(old.key);
    }, 1500);
  });

  // keep selected instance types honest when a definition is removed
  void confirmDialog;
  void kindOfFile;
  return svc;
}
