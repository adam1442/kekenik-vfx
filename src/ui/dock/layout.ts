/**
 * Docking layout model: PURE data + pure operations (no DOM) so serialization and every docking operation are
 * unit-testable (tests/layout.test.ts, selftest). The DockManager renders this model.
 *
 *  - DockNode tree: `split` (row|col, sizes = fractions summing to 1) and `tabs` (a tab group of panel INSTANCE ids).
 *  - Floating windows each own one tab group.
 *  - Instances map instanceId -> {panelId, state}. Several instances of one panel are allowed (viewports).
 *  - All mutating functions mutate `layout` in place and call `normalize()` (collapses empty groups / 1-child splits).
 */
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom';
export type SplitDir = 'row' | 'col';

export interface TabsNode {
  type: 'tabs';
  id: string;
  tabs: string[];
  active: string | null;
}
export interface SplitNode {
  type: 'split';
  id: string;
  dir: SplitDir;
  children: DockNode[];
  sizes: number[];
}
export type DockNode = TabsNode | SplitNode;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FloatWindow extends Rect {
  id: string;
  group: TabsNode;
  minimized: boolean;
  maximized: boolean;
  z: number;
  /** Rect before maximize. */
  restore?: Rect;
  /** Where "dock back" should go: a group id that still exists, or a fallback zone at the root. */
  dockHint?: { groupId?: string; zone?: DropZone };
}
export interface InstanceInfo {
  panelId: string;
  state?: unknown;
}
export interface LayoutState {
  version: 1;
  root: DockNode | null;
  floating: FloatWindow[];
  instances: Record<string, InstanceInfo>;
  zCounter: number;
}

let idSeq = 0;
export const newNodeId = (prefix: string): string => `${prefix}${(++idSeq).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export const emptyLayout = (): LayoutState => ({ version: 1, root: null, floating: [], instances: {}, zCounter: 10 });
export const cloneLayout = (l: LayoutState): LayoutState => JSON.parse(JSON.stringify(l)) as LayoutState;

/* ---------------------------------------------------------------- queries */

export function* allGroups(l: LayoutState): Generator<{ group: TabsNode; float?: FloatWindow }> {
  function* walk(n: DockNode | null): Generator<TabsNode> {
    if (!n) return;
    if (n.type === 'tabs') yield n;
    else for (const c of n.children) yield* walk(c);
  }
  for (const g of walk(l.root)) yield { group: g };
  for (const f of l.floating) yield { group: f.group, float: f };
}

export function findGroup(l: LayoutState, groupId: string): { group: TabsNode; float?: FloatWindow } | null {
  for (const g of allGroups(l)) if (g.group.id === groupId) return g;
  return null;
}
export function findGroupOf(l: LayoutState, instId: string): { group: TabsNode; float?: FloatWindow } | null {
  for (const g of allGroups(l)) if (g.group.tabs.includes(instId)) return g;
  return null;
}
export function findParent(l: LayoutState, nodeId: string): SplitNode | null {
  let found: SplitNode | null = null;
  const walk = (n: DockNode): void => {
    if (n.type !== 'split') return;
    if (n.children.some((c) => c.id === nodeId)) found = n;
    n.children.forEach(walk);
  };
  if (l.root) walk(l.root);
  return found;
}
export const isDocked = (l: LayoutState, instId: string): boolean => {
  const g = findGroupOf(l, instId);
  return !!g && !g.float;
};
export const instancesOfPanel = (l: LayoutState, panelId: string): string[] => Object.keys(l.instances).filter((k) => l.instances[k].panelId === panelId);

/** Next free instance id for a panel: `panelId`, then `panelId#2`, ... */
export function nextInstanceId(l: LayoutState, panelId: string): string {
  if (!l.instances[panelId]) return panelId;
  for (let i = 2; ; i++) if (!l.instances[`${panelId}#${i}`]) return `${panelId}#${i}`;
}

/* ---------------------------------------------------------------- normalization */

const EPS = 1e-6;
function normSizes(sizes: number[], n: number): number[] {
  const s = sizes.length === n && sizes.every((v) => Number.isFinite(v) && v > 0) ? sizes.slice() : Array<number>(n).fill(1);
  const sum = s.reduce((a, b) => a + b, 0) || 1;
  return s.map((v) => v / sum);
}

function normNode(n: DockNode): DockNode | null {
  if (n.type === 'tabs') {
    if (n.tabs.length === 0) return null;
    if (!n.active || !n.tabs.includes(n.active)) n.active = n.tabs[0];
    return n;
  }
  const kids: DockNode[] = [];
  const sizes: number[] = [];
  const base = normSizes(n.sizes, n.children.length);
  n.children.forEach((c, i) => {
    const r = normNode(c);
    if (!r) return;
    if (r.type === 'split' && r.dir === n.dir) {
      // flatten same-direction splits
      r.children.forEach((cc, j) => {
        kids.push(cc);
        sizes.push(base[i] * r.sizes[j]);
      });
    } else {
      kids.push(r);
      sizes.push(base[i]);
    }
  });
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  n.children = kids;
  n.sizes = normSizes(sizes, kids.length);
  return n;
}

export function normalize(l: LayoutState): LayoutState {
  l.root = l.root ? normNode(l.root) : null;
  l.floating = l.floating.filter((f) => {
    const g = normNode(f.group);
    return g !== null;
  });
  // drop instance records that are not placed anywhere
  const placed = new Set<string>();
  for (const g of allGroups(l)) g.group.tabs.forEach((t) => placed.add(t));
  for (const k of Object.keys(l.instances)) if (!placed.has(k)) delete l.instances[k];
  return l;
}

/* ---------------------------------------------------------------- operations */

/** Remove an instance from its tab group (the instance record stays; call normalize afterwards). Returns the group it left. */
function detach(l: LayoutState, instId: string): { groupId: string; float?: FloatWindow } | null {
  const g = findGroupOf(l, instId);
  if (!g) return null;
  const idx = g.group.tabs.indexOf(instId);
  g.group.tabs.splice(idx, 1);
  if (g.group.active === instId) g.group.active = g.group.tabs[Math.min(idx, g.group.tabs.length - 1)] ?? null;
  return { groupId: g.group.id, float: g.float };
}

/** Add a brand-new instance into a group (or as a floating window when `groupId` is missing). */
export function addInstance(l: LayoutState, panelId: string, opts: { groupId?: string; state?: unknown; instId?: string; activate?: boolean } = {}): string {
  const id = opts.instId ?? nextInstanceId(l, panelId);
  l.instances[id] = { panelId, state: opts.state };
  const g = opts.groupId ? findGroup(l, opts.groupId) : null;
  if (g) {
    g.group.tabs.push(id);
    if (opts.activate !== false) g.group.active = id;
  } else if (!l.root) {
    l.root = { type: 'tabs', id: newNodeId('g'), tabs: [id], active: id };
  } else {
    // default: first docked group
    const first = [...allGroups(l)].find((x) => !x.float);
    if (first) {
      first.group.tabs.push(id);
      first.group.active = id;
    } else l.root = { type: 'tabs', id: newNodeId('g'), tabs: [id], active: id };
  }
  return id;
}

/** Insert `node` next to `target` (by id) on the side given by `zone`. */
function insertBeside(l: LayoutState, targetId: string, node: DockNode, zone: Exclude<DropZone, 'center'>, weight = 0.5): void {
  const dir: SplitDir = zone === 'left' || zone === 'right' ? 'row' : 'col';
  const before = zone === 'left' || zone === 'top';
  const parent = findParent(l, targetId);
  if (parent && parent.dir === dir) {
    const i = parent.children.findIndex((c) => c.id === targetId);
    const share = parent.sizes[i] * weight;
    parent.sizes[i] -= share;
    parent.children.splice(before ? i : i + 1, 0, node);
    parent.sizes.splice(before ? i : i + 1, 0, share);
    return;
  }
  const replace = (cur: DockNode): DockNode => {
    const split: SplitNode = { type: 'split', id: newNodeId('s'), dir, children: before ? [node, cur] : [cur, node], sizes: before ? [weight, 1 - weight] : [1 - weight, weight] };
    return split;
  };
  if (parent) {
    const i = parent.children.findIndex((c) => c.id === targetId);
    parent.children[i] = replace(parent.children[i]);
  } else if (l.root && l.root.id === targetId) l.root = replace(l.root);
  else {
    // floating group target: tabs-in-window cannot be split; fall back to appending as a tab
    const g = findGroup(l, targetId);
    if (g && node.type === 'tabs') {
      g.group.tabs.push(...node.tabs);
      g.group.active = node.active ?? g.group.active;
    }
  }
}

export interface DockResult {
  ok: boolean;
  /** Instance ended up in this group. */
  groupId?: string;
}

/**
 * Dock an existing instance onto a group: 'center' joins the tab group (at `index`), edges split the target.
 * No-op (ok:false) when it would be meaningless (edge-dropping the only tab of its own group).
 */
export function dockInstance(l: LayoutState, instId: string, targetGroupId: string, zone: DropZone, index?: number): DockResult {
  const src = findGroupOf(l, instId);
  if (!src || !l.instances[instId]) return { ok: false };
  if (src.group.id === targetGroupId && zone !== 'center' && src.group.tabs.length === 1) return { ok: false };
  const target = findGroup(l, targetGroupId);
  if (!target) return { ok: false };
  detach(l, instId);
  if (zone === 'center') {
    const g = findGroup(l, targetGroupId);
    if (!g) return { ok: false };
    const i = index === undefined ? g.group.tabs.length : Math.max(0, Math.min(index, g.group.tabs.length));
    g.group.tabs.splice(i, 0, instId);
    g.group.active = instId;
    normalize(l);
    return { ok: true, groupId: targetGroupId };
  }
  if (target.float) {
    // cannot split a floating window's group: join it instead
    target.group.tabs.push(instId);
    target.group.active = instId;
    normalize(l);
    return { ok: true, groupId: target.group.id };
  }
  const node: TabsNode = { type: 'tabs', id: newNodeId('g'), tabs: [instId], active: instId };
  insertBeside(l, targetGroupId, node, zone);
  normalize(l);
  return { ok: true, groupId: node.id };
}

/** Dock at the outer edge of the whole layout (full height/width strip). */
export function dockToRootEdge(l: LayoutState, instId: string, zone: Exclude<DropZone, 'center'>, _hint?: FloatWindow['dockHint'], weight = 0.25): DockResult {
  if (!findGroupOf(l, instId)) return { ok: false };
  detach(l, instId);
  const node: TabsNode = { type: 'tabs', id: newNodeId('g'), tabs: [instId], active: instId };
  // NOTE: do not normalize before the node is placed (normalize drops instances that are not placed anywhere).
  if (!l.root) {
    l.root = node;
    return { ok: true, groupId: node.id };
  }
  const dir: SplitDir = zone === 'left' || zone === 'right' ? 'row' : 'col';
  const before = zone === 'left' || zone === 'top';
  if (l.root.type === 'split' && l.root.dir === dir) {
    const root = l.root;
    const scale = 1 - weight;
    root.sizes = root.sizes.map((s) => s * scale);
    if (before) {
      root.children.unshift(node);
      root.sizes.unshift(weight);
    } else {
      root.children.push(node);
      root.sizes.push(weight);
    }
  } else {
    l.root = { type: 'split', id: newNodeId('s'), dir, children: before ? [node, l.root] : [l.root, node], sizes: before ? [weight, 1 - weight] : [1 - weight, weight] };
  }
  normalize(l);
  return { ok: true, groupId: node.id };
}

/** Turn an instance into a floating window at `rect` (or move it into a fresh window). */
export function floatInstance(l: LayoutState, instId: string, rect: Rect): FloatWindow | null {
  const src = findGroupOf(l, instId);
  if (!src) return null;
  if (src.float && src.group.tabs.length === 1) {
    Object.assign(src.float, rect);
    focusFloat(l, src.float.id);
    return src.float;
  }
  const left = detach(l, instId);
  const fw: FloatWindow = {
    id: newNodeId('f'),
    group: { type: 'tabs', id: newNodeId('g'), tabs: [instId], active: instId },
    ...rect,
    minimized: false,
    maximized: false,
    z: ++l.zCounter,
    dockHint: left && !left.float ? { groupId: left.groupId } : { zone: 'right' },
  };
  l.floating.push(fw);
  normalize(l);
  return fw;
}

/** Re-dock a floating window's active/all tabs: to its dock hint group when it still exists, else a root edge. */
export function dockFloatBack(l: LayoutState, floatId: string): boolean {
  const fw = l.floating.find((f) => f.id === floatId);
  if (!fw) return false;
  const ids = [...fw.group.tabs];
  const hint = fw.dockHint;
  const target = hint?.groupId ? findGroup(l, hint.groupId) : null;
  for (const id of ids) {
    if (target && !target.float) dockInstance(l, id, target.group.id, 'center');
    else dockToRootEdge(l, id, (hint?.zone && hint.zone !== 'center' ? hint.zone : 'right') as Exclude<DropZone, 'center'>);
  }
  return true;
}

export function closeInstance(l: LayoutState, instId: string): boolean {
  if (!findGroupOf(l, instId)) return false;
  detach(l, instId);
  delete l.instances[instId];
  normalize(l);
  return true;
}

export function moveTab(l: LayoutState, instId: string, newIndex: number): void {
  const g = findGroupOf(l, instId);
  if (!g) return;
  const t = g.group.tabs;
  const from = t.indexOf(instId);
  t.splice(from, 1);
  t.splice(Math.max(0, Math.min(newIndex, t.length)), 0, instId);
}

export function activate(l: LayoutState, instId: string): void {
  const g = findGroupOf(l, instId);
  if (g) {
    g.group.active = instId;
    if (g.float) focusFloat(l, g.float.id);
  }
}

export function focusFloat(l: LayoutState, floatId: string): void {
  const f = l.floating.find((x) => x.id === floatId);
  if (f) f.z = ++l.zCounter;
}

export function setSplitSizes(l: LayoutState, splitId: string, sizes: number[]): void {
  const walk = (n: DockNode | null): SplitNode | null => {
    if (!n || n.type === 'tabs') return null;
    if (n.id === splitId) return n;
    for (const c of n.children) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  const s = walk(l.root);
  if (s && sizes.length === s.children.length) s.sizes = normSizes(sizes, sizes.length);
}

/** Snap a rect to the container edges within `threshold` px; returns the adjusted position. */
export function snapRect(r: Rect, bounds: { w: number; h: number }, threshold = 12): Rect {
  const o = { ...r };
  if (Math.abs(o.x) < threshold) o.x = 0;
  if (Math.abs(o.x + o.w - bounds.w) < threshold) o.x = bounds.w - o.w;
  if (Math.abs(o.y) < threshold) o.y = 0;
  if (Math.abs(o.y + o.h - bounds.h) < threshold) o.y = bounds.h - o.h;
  return o;
}

/** Keep at least `grab` px of the title bar reachable. */
export function clampRect(r: Rect, bounds: { w: number; h: number }, grab = 48, minW = 220, minH = 90): Rect {
  const w = Math.max(minW, Math.min(r.w, Math.max(minW, bounds.w)));
  const h = Math.max(minH, Math.min(r.h, Math.max(minH, bounds.h)));
  const x = Math.max(grab - w, Math.min(r.x, bounds.w - grab));
  const y = Math.max(0, Math.min(r.y, bounds.h - 28));
  return { x, y, w, h };
}

/* ---------------------------------------------------------------- serialization */

export const serializeLayout = (l: LayoutState): string => JSON.stringify(l);

/**
 * Parse + validate untrusted JSON (localStorage, project file). Unknown panels (`isKnownPanel` false) are dropped;
 * anything malformed returns null so the caller falls back to a default workspace.
 */
export function parseLayout(json: unknown, isKnownPanel: (panelId: string) => boolean): LayoutState | null {
  try {
    const raw = typeof json === 'string' ? (JSON.parse(json) as unknown) : json;
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<LayoutState>;
    if (r.version !== 1 || typeof r.instances !== 'object' || r.instances === null) return null;
    const instances: Record<string, InstanceInfo> = {};
    for (const [k, v] of Object.entries(r.instances)) {
      if (v && typeof v.panelId === 'string' && isKnownPanel(v.panelId)) instances[k] = { panelId: v.panelId, state: v.state };
    }
    const seen = new Set<string>();
    const cleanTabs = (n: unknown): TabsNode | null => {
      const t = n as Partial<TabsNode>;
      if (!t || t.type !== 'tabs' || !Array.isArray(t.tabs)) return null;
      const tabs = t.tabs.filter((x): x is string => typeof x === 'string' && x in instances && !seen.has(x));
      tabs.forEach((x) => seen.add(x));
      return { type: 'tabs', id: typeof t.id === 'string' ? t.id : newNodeId('g'), tabs, active: typeof t.active === 'string' ? t.active : null };
    };
    const clean = (n: unknown): DockNode | null => {
      const x = n as Partial<DockNode> | null;
      if (!x || typeof x !== 'object') return null;
      if (x.type === 'tabs') return cleanTabs(x);
      if (x.type === 'split' && Array.isArray(x.children) && (x.dir === 'row' || x.dir === 'col')) {
        const kids: DockNode[] = [];
        const sizes: number[] = [];
        x.children.forEach((c, i) => {
          const cc = clean(c);
          if (cc) {
            kids.push(cc);
            sizes.push(Number(x.sizes?.[i]) || 1);
          }
        });
        return { type: 'split', id: typeof x.id === 'string' ? x.id : newNodeId('s'), dir: x.dir, children: kids, sizes: normSizes(sizes, kids.length) };
      }
      return null;
    };
    const floating: FloatWindow[] = [];
    for (const f of Array.isArray(r.floating) ? r.floating : []) {
      const g = cleanTabs(f?.group);
      if (!g || ![f.x, f.y, f.w, f.h].every(Number.isFinite)) continue;
      floating.push({ id: typeof f.id === 'string' ? f.id : newNodeId('f'), group: g, x: f.x, y: f.y, w: f.w, h: f.h, minimized: !!f.minimized, maximized: !!f.maximized, z: Number(f.z) || 10, restore: f.restore, dockHint: f.dockHint });
    }
    const layout: LayoutState = { version: 1, root: clean(r.root), floating, instances, zCounter: Math.max(10, Number(r.zCounter) || 10, ...floating.map((f) => f.z)) };
    normalize(layout);
    return layout.root || layout.floating.length ? layout : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- declarative builder (workspaces) */

export type LayoutSpec = { t: 'tabs'; panels: string[]; active?: number; w?: number } | { t: 'row' | 'col'; children: LayoutSpec[]; w?: number };
export const tabsSpec = (panels: string[], w?: number, active = 0): LayoutSpec => ({ t: 'tabs', panels, active, w });
export const rowSpec = (children: LayoutSpec[], w?: number): LayoutSpec => ({ t: 'row', children, w });
export const colSpec = (children: LayoutSpec[], w?: number): LayoutSpec => ({ t: 'col', children, w });

export function layoutFromSpec(spec: LayoutSpec, isKnownPanel: (id: string) => boolean = () => true): LayoutState {
  const l = emptyLayout();
  const build = (s: LayoutSpec): DockNode | null => {
    if (s.t === 'tabs') {
      const ids: string[] = [];
      for (const pid of s.panels) {
        if (!isKnownPanel(pid)) continue;
        const id = nextInstanceId(l, pid);
        l.instances[id] = { panelId: pid };
        ids.push(id);
      }
      if (!ids.length) return null;
      return { type: 'tabs', id: newNodeId('g'), tabs: ids, active: ids[Math.min(s.active ?? 0, ids.length - 1)] };
    }
    const kids: DockNode[] = [];
    const sizes: number[] = [];
    for (const c of s.children) {
      const n = build(c);
      if (n) {
        kids.push(n);
        sizes.push(c.w ?? 1);
      }
    }
    if (!kids.length) return null;
    return { type: 'split', id: newNodeId('s'), dir: s.t, children: kids, sizes: normSizes(sizes, kids.length) };
  };
  l.root = build(spec);
  return normalize(l);
}

/** Structural summary used by tests: ignores generated ids. */
export function layoutShape(n: DockNode | null, l: LayoutState): unknown {
  if (!n) return null;
  if (n.type === 'tabs') return n.tabs.map((t) => l.instances[t]?.panelId ?? '?');
  return { [n.dir]: n.children.map((c) => layoutShape(c, l)), sizes: n.sizes.map((s) => Math.round(s * 100) / 100) };
}

export const sizesSumToOne = (n: DockNode | null): boolean => {
  if (!n || n.type === 'tabs') return true;
  return Math.abs(n.sizes.reduce((a, b) => a + b, 0) - 1) < EPS * 10 && n.children.every(sizesSumToOne);
};
