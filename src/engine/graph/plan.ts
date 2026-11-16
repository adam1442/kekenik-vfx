import { hashString, stableStringify } from '../../shared/util';
import { texSnaps } from '../mesh/texsnap';
import { coerceParam, type ParamValues } from '../params/schema';
import { FILTER_INDEX, isTexturePin, tilingFlags, type FilterMode, type TilingMode } from '../types';
import type { ExpandedNode } from './expand';
import type { Graph, LinkData, NodeData } from './graph';
import type { NodeFrame } from './node';
import type { PinDef } from './pins';

/**
 * Evaluation PLAN: everything that can be decided without touching the GPU.
 *   - topological order of the nodes needed by the targets (pull-based: nothing else is visited),
 *   - resolved params (animation applied, coerced),
 *   - per-node frame (size / tiling / filtering from the Texture tab, preview scale, time),
 *   - version hash per node: hash(def id+version, params, frame, bypass, input hashes). Equal hash == equal output,
 *     which is what the output cache keys on. Changing a param changes that node's hash and (through inputs) every
 *     downstream hash: that IS the dirty propagation for caching.
 * Pure and unit-tested.
 */

export interface Region {
  /** Padded region origin / size in full-image pixels (see TileScheduler). */
  px: number;
  py: number;
  pw: number;
  ph: number;
}

export type ParamAnimator = (node: NodeData, values: ParamValues, time: number, fps?: number) => ParamValues;

export interface PlanOptions {
  time: number;
  /** Preview resolution factor (1 = full). Sizes are scaled and rounded (min 1). */
  scale: number;
  /** Device maxTextureDimension2D. */
  maxDim: number;
  region?: Region;
  animator?: ParamAnimator;
  /** present only in interactive evaluations that may use worker jobs: is the result of this job key ready? */
  jobReady?: (key: string) => boolean;
  /** salt of a simulation node (changes when its cache gains frames / is invalidated) so the plan hash follows the simulation state. */
  simSalt?: (nodeId: string) => string;
  /** output pins requested by the targets (viewport pin, export) per node; nodes with `lazyOutputs` only produce wanted + linked pins. */
  targetPins?: Map<string, Set<string>>;
}

export interface PlanNode {
  id: string;
  node: NodeData;
  expanded?: ExpandedNode;
  params: ParamValues;
  frame: NodeFrame;
  hash: number;
  timeDep: boolean;
  /** Set when the node cannot be evaluated at all (unknown type, impossible tiled size...). */
  error?: string;
  inputs: { pin: PinDef; link?: LinkData }[];
  /** LAZY input pins (not evaluated by the engine; the node pulls them itself, e.g. Sheet Encode) with a time-independent content signature of the upstream subgraph. */
  lazy?: Record<string, { nodeId: string; pin: string; sig: string; graph: Graph }>;
  /** `<producer hash>:<pin>` per connected input pin id (cache key of CPU texture snapshots). */
  srcKeys?: Record<string, string>;
  /** key of the worker job of this node (set when the evaluation allows worker jobs and the definition declares `workerTask`). */
  jobKey?: string;
  /** outputs that must be produced (linked or targeted); undefined = all. Only set for nodes with `lazyOutputs`. */
  wanted?: Set<string>;
}

export interface Plan {
  order: string[];
  nodes: Map<string, PlanNode>;
}

/** Iterative post-order DFS over upstream links restricted to nodes reachable from `targets`. */
export function topoOrder(graph: Graph, targets: string[]): string[] {
  const ups = new Map<string, string[]>();
  for (const l of graph.links.values()) {
    if (!ups.has(l.to.node)) ups.set(l.to.node, []);
    ups.get(l.to.node)!.push(l.from.node);
  }
  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 1 = visiting, 2 = done
  for (const t of targets) {
    if (!graph.nodes.has(t) || state.get(t) === 2) continue;
    const stack: { id: string; i: number }[] = [{ id: t, i: 0 }];
    state.set(t, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const deps = ups.get(top.id) ?? [];
      if (top.i < deps.length) {
        const d = deps[top.i++];
        if (!graph.nodes.has(d)) continue;
        const s = state.get(d);
        if (s === 1) throw new Error(`Cycle detected at node "${d}"`);
        if (s !== 2) {
          state.set(d, 1);
          stack.push({ id: d, i: 0 });
        }
      } else {
        state.set(top.id, 2);
        order.push(top.id);
        stack.pop();
      }
    }
  }
  return order;
}

const clampDim = (v: number, max: number): number => Math.max(1, Math.min(max, Math.round(v)));

export function resolveFrame(
  graph: Graph,
  ex: ExpandedNode,
  params: ParamValues,
  parent: NodeFrame | undefined,
  opts: PlanOptions,
  time: number,
): { frame: NodeFrame; error?: string } {
  const g = graph.settings;
  const scale = opts.scale;
  const gw = g.width * scale;
  const gh = g.height * scale;
  const hasTex = ex.hasTextureTab;
  const mode = (hasTex ? (params.tex_size_mode as string) : 'from_graph') ?? 'from_graph';
  const mul = (hasTex ? (params.tex_size_mul as number[]) : [1, 1]) ?? [1, 1];
  const abs = (hasTex ? (params.tex_size_abs as number[]) : [g.width, g.height]) ?? [g.width, g.height];

  let w: number;
  let h: number;
  if (mode === 'absolute') {
    w = abs[0] * scale;
    h = abs[1] * scale;
  } else if (mode === 'from_parent' && parent) {
    w = parent.width * mul[0];
    h = parent.height * mul[1];
  } else {
    w = gw * mul[0];
    h = gh * mul[1];
  }
  let width = clampDim(w, opts.maxDim);
  let height = clampDim(h, opts.maxDim);

  const fm = (hasTex ? (params.tex_filter_mode as string) : 'from_graph') ?? 'from_graph';
  const filter: FilterMode = fm === 'absolute' ? (params.tex_filter as FilterMode) : fm === 'from_parent' && parent ? (['point', 'linear', 'cubic'] as const)[parent.filter] : g.filtering;
  const tm = (hasTex ? (params.tex_tiling_mode as string) : 'from_graph') ?? 'from_graph';
  let tx: boolean;
  let ty: boolean;
  if (tm === 'absolute') [tx, ty] = tilingFlags(params.tex_tiling as TilingMode);
  else if (tm === 'from_parent' && parent) [tx, ty] = [parent.tileX, parent.tileY];
  else [tx, ty] = tilingFlags(g.tiling);

  const frame: NodeFrame = {
    width,
    height,
    fullWidth: width,
    fullHeight: height,
    originX: 0,
    originY: 0,
    tileX: tx,
    tileY: ty,
    filter: FILTER_INDEX[filter] as 0 | 1 | 2,
    hq: g.bitDepth === 32,
    supersample: hasTex ? Math.max(1, Math.round((params.tex_ss as number) ?? 1)) : 1,
    time,
    loopPhase: (((time * g.fps) % g.loopLength) + g.loopLength) % g.loopLength / g.loopLength,
    seed: g.seed,
  };

  if (opts.region) {
    // Tiled evaluation: only nodes whose logical size equals the graph size can be rendered per tile.
    if (mode === 'absolute' || mul[0] !== 1 || mul[1] !== 1) {
      return { frame, error: 'Tiled evaluation requires every node to use the graph size (size source not Absolute, multiplier 1).' };
    }
    const r = opts.region;
    width = r.pw;
    height = r.ph;
    Object.assign(frame, { width, height, fullWidth: g.width, fullHeight: g.height, originX: r.px, originY: r.py });
  }
  return { frame };
}

const sigCache = new WeakMap<Graph, { rev: number; map: Map<string, number> }>();
/**
 * TIME-INDEPENDENT content signature of everything upstream of `nodeId` (types, params, keyframes, bypass, links and the
 * graph settings that change pixels). Used by LAZY pins: a node that pulls its input itself (Sheet Encode bakes N frames of it)
 * must not be invalidated by the playhead, only by real edits. Memoised per graph revision.
 */
export function lazySignature(graph: Graph, nodeId: string): number {
  let c = sigCache.get(graph);
  if (!c || c.rev !== graph.revision) {
    c = { rev: graph.revision, map: new Map() };
    sigCache.set(graph, c);
  }
  const hit = c.map.get(nodeId);
  if (hit !== undefined) return hit;
  const s = graph.settings;
  const parts: string[] = [`${s.width}x${s.height}|${s.tiling}|${s.filtering}|${s.bitDepth}|${s.fps}|${s.loopLength}|${s.seed}`];
  for (const id of topoOrder(graph, [nodeId])) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    const ins = [...graph.links.values()].filter((l) => l.to.node === id).map((l) => `${l.from.node}.${l.from.pin}>${l.to.pin}`).sort();
    parts.push(`${n.id}|${n.type}@${n.typeVersion}|${stableStringify(n.params)}|${n.anim ? stableStringify(n.anim) : ''}|${n.bypass ? 1 : 0}|${ins.join(',')}`);
  }
  const sig = hashString(parts.join('\n'));
  c.map.set(nodeId, sig);
  return sig;
}

export function buildPlan(graph: Graph, targets: string[], opts: PlanOptions): Plan {
  const order = topoOrder(graph, targets);
  const inLinks = new Map<string, Map<string, LinkData>>();
  for (const l of graph.links.values()) {
    let m = inLinks.get(l.to.node);
    if (!m) inLinks.set(l.to.node, (m = new Map()));
    m.set(l.to.pin, l);
  }
  const nodes = new Map<string, PlanNode>();
  const g = graph.settings;

  for (const id of order) {
    const node = graph.nodes.get(id)!;
    const ex = graph.registry.expanded(node.type);
    const links = inLinks.get(id);
    if (!ex) {
      nodes.set(id, {
        id,
        node,
        params: {},
        frame: resolveFrame(graph, { hasTextureTab: false } as ExpandedNode, {}, undefined, opts, opts.time).frame,
        hash: hashString(`missing:${node.type}`),
        timeDep: false,
        error: `Unknown node type "${node.type}"`,
        inputs: [],
      });
      continue;
    }
    const raw = opts.animator ? opts.animator(node, node.params, opts.time, g.fps) : node.params;
    const params: ParamValues = {};
    for (const p of ex.params) params[p.id] = coerceParam(p, p.id in raw ? raw[p.id] : p.default);

    const inputs = ex.inputs.map((pin) => ({ pin, link: links?.get(pin.id) }));
    // Parent = first connected texture input.
    let parent: NodeFrame | undefined;
    for (const i of inputs) {
      if (i.link && isTexturePin(i.pin.type)) {
        parent = nodes.get(i.link.from.node)?.frame;
        if (parent) break;
      }
    }
    const def = ex.def;
    let timeDep = typeof def.timeDependent === 'function' ? def.timeDependent(params) : !!def.timeDependent;
    for (const i of inputs) if (i.link && !i.pin.lazy && nodes.get(i.link.from.node)?.timeDep) timeDep = true;

    const { frame, error } = resolveFrame(graph, ex, params, parent, opts, timeDep ? opts.time : 0);
    if (timeDep) {
      /* frame.time already set */
    } else {
      frame.time = 0;
      frame.loopPhase = 0;
    }
    const inputsKey = inputs.map((i) => (i.link ? (i.pin.lazy ? `L${lazySignature(graph, i.link.from.node)}:${i.link.from.pin}` : `${nodes.get(i.link.from.node)?.hash ?? 0}:${i.link.from.pin}`) : '-')).join(',');
    const frameKey = `${frame.width}x${frame.height}/${frame.fullWidth}x${frame.fullHeight}@${frame.originX},${frame.originY}|${+frame.tileX}${+frame.tileY}|${frame.filter}|${+frame.hq}|${frame.supersample}|${frame.seed}|${timeDep ? `${frame.time}` : ''}`;
    // key of the producer of every input (CPU texture snapshots are cached by it) + snapshot readiness salt.
    const srcKeys: Record<string, string> = {};
    for (const i of inputs) if (i.link) srcKeys[i.pin.id] = `${nodes.get(i.link.from.node)?.hash ?? 0}:${i.link.from.pin}`;
    const snapSalt = (def.cpuTextureInputs ?? []).map((p) => (srcKeys[p] ? (texSnaps.has(srcKeys[p]) ? 'S' : 's') : '-')).join('');
    let wanted: Set<string> | undefined;
    let simKey = '';
    if (def.lazyOutputs) {
      wanted = new Set(opts.targetPins?.get(id) ?? []);
      for (const l of graph.links.values()) if (l.from.node === id) wanted.add(l.from.pin);
      simKey = `|W${[...wanted].sort().join(',')}`;
    }
    if (def.simulation) simKey += `|S${opts.simSalt?.(id) ?? ''}`;
    const baseKey = `${def.id}@${def.version}|${stableStringify(params)}|${frameKey}|${node.bypass ? 'B' : ''}|${inputsKey}|${snapSalt}${simKey}`;
    // nodes that run in a worker: the hash flips when the result arrives, which triggers exactly one coalesced re-evaluation.
    const jobKey = def.workerTask && opts.jobReady ? String(hashString(baseKey)) : undefined;
    const hash = jobKey ? hashString(`${baseKey}|${opts.jobReady!(jobKey) ? 'J' : 'j'}`) : hashString(baseKey);
    void g;
    const lazy: NonNullable<PlanNode['lazy']> = {};
    for (const i of inputs) if (i.link && i.pin.lazy) lazy[i.pin.id] = { nodeId: i.link.from.node, pin: i.link.from.pin, sig: String(lazySignature(graph, i.link.from.node)), graph };
    nodes.set(id, { id, node, expanded: ex, params, frame, hash, timeDep, error, inputs, srcKeys, jobKey, wanted, lazy: Object.keys(lazy).length ? lazy : undefined });
  }
  return { order, nodes };
}
