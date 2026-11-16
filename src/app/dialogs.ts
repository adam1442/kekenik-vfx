import { versionLabel } from '../shared/version';
import { h } from '../ui/core/dom';
import { placeNewNode } from '../panels/graph-editor/api';
import { showModal } from '../ui/core/overlay';
import { icon } from '../ui/icons';
import { CATEGORIES } from '../engine/graph/categories';
import { eventToChord, formatChord, isModifierOnly } from './keymap';
import type { AppServices } from './app';

import { t as tt, tr } from '../shared/i18n';
interface PaletteItem {
  id: string;
  title: string;
  category: string;
  icon: string;
  shortcut: string;
  run: () => void;
}

const recent: string[] = [];

/** Subsequence fuzzy score (higher = better, 0 = no match). */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - t.length * 0.1;
  const at = t.indexOf(q);
  if (at >= 0) return 60 - at * 0.5;
  let i = 0;
  let score = 0;
  let last = -2;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) {
      score += j === last + 1 ? 3 : 1;
      last = j;
      i++;
    }
  }
  return i === q.length ? score : 0;
}

/** Command palette (Ctrl+K): every command, every panel and "Add node: X" for every registered node. */
export function openPalette(app: AppServices): void {
  const items: PaletteItem[] = [];
  for (const c of app.commands.list()) {
    if (c.hidden || !app.commands.isEnabled(c.id)) continue;
    items.push({ id: c.id, title: c.title, category: c.category, icon: c.icon ?? 'command', shortcut: app.commands.shortcutOf(c.id), run: () => void app.commands.execute(c.id) });
  }
  for (const d of app.engine.registry.list()) {
    items.push({
      id: `node:${d.id}`,
      title: tt('dialogs.addNode', { title: d.title }),
      category: CATEGORIES[d.category].label,
      icon: d.icon,
      shortcut: '',
      run: () => {
        const id = app.project.editor.addNode(d.id, placeNewNode({ x: 40 * app.project.graph.nodes.size, y: 40 }));
        app.selection.set([id]);
      },
    });
  }
  const input = h('input', { type: 'text', placeholder: tt('dialogs.typeACommandPanel'), spellcheck: 'false', 'aria-label': 'Command palette' });
  const list = h('div', { class: 'k-palette-list', role: 'listbox' });
  const back = h('div', { class: 'k-palette-back' }, h('div', { class: 'k-palette' }, input, list));
  let sel = 0;
  let shown: PaletteItem[] = [];
  const close = (): void => {
    back.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const render = (): void => {
    const q = input.value.trim();
    shown = items
      .map((it) => ({ it, s: fuzzy(q, `${it.title} ${it.category}`) + (q ? 0 : recent.includes(it.id) ? 50 - recent.indexOf(it.id) : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.it);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(
      ...shown.map((it, i) => {
        const row = h('div', { class: `k-palette-row${i === sel ? ' sel' : ''}`, role: 'option' }, icon(it.icon, 14), h('span', {}, it.title), h('span', { class: 'cat' }, tr(`menu.${it.category}`, it.category)), it.shortcut ? h('kbd', { class: 'sc' }, it.shortcut) : null);
        row.addEventListener('pointerenter', () => {
          sel = i;
          list.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
          row.classList.add('sel');
        });
        row.addEventListener('click', () => run(it));
        return row;
      }),
    );
    if (!shown.length) list.append(h('div', { class: 'k-palette-row k-dim' }, tt('dialogs.noResults')));
    (list.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  };
  const run = (it: PaletteItem): void => {
    close();
    recent.unshift(it.id);
    recent.splice(8);
    setTimeout(it.run, 0);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[sel]) run(shown[sel]);
    }
  };
  input.addEventListener('input', () => ((sel = 0), render()));
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) close();
  });
  window.addEventListener('keydown', onKey, true);
  document.body.append(back);
  render();
  input.focus();
}

/** Editable keymap dialog: search, click a shortcut to record a new chord, conflicts are flagged, per-command reset. */
export function openKeymapDialog(app: AppServices): void {
  const km = app.keymap;
  const filter = h('input', { type: 'search', placeholder: tt('dialogs.filterCommands'), style: { width: '100%', marginBottom: '0.667rem', padding: '0.417rem 0.667rem', background: 'var(--bg0)', border: '1px solid var(--line2)', borderRadius: '0.25rem' } });
  const table = h('div', { style: { maxHeight: '55vh', overflow: 'auto', minWidth: '40rem' } });
  const warn = h('div', { style: { color: 'var(--warn)', minHeight: '1.4em', marginTop: '0.5rem' } });
  let recording: string | null = null;

  const render = (): void => {
    const q = filter.value.trim().toLowerCase();
    const conflicts = new Set(km.conflicts().map((c) => c.chord));
    const rows = app.commands.list().filter((c) => !c.hidden && (!q || `${c.title} ${c.category}`.toLowerCase().includes(q))).sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    table.replaceChildren(
      ...rows.map((c) => {
        const chords = km.chordsOf(c.id);
        const isRec = recording === c.id;
        const chip = h('button', { class: 'k-btn', style: { minWidth: '9rem', borderColor: isRec ? 'var(--accent)' : chords.some((x) => conflicts.has(x)) ? 'var(--warn)' : '' }, onclick: () => ((recording = isRec ? null : c.id), (app.keyCapture = !!recording), render()) }, isRec ? 'Press keys… (Esc cancels)' : chords.length ? chords.map((x) => formatChord(x)).join('  ·  ') : '— unbound —');
        return h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '7rem 1fr auto auto auto', gap: '0.667rem', alignItems: 'center', padding: '0.25rem 0', borderBottom: '1px solid var(--line)' } },
          h('span', { class: 'k-dim' }, tr(`menu.${c.category}`, c.category)),
          h('span', {}, c.title),
          chip,
          h('button', { class: 'k-ibtn sm', tip: tt('dialogs.clearShortcut'), onclick: () => (app.commands.rebind(c.id, []), render()) }, icon('close', 10)),
          h('button', { class: 'k-ibtn sm', tip: tt('common.resetToDefault'), style: { visibility: km.isCustomized(c.id) ? 'visible' : 'hidden' }, onclick: () => (app.commands.resetBinding(c.id), render()) }, icon('reset', 11)),
        );
      }),
    );
    const cs = km.conflicts();
    warn.textContent = cs.length ? `Conflicts: ${cs.map((c) => `${formatChord(c.chord)} → ${c.commands.join(', ')}`).join(' | ')}` : '';
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') recording = null;
    else if (!isModifierOnly(e)) {
      const chord = eventToChord(e);
      const id = recording;
      const others = km.conflictsWith(id, chord);
      app.commands.rebind(id, [chord]);
      recording = null;
      if (others.length) warn.textContent = `Warning: ${formatChord(chord)} is also bound to ${others.join(', ')}`;
    }
    app.keyCapture = !!recording;
    render();
    if (!recording) setTimeout(() => (app.keyCapture = false), 0);
  };
  window.addEventListener('keydown', onKey, true);
  filter.addEventListener('input', render);
  render();
  void showModal({
    title: tt('dialogs.keyboardShortcuts'),
    body: h('div', {}, filter, table, warn),
    buttons: [
      { label: tt('dialogs.resetAll'), value: 'reset', danger: true },
      { label: 'Close', value: 'close', primary: true },
    ],
    width: '52rem',
  }).then((v) => {
    window.removeEventListener('keydown', onKey, true);
    app.keyCapture = false;
    if (v === 'reset') {
      app.commands.resetAllBindings();
      openKeymapDialog(app);
    }
  });
}

export function openAbout(app: AppServices): void {
  const c = app.engine.gpu.caps;
  void showModal({
    title: `About Kekenik VFX ${versionLabel()}`,
    body: h('div', {}, h('p', {}, tt('dialogs.proceduralNodeBasedRealTimeV')), h('p', { class: 'k-dim' }, `Adapter: ${[c.adapter.vendor, c.adapter.architecture, c.adapter.description].filter(Boolean).join(' ') || 'unknown'}`)),
  });
}
