import { versionLabel } from '../shared/version';
import { CATEGORIES } from '../engine/graph/categories';
import { getActiveGraphView } from '../panels/graph-editor/api';
import type { GraphSettings } from '../engine/graph/graph';
import { formatBytes } from '../shared/util';
import { availableLocales, getLocale, LANG_NAMES, onLocaleChange, setLocale, t, t as tt, tr } from '../shared/i18n';
import { uiState } from '../ui/theme/ui-store';
import { formatCapabilityReport } from '../engine/gpu/caps';
import { h, observeSize } from '../ui/core/dom';
import { menuBelow, type MenuItem } from '../ui/core/menu';
import { toast, promptDialog, confirmDialog } from '../ui/core/overlay';
import { Dropdown, Segmented, iconButton } from '../ui/widgets/controls';
import { NumberField } from '../ui/widgets/number-field';
import { icon } from '../ui/icons';
import { listPanels } from '../ui/dock/panel-registry';
import type { AppServices } from './app';
import { openAbout, openKeymapDialog, openPalette } from './dialogs';
import { registerAnimationCommands } from './anim';
import { registerExportCommands } from './export-commands';
import { PRESET_NAMES } from './workspaces';

/* ================================================================================ commands */
export function registerBuiltinCommands(app: AppServices): void {
  const { commands: C, project, selection, dock, workspaces, settings } = app;
  const reg = C.register.bind(C);
  const ed = (): typeof project.editor => project.editor;
  registerAnimationCommands(app);
  registerExportCommands(app);

  reg({ id: 'file.new', title: tt('chrome.newProject'), category: 'File', icon: 'new', keys: ['Mod+N'], run: () => void project.newProject() });
  reg({ id: 'file.open', title: tt('chrome.openProject'), category: 'File', icon: 'open', keys: ['Mod+O'], run: () => void project.open() });
  reg({ id: 'file.save', title: tt('chrome.saveProject'), category: 'File', icon: 'save', keys: ['Mod+S'], allowInInput: true, run: () => void project.save() });
  reg({ id: 'file.saveAs', title: tt('chrome.saveProjectAs'), category: 'File', icon: 'save-as', keys: ['Mod+Shift+S'], allowInInput: true, run: () => void project.saveAs() });
  reg({ id: 'file.import', title: tt('chrome.importFile'), category: 'File', icon: 'cat-import', keys: ['Mod+I'], run: async () => {
    const { pickFile } = await import('../ui/core/dom');
    await app.files.handleFiles(await pickFile('*/*', true));
  } });
  reg({ id: 'file.demo', title: tt('chrome.openDemoGraph'), category: 'File', icon: 'panel-graph', run: async () => {
    if (!(await project.confirmDiscard())) return;
    await project.newProject();
    const e = ed();
    const perlin = e.addNode('grayscale.noise', { x: 0, y: 0, name: 'Perlin', params: { noise_type: 'perlin', scale: [4, 4] } });
    const levels = e.addNode('utils.levels', { x: 220, y: 0, name: 'Levels', params: { in_low: 0.3, in_high: 0.8 } });
    e.connect({ node: perlin, pin: 'output' }, { node: levels, pin: 'input' });
    e.stack.clear();
    selection.set([levels]);
  } });

  reg({ id: 'edit.undo', title: 'Undo', category: 'Edit', icon: 'undo', keys: ['Mod+Z'], allowInInput: false, enabled: () => ed().stack.canUndo && !ed().stack.inTransaction, run: () => void ed().stack.undo() });
  reg({ id: 'edit.redo', title: 'Redo', category: 'Edit', icon: 'redo', keys: ['Mod+Y', 'Mod+Shift+Z'], enabled: () => ed().stack.canRedo && !ed().stack.inTransaction, run: () => void ed().stack.redo() });
  reg({ id: 'edit.selectAll', title: tt('chrome.selectAllNodes'), category: 'Edit', keys: ['Mod+A'], run: () => { const gv = getActiveGraphView(); if (gv?.isActive()) gv.selectAll(); else selection.set([...project.graph.nodes.keys()]); } });
  reg({ id: 'edit.deselect', title: tt('chrome.deselectAll'), category: 'Edit', keys: ['Mod+Shift+A'], run: () => { const gv = getActiveGraphView(); if (gv?.isActive()) gv.deselect(); else selection.clear(); } });
  reg({ id: 'edit.delete', title: tt('chrome.deleteSelectedNodes'), category: 'Edit', icon: 'delete', keys: ['Delete', 'Backspace'], enabled: () => selection.get().length > 0 || !!getActiveGraphView()?.hasSelection(), run: () => { const gv = getActiveGraphView(); if (gv?.isActive()) gv.deleteSelection(false); else ed().removeNodes([...selection.get()]); } });
  reg({ id: 'edit.duplicate', title: tt('chrome.duplicateSelectedNodes'), category: 'Edit', icon: 'duplicate', keys: ['Mod+D'], enabled: () => selection.get().length > 0 || !!getActiveGraphView()?.hasSelection(), run: () => { const gv = getActiveGraphView(); if (gv?.isActive()) gv.duplicateSelection(); else selection.set(ed().duplicate([...selection.get()])); } });
  reg({ id: 'edit.bypass', title: tt('chrome.toggleBypass'), category: 'Edit', icon: 'bypass', keys: ['B'], enabled: () => selection.get().length > 0, run: () => { const gv = getActiveGraphView(); if (gv?.isActive()) return gv.toggleBypass(); ed().stack.transaction('Toggle bypass', () => selection.get().forEach((id) => ed().setNodeField(id, 'bypass', !project.graph.nodes.get(id)?.bypass))); } });

  const scale = (d: number): void => {
    settings.set('uiScale', Math.min(2, Math.max(0.75, Math.round((settings.get('uiScale') + d) * 20) / 20)));
    settings.applyUiScale();
  };
  reg({ id: 'view.themeToggle', title: t('cmd.theme.toggle'), category: 'View', run: () => { settings.set('theme', uiState().resolved === 'light' ? 'dark' : 'light'); settings.applyAppearance(); } });
  reg({ id: 'view.themeSystem', title: t('cmd.theme.system'), category: 'View', run: () => { settings.set('theme', 'system'); settings.applyAppearance(); } });
  reg({ id: 'view.densityToggle', title: t('cmd.density.toggle'), category: 'View', run: () => { settings.set('density', settings.get('density') === 'compact' ? 'comfortable' : 'compact'); settings.applyAppearance(); } });
  reg({ id: 'view.uiScaleUp', title: tt('chrome.uiScaleLarger'), category: 'View', icon: 'zoom-in', keys: ['Mod+='], run: () => scale(0.05) });
  reg({ id: 'view.uiScaleDown', title: tt('chrome.uiScaleSmaller'), category: 'View', icon: 'zoom-out', keys: ['Mod+-'], run: () => scale(-0.05) });
  reg({ id: 'view.uiScaleReset', title: tt('chrome.uiScaleReset'), category: 'View', keys: ['Mod+0'], run: () => scale(1 - settings.get('uiScale')) });
  reg({ id: 'view.fullscreen', title: tt('chrome.toggleFullscreen'), category: 'View', icon: 'fullscreen', keys: ['F11'], run: () => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) });

  reg({ id: 'window.resetLayout', title: tt('chrome.resetLayout'), category: 'Window', icon: 'layout', run: () => workspaces.reset() });
  reg({ id: 'window.saveWorkspace', title: tt('chrome.saveWorkspaceAs'), category: 'Window', icon: 'save', run: async () => {
    const n = await promptDialog(tt('chrome.saveWorkspace'), tt('chrome.workspaceName'), workspaces.current);
    if (n) {
      workspaces.saveAs(n);
      toast(tt('chrome.workspaceSaved', { n }), { type: 'ok' });
    }
  } });
  reg({ id: 'window.deleteWorkspace', title: tt('chrome.deleteCustomWorkspace'), category: 'Window', run: async () => {
    const user = workspaces.list().filter((w) => !w.builtin);
    if (!user.length) return void toast(tt('chrome.noCustomWorkspaces'), { type: 'info' });
    const n = await promptDialog(tt('chrome.deleteWorkspace'), `Name (${user.map((u) => u.name).join(', ')})`);
    if (n && user.some((u) => u.name === n) && (await confirmDialog(tt('chrome.deleteWorkspace'), `Delete "${n}"?`, { danger: true, ok: 'Delete' }))) workspaces.remove(n);
  } });
  PRESET_NAMES.forEach((name, i) => reg({ id: `workspace.${name}`, title: tt('chrome.workspace', { name }), category: 'Window', icon: 'layout', keys: [`Alt+${i + 1}`], run: () => workspaces.apply(name) }));
  for (const p of listPanels()) reg({ id: `panel.${p.id}`, title: tt('chrome.toggle', { title: p.title }), category: 'Window', icon: p.icon, run: () => dock.togglePanel(p.id) });
  reg({ id: 'panel.float', title: tt('chrome.floatDockFocused'), category: 'Window', icon: 'float', keys: ['Alt+F'], run: () => {
    const f = dock.focusedInstance();
    if (!f) return;
    const l = dock.getLayout();
    const fw = l.floating.find((x) => x.group.tabs.includes(f));
    if (fw) dock.dockBack(fw.id);
    else dock.floatInstance(f);
  } });
  reg({ id: 'panel.close', title: tt('chrome.closeFocusedPanel'), category: 'Window', icon: 'close', run: () => {
    const f = dock.focusedInstance();
    if (f) dock.closeInstance(f);
  } });

  reg({ id: 'help.palette', title: tt('chrome.commandPalette'), category: 'Help', icon: 'command', keys: ['Mod+K'], allowInInput: true, run: () => openPalette(app) });
  reg({ id: 'help.shortcuts', title: tt('chrome.keyboardShortcuts'), category: 'Help', icon: 'keyboard', keys: ['Mod+/'], run: () => openKeymapDialog(app) });
  // Contributor-only GPU test harness (development server only; not part of production builds).
  if (import.meta.env.DEV) {
    reg({ id: 'help.selftest', title: tt('chrome.runSelfTestGpuKnownAnswer'), category: 'Help', icon: 'bug', run: () => {
      location.hash = '#selftest';
      location.reload();
    } });
  }
  reg({ id: 'help.about', title: tt('chrome.aboutKekenikVfx'), category: 'Help', icon: 'info', run: () => openAbout(app) });
  reg({ id: 'help.console', title: tt('chrome.openConsoleDiagnostics'), category: 'Help', icon: 'panel-console', run: () => void dock.openPanel('console') });
  app.openPalette = () => openPalette(app);
  app.openKeymapDialog = () => openKeymapDialog(app);
}

/* ================================================================================ menus */
function item(app: AppServices, id: string, label?: string): MenuItem {
  const c = app.commands.get(id);
  return { label: label ?? c?.title ?? id, icon: c?.icon, shortcut: app.commands.shortcutOf(id), disabled: !app.commands.isEnabled(id), action: () => void app.commands.execute(id) };
}

export function buildMenus(app: AppServices): Record<string, () => MenuItem[]> {
  const sep: MenuItem = { separator: true };
  return {
    File: () => [item(app, 'file.new'), item(app, 'file.open'), item(app, 'file.demo'), item(app, 'home.open', t('menu.homeSamples')), sep, item(app, 'file.save'), item(app, 'file.saveAs'), sep, item(app, 'file.import'), { label: tt('chrome.export'), icon: 'panel-export', action: () => void app.dock.openPanel('export') }, ...(import.meta.env.DEV ? [sep, item(app, 'help.selftest')] : [])],
    Edit: () => [
      { ...item(app, 'edit.undo'), label: t('menu.undo') + (app.project.editor.stack.undoLabel ? ` “${app.project.editor.stack.undoLabel}”` : '') },
      { ...item(app, 'edit.redo'), label: t('menu.redo') + (app.project.editor.stack.redoLabel ? ` “${app.project.editor.stack.redoLabel}”` : '') },
      sep, item(app, 'edit.duplicate'), item(app, 'edit.delete'), item(app, 'edit.bypass'), sep, item(app, 'subgraph.make'), item(app, 'subgraph.interface'), item(app, 'preset.save'), sep, item(app, 'edit.selectAll'), item(app, 'edit.deselect'), sep, item(app, 'help.shortcuts'),
    ],
    View: () => [
      item(app, 'view.uiScaleUp'), item(app, 'view.uiScaleDown'), item(app, 'view.uiScaleReset'),
      { label: t('menu.uiScaleValue', { n: Math.round(app.settings.get('uiScale') * 100) }), disabled: true },
      {
        label: t('settings.theme'),
        submenu: () =>
          (['dark', 'light', 'system'] as const).map((m) => ({
            label: t(`settings.theme.${m}`),
            checked: app.settings.get('theme') === m,
            action: () => (app.settings.set('theme', m), app.settings.applyAppearance()),
          })),
      },
      {
        label: t('settings.density'),
        submenu: () =>
          (['compact', 'comfortable'] as const).map((m) => ({
            label: t(`settings.density.${m}`),
            checked: app.settings.get('density') === m,
            action: () => (app.settings.set('density', m), app.settings.applyAppearance()),
          })),
      },
      {
        label: t('settings.language'),
        submenu: () => availableLocales().filter((id) => id !== 'pseudo').map((id) => ({ label: LANG_NAMES[id] ?? id, checked: getLocale() === id, action: () => (setLocale(id), app.settings.set('language', id)) })),
      },
      sep, item(app, 'view.fullscreen'), item(app, 'view.perfHud'), item(app, 'perf.freeMemory'), item(app, 'settings.open'), sep,
      { label: t('settings.autosave'), checked: app.settings.get('autosave'), keepOpen: false, action: () => (app.settings.set('autosave', !app.settings.get('autosave')), (app.project.autosaveEnabled = app.settings.get('autosave'))) },
      { label: tt('chrome.viewportsFollowSelection'), checked: app.active.follow, action: () => app.active.setFollow(!app.active.follow) },
    ],
    Window: () => [
      { header: t('menu.panels') },
      ...listPanels().map((p) => ({ label: p.title, icon: p.icon, checked: app.dock.isOpen(p.id), keepOpen: false, action: () => app.dock.togglePanel(p.id) })),
      sep,
      { header: t('menu.workspaces') },
      ...app.workspaces.list().map((w) => ({ label: tr(`workspace.${w.name}`, w.name), checked: app.workspaces.current === w.name, action: () => app.workspaces.apply(w.name), shortcut: w.builtin ? app.commands.shortcutOf(`workspace.${w.name}`) : '' })),
      sep, item(app, 'window.saveWorkspace'), item(app, 'window.deleteWorkspace'), item(app, 'window.resetLayout'),
    ],
    Help: () => [item(app, 'help.palette'), item(app, 'help.shortcuts'), item(app, 'help.console'), sep, item(app, 'help.about')],
  };
}

/* ================================================================================ menu bar + toolbar + status bar */
export function buildMenuBar(app: AppServices, host: HTMLElement): void {
  const menus = buildMenus(app);
  const title = h('div', { class: 'k-title' });
  const bar = h('div', { class: 'k-menubar', role: 'menubar' }, h('div', { class: 'k-brand' }, h('span', { class: 'k-logo' }, icon('cat-geometry', 18)), 'KEKENIK'));
  let openBtn: HTMLElement | null = null;
  const open = (btn: HTMLElement, name: string): void => {
    openBtn?.classList.remove('open');
    openBtn = btn;
    btn.classList.add('open');
    menuBelow(btn, menus[name], { minWidth: 200, onClose: () => btn.classList.remove('open') });
  };
  for (const name of Object.keys(menus)) {
    const b = h('button', { class: 'k-menu-btn', role: 'menuitem', 'aria-haspopup': 'true' }, tr(`menu.${name}`, name));
    b.addEventListener('click', () => open(b, name));
    b.addEventListener('pointerenter', () => {
      if (document.querySelector('.k-menu') && openBtn && openBtn !== b) open(b, name);
    });
    bar.append(b);
  }
  bar.append(h('span', { class: 'k-sp' }), iconButton('command', t('menu.commandPalette'), () => app.openPalette(), { key: app.commands.shortcutOf('help.palette') }), iconButton('keyboard', t('menu.keyboardShortcuts'), () => app.openKeymapDialog()), iconButton('settings', t('menu.settingsTip'), () => void app.commands.execute('settings.open')), title);
  host.append(bar);
  const upd = (): void => {
    title.replaceChildren(app.project.name, app.project.isDirty ? h('span', { class: 'edited' }, ` (${t('menu.edited')})`) : '');
    document.title = `${app.project.isDirty ? '• ' : ''}${app.project.name} — Kekenik VFX`;
  };
  app.project.onDirty.on(upd);
  upd();
}

export function buildToolbar(app: AppServices, host: HTMLElement): void {
  const bar = h('div', { class: 'k-toolbar' });
  host.append(bar);
  const ed = (): typeof app.project.editor => app.project.editor;
  const sch = app.engine.scheduler;
  const settingCb = (apply: (v: number) => void): { onBegin: () => void; onInput: (v: number) => void; onEnd: () => void } => ({
    onBegin: () => sch.beginInteraction(),
    onInput: apply,
    onEnd: () => (sch.endInteraction(), ed().stack.sealTop()),
  });
  const ws = new Segmented<string>({ options: PRESET_NAMES.map((n) => ({ value: n, label: tr(`workspace.${n}`, n) })), value: app.workspaces.current }, { onInput: (v) => app.workspaces.apply(v) });
  let linked = true;
  const linkBtn = iconButton('link', tt('chrome.keepWidthHeight'), () => ((linked = !linked), linkBtn.classList.toggle('active', linked)), { size: 13, active: true, cls: 'sm' });
  const num = (key: 'width' | 'height'): NumberField => new NumberField({ integer: true, min: 1, max: 16384, softMin: 16, softMax: 4096, unit: 'px', noFill: true, tip: key === 'width' ? t('toolbar.graphWidth') : t('toolbar.graphHeight') }, settingCb((v) => ed().setSettings(linked ? { width: v, height: v } : { [key]: v })));
  const wF = num('width');
  const hF = num('height');
  wF.el.style.maxWidth = hF.el.style.maxWidth = '6.2rem';
  const sizes = [64, 128, 256, 512, 1024, 2048, 4096, 8192];
  const preset = new Dropdown({ options: sizes.map((s) => ({ value: String(s), label: `${s} × ${s}` })), value: '1024', tip: tt('chrome.sizePresets') }, { onInput: (v) => ed().setSettings({ width: +v, height: +v }) });
  preset.el.style.maxWidth = '2.2rem';
  preset.el.style.minWidth = '2.2rem';
  const tiling = new Dropdown({ options: [{ value: 'none', label: tt('chrome.noTiling') }, { value: 'both', label: t('toolbar.tiling') }, { value: 'x', label: tt('chrome.horizontalOnly') }, { value: 'y', label: tt('chrome.verticalOnly') }], value: 'both', tip: tt('chrome.defaultTilingNodesCan') }, { onInput: (v) => ed().setSettings({ tiling: v as GraphSettings['tiling'] }) });
  const filt = new Dropdown({ options: [{ value: 'point', label: t('toolbar.point') }, { value: 'linear', label: t('toolbar.linear') }, { value: 'cubic', label: t('toolbar.cubic') }], value: 'linear', tip: tt('chrome.defaultFiltering') }, { onInput: (v) => ed().setSettings({ filtering: v as GraphSettings['filtering'] }) });
  const bits = new Segmented<'16' | '32'>({ options: [{ value: '16', label: '16', tip: tt('chrome.halfFloatIntermediates') }, { value: '32', label: '32 HQ', tip: tt('chrome.32BitFloatIntermediates2') }], value: '16' }, { onInput: (v) => ed().setSettings({ bitDepth: v === '32' ? 32 : 16 }) });
  const quality = new Dropdown({ options: [{ value: '0.25', label: tt('chrome.drag25') }, { value: '0.5', label: tt('chrome.drag50') }, { value: '0.75', label: tt('chrome.drag75') }, { value: '1', label: tt('chrome.drag100') }], value: String(app.settings.get('previewQuality')), tip: tt('chrome.previewResolutionWhileDraggi') }, { onInput: (v) => (app.settings.set('previewQuality', +v), (sch.interactionScale = +v)) });
  sch.interactionScale = app.settings.get('previewQuality');
  const field = (label: string, ...els: HTMLElement[]): HTMLElement => h('div', { class: 'k-w', style: { gap: '0.333rem' } }, h('span', { class: 'k-tb-label' }, label), ...els);
  const undo = iconButton('undo', t('menu.undo'), () => void app.commands.execute('edit.undo'), { key: app.commands.shortcutOf('edit.undo') });
  const redo = iconButton('redo', t('menu.redo'), () => void app.commands.execute('edit.redo'), { key: app.commands.shortcutOf('edit.redo') });
  bar.append(
    ws.el, h('div', { class: 'k-sep' }),
    iconButton('new', t('toolbar.newProject'), () => void app.commands.execute('file.new'), { key: app.commands.shortcutOf('file.new') }),
    iconButton('open', t('toolbar.openProject'), () => void app.commands.execute('file.open'), { key: app.commands.shortcutOf('file.open') }),
    iconButton('save', t('toolbar.saveProject'), () => void app.commands.execute('file.save'), { key: app.commands.shortcutOf('file.save') }),
    undo, redo, h('div', { class: 'k-sep' }),
    field(t('toolbar.size'), wF.el, linkBtn, hF.el, preset.el),
    h('div', { class: 'k-sep' }), field(t('toolbar.tiling'), tiling.el), field(t('toolbar.filter'), filt.el), field(t('toolbar.bits'), bits.el), h('div', { class: 'k-sep' }), field(t('toolbar.preview'), quality.el),
  );
  const sync = (): void => {
    const s = app.project.graph.settings;
    wF.set(s.width);
    hF.set(s.height);
    tiling.set(s.tiling);
    filt.set(s.filtering);
    bits.set(String(s.bitDepth) as '16');
    preset.set(s.width === s.height && sizes.includes(s.width) ? String(s.width) : '');
    undo.disabled = !ed().stack.canUndo;
    redo.disabled = !ed().stack.canRedo;
  };
  let unsub: (() => void) | null = null;
  const bind = (): void => {
    unsub?.();
    unsub = app.project.graph.events.on((e) => (e.type === 'settings' || e.type === 'reset') && sync());
    sync();
  };
  app.project.onChange.on(bind);
  app.project.onDirty.on(sync);
  app.workspaces.onChange.on(() => ws.set(PRESET_NAMES.includes(app.workspaces.current) ? app.workspaces.current : ws.get()));
  bind();
  void CATEGORIES;
}

export function buildStatusBar(app: AppServices, host: HTMLElement): void {
  const mm = app.engine.mm;
  const fill = h('i');
  const meter = h('div', { class: 'k-meter' }, fill);
  const memTxt = h('span');
  const evalTxt = h('span', {}, tt('chrome.eval'));
  const fpsTxt = h('span', {}, tt('chrome.fps'));
  const taskTxt = h('span', {}, t('status.idle'));
  const spinner = h('span', { class: 'k-spinner', style: { display: 'none' } });
  const hint = h('span', { class: 'k-dim' });
  const mem = h('div', { class: 'k-status-item click', tip: tt('chrome.gpuMemoryUsed'), onclick: () => (void app.dock.openPanel('console'), window.dispatchEvent(new CustomEvent('kk-console-tab', { detail: 'Memory' }))) }, icon('memory', 12), meter, memTxt);
  const caps = app.engine.gpu.caps;
  const resetGpu = h('button', { class: 'k-status-item click k-flat', tip: t('gpu.reset.tip'), onclick: () => void app.engine.gpu.resetDevice().catch(() => undefined) }, t('gpu.reset'));
  const tierChip = h('span', { class: `k-status-item k-dim${caps.tier === 'A' ? '' : ' k-warn-text'}`, tip: formatCapabilityReport(caps) }, t('gpu.tier', { tier: caps.tier + (caps.software ? ' · SW' : caps.compat ? ' · compat' : '') }));
  const langSel = h('select', { class: 'k-flat k-lang', 'aria-label': t('settings.language'), onchange: () => setLocale(langSel.value) }, ...availableLocales().map((id) => h('option', { value: id }, LANG_NAMES[id] ?? id)));
  langSel.value = getLocale();
  onLocaleChange((id) => (langSel.value = id));
  host.append(h('div', { class: 'k-statusbar' }, hint, h('span', { class: 'k-sp' }), mem, tierChip, resetGpu, langSel, h('div', { class: 'k-status-item' }, icon('clock', 12), evalTxt), h('div', { class: 'k-status-item' }, fpsTxt), h('div', { class: 'k-status-item', tip: tt('chrome.activeBackgroundTasks') }, spinner, taskTxt), h('span', { class: 'k-dim' }, `${caps.adapter.vendor || 'GPU'} ${caps.adapter.architecture || ''} · v${versionLabel()}`.trim())));
  const upd = (): void => {
    const s = mm.stats();
    const pct = Math.min(100, (s.usedBytes / s.budgetBytes) * 100);
    fill.style.width = `${pct}%`;
    meter.classList.toggle('warn', pct > 70);
    meter.classList.toggle('bad', pct > 90);
    memTxt.textContent = `${formatBytes(s.usedBytes)} / ${formatBytes(s.budgetBytes)}`;
  };
  setInterval(upd, 500);
  mm.onChange.on(upd);
  upd();
  app.lastEval.subscribe((e) => {
    evalTxt.textContent = e ? `${e.cpuMs.toFixed(1)} ms CPU${e.gpuMs !== undefined ? ` · ${e.gpuMs.toFixed(2)} ms GPU` : ''} · ${e.ran} run / ${e.cached} cached${e.scale < 1 ? ` · ${Math.round(e.scale * 100)}%` : ''}` : 'eval —';
  }, true);
  app.fps.subscribe((f) => (fpsTxt.textContent = tt('chrome.fps2', { f })), true);
  const tasks = (): void => {
    spinner.style.display = app.tasks.count ? '' : 'none';
    taskTxt.textContent = app.tasks.count ? t('status.tasks', { n: app.tasks.count, label: app.tasks.labels()[0] }) : t('status.idle');
  };
  app.tasks.onChange.on(tasks);
  app.hint.subscribe((t) => (hint.textContent = t), true);
  observeSize(host, () => undefined);
}
