import type { Engine } from '../../engine/engine';
import { placeNewNode } from '../graph-editor/api';
import { CATEGORIES } from '../../engine/graph/categories';
import type { NodeDefinition } from '../../engine/graph/node';
import type { Graph } from '../../engine/graph/graph';
import type { PinDef } from '../../engine/graph/pins';
import { coerceParam, type ParamDef, type ParamValue } from '../../engine/params/schema';
import { readTextureFloat32 } from '../../engine/resources/readback';
import { asMesh } from '../../engine/mesh/accounting';
import { texSnaps } from '../../engine/mesh/texsnap';
import { MESH_RECIPES, type MeshRecipe, type RecipeSink } from '../../nodes/_shared/mesh-recipes';
import { renderMeshThumb } from './mesh-thumb';
import { linearToSrgb } from '../../ui/widgets/color';
import { clamp } from '../../shared/util';
import { Disposer, h } from '../../ui/core/dom';
import { contextMenu } from '../../ui/core/menu';
import { toast } from '../../ui/core/overlay';
import { definePanelView } from '../../ui/dock/panel-lazy';
import { icon } from '../../ui/icons';
import { Dropdown, SearchField, iconButton } from '../../ui/widgets/controls';

import { t as tt, trNodeDesc } from '../../shared/i18n';
const RES = 160; // render resolution of one tile (px)

/** Deterministic PRNG (mulberry32) so a variant always looks the same for the same (node, variant, seed offset). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const strSeed = (s: string): number => [...s].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);

/** Variant 0 = defaults; others randomise the node's own parameters inside their soft ranges (never the common tabs). */
export function variantParams(def: NodeDefinition, variant: number, offset: number): Record<string, ParamValue> {
  if (variant === 0 && offset === 0) return {};
  // Curated variants first (re-roll offsets switch to random ones).
  const curated = def.gallery?.[variant - 1];
  if (curated && offset === 0 && variant >= 1) return { ...curated.params };
  const r = rng(strSeed(def.id) ^ Math.imul(variant + 1, 0x9e3779b1) ^ Math.imul(offset + 1, 0x85ebca6b));
  const out: Record<string, ParamValue> = {};
  const range = (d: { min?: number; max?: number; softMin?: number; softMax?: number; default: number }): [number, number] => {
    const lo = d.softMin ?? d.min ?? (d.default >= 0 ? 0 : d.default * 2);
    const hi = d.softMax ?? d.max ?? Math.max(1, Math.abs(d.default) * 2);
    return [lo, hi];
  };
  for (const p of def.params as ParamDef[]) {
    if (p.tab === 'Texture' || p.tab === 'Blending') continue;
    switch (p.type) {
      case 'seed':
        out[p.id] = Math.floor(r() * 99999);
        break;
      case 'float': {
        const [lo, hi] = range(p);
        // stay near the default half of the time so results remain useful
        const t = r();
        out[p.id] = coerceParam(p, r() < 0.5 ? p.default + (lo + t * (hi - lo) - p.default) * 0.5 : lo + t * (hi - lo));
        break;
      }
      case 'int': {
        const [lo, hi] = range(p);
        out[p.id] = coerceParam(p, Math.round(lo + r() * (hi - lo)));
        break;
      }
      case 'bool':
        out[p.id] = r() < 0.3 ? !p.default : p.default;
        break;
      case 'enum':
        out[p.id] = p.options[Math.floor(r() * p.options.length)].value;
        break;
      case 'vec2':
      case 'vec3': {
        const [lo, hi] = range({ ...p, default: p.default[0] });
        out[p.id] = coerceParam(p, p.default.map((d) => (r() < 0.5 ? d : lo + r() * (hi - lo))));
        break;
      }
      case 'color':
        out[p.id] = [r(), r(), r(), 1];
        break;
      default:
        break;
    }
  }
  return out;
}

interface Job {
  def: NodeDefinition;
  variant: number;
  canvas: HTMLCanvasElement;
  tile: HTMLElement;
}
type Cached = { img: ImageData } | { error: string };

/**
 * feeders for the pin types that plain noise cannot serve — UV fields (uv.noise), normal maps
 * (noise -> normal.create) and Island Maps (noise -> islands.generate). Returns the output pin to connect, or null.
 */
function feedSpecial(g: Graph, reg: Engine['registry'], def: NodeDefinition, pin: PinDef, k: number, variant: number): { node: string; pin: string } | null {
  const seed = 11 + k * 7 + variant;
  const noise = (scale: number): string => g.addNode('grayscale.noise', { x: 0, y: k * 100, params: { seed, scale: [scale, scale] } }).id;
  if (pin.type === 'uv' && reg.has('uv.noise')) return { node: g.addNode('uv.noise', { x: 0, y: k * 100, params: { seed, strength: 0.06, scale: [3, 3] } }).id, pin: 'output' };
  if (pin.type === 'normal' && reg.has('normal.create') && reg.has('grayscale.noise')) {
    const n = g.addNode('normal.create', { x: 100, y: k * 100, params: {} }).id;
    g.connect({ node: noise(4 + k), pin: 'output' }, { node: n, pin: 'input' });
    return { node: n, pin: 'output' };
  }
  if (def.category === 'islands' && pin.id === 'islands' && reg.has('islands.generate') && reg.has('grayscale.noise')) {
    const n = g.addNode('islands.generate', { x: 100, y: k * 100, params: { threshold: 0.52 } }).id;
    g.connect({ node: noise(5), pin: 'output' }, { node: n, pin: 'input' });
    return { node: n, pin: 'islands' };
  }
  return null;
}


/** demo geometry for mesh-node inputs (a subdivided plane / torus for deformers, a point ring for point inputs, a spline sweep for Sweep-like consumers). */
function feedMesh(g: Graph, reg: Engine['registry'], type: 'mesh' | 'points', k: number, def: NodeDefinition): { node: string; pin: string } | null {
  if (type === 'points') {
    if (!reg.has('geometry.points_shape')) return null;
    return { node: g.addNode('geometry.points_shape', { x: 0, y: k * 100, params: { mode: 'circle', count: 24, radius: 1 } }).id, pin: 'points' };
  }
  if (!reg.has('geometry.shapes')) return null;
  const needsTorus = ['geometry.space_warp', 'geometry.noise', 'geometry.subdivide', 'geometry.normals'].includes(def.id);
  const params: Record<string, ParamValue> = needsTorus ? { shape: 'grid', cols: 24, rows: 24, size: [1.6, 1.6, 1] } : { shape: 'torus', segments: 24 };
  return { node: g.addNode('geometry.shapes', { x: 0, y: k * 100, params }).id, pin: 'mesh' };
}

/** Evaluates a mesh node in a tiny graph and draws it with the software rasteriser. Texture inputs get a noise feeder; the first pass requests the CPU snapshots, the second one uses them. */
async function renderMeshVariant(engine: Engine, g: Graph, nodeId: string, needsSnap: boolean, pinId: string): Promise<Cached> {
  const run = async (): Promise<Cached> => {
    const res = await engine.evaluator.evaluate(g, [{ nodeId, pinId }], { time: 0, scale: 1, useCache: true });
    try {
      const err = res.errors.get(nodeId);
      if (err) return { error: err };
      const v = [...res.values.values()].find((x) => x.kind === 'data');
      const mesh = v ? asMesh(v) : undefined;
      if (!mesh) return { error: 'no mesh produced' };
      const t = renderMeshThumb(mesh, RES);
      return { img: new ImageData(t.data as unknown as Uint8ClampedArray<ArrayBuffer>, t.width, t.height) };
    } finally {
      res.release();
    }
  };
  const first = await run();
  if (needsSnap) {
    await texSnaps.whenIdle();
    return run(); // snapshots are ready now (plan hash changed)
  }
  return first;
}

/** Builds a mesh recipe into a scratch graph and renders its result (3D thumbnail). */
async function renderRecipe(engine: Engine, r: MeshRecipe): Promise<Cached> {
  const g = engine.newGraph({ width: 256, height: 256, tiling: 'both', filtering: 'linear', bitDepth: 16 });
  const sink: RecipeSink = {
    add: (type, x, y, params) => g.addNode(type, { x, y, params }).id,
    connect: (a, ap, b, bp) => void g.connect({ node: a, pin: ap }, { node: b, pin: bp }),
  };
  const res = r.build(sink, 0, 0);
  return renderMeshVariant(engine, g, res.target, true, 'output');
}

/** Renders ONE node variant in an isolated tiny graph and reads it back as an 8-bit preview. */
async function renderVariant(engine: Engine, def: NodeDefinition, variant: number, offset: number): Promise<Cached> {
  const reg = engine.registry;
  const g = engine.newGraph({ width: RES, height: RES, tiling: 'both', filtering: 'linear', bitDepth: 16 });
  const node = g.addNode(def.id, { params: variantParams(def, variant, offset), x: 300, y: 0 });
  let k = 0;
  for (const pin of def.inputs) {
    if (pin.role === 'modulation') continue;
    const fed = feedSpecial(g, reg, def, pin, k, variant);
    if (fed) {
      g.connect(fed, { node: node.id, pin: pin.id });
      k++;
      continue;
    }
    if (pin.type === 'mesh' || pin.type === 'points') {
      const src = feedMesh(g, reg, pin.type, k, def);
      if (src) {
        g.connect(src, { node: node.id, pin: pin.id });
        k++;
        continue;
      }
    }
    if (pin.type !== 'gray' && pin.type !== 'color') {
      if (!pin.optional) return { error: `needs a “${pin.type}” input` };
      continue;
    }
    if (!reg.has('grayscale.noise') || k >= 3) {
      if (!pin.optional) return { error: 'needs an input (no noise feeder)' };
      continue;
    }
    const f = g.addNode('grayscale.noise', { x: 0, y: k * 100, params: { seed: 11 + k * 7 + variant, scale: [3 + k * 2, 3 + k * 2] } });
    g.connect({ node: f.id, pin: 'output' }, { node: node.id, pin: pin.id });
    k++;
  }
  const meshOut = def.outputs.find((o) => o.type === 'mesh' || o.type === 'points');
  if (meshOut) return renderMeshVariant(engine, g, node.id, !!def.cpuTextureInputs?.length, meshOut.id);
  const out = def.outputs.find((o) => o.type === 'gray' || o.type === 'color' || o.type === 'normal' || o.type === 'uv' || o.type === 'vector');
  if (!out) return { error: `no previewable output (${def.outputs.map((o) => o.type).join(', ') || 'none'})` };
  const res = await engine.evaluator.evaluate(g, [{ nodeId: node.id, pinId: out.id }], { time: 0, scale: 1, useCache: false });
  try {
    const err = res.errors.get(node.id);
    if (err) return { error: err };
    const v = [...res.values.values()].find((x) => x.kind === 'texture');
    if (!v || v.kind !== 'texture') return { error: 'no texture produced' };
    const data = await readTextureFloat32(engine.gpu, engine.mm, v.tex.texture, v.tex.format, v.width, v.height);
    const ch = data.length / (v.width * v.height);
    const img = new ImageData(v.width, v.height);
    const enc = (x: number, srgb: boolean): number => Math.round(clamp(srgb ? linearToSrgb(clamp(x, 0, 1)) : x, 0, 1) * 255);
    for (let i = 0; i < v.width * v.height; i++) {
      const o = i * 4;
      if (ch === 1) img.data.set([enc(data[i], false), enc(data[i], false), enc(data[i], false), 255], o);
      else if (ch === 2) img.data.set([enc(data[i * 2], false), enc(data[i * 2 + 1], false), 0, 255], o);
      else {
        const s = v.pin === 'color';
        img.data.set([enc(data[i * ch], s), enc(data[i * ch + 1], s), enc(data[i * ch + 2], s), s ? Math.round(clamp(data[i * ch + 3], 0, 1) * 255) : 255], o);
      }
    }
    return { img };
  } finally {
    res.release();
  }
}

/**
 * NODE GALLERY: lists EVERY registered node (auto-discovered) and renders several variants of each (defaults + random
 * seeds/params) lazily and sequentially through the real engine, so the user can review nodes visually. Double-click a
 * tile to add that variant to the graph. Previews are cached; rendering pauses while the panel is hidden.
 */
export const { create } = definePanelView({
  create(host, ctx) {
    const app = ctx.app;
    const dis = new Disposer();
    const saved = (ctx.initialState as { variants?: number; tile?: number } | undefined) ?? {};
    let variants = saved.variants ?? 4;
    let tileRem = saved.tile ?? 9;
    let offset = 0;
    let query = '';
    const cache = new Map<string, Cached>();
    const queue: Job[] = [];
    let running = false;
    let done = 0;
    let total = 0;
    const status = h('span', { class: 'k-dim', style: { marginInlineStart: 'auto' } });
    const grid = h('div', { class: 'k-gal-grid' });
    const scroll = h('div', { class: 'k-panel-scroll' }, grid);
    const search = new SearchField({ placeholder: tt('nodeGallery.filterNodes') }, { onInput: (v) => ((query = v), build()) });
    const vDrop = new Dropdown({ options: [1, 2, 4, 6, 8].map((n) => ({ value: String(n), label: `${n} variant${n > 1 ? 's' : ''}` })), value: String(variants) }, { onInput: (v) => ((variants = +v), ctx.state.set({ variants, tile: tileRem }), build()) });
    const sDrop = new Dropdown({ options: [{ value: '7', label: 'Small' }, { value: '9', label: 'Medium' }, { value: '13', label: 'Large' }], value: String(tileRem) }, { onInput: (v) => ((tileRem = +v), ctx.state.set({ variants, tile: tileRem }), (grid.style.setProperty('--tile', `${tileRem}rem`))) });
    const reroll = h('button', { tip: tt('nodeGallery.renderNewRandomSeedsParamete'), onclick: () => ((offset += 1), cache.clear(), build()) }, 'Re-roll');
    host.append(h('div', { class: 'k-toolrow' }, search.el, vDrop.el, sDrop.el, reroll, iconButton('refresh', tt('nodeGallery.refreshAllPreviews'), () => (cache.clear(), build()), { cls: 'sm' }), status), scroll);
    grid.style.setProperty('--tile', `${tileRem}rem`);

    const key = (d: NodeDefinition, v: number): string => `${d.id}:${v}:${offset}:${app.project.graph.settings.bitDepth}`;
    const paint = (job: Pick<Job, 'canvas' | 'tile'>, c: Cached): void => {
      job.tile.querySelector('.msg')?.remove();
      job.tile.classList.toggle('err', 'error' in c);
      if ('img' in c) {
        job.canvas.width = c.img.width;
        job.canvas.height = c.img.height;
        job.canvas.getContext('2d')!.putImageData(c.img, 0, 0);
        job.canvas.style.display = '';
      } else {
        job.canvas.style.display = 'none';
        job.tile.append(h('div', { class: 'msg', tip: c.error }, c.error.slice(0, 80)));
      }
    };
    async function pump(): Promise<void> {
      if (running) return;
      running = true;
      const end = app.tasks.begin('Node Gallery previews');
      try {
        while (queue.length) {
          if (!ctx.visible.get()) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          const job = queue.shift()!;
          if (!job.canvas.isConnected) continue;
          const k = key(job.def, job.variant);
          let c = cache.get(k);
          if (!c) {
            try {
              c = await renderVariant(app.engine, job.def, job.variant, offset);
            } catch (e) {
              c = { error: (e as Error).message };
            }
            cache.set(k, c);
            if (cache.size > 500) cache.delete(cache.keys().next().value as string);
          }
          paint(job, c);
          done++;
          status.textContent = queue.length ? `Rendering ${done}/${total}…` : `${total} previews`;
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
      } finally {
        running = false;
        end();
      }
    }

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const jobs = (e.target as HTMLElement & { _jobs?: Job[] })._jobs;
        if (!jobs) continue;
        (e.target as HTMLElement & { _jobs?: Job[] })._jobs = undefined;
        for (const j of jobs) {
          const c = cache.get(key(j.def, j.variant));
          if (c) paint(j, c);
          else {
            queue.push(j);
            total++;
          }
        }
        void pump();
      }
    }, { root: scroll, rootMargin: '200px' });
    dis.add(() => io.disconnect());

    let recipeChain: Promise<void> = Promise.resolve();
    function addRecipe(r: MeshRecipe): void {
      const ed = app.project.editor;
      const at = placeNewNode({ x: 80, y: 80 });
      ed.stack.begin(`Add recipe “${r.title}”`);
      try {
        const res = r.build({ add: (type, x, y, params) => ed.addNode(type, { x, y, params }), connect: (a, ap, b, bp) => ed.connect({ node: a, pin: ap }, { node: b, pin: bp }) }, at.x, at.y);
        ed.stack.commit();
        app.selection.set([res.target]);
        toast(tt('nodeGallery.addedRecipe', { title: r.title }), { type: 'ok', timeout: 2500 });
      } catch (e) {
        ed.stack.abort();
        toast(`Recipe failed: ${(e as Error).message}`, { type: 'error' });
      }
    }
    function build(): void {
      queue.length = 0;
      io.disconnect();
      done = 0;
      total = 0;
      grid.style.setProperty('--variants', String(variants));
      const defs = app.engine.registry.search(query);
      grid.replaceChildren();
      if (!query || 'mesh recipe energy beam shockwave ring sword swipe'.includes(query.toLowerCase())) {
        const rtiles = MESH_RECIPES.map((r) => {
          const canvas = h('canvas', { width: '4', height: '4' });
          const tile = h('div', { class: 'k-gal-tile', tip: tt('nodeGallery.doubleClickTo', { description: r.description }) }, canvas, h('span', { class: 'lab' }, r.title));
          tile.addEventListener('dblclick', () => addRecipe(r));
          const ck = `recipe:${r.id}:${app.project.graph.settings.bitDepth}`;
          const cached = cache.get(ck);
          if (cached) paint({ canvas, tile }, cached);
          else {
            recipeChain = recipeChain.then(async () => {
              if (!canvas.isConnected) return;
              let c: Cached;
              try {
                c = await renderRecipe(app.engine, r);
              } catch (e) {
                c = { error: (e as Error).message };
              }
              cache.set(ck, c);
              paint({ canvas, tile }, c);
            });
          }
          return tile;
        });
        grid.append(h('div', { class: 'k-gal-card' }, h('div', { class: 'k-gal-head', tip: tt('nodeGallery.completeGraphsBuiltOnly') }, h('span', { style: { color: CATEGORIES.geometry.color, display: 'flex' } }, icon('cat-geometry', 14)), 'Mesh recipes', h('small', {}, 'Sweep · Noise · Combine Color')), h('div', { class: 'k-gal-row' }, ...rtiles)));
      }
      for (const d of defs) {
        const cat = CATEGORIES[d.category];
        const tiles: HTMLElement[] = [];
        const jobs: Job[] = [];
        for (let v = 0; v < variants; v++) {
          const canvas = h('canvas', { width: '4', height: '4' });
          const tile = h('div', { class: 'k-gal-tile', tip: v === 0 ? 'Defaults — double-click to add to graph' : `Variant ${v} — double-click to add to graph` }, canvas, h('span', { class: 'lab' }, v === 0 ? 'default' : `#${v}`));
          tile.addEventListener('dblclick', () => {
            const id = app.project.editor.addNode(d.id, { params: variantParams(d, v, offset), ...placeNewNode({ x: 80, y: 80 }) });
            app.selection.set([id]);
            toast(`Added “${d.title}” (${v === 0 ? 'default' : `variant ${v}`})`, { type: 'ok', timeout: 1500 });
          });
          tile.addEventListener('contextmenu', (e) => contextMenu(e, [{ label: tt('common.addToGraph'), icon: 'plus', action: () => tile.dispatchEvent(new MouseEvent('dblclick')) }]));
          tiles.push(tile);
          jobs.push({ def: d, variant: v, canvas, tile });
        }
        const card = h('div', { class: 'k-gal-card' }, h('div', { class: 'k-gal-head', tip: trNodeDesc(d.id, d.description) }, h('span', { style: { color: cat.color, display: 'flex' } }, icon(d.icon, 14)), d.title, h('small', {}, cat.label)), h('div', { class: 'k-gal-row' }, ...tiles));
        (card as HTMLElement & { _jobs?: Job[] })._jobs = jobs;
        grid.append(card);
        io.observe(card);
      }
      if (!defs.length) grid.append(h('div', { class: 'k-empty', style: { gridColumn: '1/-1' } }, 'No nodes match.'));
      status.textContent = `${defs.length} node${defs.length === 1 ? '' : 's'}`;
    }
    dis.add(app.engine.onRestored.on(() => (cache.clear(), build())));
    build();
    return { dispose: () => (queue.length = 0, dis.dispose()), serialize: () => ({ variants, tile: tileRem }) };
  },
});
