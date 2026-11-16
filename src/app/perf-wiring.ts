import { MemoryGuard } from '../engine/perf/guard';
import { warmUpPipelines } from '../engine/perf/warmup';
import { consoleBus } from '../shared/log';
import { getLocale, setLocale, t } from '../shared/i18n';
import { isSafeMode } from './safe-mode';
import { toast } from '../ui/core/overlay';
import type { AppServices } from './app';
import { PerfHud } from './hud';
import { openSettings } from './settings-dialog';

/**
 * glue: applies the settings to the engine / UI, creates the memory guard + HUD, registers the commands
 * (Settings, Performance HUD, Profiler, Help, Free memory, Warm-up) and triggers the pipeline warm-up after project loads.
 */
let hud: PerfHud | null = null;

/** Make the current settings live (idempotent; called on startup and after every change). */
export function applySettings(app: AppServices): void {
  const s = app.settings;
  const e = app.engine;
  s.applyAppearance();
  e.scheduler.interactionScale = s.get('previewQuality');
  e.adaptive.enabled = s.get('adaptivePreview');
  e.adaptive.setBudget(s.get('budgetMs'));
  e.adaptive.opts.maxScale = 1;
  const mb = s.get('budgetMB');
  const want = mb ? mb * 1024 * 1024 : e.gpu.caps.defaultBudgetBytes;
  if (Math.abs(e.mm.budgetBytes - want) > 1024 * 1024 && (mb || appliedBudget)) e.mm.setBudget(want);
  appliedBudget = !!mb;
  app.project.autosaveEnabled = s.get('autosave');
  app.project.setAutosaveDelay(Math.max(1, s.get('autosaveSec')) * 1000);
  hud?.setVisible(s.get('hud'));
}
let appliedBudget = false;

export function installPerformance(app: AppServices): { guard: MemoryGuard; hud: PerfHud } {
  hud = new PerfHud(app);
  const guard = new MemoryGuard(app.engine, {
    getPreview: () => app.settings.get('previewQuality'),
    setPreview: (v) => {
      app.settings.set('previewQuality', v);
      applySettings(app);
    },
    notify: (msg, level) => toast(msg, { type: level === 'warn' ? 'warn' : 'info', title: t('perfWiring.gpuMemory'), timeout: 8000 }),
  });
  guard.attach();
  applySettings(app);
  app.settings.onChange.on(() => applySettings(app));

  const reg = app.commands.register.bind(app.commands);
  reg({ id: 'settings.open', title: t('perfWiring.settings'), category: 'Edit', icon: 'settings', keys: ['Mod+,'], run: () => openSettings(app) });
  reg({ id: 'view.perfHud', title: t('perfWiring.togglePerformanceHud'), category: 'View', icon: 'clock', keys: ['F3'], run: () => app.settings.set('hud', !app.settings.get('hud')) });
  reg({
    id: 'perf.fusion',
    title: t('cmd.perf.fusion'),
    category: 'View',
    icon: 'clock',
    run: () => {
      const fu = app.engine.evaluator.fusion;
      fu.setEnabled(!fu.enabled);
      app.engine.scheduler.invalidate();
      toast(fu.enabled ? t('perf.fusion.on') : t('perf.fusion.off'), { type: 'ok', timeout: 1800 });
    },
  });
  reg({
    id: 'settings.language',
    title: t('cmd.lang.toggle'),
    category: 'Edit',
    run: () => {
      setLocale(getLocale() === 'fa' ? 'en' : 'fa'); // live: lang / dir on the root, persisted, undo-neutral
      toast(t('lang.switched'), { type: 'ok', timeout: 1800 });
    },
  });
  reg({ id: 'window.profiler', title: t('perfWiring.openProfiler'), category: 'Window', icon: 'clock', run: () => void app.dock.openPanel('profiler') });
  reg({ id: 'help.panel', title: t('perfWiring.helpNodeReference'), category: 'Help', icon: 'info', keys: ['F1'], run: () => void app.dock.openPanel('help') });
  reg({
    id: 'perf.freeMemory',
    title: t('perfWiring.freeGpuMemoryDrop'),
    category: 'View',
    run: () => {
      app.engine.scheduler.dropFrameCache();
      app.engine.evaluator.cache.clear();
      app.engine.mm.reclaim(Number.MAX_SAFE_INTEGER);
      app.engine.runner.clearBindGroups();
      app.engine.scheduler.invalidate();
      toast(t('perfWiring.cachesDropped'), { type: 'ok', timeout: 1500 });
    },
  });
  reg({
    id: 'perf.warmup',
    title: t('perfWiring.preCompileShadersOfThis'),
    category: 'View',
    run: async () => {
      const r = await warmUpPipelines(app.engine, app.project.graph);
      toast(r.skipped ? 'Warm-up skipped (busy)' : `Warm-up done: ${r.nodes} node types in ${r.ms.toFixed(0)} ms`, { type: 'ok', timeout: 2500 });
    },
  });

  // pipeline warm-up after every project change (load / new): idle, cancellable, never in safe mode
  if (!isSafeMode()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    app.project.onChange.on(() => {
      clearTimeout(timer);
      if (!app.settings.get('warmup')) return;
      const g = app.project.graph;
      timer = setTimeout(() => {
        void warmUpPipelines(app.engine, g).then((r) => {
          if (!r.skipped && r.nodes) consoleBus.info(`Warm-up: ${r.nodes} node types, ${r.batches} batch(es), ${r.ms.toFixed(0)} ms`, { source: 'eval' });
        });
      }, 800);
    });
  }
  return { guard, hud };
}
