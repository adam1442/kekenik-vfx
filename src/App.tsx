import { buildMenuBar, buildStatusBar, buildToolbar, registerBuiltinCommands } from './app/chrome';
import { createApp } from './app/app';
import { maybeShowHomeOnStart, registerLibrary } from './app/library';
import { installPerformance } from './app/perf-wiring';
import { isSafeMode } from './app/safe-mode';
import { PanelErrorTracker } from './ui/dock/panel-guard';
import { onLocaleChange, setLocale, t } from './shared/i18n';
import { Settings } from './app/services';
import { installCanvasTheming, watchSystemTheme } from './ui/theme/ui-store';
import { Engine } from './engine/engine';
import { GpuContext } from './engine/gpu/device';
import { consoleBus } from './shared/log';
import { h } from './ui/core/dom';
import { initTooltips, toast } from './ui/core/overlay';
import { discoverPanels } from './ui/dock/panel-discovery';
import { injectStyles } from './ui/styles';
import { showGpuDiagnostics } from './ui/diagnostics';
import type { AcquireOptions } from './engine/gpu/acquire';

/**
 * Application entry (vanilla TypeScript, no UI framework; this file keeps the conventional
 * name src/App.tsx but contains no JSX). Routes: default = the app shell. In the development server only: #selftest (GPU known-answer tests), #gizmo-test, #graph-stress.
 */
export async function startApp(root: HTMLElement): Promise<void> {
  injectStyles();
  // theme / scale / density / language are applied BEFORE anything is drawn (also for the Diagnostics screen)
  installCanvasTheming();
  const early = new Settings();
  early.applyAppearance();
  watchSystemTheme();
  const lang = early.get('language');
  if (lang) setLocale(lang, false);
  if (import.meta.env.DEV && location.hash === '#gizmo-test') {
    // Gizmo test page: pure Canvas2D + the real gizmo framework, works WITHOUT WebGPU.
    const { mountGizmoTest } = await import('./gizmos/testpage');
    mountGizmoTest(root);
    return;
  }
  const first = isSafeMode() ? SAFE_ACQUIRE : {};
  const err = await tryStart(root, first);
  if (!err) return;
  if (import.meta.env.DEV && location.hash === '#graph-stress') {
    // the stress page also works without WebGPU (no thumbnails): it measures the Canvas2D graph itself
    const { mountGraphStress } = await import('./panels/graph-editor/stress');
    await mountGraphStress(root, null);
    return;
  }
  showStartFailure(root, err);
}

/** Safe mode / "limited": lowest tier first (compatibility), bare device request (no optional features, default limits). */
const SAFE_ACQUIRE: AcquireOptions = { bare: true, order: ['C', 'A', 'D'] };

function showStartFailure(root: HTMLElement, err: Error): void {
  const run = (acq: AcquireOptions) => async (): Promise<string | null> => {
    const e = await tryStart(root, acq);
    return e ? e.message : null;
  };
  showGpuDiagnostics(root, err, { retry: run({}), software: run({ order: ['D'] }), limited: run(SAFE_ACQUIRE) });
}

/** One startup attempt. Returns null when the app (or a test page) took over, or the error. Never throws. */
async function tryStart(root: HTMLElement, acquire: AcquireOptions): Promise<Error | null> {
  const boot = h('div', { class: 'k-boot' }, h('div', { class: 'k-spinner' }), t('boot.gpu'));
  if (!root.querySelector('.k-diag-wrap')) root.replaceChildren(boot);
  let gpu: GpuContext;
  try {
    gpu = await GpuContext.create(acquire);
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
  try {
    if (import.meta.env.DEV && (location.hash === '#selftest' || new URLSearchParams(location.search).has('selftest'))) {
      const { mountSelfTest } = await import('./selftest/selftest');
      await mountSelfTest(root, gpu);
      return null;
    }
    if (import.meta.env.DEV && location.hash === '#graph-stress') {
      const { mountGraphStress } = await import('./panels/graph-editor/stress');
      await mountGraphStress(root, gpu);
      return null;
    }
    const engine = await Engine.create({ gpu });
    mountShell(root, engine);
    return null;
  } catch (e) {
    consoleBus.error(`Startup failed: ${(e as Error).message}`);
    // not "unsupported": the device exists; show the diagnostics (with the caps) and offer retry / limited mode
    return Object.assign(new Error(`Startup failed: ${(e as Error).message}`), { caps: gpu.caps });
  }
}

function mountShell(root: HTMLElement, engine: Engine): void {
  const menubar = h('div');
  const toolbar = h('div');
  const dockEl = h('div');
  const status = h('div');
  root.replaceChildren(h('div', { class: 'k-app' }, menubar, toolbar, dockEl, status));
  initTooltips();

  discoverPanels();
  const app = createApp(engine, dockEl);
  app.settings.applyAppearance();
  engine.scheduler.interactionScale = app.settings.get('previewQuality');
  app.project.autosaveEnabled = app.settings.get('autosave');
  registerBuiltinCommands(app);
  const perf = installPerformance(app); // settings -> engine, memory guard, HUD, profiler / help commands, shader warm-up
  new PanelErrorTracker((id, err) => app.dock.crashPanel(id, err)).install(); // per-panel error boundary
  if (isSafeMode()) root.querySelector('.k-app')?.prepend(h('div', { class: 'k-safe-banner', role: 'status' }, t('safe.banner')));
  const caps = engine.gpu.caps;
  if (caps.software) {
    root.querySelector('.k-app')?.prepend(h('div', { class: 'k-safe-banner k-banner-sw', role: 'status' }, t('gpu.softwareBanner')));
    // software rendering: lower the drag-preview resolution ONCE (the memory budget is already reduced in caps.defaultBudgetBytes)
    if (app.settings.get('previewQuality') > 0.25 && !localStorage.getItem('kk-sw-lowered')) {
      localStorage.setItem('kk-sw-lowered', '1');
      app.settings.set('previewQuality', 0.25);
      engine.scheduler.interactionScale = 0.25;
    }
  }
  else if (caps.compat) root.querySelector('.k-app')?.prepend(h('div', { class: 'k-safe-banner', role: 'status' }, t('gpu.compatBanner')));
  wireGpuResilience(root, app, engine, perf.guard);
  const library = registerLibrary(app); // subgraphs, presets, imports, samples, start screen
  app.project.hooks = { collectUi: () => app.workspaces.collectUi(), applyUi: (ui) => app.workspaces.applyUi(ui) };
  app.commands.installKeyboard(() => app.keyCapture);
  app.files.install();
  app.files.register({ id: 'project', extensions: ['kvfx', 'json'], handle: async (files) => app.project.openFile(files[0]) });

  buildMenuBar(app, menubar);
  buildToolbar(app, toolbar);
  buildStatusBar(app, status);
  // live language switch: the chrome is rebuilt in place (no reload); canvases / panels read `t()` at draw time
  onLocaleChange(() => {
    try {
      for (const c of [menubar, toolbar, status]) c.replaceChildren();
      buildMenuBar(app, menubar);
      buildToolbar(app, toolbar);
      buildStatusBar(app, status);
      window.dispatchEvent(new Event('kk-locale'));
    } catch (e) {
      consoleBus.error(`Language switch: ${(e as Error).message}`);
    }
  });
  app.workspaces.restore();
  engine.scheduler.start();

  // surface engine errors as toasts (details are in the Console panel)
  consoleBus.onEntry.on((e) => {
    if (e.level === 'error' && e.source !== 'test') toast(e.message.slice(0, 160), { type: 'error', title: e.nodeName ? `Error in “${e.nodeName}”` : 'Error', timeout: 6000, action: { label: 'Console', run: () => void app.dock.openPanel('console') } });
  });
  if (import.meta.env.DEV) (window as unknown as { kekenik: unknown }).kekenik = app; // devtools handle (development server only)
  void app.project.checkRecovery().then(() => maybeShowHomeOnStart(app, library));
}

/**
 * Recoverable GPU problems never kill the app: out-of-memory -> free caches + lower the preview (+ toast with an action),
 * device lost -> the GpuContext recreates the device (Engine rebuilds pools / pipelines) and we tell the user; when recreation fails
 * the Diagnostics screen is shown as an OVERLAY (the project stays in memory and autosaved) with a Retry button.
 */
function wireGpuResilience(root: HTMLElement, app: ReturnType<typeof createApp>, engine: Engine, guard: { handle(kind: 'budget' | 'device-oom'): unknown }): void {
  const gpu = engine.gpu;
  gpu.onOutOfMemory.on(() => {
    guard.handle('device-oom');
    toast(t('gpu.oom'), {
      type: 'warn',
      timeout: 9000,
      action: {
        label: t('gpu.oom.action'),
        run: () => {
          const cur = app.settings.get('budgetMB') ?? Math.round(engine.mm.budgetBytes / 1024 ** 2);
          app.settings.set('budgetMB', Math.max(128, Math.round(cur / 2)));
        },
      },
    });
  });
  gpu.onRestored.on(() => {
    root.querySelector('.k-diag-overlay')?.remove();
    toast(t('gpu.wasReset'), { type: 'info', timeout: 4000 });
  });
  gpu.onRecoveryFailed.on((err) => {
    void app.project.flushAutosave();
    toast(t('gpu.recoverFailed'), { type: 'error', timeout: 8000 });
    const overlay = h('div', { class: 'k-diag-overlay' });
    root.append(overlay);
    const run = (over: AcquireOptions) => async (): Promise<string | null> => {
      try {
        await gpu.recoverNow(over);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    showGpuDiagnostics(overlay, err, { retry: run({}), software: run({ order: ['D'] }), limited: run(SAFE_ACQUIRE) }, gpu.caps);
  });
}
