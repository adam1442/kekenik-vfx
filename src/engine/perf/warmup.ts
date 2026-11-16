import type { Engine } from '../engine';
import type { Graph } from '../graph/graph';
import { consoleBus } from '../../shared/log';

/**
 * Pipeline warm-up: after a project is loaded the first real evaluation would stall on `createRenderPipelineAsync` for every node
 * type. We pre-build them at idle time by evaluating the graph once at 1/16 resolution (tiny textures, same pipelines: a pipeline
 * is keyed by shader + defines + format, not by size). Runs in small batches, yields between batches, backs off while the user
 * interacts, never touches Export nodes and never throws.
 */
export interface WarmupResult {
  nodes: number;
  batches: number;
  ms: number;
  skipped: boolean;
}

const yieldIdle = (): Promise<void> =>
  new Promise((r) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(() => r(), { timeout: 250 });
    else setTimeout(r, 16);
  });

export async function warmUpPipelines(engine: Engine, graph: Graph, opts: { batch?: number; scale?: number; maxNodes?: number; isCancelled?: () => boolean } = {}): Promise<WarmupResult> {
  const t0 = performance.now();
  const batchSize = opts.batch ?? 16;
  const scale = opts.scale ?? 1 / 16;
  const ids: string[] = [];
  // one representative per node TYPE is not enough (upstream nodes are evaluated anyway), but dedupe by type for the targets
  const seenTypes = new Set<string>();
  for (const n of graph.nodes.values()) {
    if (n.type.startsWith('export.') || seenTypes.has(n.type)) continue;
    seenTypes.add(n.type);
    ids.push(n.id);
    if (ids.length >= (opts.maxNodes ?? 200)) break;
  }
  let batches = 0;
  let nodes = 0;
  try {
    for (let i = 0; i < ids.length; i += batchSize) {
      if (opts.isCancelled?.() || engine.scheduler.currentGraph !== graph) return { nodes, batches, ms: performance.now() - t0, skipped: true };
      await yieldIdle();
      const slice = ids.slice(i, i + batchSize).map((nodeId) => ({ nodeId }));
      // Retry while the scheduler is busy (interaction has priority); give up after ~3 s so we never starve.
      let done: boolean | null = null;
      for (let tries = 0; tries < 30 && done === null; tries++) {
        done = await engine.scheduler.runExclusive(async () => {
          const res = await engine.evaluator.evaluate(graph, slice, { scale, time: 0 });
          res.release();
          return true;
        });
        if (done === null) await new Promise((r) => setTimeout(r, 100));
      }
      if (done === null) return { nodes, batches, ms: performance.now() - t0, skipped: true };
      nodes += slice.length;
      batches++;
    }
  } catch (e) {
    consoleBus.warn(`Pipeline warm-up stopped: ${(e as Error).message}`, { source: 'eval' });
  }
  engine.scheduler.invalidate();
  return { nodes, batches, ms: performance.now() - t0, skipped: false };
}
