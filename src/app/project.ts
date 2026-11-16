import { GraphEditor } from '../engine/commands/graph-commands';
import type { Engine } from '../engine/engine';
import { IndexedDbAutosave, Autosaver } from '../engine/io/autosave';
import { projectToJson, serializeProject, type ProjectFile } from '../engine/io/project';
import { loadProjectRobust } from '../engine/io/robust-load';
import { loadAutosaveSafe } from '../engine/io/autosave';
import { wrapIntegrity } from '../engine/io/integrity';
import { t } from '../shared/i18n';
import type { Graph } from '../engine/graph/graph';
import { Emitter } from '../shared/emitter';
import { assets, type AssetRecord } from '../engine/io/assets';
import { defTypeId } from '../engine/subgraph/def';
import { graphNavigation } from '../panels/graph-editor/navigation';
import { Graph as GraphCls } from '../engine/graph/graph';
import { consoleBus } from '../shared/log';
import { download, pickFile } from '../ui/core/dom';
import { toast, unsavedDialog, showModal } from '../ui/core/overlay';
import type { SelectionService } from './services';

type FsHandle = { name: string; getFile(): Promise<File>; createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }> };
type FsWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<FsHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<FsHandle[]>;
};
const PICKER_TYPES = [{ description: t('project.kekenikVfxProject'), accept: { 'application/json': ['.kvfx', '.json'] } }];

/**
 * Project lifecycle: new / open / save (File System Access API, download fallback), autosave to IndexedDB,
 * crash recovery, unsaved-changes guard. `graph`/`editor` are REPLACED on new/open: listen to `onChange`.
 */
interface Scope {
  defId: string;
  instanceId: string;
  graph: Graph;
  editor: GraphEditor;
  unsub: () => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Asset ids referenced by node params anywhere in a graph (and in subgraph definitions). */
export function referencedAssetIds(datas: { nodes: { params: Record<string, unknown> }[] }[]): Set<string> {
  const out = new Set<string>();
  for (const d of datas) for (const n of d.nodes) for (const v of Object.values(n.params)) {
    const id = (v as { assetId?: unknown } | null)?.assetId;
    if (typeof id === 'string') out.add(id);
  }
  return out;
}

export class ProjectService {
  /** The graph currently EDITED (the root graph, or the inner graph of an entered subgraph). */
  graph!: Graph;
  editor!: GraphEditor;
  /** the project's root graph / editor (differ from `graph` / `editor` while a subgraph is open). */
  rootGraph!: Graph;
  rootEditor!: GraphEditor;
  private scopes: Scope[] = [];
  private subgraphDirty = false;
  /** Fires after a successful save and after open (recent-projects list). */
  readonly onSaved = new Emitter<void>();
  name = 'Untitled';
  created = new Date().toISOString();
  private handle: FsHandle | null = null;
  private autosaver!: Autosaver;
  private backend = new IndexedDbAutosave();
  private unsubs: Array<() => void> = [];
  /** The project object was replaced (new/open). */
  readonly onChange = new Emitter<void>();
  /** Dirty flag / name changed (title bar). */
  readonly onDirty = new Emitter<void>();
  /** UI state stored in the project file (workspace layout...). Set by the shell. */
  hooks: { collectUi?: () => Record<string, unknown>; applyUi?: (ui: Record<string, unknown> | undefined) => void } = {};
  autosaveEnabled = true;
  /** Write the autosave right now (GPU trouble: keep the project safe). Never throws. */
  async flushAutosave(): Promise<void> {
    try {
      await this.autosaver.flush();
    } catch {
      /* best effort */
    }
  }
  /** debounce of the autosave writer (Settings > autosave interval). Applies to the current and every future autosaver. */
  autosaveDelayMs = 2000;
  setAutosaveDelay(ms: number): void {
    this.autosaveDelayMs = Math.max(500, ms);
    this.autosaver?.setDelay(this.autosaveDelayMs);
  }

  constructor(
    private engine: Engine,
    private selection: SelectionService,
  ) {
    this.install(this.engine.newGraph({ width: 1024, height: 1024 }), 'Untitled');
    window.addEventListener('beforeunload', (e) => {
      if (this.isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('pagehide', () => {
      try {
        localStorage.setItem('kk-clean', '1');
      } catch {
        /* ignore */
      }
      if (this.isDirty) void this.autosaver.flush();
    });
    window.addEventListener('keydown', () => {}, { passive: true });
  }

  /** Remove the crash-recovery slot (never throws: IndexedDB may be unavailable). */
  clearAutosave(): void {
    void this.backend.remove('autosave').catch(() => undefined);
    void this.backend.remove('autosave.prev').catch(() => undefined);
  }

  get isDirty(): boolean {
    return this.rootEditor.stack.isDirty || this.subgraphDirty || this.scopes.some((s) => s.editor.stack.isDirty);
  }
  get scopeDepth(): number {
    return this.scopes.length;
  }
  /** Definition id of the subgraph being edited (null at root). */
  get activeDefId(): string | null {
    return this.scopes.length ? this.scopes[this.scopes.length - 1].defId : null;
  }
  private markClean(): void {
    this.rootEditor.stack.markSaved();
    for (const s of this.scopes) s.editor.stack.markSaved();
    this.subgraphDirty = false;
    this.onSaved.emit();
  }
  get title(): string {
    return `${this.name}${this.isDirty ? ' (Edited)' : ''}`;
  }

  private install(graph: Graph, name: string, created?: string): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    for (const s of this.scopes) {
      if (s.timer) clearTimeout(s.timer);
      s.unsub();
    }
    this.scopes = [];
    this.subgraphDirty = false;
    this.graph = this.rootGraph = graph;
    this.editor = this.rootEditor = new GraphEditor(graph);
    graphNavigation.reset();
    this.name = name;
    this.created = created ?? new Date().toISOString();
    this.autosaver?.dispose();
    this.autosaver = new Autosaver(this.backend, () => wrapIntegrity(projectToJson(this.snapshot())), 'autosave', this.autosaveDelayMs);
    this.unsubs.push(
      graph.events.on(() => {
        {
          if (this.autosaveEnabled) this.autosaver.notifyChanged();
        }
      }),
      this.editor.stack.onChange.on(() => this.onDirty.emit()),
    );
    this.selection.bind(graph);
    this.engine.scheduler.attach(graph);
    this.onChange.emit();
    this.onDirty.emit();
  }

  snapshot(): ProjectFile {
    this.flushScopes();
    const lib = this.engine.subgraphs.toData();
    const ids = referencedAssetIds([this.rootGraph.toData(), ...lib.map((d) => d.graph)]);
    return serializeProject(this.rootGraph, { name: this.name, created: this.created, ui: this.hooks.collectUi?.(), subgraphs: lib, assets: assets.metas(ids) });
  }

  /** Snapshot with the asset files embedded (self-contained project bundle). Used by Save / Save As. */
  async snapshotFull(): Promise<ProjectFile> {
    const p = this.snapshot();
    p.assetBlobs = await assets.exportBlobs(p.assets.map((a) => a.id));
    return p;
  }

  /* ------------------------------------------------------------------------------- subgraph scopes */
  /** Enter the shared definition of an instance node: the editor / graph are swapped for the inner graph. */
  enterSubgraph(nodeId: string): boolean {
    const lib = this.engine.subgraphs;
    const n = this.graph.nodes.get(nodeId);
    const defId = n ? lib.isInstance(n.type) : null;
    const def = defId ? lib.get(defId) : undefined;
    if (!n || !defId || !def) return false;
    const { graph, warnings } = GraphCls.fromData(this.engine.registry, def.graph);
    for (const w of warnings) consoleBus.warn(`Subgraph "${def.name}": ${w}`, { source: 'io' });
    graph.settings = { ...this.rootGraph.settings };
    const editor = new GraphEditor(graph);
    const scope: Scope = { defId, instanceId: nodeId, graph, editor, unsub: () => {}, timer: null };
    scope.unsub = graph.events.on(() => this.scheduleWriteBack(scope));
    const un2 = editor.stack.onChange.on(() => this.onDirty.emit());
    const un1 = scope.unsub;
    scope.unsub = () => {
      un1();
      un2();
    };
    this.scopes.push(scope);
    this.activate(graph, editor);
    return true;
  }
  exitToDepth(depth: number): boolean {
    while (this.scopes.length > Math.max(0, depth)) {
      const s = this.scopes.pop()!;
      if (s.timer) clearTimeout(s.timer);
      this.writeBack(s);
      s.unsub();
    }
    const top = this.scopes[this.scopes.length - 1];
    this.activate(top ? top.graph : this.rootGraph, top ? top.editor : this.rootEditor);
    return true;
  }
  private activate(g: Graph, e: GraphEditor): void {
    this.graph = g;
    this.editor = e;
    this.selection.bind(g);
    this.engine.scheduler.attach(g);
    this.onChange.emit();
    this.onDirty.emit();
  }
  private scheduleWriteBack(s: Scope): void {
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      s.timer = null;
      this.writeBack(s);
    }, 120);
  }
  /** Writes the inner graph back into the SHARED definition; every instance (in every open graph level) re-evaluates. */
  private writeBack(s: Scope): void {
    const lib = this.engine.subgraphs;
    if (!lib.has(s.defId)) return;
    // cycle protection: an instance of an enclosing definition inside its own definition is removed
    const bad = [...s.graph.nodes.values()].filter((n) => {
      const id = lib.isInstance(n.type);
      return !!id && lib.wouldRecurse(s.defId, id);
    });
    if (bad.length) {
      s.editor.removeNodes(bad.map((n) => n.id));
      toast(t('project.aSubgraphCannotContain'), { type: 'warn' });
      return;
    }
    lib.update(s.defId, { graph: s.graph.toData() });
    this.subgraphDirty = true;
    const type = defTypeId(s.defId);
    for (const g of [this.rootGraph, ...this.scopes.map((x) => x.graph)]) {
      const ids = [...g.nodes.values()].filter((n) => n.type === type).map((n) => n.id);
      if (ids.length && g !== s.graph) {
        // links to pins that no longer exist (renamed / removed Input or Output nodes) are dropped so no graph keeps a dangling link
        for (const l of [...g.links.values()]) {
          if ((ids.includes(l.to.node) || ids.includes(l.from.node)) && g.checkConnection(l.from, l.to)) g.disconnect(l.id);
        }
        g.touch(ids);
      }
    }
    this.autosaver.notifyChanged();
    this.onDirty.emit();
  }
  /** Flush pending inner edits (before saving / leaving). */
  flushScopes(): void {
    for (const s of this.scopes) if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
      this.writeBack(s);
    }
  }

  /** Ask the user what to do with unsaved changes. Returns false when cancelled. */
  async confirmDiscard(): Promise<boolean> {
    if (!this.isDirty) return true;
    const r = await unsavedDialog(this.name);
    if (r === 'cancel') return false;
    if (r === 'save') return this.save();
    return true;
  }

  async newProject(opts: { width?: number; height?: number } = {}): Promise<boolean> {
    if (!(await this.confirmDiscard())) return false;
    this.handle = null;
    this.engine.subgraphs.load([]);
    assets.setRecords([]);
    this.install(this.engine.newGraph({ width: opts.width ?? 1024, height: opts.height ?? 1024 }), 'Untitled');
    this.clearAutosave();
    this.hooks.applyUi?.(undefined);
    return true;
  }

  /** Load a project from JSON text (used by Open, drop, recovery, samples). */
  loadText(text: string, opts: { name?: string; handle?: FsHandle | null; dirty?: boolean } = {}): void {
    const { graph, project, warnings, migratedFrom, repairs } = loadProjectRobust(this.engine.registry, text, (pf) => {
      for (const w of this.engine.subgraphs.load(pf.subgraphs)) consoleBus.warn(`Project load: ${w}`, { source: 'io' });
      assets.setRecords(pf.assets as AssetRecord[]);
    });
    this.handle = opts.handle ?? null;
    this.install(graph, opts.name ?? project.name, project.created);
    for (const w of warnings) consoleBus.warn(`Project load: ${w}`, { source: 'io' });
    if (migratedFrom) toast(t('project.projectMigratedFromV', { migratedFrom }), { type: 'info' });
    if (repairs.length) {
      for (const r of repairs) consoleBus.warn(`Project repair: ${r}`, { source: 'io' });
      toast(t('project.recovered', { n: repairs.length }), { type: 'warn', timeout: 9000 });
    }
    if (warnings.length) toast(t('project.warningSWhileLoading', { length: warnings.length }), { type: 'warn' });
    this.hooks.applyUi?.(project.ui);
    if (project.assetBlobs) void assets.importBlobs(project.assetBlobs).then(() => this.engine.scheduler.invalidate());
    this.onSaved.emit();
    if (opts.dirty) this.editor.stack.clear(); // keeps clean marker semantic: recovered projects are saved explicitly below
  }

  async open(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    try {
      const w = window as FsWindow;
      if (w.showOpenFilePicker) {
        const [hd] = await w.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
        const f = await hd.getFile();
        this.loadText(await f.text(), { name: f.name.replace(/\.(kvfx|json)$/i, ''), handle: hd });
      } else {
        const [f] = await pickFile('.kvfx,.json,application/json');
        if (f) this.loadText(await f.text(), { name: f.name.replace(/\.(kvfx|json)$/i, '') });
      }
      this.clearAutosave();
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
      consoleBus.error(`Open failed: ${(e as Error).message}`, { source: 'io' });
      toast((e as Error).message, { type: 'error', title: t('common.cannotOpenProject') });
    }
  }

  async openFile(f: File): Promise<boolean> {
    if (!(await this.confirmDiscard())) return true;
    try {
      this.loadText(await f.text(), { name: f.name.replace(/\.(kvfx|json)$/i, '') });
      return true;
    } catch (e) {
      toast((e as Error).message, { type: 'error', title: t('common.cannotOpenProject') });
      return true;
    }
  }

  async save(): Promise<boolean> {
    if (!this.handle) return this.saveAs();
    return this.write(this.handle);
  }

  async saveAs(): Promise<boolean> {
    const w = window as FsWindow;
    try {
      if (w.showSaveFilePicker) {
        const hd = await w.showSaveFilePicker({ suggestedName: `${this.name}.kvfx`, types: PICKER_TYPES });
        this.name = hd.name.replace(/\.(kvfx|json)$/i, '');
        this.handle = hd;
        return this.write(hd);
      }
      // download fallback
      download(`${this.name}.kvfx`, projectToJson(await this.snapshotFull()), 'application/json');
      this.markClean();
      this.clearAutosave();
      toast(t('project.downloadedKvfx', { name: this.name }), { type: 'ok' });
      this.onDirty.emit();
      return true;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false;
      toast((e as Error).message, { type: 'error', title: t('project.saveFailed') });
      return false;
    }
  }

  private async write(hd: FsHandle): Promise<boolean> {
    try {
      const wr = await hd.createWritable();
      await wr.write(projectToJson(await this.snapshotFull()));
      await wr.close();
      this.markClean();
      this.clearAutosave();
      toast(t('project.saved', { name: hd.name }), { type: 'ok', timeout: 1800 });
      this.onDirty.emit();
      return true;
    } catch (e) {
      toast((e as Error).message, { type: 'error', title: t('project.saveFailed') });
      return false;
    }
  }

  /** Crash recovery: offered at startup when the last session did not exit cleanly and an autosave exists. */
  async checkRecovery(): Promise<void> {
    let crashed = false;
    try {
      crashed = localStorage.getItem('kk-clean') === '0';
      localStorage.setItem('kk-clean', '0');
    } catch {
      /* ignore */
    }
    if (!crashed) return;
    const found = await loadAutosaveSafe(this.backend, 'autosave').catch(() => null);
    if (!found) return;
    const json = found.json;
    if (found.source === 'backup') toast(t('project.autosaveRestored'), { type: 'warn', timeout: 7000 });
    const info = (await this.backend.list().catch(() => [])).find((s) => s.slot === 'autosave');
    const when = info ? new Date(info.modified).toLocaleString() : 'earlier';
    const r = await showModal<'recover' | 'discard'>({
      title: t('project.recoverPreviousSession'),
      body: `Kekenik VFX did not close cleanly. An autosaved project from ${when} was found.`,
      buttons: [
        { label: 'Discard', value: 'discard' },
        { label: 'Recover', value: 'recover', primary: true },
      ],
    });
    if (r === 'recover') {
      try {
        this.loadText(json, { name: 'Recovered project' });
        // mark dirty so the user is nudged to save it
        this.editor.stack.execute({ label: 'Recover', do() {}, undo() {} });
        toast(t('project.sessionRecoveredSaveIt'), { type: 'ok' });
      } catch (e) {
        toast((e as Error).message, { type: 'error', title: t('project.recoveryFailed') });
      }
    } else this.clearAutosave();
  }
}
