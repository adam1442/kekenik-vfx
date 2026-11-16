import { serializeProject, projectToJson } from '../engine/io/project';
import { loadProjectRobust } from '../engine/io/robust-load';
import { CATEGORIES } from '../engine/graph/categories';
import { SAMPLES, buildSample, type SampleDef } from '../samples';
import { SAMPLE_INDEX, loadGraphText, loadMeta, prepareSample } from '../samples/catalog';
import { searchText, textsOf } from '../samples/localize';
import { SAMPLE_CATEGORIES, type IndexEntry, type SampleMeta } from '../samples/types';
import { viewHints } from './view-hints';
import { h } from '../ui/core/dom';
import { toast } from '../ui/core/overlay';
import { icon } from '../ui/icons';
import '../ui/theme/home.css';
import type { AppServices } from './app';
import { HOME_STARTUP_KEY, cachedThumb, clearCachedThumbs, renderThumb, type LibraryServices } from './library';

import { displayNumber, getLocale, isRtl, onLocaleChange, t as tt, tr, trNodeLabel, trTerm } from '../shared/i18n';
/**
 * START SCREEN: compact left column (New / Open / Recent), a searchable sample gallery with
 * category chips, sorting and keyboard navigation, and a detail pane for the selected sample.
 *
 * Samples are DATA: the file-based ones (`samples/<id>/`) carry their names, descriptions, tags and comment-frame texts in English +
 * Persian; the classic code-built ones are listed too. Thumbnails are generated lazily (visible cards only, one at a time, while
 * the browser is idle, cancelled on close), cached in IndexedDB under a content hash, and replaced by a gradient + category icon
 * until they exist (or forever when there is no GPU). Nothing is evaluated by merely showing the Home screen.
 */
const TIPS = ['home.tip1', 'home.tip2', 'home.tip3', 'home.tip4', 'home.tip5', 'home.tip6'] as const;
const CAT_ICON: Record<string, string> = { all: 'panel-gallery', fire: 'cat-particle', magic: 'star', energy: 'glow', weapons: 'edge', water: 'warp', lightning: 'spline', environment: 'texture', tiling: 'tile3', flipbooks: 'sheet', meshes: 'cat-geometry', simulation: 'cat-islands', beginner: 'help' };
const FEATURE_ICON: Record<string, string> = { loops: 'loop', tileable: 'tile3', mesh: 'cube', simulation: 'cat-particle', flipbook: 'sheet', exportReady: 'cat-export' };
const FEATURES = ['loops', 'tileable', 'mesh', 'simulation', 'flipbook', 'exportReady'] as const;
const DIFF_RANK: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const THUMB_PX = 192;
const THUMB_VERSION = 't1';
const MAX_NODE_CHIPS = 14;

type Features = IndexEntry['features'];
/** One gallery entry: either a file-based sample (index + meta) or a classic code-built one. */
interface Item {
  id: string;
  kind: 'file' | 'code';
  entry?: IndexEntry;
  meta?: SampleMeta;
  def?: SampleDef;
  categories: string[];
  tags: string[];
  difficulty: string;
  features: Features;
  nodes: string[];
  memoryMB?: number;
  resolution: [number, number];
  created: string;
  thumbKey: string;
}

const LEGACY_CATS: [RegExp, string][] = [
  [/fire|flame|torch|smoke|explosion|fireball|burn/, 'fire'], [/magic|portal|aura|orb|teleport|sparkle|rune|snitch|flower/, 'magic'], [/energy|beam|shield|plasma|neon/, 'energy'],
  [/slash|sword|impact|muzzle|shockwave|hit|dust/, 'weapons'], [/water|waterfall|splash|ripple|wind|tornado|vortex/, 'water'], [/lightning|arc|electric/, 'lightning'],
  [/tile|tileable|ice|frost|lava|ground|texture/, 'tiling'], [/flipbook/, 'flipbooks'], [/mesh|vat|ribbon/, 'meshes'],
];
function legacyItem(def: SampleDef): Item {
  const tags = def.tags;
  const text = `${def.id} ${tags.join(' ')}`.toLowerCase();
  const categories = new Set(LEGACY_CATS.filter(([re]) => re.test(text)).map(([, c]) => c));
  if (!categories.size) categories.add('environment');
  const s = def.settings ?? {};
  return {
    id: def.id, kind: 'code', def, categories: [...categories], tags, difficulty: 'intermediate',
    features: { loops: tags.includes('loop') || tags.includes('animated'), tileable: (s.tiling ?? 'both') !== 'none', mesh: !!def.view?.mesh, simulation: /fluid|simulation/.test(text), flipbook: tags.includes('flipbook'), exportReady: true },
    nodes: [], resolution: [s.width ?? 1024, s.height ?? 1024], created: '2025-01-01', thumbKey: `sample:${def.id}:v2`,
  };
}

let open: HTMLElement | null = null;

export function openHome(app: AppServices, lib: LibraryServices): void {
  if (open) {
    open.remove();
    open = null;
    return;
  }
  const { project } = app;
  const root = h('div', { class: 'k-home', role: 'dialog', 'aria-label': tt('home.samples') });
  open = root;
  let closed = false;
  const offLocale = onLocaleChange(() => {
    renderChips();
    renderGrid();
    renderDetail();
    renderStatic();
  });
  const close = (): void => {
    closed = true;
    queue.length = 0;
    root.remove();
    open = null;
    offLocale();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === '/' && document.activeElement !== search && !(document.activeElement instanceof HTMLInputElement)) {
      e.preventDefault();
      search.focus();
    }
  };
  window.addEventListener('keydown', onKey, true);

  /* ------------------------------------------------------------------------------------------ data */
  const registry = app.engine.registry;
  const fileItems: Item[] = SAMPLE_INDEX.samples.map((e) => ({
    id: e.id, kind: 'file', entry: e, categories: e.category, tags: e.tags, difficulty: e.difficulty, features: e.features, nodes: e.nodesUsed, memoryMB: e.memoryMB, resolution: e.resolution, created: e.created,
    thumbKey: `sample:${e.id}:${e.hash}:${THUMB_VERSION}`,
  }));
  const codeItems = SAMPLES.filter((s) => s.kind === 'sample').map(legacyItem);
  const items = [...fileItems, ...codeItems];
  const templates = SAMPLES.filter((s) => s.kind === 'template');
  const byId = new Map(items.map((i) => [i.id, i]));
  void Promise.all(fileItems.map(async (i) => (i.meta = await loadMeta(i.id)))).then(() => {
    if (!closed) {
      renderGrid();
      renderDetail();
    }
  });
  // classic samples: which nodes they use is computed in idle time (cheap graph build, no GPU), so node search finds them too
  const pendingNodes = codeItems.slice();
  const fillNodes = (): void => {
    const it = pendingNodes.shift();
    if (!it || closed) return;
    try {
      const { graph } = buildSample(registry, it.def!);
      it.nodes = [...new Set([...graph.nodes.values()].map((n) => n.type))].sort();
      it.memoryMB = undefined;
    } catch {
      /* a broken classic sample is reported by its own test */
    }
    setTimeout(fillNodes, 0);
  };
  setTimeout(fillNodes, 400);

  const nameOf = (i: Item): string => (i.meta ? textsOf(i.meta, getLocale()).name : i.def ? trTerm(i.def.name) : i.id);
  const descOf = (i: Item): string => (i.meta ? textsOf(i.meta, getLocale()).description : (i.def?.description ?? ''));
  const tagText = (i: Item, tag: string): string => (i.meta ? (textsOf(i.meta, getLocale()).tags[tag] ?? tag) : trTerm(tag));
  const hay = (i: Item): string => {
    const titles = i.nodes.map((n) => registry.get(n)?.title ?? '');
    const base = i.meta ? searchText(i.meta, [...i.nodes, ...titles]) : [i.id, trTerm(i.def?.name ?? ''), i.def?.name ?? '', ...i.tags, ...i.nodes, ...titles].join(' ').toLowerCase();
    return `${base} ${nameOf(i).toLowerCase()} ${descOf(i).toLowerCase()}`;
  };

  /* ------------------------------------------------------------------------------------------ thumbnails */
  const thumbUrls = new Map<string, string>();
  const noGpu = typeof navigator === 'undefined' || !('gpu' in navigator);
  const queue: Item[] = [];
  const queued = new Set<string>();
  let pumping = false;
  const idle = (): Promise<void> => new Promise((res) => ('requestIdleCallback' in window ? window.requestIdleCallback(() => res(), { timeout: 600 }) : setTimeout(res, 40)));
  const makeThumb = async (it: Item): Promise<string | null> => {
    if (noGpu) return null;
    if (it.kind === 'file') {
      const meta = it.meta ?? (await loadMeta(it.id));
      const { graph } = loadProjectRobust(registry, await loadGraphText(it.id));
      return renderThumb(app, graph, { nodeId: meta.thumb.node, pinId: meta.thumb.pin ?? 'output' }, THUMB_PX, (meta.thumb.frame ?? 0) / graph.settings.fps);
    }
    const { graph, marks } = buildSample(registry, it.def!);
    const m = marks.get('main');
    return m ? renderThumb(app, graph, { nodeId: m.node, pinId: m.pin }, THUMB_PX, (it.def!.thumbFrame ?? 0) / graph.settings.fps) : null;
  };
  const setThumb = (id: string, url: string): void => {
    thumbUrls.set(id, url);
    for (const host of root.querySelectorAll<HTMLElement>(`[data-thumb="${CSS.escape(id)}"]`)) host.replaceChildren(h('img', { src: url, alt: '' }));
  };
  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    while (!closed && queue.length) {
      const it = queue.shift()!;
      await idle();
      if (closed) break;
      try {
        const url = await cachedThumb(lib, it.thumbKey, () => makeThumb(it));
        if (url && !closed) setThumb(it.id, url);
      } catch {
        /* a failing thumbnail keeps its placeholder */
      }
    }
    pumping = false;
  };
  const want = (it: Item): void => {
    if (thumbUrls.has(it.id) || queued.has(it.id)) return;
    queued.add(it.id);
    queue.push(it);
    void pump();
  };
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (observer?.unobserve(e.target), want(byId.get((e.target as HTMLElement).dataset.id ?? '')!))), { root: null, rootMargin: '120px' }) : null;

  const placeholder = (it: Item): HTMLElement => h('div', { class: 'ph', style: { ['--h' as never]: String([...it.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)) } as never }, icon(CAT_ICON[it.categories[0]] ?? 'cat-grayscale', 28));
  const thumbHost = (it: Item): HTMLElement => {
    const url = thumbUrls.get(it.id);
    return h('div', { class: 'thumbhost', 'data-thumb': it.id }, url ? h('img', { src: url, alt: '' }) : placeholder(it));
  };

  /* ------------------------------------------------------------------------------------------ state + filtering */
  let selected = fileItems[0]?.id ?? items[0]?.id ?? '';
  let category = 'all';
  let sort: 'name' | 'newest' | 'difficulty' = 'name';
  let query = '';
  const visible = (): Item[] => {
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const list = items.filter((i) => (category === 'all' || i.categories.includes(category) || (category === 'beginner' && i.difficulty === 'beginner')) && words.every((w) => hay(i).includes(w)));
    const cmp: Record<typeof sort, (a: Item, b: Item) => number> = {
      name: (a, b) => nameOf(a).localeCompare(nameOf(b), getLocale()),
      newest: (a, b) => b.created.localeCompare(a.created) || nameOf(a).localeCompare(nameOf(b), getLocale()),
      difficulty: (a, b) => DIFF_RANK[a.difficulty] - DIFF_RANK[b.difficulty] || nameOf(a).localeCompare(nameOf(b), getLocale()),
    };
    return list.sort(cmp[sort]);
  };

  /* ------------------------------------------------------------------------------------------ opening */
  const loadClassic = async (def: SampleDef, copy: boolean): Promise<void> => {
    if (!(await project.confirmDiscard())) return;
    const { graph, marks } = buildSample(registry, def);
    close();
    const tpl = def.kind === 'template';
    const base = tpl ? 'Untitled' : trTerm(def.name);
    const name = !tpl && copy ? `${base} (${tt('home.copySuffix')})` : base;
    project.loadText(projectToJson(serializeProject(graph, { name })), { name, dirty: !tpl && copy });
    app.engine.subgraphs.load([]);
    const first = def.preview ?? [...graph.nodes.keys()][0];
    if (first) app.selection.set([[...graph.nodes.keys()].find((id) => graph.nodes.get(id)?.type.startsWith('export.')) ?? first]);
    if (def.view) {
      const id = (m?: string): string | undefined => (m ? marks.get(m)?.node : undefined);
      viewHints.emit({ mesh: id(def.view.mesh), material: id(def.view.material), mat: def.view.mat, display: def.view.display });
    }
    toast(tpl ? tt('home.openedSample', { name: trTerm(def.name) }) : tt('home.openedSample', { name: base }), { type: 'ok' });
  };
  const openItem = async (it: Item, mode: 'copy' | 'orig' | 'tour'): Promise<void> => {
    if (it.kind === 'code') return loadClassic(it.def!, mode !== 'orig');
    if (!(await project.confirmDiscard())) return;
    try {
      const name = nameOf(it);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || 'currentColor';
      const { text, meta } = await prepareSample(it.id, { lang: getLocale(), name: mode === 'orig' ? name : `${name} (${tt('home.copySuffix')})`, tour: mode === 'tour', digits: (n) => displayNumber(n), tourColor: accent });
      close();
      project.loadText(text, { name: mode === 'orig' ? name : `${name} (${tt('home.copySuffix')})`, dirty: mode !== 'orig' });
      app.engine.subgraphs.load([]);
      app.selection.set([meta.preview]);
      if (meta.view) viewHints.emit({ mesh: meta.view.mesh, material: meta.view.material, mat: meta.view.mat as never, display: meta.view.display });
      toast(tt(mode === 'tour' ? 'home.openedTour' : 'home.openedSample', { name }), { type: 'ok' });
    } catch (e) {
      toast((e as Error).message, { type: 'error', title: tt('common.cannotOpenProject') });
    }
  };

  /* ------------------------------------------------------------------------------------------ gallery */
  const search = h('input', { class: 'k-home-search', type: 'search', placeholder: tt('home.search'), 'aria-label': tt('home.search'), autocomplete: 'off' }) as HTMLInputElement;
  search.addEventListener('input', () => {
    query = search.value;
    renderGrid();
  });
  const sortSel = h('select', { class: 'k-home-sort', 'aria-label': tt('home.sortLabel') }) as HTMLSelectElement;
  sortSel.addEventListener('change', () => {
    sort = sortSel.value as typeof sort;
    renderGrid();
  });
  const chips = h('div', { class: 'chips', role: 'tablist' });
  const grid = h('div', { class: 'grid', role: 'listbox', 'aria-label': tt('home.samples') });
  const count = h('div', { class: 'count k-dim' });
  const detail = h('aside', { class: 'detail', 'aria-live': 'polite' });

  const renderStatic = (): void => {
    search.placeholder = tt('home.search');
    sortSel.replaceChildren(...(['name', 'newest', 'difficulty'] as const).map((s) => h('option', { value: s, selected: s === sort }, tr(`home.sort.${s}`, s))));
  };
  const renderChips = (): void => {
    chips.replaceChildren(
      ...['all', ...SAMPLE_CATEGORIES].map((c) =>
        h('button', { class: `chip${c === category ? ' on' : ''}`, role: 'tab', 'aria-selected': c === category ? 'true' : 'false', onclick: () => { category = c; renderChips(); renderGrid(); } }, icon(CAT_ICON[c] ?? 'tag', 12), tr(`home.cat.${c}`, c)),
      ),
    );
  };
  const diffDots = (d: string): HTMLElement => h('span', { class: `diff d${DIFF_RANK[d] ?? 1}`, 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const featureBadges = (f: Features, only?: number): HTMLElement =>
    h('span', { class: 'feats' }, ...FEATURES.filter((k) => f[k]).slice(0, only ?? 99).map((k) => h('span', { class: 'feat', tip: tr(`home.feature.${k}`, k) }, icon(FEATURE_ICON[k], 11))));

  const select = (id: string, focus = false): void => {
    selected = id;
    for (const c of grid.querySelectorAll<HTMLElement>('.k-home-card')) {
      const on = c.dataset.id === id;
      c.classList.toggle('sel', on);
      c.setAttribute('aria-selected', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
      if (on && focus) c.focus();
    }
    renderDetail();
  };
  const renderGrid = (): void => {
    const list = visible();
    if (!list.some((i) => i.id === selected) && list[0]) selected = list[0].id;
    count.textContent = tt('home.sampleCount', { n: displayNumber(list.length) });
    grid.replaceChildren(
      ...(list.length
        ? list.map((it) => {
            const card = h(
              'button',
              { class: `k-home-card${it.id === selected ? ' sel' : ''}`, role: 'option', 'aria-selected': it.id === selected ? 'true' : 'false', 'data-id': it.id, tabindex: it.id === selected ? '0' : '-1', onclick: () => select(it.id), ondblclick: () => void openItem(it, 'copy') },
              h('div', { class: 'thumb' }, thumbHost(it), h('span', { class: 'tag' }, tr(`home.cat.${it.categories[0]}`, it.categories[0]))),
              h('div', { class: 'meta' }, h('div', { class: 'title', dir: 'auto' }, nameOf(it)), h('div', { class: 'sub' }, diffDots(it.difficulty), featureBadges(it.features, 4))),
            );
            observer?.observe(card);
            if (!observer) want(it);
            return card;
          })
        : [h('div', { class: 'empty' }, tt('home.noResults'))]),
    );
    if (!grid.querySelector('.k-home-card.sel')) grid.querySelector<HTMLElement>('.k-home-card')?.setAttribute('tabindex', '0');
  };
  grid.addEventListener('keydown', (e) => {
    const cards = [...grid.querySelectorAll<HTMLElement>('.k-home-card')];
    const cur = cards.findIndex((c) => c.dataset.id === selected);
    if (!cards.length || cur < 0) return;
    const rtl = isRtl() ? -1 : 1;
    const cols = Math.max(1, cards.filter((c) => c.offsetTop === cards[0].offsetTop).length);
    let next: number;
    if (e.key === 'ArrowRight') next = cur + rtl;
    else if (e.key === 'ArrowLeft') next = cur - rtl;
    else if (e.key === 'ArrowDown') next = cur + cols;
    else if (e.key === 'ArrowUp') next = cur - cols;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = cards.length - 1;
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = byId.get(selected);
      if (it) void openItem(it, 'copy');
      return;
    } else return;
    e.preventDefault();
    next = Math.max(0, Math.min(cards.length - 1, next));
    select(cards[next].dataset.id!, true);
  });

  /* ------------------------------------------------------------------------------------------ detail pane */
  const stat = (label: string, value: string): HTMLElement => h('div', { class: 'stat' }, h('span', { class: 'k-dim' }, label), h('b', {}, value));
  function renderDetail(): void {
    const it = byId.get(selected);
    if (!it) return void detail.replaceChildren(h('div', { class: 'empty' }, tt('home.detailEmpty')));
    const nodes = it.nodes.map((n) => trNodeLabel(n, registry.get(n)?.title ?? n));
    const adapt = it.meta ? textsOf(it.meta, getLocale()).adapt : '';
    const hasTour = (it.meta?.tour?.length ?? 0) > 0;
    const name = nameOf(it);
    detail.replaceChildren(h('div', { class: 'dbody' },
      h('div', { class: 'dthumb' }, thumbHost(it)),
      h('h3', { dir: 'auto' }, name),
      h('div', { class: 'badges' }, h('span', { class: 'badge' }, diffDots(it.difficulty), tr(`home.difficulty.${it.difficulty}`, it.difficulty)), ...(it.kind === 'code' ? [h('span', { class: 'badge' }, tt('home.legacy'))] : [])),
      h('p', { class: 'desc', dir: 'auto' }, descOf(it)),
      h('div', { class: 'actions' },
        h('button', { class: 'k-btn primary', tip: tt('home.copyTip', { name }), onclick: () => void openItem(it, 'copy') }, icon('open', 13), tt('home.openAsCopy')),
        h('button', { class: 'k-btn', tip: tt('home.openTip'), onclick: () => void openItem(it, 'orig') }, tt('home.open')),
        hasTour ? h('button', { class: 'k-btn', tip: tt('home.tourTip'), onclick: () => void openItem(it, 'tour') }, icon('help', 13), tt('home.tour')) : null,
      ),
      h('div', { class: 'stats' }, stat(tt('home.resolution'), `${it.resolution[0]}×${it.resolution[1]}`), stat(tt('home.memory'), it.memoryMB !== undefined ? `~${displayNumber(Math.round(it.memoryMB))} MB` : '—'), stat(tt('home.nodesUsed'), it.entry ? tt('home.nodes', { n: displayNumber(it.entry.nodeCount) }) : '—')),
      h('h4', {}, tt('home.features')),
      h('div', { class: 'featlist' }, ...FEATURES.filter((k) => it.features[k]).map((k) => h('span', { class: 'badge' }, icon(FEATURE_ICON[k], 11), tr(`home.feature.${k}`, k)))),
      it.tags.length ? h('div', { class: 'taglist' }, ...it.tags.map((tg) => h('button', { class: 'tagchip', onclick: () => { search.value = tagText(it, tg); query = search.value; category = 'all'; renderChips(); renderGrid(); } }, `#${tagText(it, tg)}`))) : null,
      adapt ? h('h4', {}, tt('home.howToAdapt')) : null,
      adapt ? h('p', { class: 'desc', dir: 'auto' }, adapt) : null,
      nodes.length ? h('h4', {}, tt('home.nodesUsed')) : null,
      nodes.length ? h('div', { class: 'taglist' }, ...nodes.slice(0, MAX_NODE_CHIPS).map((n) => h('span', { class: 'nodechip' }, n)), nodes.length > MAX_NODE_CHIPS ? h('span', { class: 'nodechip dim' }, tt('home.moreNodes', { n: displayNumber(nodes.length - MAX_NODE_CHIPS) })) : null) : null,
      it.features.simulation ? h('p', { class: 'k-dim note' }, tt('home.simQuality')) : null,
    ));
  }

  /* ------------------------------------------------------------------------------------------ left column */
  const recentList = h('div', { class: 'recent' });
  const versionList = h('div', { class: 'list' });
  void lib.recents.all().then((all) => {
    const rows = all.map((r) => r.value).sort((a, b) => b.modified - a.modified);
    if (!rows.length) recentList.append(h('div', { class: 'empty' }, tt('home.noRecentProjectsYet')));
    for (const r of rows) {
      recentList.append(
        h('button', { class: 'recent-row', tip: new Date(r.modified).toLocaleString(), onclick: async () => {
          if (!(await project.confirmDiscard())) return;
          close();
          try {
            project.loadText(r.json, { name: r.name });
          } catch (e) {
            toast((e as Error).message, { type: 'error', title: tt('common.cannotOpenProject') });
          }
        } }, r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('span', { class: 'ph mini' }, icon('file', 12)), h('span', { class: 'rn', dir: 'auto' }, r.name)),
      );
    }
  });
  void lib.versions.all().then((all) => {
    const rows = all.sort((a, b) => b.value.modified - a.value.modified);
    if (!rows.length) versionList.append(h('div', { class: 'empty' }, tt('home.autosavedVersionsAppearHere')));
    for (const v of rows) {
      versionList.append(
        h('div', { class: 'row' }, h('span', { dir: 'auto' }, `${v.value.name} — ${new Date(v.value.modified).toLocaleString()}`), h('button', { class: 'k-btn sm', onclick: async () => {
          if (!(await project.confirmDiscard())) return;
          close();
          project.loadText(v.value.json, { name: `${v.value.name} (restored)`, dirty: true });
          toast(tt('home.versionRestoredSaveIt'), { type: 'ok' });
        } }, tt('home.restore'))),
      );
    }
  });
  const startup = h('input', { type: 'checkbox' }) as HTMLInputElement;
  startup.checked = localStorage.getItem(HOME_STARTUP_KEY) !== '0';
  startup.addEventListener('change', () => localStorage.setItem(HOME_STARTUP_KEY, startup.checked ? '1' : '0'));
  const nav = (label: string, ic: string, on: () => void, primary = false): HTMLElement => h('button', { class: `k-home-nav${primary ? ' primary' : ''}`, onclick: on }, icon(ic, 14), label);
  const regen = h('button', { class: 'k-home-nav small', tip: noGpu ? tt('home.thumbsNoGpu') : undefined, disabled: noGpu, onclick: async () => {
    toast(tt('home.thumbsRegenerating'), { type: 'info' });
    await clearCachedThumbs(lib, 'sample:');
    thumbUrls.clear();
    queued.clear();
    queue.length = 0;
    renderGrid();
    renderDetail();
  } }, icon('refresh', 13), tt('home.regenThumbs'));
  const tip = h('div', { class: 'tip k-dim' }, tt(TIPS[Math.floor(Math.random() * TIPS.length)]));

  root.append(
    h(
      'aside',
      { class: 'side' },
      h('div', { class: 'brand' }, icon('panel-graph', 18), 'Kekenik VFX'),
      nav(tt('chrome.newProject'), 'new', () => void project.newProject().then((ok) => ok && close()), true),
      nav(tt('chrome.openProject'), 'open', () => void project.open().then(close)),
      nav(tt('home.returnToProject'), 'chevron-left', close),
      h('h2', {}, tt('home.newFromTemplate')),
      h('div', { class: 'tpls' }, ...templates.map((tp) => h('button', { class: 'tpl', tip: tp.description, onclick: () => void loadClassic(tp, false) }, trTerm(tp.name)))),
      h('h2', {}, tt('home.recentShort')),
      recentList,
      h('details', { class: 'versions' }, h('summary', {}, tt('home.autosave')), versionList),
      h('div', { class: 'sp' }),
      tip,
      nav(tt('home.presetsAssets'), 'panel-assets', () => (close(), void app.dock.openPanel('assets'))),
      nav(tt('home.importLibrary'), 'cat-import', () => void app.commands.execute('preset.import')),
      regen,
      h('label', { class: 'chk' }, startup, tt('home.showAtStartup')),
      h('div', { class: 'k-dim ver' }, `${Object.keys(CATEGORIES).length} · ${registry.list().length}`),
    ),
    h('main', { class: 'main' }, h('div', { class: 'toolbar' }, h('div', { class: 'searchbox' }, icon('search', 14), search), h('label', { class: 'sortbox k-dim' }, tt('home.sortLabel'), sortSel), count), chips, grid),
    detail,
  );
  renderStatic();
  renderChips();
  renderGrid();
  renderDetail();
  document.body.append(root);
  search.focus({ preventScroll: true });
}
