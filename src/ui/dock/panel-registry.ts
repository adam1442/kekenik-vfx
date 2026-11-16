import type { GraphEditor } from '../../engine/commands/graph-commands';
import type { Engine } from '../../engine/engine';
import type { EvalScheduler } from '../../engine/graph/scheduler';
import type { Store } from '../../shared/emitter';
import type { AppServices } from '../../app/app';
import type { DropZone } from './layout';

/**
 * PANEL REGISTRY. A panel is added by creating `src/panels/<name>/panel.ts` that calls `registerPanel({...})` at
 * module load (files are auto-discovered, nothing else to edit). See docs/ARCHITECTURE.md "Panels".
 */
export interface PanelContext {
  readonly engine: Engine;
  /** Always the CURRENT project's editor (changes on New/Open: subscribe to `app.project.onChange`). */
  readonly editor: GraphEditor;
  readonly scheduler: EvalScheduler;
  readonly app: AppServices;
  readonly instanceId: string;
  readonly panelId: string;
  /** Free-form per-instance state persisted in the workspace layout (JSON). Also see PanelInstance.serialize. */
  readonly state: Store<unknown>;
  /** Tab title (panels may rename themselves, e.g. "2D View — Noise"). */
  readonly title: Store<string>;
  /** false while the panel is in a hidden tab or a minimized window: stop rendering / release evaluation targets. */
  readonly visible: Store<boolean>;
  /** Restored state from the saved layout (undefined on first open). */
  readonly initialState: unknown;
}

export interface PanelInstance {
  dispose(): void;
  /** CSS pixel size of the panel body (also fired after dock/float moves). Canvases: use devicePixelRatio. */
  resize?(width: number, height: number): void;
  focus?(): void;
  /** Return JSON to persist in the workspace. */
  serialize?(): unknown;
}

export interface PanelDefinition {
  id: string;
  title: string;
  icon: string;
  /** Only one instance allowed (default true). Viewports set `multiple: true` / `singleton: false`. */
  singleton?: boolean;
  multiple?: boolean;
  /** Where Window > <Panel> opens it when it was closed. */
  defaultDock?: { zone: DropZone | 'float'; size?: number };
  description?: string;
  /** Build the panel UI inside `container` (a persistent element that survives docking/floating moves). */
  create(container: HTMLElement, ctx: PanelContext): PanelInstance;
}

const panels = new Map<string, PanelDefinition>();
export function registerPanel(def: PanelDefinition): void {
  if (panels.has(def.id)) throw new Error(`Duplicate panel id "${def.id}"`);
  panels.set(def.id, def);
}
export const getPanel = (id: string): PanelDefinition | undefined => panels.get(id);
export const listPanels = (): PanelDefinition[] => [...panels.values()];
export const isSingleton = (d: PanelDefinition): boolean => d.singleton ?? !d.multiple;
