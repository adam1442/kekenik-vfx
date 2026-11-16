import type { EvalTarget } from '../engine/graph/evaluator';
import type { Graph } from '../engine/graph/graph';
import { Emitter } from '../shared/emitter';
import { consoleBus } from '../shared/log';
import { h } from '../ui/core/dom';
import { prefs } from '../shared/prefs';
import { setUi } from '../ui/theme/ui-store';
import { setDigitsMode, t as tt } from '../shared/i18n';
import { toast } from '../ui/core/overlay';

/* ============================================================================================ settings */
export interface SettingsData {
  uiScale: number;
  /** Interactive (drag) preview resolution factor. */
  previewQuality: number;
  autosave: boolean;
  favorites: string[];
  recentNodes: string[];
  budgetMB: number | null;
  /** settings */
  accent: string;
  reduceMotion: boolean;
  angleUnit: 'deg' | 'rad';
  adaptivePreview: boolean;
  budgetMs: number;
  autosaveSec: number;
  hud: boolean;
  warmup: boolean;
  /** 'compact' (default) | 'comfortable' */
  density: 'compact' | 'comfortable';
  theme: 'dark' | 'light' | 'system';
  /** Digits shown in labels: Latin (default) or Persian. */
  digits: 'latin' | 'fa';
  /** '' = detect from the browser on first run. */
  language: string;
  [k: string]: unknown;
}
const DEFAULTS: SettingsData = { uiScale: 1, previewQuality: 0.5, autosave: true, favorites: [], recentNodes: [], budgetMB: null, accent: '#7c6cf0', reduceMotion: false, angleUnit: 'deg', adaptivePreview: true, budgetMs: 8, autosaveSec: 2, hud: false, warmup: true, density: 'compact', theme: 'dark', digits: 'latin', language: '' };

/** Persistent user settings (localStorage). Reading/writing never throws (private mode etc.). */
export class Settings {
  readonly onChange = new Emitter<keyof SettingsData>();
  private data: SettingsData = { ...DEFAULTS };
  constructor(private key = 'kk-settings') {
    try {
      const raw = localStorage.getItem(key);
      if (raw) this.data = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SettingsData>) };
    } catch {
      /* ignore corrupt settings */
    }
  }
  get<K extends keyof SettingsData>(k: K): SettingsData[K] {
    return this.data[k];
  }
  set<K extends keyof SettingsData>(k: K, v: SettingsData[K]): void {
    this.data[k] = v;
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch {
      /* quota */
    }
    this.onChange.emit(k);
  }
  /** Scale the whole UI (root font size). */
  applyUiScale(): void {
    setUi({ scale: this.data.uiScale });
  }
  /** scale + accent colour + reduced motion + angle unit. Idempotent, called at startup and after every change. */
  applyAppearance(): void {
    setUi({ scale: this.data.uiScale, density: this.data.density, theme: this.data.theme, accent: this.data.accent });
    setDigitsMode(this.data.digits === 'fa' ? 'fa' : 'latin');
    const root = document.documentElement;
    const osReduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.classList.toggle('reduce-motion', this.data.reduceMotion || osReduce);
    prefs.angleUnit = this.data.angleUnit === 'rad' ? 'rad' : 'deg';
  }
  /** Forget every saved setting. */
  reset(): void {
    for (const k of Object.keys(this.data)) delete this.data[k];
    Object.assign(this.data, DEFAULTS);
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
    this.onChange.emit('uiScale');
  }
}

/* ============================================================================================ selection */
/** Selected node ids (graph editor writes, Properties/viewports read). Pruned automatically when nodes vanish. */
export class SelectionService {
  readonly onChange = new Emitter<void>();
  private ids: string[] = [];
  private unsub: (() => void) | null = null;

  bind(graph: Graph): void {
    this.unsub?.();
    this.ids = [];
    this.unsub = graph.events.on((e) => {
      if (e.type !== 'structure' && e.type !== 'reset') return;
      const keep = this.ids.filter((id) => graph.nodes.has(id));
      if (keep.length !== this.ids.length) this.set(keep);
    });
    this.onChange.emit();
  }
  get(): readonly string[] {
    return this.ids;
  }
  /** The last selected node (what single-node panels show). */
  get primary(): string | null {
    return this.ids[this.ids.length - 1] ?? null;
  }
  has(id: string): boolean {
    return this.ids.includes(id);
  }
  set(ids: string[]): void {
    const next = [...new Set(ids)];
    if (next.length === this.ids.length && next.every((v, i) => v === this.ids[i])) return;
    this.ids = next;
    this.onChange.emit();
  }
  toggle(id: string): void {
    this.set(this.has(id) ? this.ids.filter((x) => x !== id) : [...this.ids, id]);
  }
  clear(): void {
    this.set([]);
  }
}

/* ============================================================================================ active target */
/** Which node (and output pin) the viewports display. Follows the selection unless pinned. */
export class ActiveTargetService {
  readonly onChange = new Emitter<void>();
  private target: EvalTarget | null = null;
  follow = true;
  constructor(private selection: SelectionService) {
    selection.onChange.on(() => {
      if (this.follow && selection.primary) this.set({ nodeId: selection.primary });
    });
  }
  get(): EvalTarget | null {
    return this.target;
  }
  set(t: EvalTarget | null): void {
    if (this.target?.nodeId === t?.nodeId && this.target?.pinId === t?.pinId) return;
    this.target = t;
    this.onChange.emit();
  }
  /** Pin the viewports to this node (stops following the selection). */
  pin(t: EvalTarget | null): void {
    this.follow = false;
    this.set(t);
  }
  setFollow(f: boolean): void {
    this.follow = f;
    if (f && this.selection.primary) this.set({ nodeId: this.selection.primary });
    this.onChange.emit();
  }
  validate(graph: Graph): void {
    if (this.target && !graph.nodes.has(this.target.nodeId)) this.set(null);
  }
}

/* ============================================================================================ tasks */
/** Counts running background tasks for the status bar (exports, gallery renders, project IO). */
export class TaskService {
  readonly onChange = new Emitter<void>();
  private tasks = new Map<number, string>();
  private seq = 0;
  begin(label: string): () => void {
    const id = ++this.seq;
    this.tasks.set(id, label);
    this.onChange.emit();
    return () => {
      if (this.tasks.delete(id)) this.onChange.emit();
    };
  }
  async run<T>(label: string, p: Promise<T>): Promise<T> {
    const done = this.begin(label);
    try {
      return await p;
    } finally {
      done();
    }
  }
  get count(): number {
    return this.tasks.size;
  }
  labels(): string[] {
    return [...this.tasks.values()];
  }
}

/* ============================================================================================ file drop */
export interface FileHandler {
  id: string;
  /** Lower-case extensions without dot, e.g. ['png','jpg']. Empty = any. */
  extensions: string[];
  /** Return true when the files were consumed. */
  handle(files: File[]): boolean | Promise<boolean>;
  label?: string;
}

/**
 * Drag-and-drop / "Import file" hook. Modules register handlers; the shell registers the
 * project handler. The first handler accepting ALL dropped extensions wins.
 */
export class FileDropService {
  private handlers: FileHandler[] = [];
  register(h: FileHandler): () => void {
    this.handlers.unshift(h);
    return () => (this.handlers = this.handlers.filter((x) => x !== h));
  }
  async handleFiles(files: File[]): Promise<void> {
    if (!files.length) return;
    const ext = (f: File): string => f.name.split('.').pop()?.toLowerCase() ?? '';
    for (const hd of this.handlers) {
      const mine = files.filter((f) => !hd.extensions.length || hd.extensions.includes(ext(f)));
      if (!mine.length) continue;
      try {
        if (await hd.handle(mine)) return;
      } catch (e) {
        consoleBus.error(`File handler "${hd.id}" failed: ${(e as Error).message}`, { source: 'io' });
        toast((e as Error).message, { type: 'error', title: tt('common.importFailed') });
        return;
      }
    }
    toast(`No importer for ${files.map((f) => f.name).join(', ')} yet.`, { type: 'warn', title: tt('services.unsupportedFile') });
  }
  install(): void {
    const overlay = h('div', { class: 'k-filedrop' }, tt('services.dropFilesToImport'));
    document.body.append(overlay);
    let depth = 0;
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (hasFiles(e)) {
        depth++;
        overlay.classList.add('on');
      }
    });
    window.addEventListener('dragleave', (e) => {
      if (hasFiles(e) && --depth <= 0) {
        depth = 0;
        overlay.classList.remove('on');
      }
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      depth = 0;
      overlay.classList.remove('on');
      if (!hasFiles(e)) return;
      e.preventDefault();
      void this.handleFiles([...(e.dataTransfer?.files ?? [])]);
    });
  }
}

/** MIME used when dragging nodes from the Node Library. */
export const DND_NODE_MIME = 'application/x-kekenik-node';
