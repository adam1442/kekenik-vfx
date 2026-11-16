import type { Engine } from '../engine/engine';
import type { EvalTarget } from '../engine/graph/evaluator';
import { Graph } from '../engine/graph/graph';
import { coerceParam, defaultValues } from '../engine/params/schema';
import { consoleBus } from '../shared/log';
import type { ExportTarget } from './targets';

/** Shared environment of every export job. */
export class CancelledExport extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'CancelledExport';
  }
}

/** Pause / cancel gate: jobs `await gate.checkpoint()` between strips, tiles and frames. */
export class JobGate {
  cancelled = false;
  private paused = false;
  private waiters: Array<() => void> = [];
  get isPaused(): boolean {
    return this.paused;
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
    for (const w of this.waiters.splice(0)) w();
  }
  cancel(): void {
    this.cancelled = true;
    this.resume();
  }
  async checkpoint(): Promise<void> {
    if (this.cancelled) throw new CancelledExport();
    if (this.paused) await new Promise<void>((r) => this.waiters.push(r));
    if (this.cancelled) throw new CancelledExport();
  }
}

export interface JobEnv {
  engine: Engine;
  graph: Graph;
  graphName: string;
  target: ExportTarget;
  gate: JobGate;
  onProgress(fraction: number, label?: string): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  now?: Date;
}

export interface JobResult {
  files: string[];
  bytes: number;
}

/** Node params with defaults + coercion (what the evaluator sees, without animation). */
export function resolveNodeParams(env: Pick<JobEnv, 'engine' | 'graph'>, nodeId: string): Record<string, unknown> {
  const node = env.graph.nodes.get(nodeId);
  if (!node) throw new Error(`Node ${nodeId} no longer exists`);
  const ex = env.engine.registry.expanded(node.type);
  if (!ex) throw new Error(`Unknown node type ${node.type}`);
  const out: Record<string, unknown> = { ...defaultValues(ex.params) };
  for (const p of ex.params) if (p.id in node.params) out[p.id] = coerceParam(p, node.params[p.id]);
  return out;
}

/** Copy of the graph with another resolution (exact: every "From graph" node renders at the new size). */
export function graphAtSize(env: Pick<JobEnv, 'engine' | 'graph'>, w: number, h: number): { graph: Graph; owned: boolean } {
  const g = env.graph;
  if (g.settings.width === w && g.settings.height === h) return { graph: g, owned: false };
  const data = g.toData();
  data.settings = { ...data.settings, width: w, height: h };
  return { graph: Graph.fromData(env.engine.registry, data).graph, owned: true };
}

/** Drop the output cache entries of a temporary graph copy. */
export function releaseGraphCopy(env: Pick<JobEnv, 'engine'>, g: { graph: Graph; owned: boolean }): void {
  if (g.owned) env.engine.evaluator.cache.deletePrefix(`${g.graph.id}:`);
}

/** Max halo (px) and whether a node that cannot be tiled feeds the target (for tiled renders). */
export function tilingNeeds(env: Pick<JobEnv, 'engine' | 'graph'>, nodeId: string): { halo: number; global: string[] } {
  const ids = env.graph.upstream([nodeId]);
  ids.add(nodeId);
  let halo = 0;
  const global: string[] = [];
  for (const id of ids) {
    const n = env.graph.nodes.get(id);
    const ex = n ? env.engine.registry.expanded(n.type) : undefined;
    if (!n || !ex) continue;
    const cost = ex.def.cost;
    if (!cost) continue;
    const params = resolveNodeParams(env, id);
    if (cost.tiling === 'global') global.push(n.name);
    else if (cost.tiling === 'halo') halo = Math.max(halo, Math.ceil(cost.halo?.(params as never) ?? 0));
  }
  return { halo, global };
}

/** Evaluation target of the producer feeding `pinId` of `nodeId` (null when unconnected). */
export function producerTarget(graph: Graph, nodeId: string, pinId: string): EvalTarget | null {
  const l = graph.inputLink(nodeId, pinId);
  return l ? { nodeId: l.from.node, pinId: l.from.pin } : null;
}

export const logTo = (env: JobEnv, nodeName: string) => (level: 'info' | 'warn' | 'error', message: string): void => {
  env.log(level, message);
  consoleBus[level](`[export] ${nodeName}: ${message}`, { source: 'io' });
};
