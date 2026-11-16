import { Emitter } from '../shared/emitter';
import { colSpec, layoutFromSpec, parseLayout, rowSpec, tabsSpec, type LayoutSpec, type LayoutState } from '../ui/dock/layout';
import { getPanel } from '../ui/dock/panel-registry';
import type { AppServices } from './app';

/** Built-in workspace presets: Graph, Texture, Mesh, Animation, Export. */
export const PRESETS: Record<string, LayoutSpec> = {
  Graph: rowSpec([
    colSpec([tabsSpec(['viewport-2d', 'viewport-3d'], 0.7), tabsSpec(['timeline', 'anim-curves', 'curve-editor', 'console'], 0.3)], 0.38),
    colSpec([rowSpec([tabsSpec(['node-library', 'node-gallery', 'assets'], 0.24), tabsSpec(['graph-editor'], 0.76)], 0.56), tabsSpec(['properties', 'export'], 0.44)], 0.62),
  ]),
  Texture: rowSpec([
    colSpec([tabsSpec(['viewport-2d'], 0.78), tabsSpec(['console', 'curve-editor'], 0.22)], 0.42),
    colSpec([rowSpec([tabsSpec(['node-library', 'node-gallery'], 0.25), tabsSpec(['graph-editor'], 0.75)], 0.55), tabsSpec(['properties'], 0.45)], 0.58),
  ]),
  Mesh: rowSpec([
    tabsSpec(['viewport-3d', 'viewport-2d'], 0.5),
    colSpec([rowSpec([tabsSpec(['node-library', 'node-gallery'], 0.28), tabsSpec(['graph-editor'], 0.72)], 0.52), tabsSpec(['properties', 'console'], 0.48)], 0.5),
  ]),
  Animation: colSpec([
    rowSpec([tabsSpec(['viewport-2d', 'viewport-3d'], 0.4), tabsSpec(['graph-editor'], 0.4), tabsSpec(['properties'], 0.2)], 0.55),
    rowSpec([tabsSpec(['timeline'], 0.6), tabsSpec(['anim-curves', 'curve-editor', 'flipbook-editor', 'console'], 0.4)], 0.45),
  ]),
  Export: rowSpec([
    tabsSpec(['viewport-2d', 'viewport-3d'], 0.4),
    colSpec([tabsSpec(['export'], 0.5), rowSpec([tabsSpec(['properties'], 0.4), tabsSpec(['graph-editor', 'node-library', 'console'], 0.6)], 0.5)], 0.6),
  ]),
};
export const PRESET_NAMES = Object.keys(PRESETS);

const LS_LAYOUT = 'kk-layout';
const LS_NAME = 'kk-workspace';
const LS_USER = 'kk-workspaces';

/** Named workspaces (presets + user-saved), current-layout persistence, reset, per-project layout hooks. */
export class WorkspaceService {
  readonly onChange = new Emitter<void>();
  current = 'Graph';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private app: AppServices) {}

  private known = (id: string): boolean => !!getPanel(id);

  presetLayout(name: string): LayoutState {
    return layoutFromSpec(PRESETS[name] ?? PRESETS.Graph, this.known);
  }
  userWorkspaces(): Record<string, LayoutState> {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_USER) ?? '{}') as Record<string, unknown>;
      const out: Record<string, LayoutState> = {};
      for (const [k, v] of Object.entries(raw)) {
        const l = parseLayout(v, this.known);
        if (l) out[k] = l;
      }
      return out;
    } catch {
      return {};
    }
  }
  list(): { name: string; builtin: boolean }[] {
    return [...PRESET_NAMES.map((name) => ({ name, builtin: true })), ...Object.keys(this.userWorkspaces()).map((name) => ({ name, builtin: false }))];
  }

  /** Startup: restore the last layout (validated) or fall back to the Graph preset. */
  restore(): void {
    let layout: LayoutState | null = null;
    try {
      layout = parseLayout(localStorage.getItem(LS_LAYOUT), this.known);
      this.current = localStorage.getItem(LS_NAME) ?? 'Graph';
    } catch {
      /* ignore */
    }
    this.app.dock.setLayout(layout ?? this.presetLayout('Graph'));
    this.app.dock.onChange.on(() => this.persistSoon());
  }

  apply(name: string): void {
    const user = this.userWorkspaces()[name];
    const layout = user ?? (PRESETS[name] ? this.presetLayout(name) : null);
    if (!layout) return;
    this.current = name;
    this.app.dock.setLayout(layout);
    this.persistNow();
    this.onChange.emit();
  }
  reset(): void {
    this.apply(PRESETS[this.current] ? this.current : 'Graph');
  }
  saveAs(name: string): void {
    const all = this.userWorkspaces();
    all[name] = this.app.dock.getLayout();
    try {
      localStorage.setItem(LS_USER, JSON.stringify(all));
    } catch {
      /* ignore */
    }
    this.current = name;
    this.persistNow();
    this.onChange.emit();
  }
  remove(name: string): void {
    const all = this.userWorkspaces();
    delete all[name];
    try {
      localStorage.setItem(LS_USER, JSON.stringify(all));
    } catch {
      /* ignore */
    }
    this.onChange.emit();
  }

  private persistSoon(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.persistNow(), 300);
  }
  persistNow(): void {
    try {
      localStorage.setItem(LS_LAYOUT, JSON.stringify(this.app.dock.getLayout()));
      localStorage.setItem(LS_NAME, this.current);
    } catch {
      /* ignore */
    }
  }

  /** Per-project layout (stored in ProjectFile.ui). */
  collectUi(): Record<string, unknown> {
    return { layout: this.app.dock.getLayout(), workspace: this.current };
  }
  applyUi(ui: Record<string, unknown> | undefined): void {
    const l = ui?.layout ? parseLayout(ui.layout, this.known) : null;
    if (l) {
      this.current = typeof ui?.workspace === 'string' ? ui.workspace : this.current;
      this.app.dock.setLayout(l);
      this.onChange.emit();
    }
  }
}
