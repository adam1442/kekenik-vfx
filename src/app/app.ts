import type { Engine } from '../engine/engine';
import { Store } from '../shared/emitter';
import { DockManager } from '../ui/dock/dock-manager';
import type { PanelContext } from '../ui/dock/panel-registry';
import { CommandRegistry } from './commands';
import { ProjectService } from './project';
import { ActiveTargetService, FileDropService, SelectionService, Settings, TaskService } from './services';
import { WorkspaceService } from './workspaces';
import type { Keymap } from './keymap';

/** Everything panels and chrome share. Created once (createApp); reachable from every panel as `ctx.app`. */
export interface AppServices {
  readonly engine: Engine;
  readonly project: ProjectService;
  readonly selection: SelectionService;
  readonly active: ActiveTargetService;
  readonly commands: CommandRegistry;
  readonly keymap: Keymap;
  readonly settings: Settings;
  readonly tasks: TaskService;
  readonly files: FileDropService;
  readonly dock: DockManager;
  readonly workspaces: WorkspaceService;
  /** Frames per second of the UI (status bar). */
  readonly fps: Store<number>;
  /** Last evaluation summary (status bar / console). */
  readonly lastEval: Store<{ cpuMs: number; gpuMs?: number; ran: number; cached: number; scale: number } | null>;
  /** Contextual hint line in the status bar (panels set it on hover). */
  readonly hint: Store<string>;
  /** Pause global shortcuts (key-capture dialogs). */
  keyCapture: boolean;
  openPalette(): void;
  openKeymapDialog(): void;
}

export function createApp(engine: Engine, dockContainer: HTMLElement): AppServices {
  const settings = new Settings();
  const selection = new SelectionService();
  const project = new ProjectService(engine, selection);
  const active = new ActiveTargetService(selection);
  const commands = new CommandRegistry();
  const lastEval = new Store<AppServices['lastEval'] extends Store<infer T> ? T : never>(null);

  // eslint-disable-next-line prefer-const
  let app: AppServices;
  const dock = new DockManager((parts) => {
    const ctx: PanelContext = {
      engine,
      get editor() {
        return project.editor;
      },
      scheduler: engine.scheduler,
      get app() {
        return app;
      },
      instanceId: parts.instanceId,
      panelId: parts.panelId,
      state: parts.state,
      title: parts.title,
      visible: parts.visible,
      initialState: parts.initialState,
    };
    return ctx;
  }, dockContainer);

  app = {
    engine,
    project,
    selection,
    active,
    commands,
    keymap: commands.keymap,
    settings,
    tasks: new TaskService(),
    files: new FileDropService(),
    dock,
    workspaces: undefined as unknown as WorkspaceService,
    fps: new Store(0),
    lastEval,
    hint: new Store(''),
    keyCapture: false,
    openPalette: () => void 0,
    openKeymapDialog: () => void 0,
  };
  (app as { workspaces: WorkspaceService }).workspaces = new WorkspaceService(app);
  project.onChange.on(() => active.validate(project.graph));

  // evaluation summary for the status bar
  engine.scheduler.onResult.on(({ result, scale }) => {
    const s = result.stats;
    lastEval.set({ cpuMs: s.cpuMs, gpuMs: s.gpuMs, ran: s.nodesEvaluated, cached: s.cacheHits, scale });
  });
  engine.evaluator.onTiming.on((s) => {
    const cur = lastEval.get();
    if (cur && s.gpuMs !== undefined) lastEval.set({ ...cur, gpuMs: s.gpuMs });
  });
  // fps counter
  let frames = 0;
  let t0 = performance.now();
  const tick = (): void => {
    frames++;
    const now = performance.now();
    if (now - t0 >= 500) {
      app.fps.set(Math.round((frames * 1000) / (now - t0)));
      frames = 0;
      t0 = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return app;
}
