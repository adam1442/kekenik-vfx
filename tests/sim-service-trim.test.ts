import { describe, expect, it } from 'vitest';
import { SimulationService } from '../src/engine/sim/service';

/** Idle housekeeping of the simulation service (no GPU: the service is built from stubs and fed fake runtimes). */
type Fake = { working: boolean; queued: boolean; lastUse: number; baked: boolean; cursor: number; rev: number; backend: { dispose(): void } | null; spec: { nodeId: string; nodeName: string }; cache: { clear(f?: boolean): void }; cancel: number; status: string; progress: number };

function make(nodes: string[]): { svc: SimulationService; runtimes: Map<string, Fake>; graph: { nodes: Map<string, { type: string }> } } {
  const graph = { nodes: new Map(nodes.map((n) => [n, { type: n.startsWith('sg') ? 'subgraph.x' : 'simulation.fluid2d' }])) };
  const deps = { gpu: {}, mm: { registerEvictor: () => undefined }, runner: {}, evaluator: {}, scheduler: { currentGraph: graph, invalidate: () => undefined } };
  const svc = new SimulationService(deps as never);
  return { svc, runtimes: (svc as unknown as { runtimes: Map<string, Fake> }).runtimes, graph };
}
const fake = (id: string, lastUse: number, over: Partial<Fake> = {}): Fake => ({ working: false, queued: false, lastUse, baked: false, cursor: 7, rev: 0, backend: { dispose: () => undefined }, spec: { nodeId: id, nodeName: id }, cache: { clear: () => undefined }, cancel: 0, status: 'idle', progress: 0, ...over });

describe('SimulationService.trim', () => {
  it('releases the live state of an idle node but keeps the runtime (cache stays, re-simulation restores)', () => {
    const { svc, runtimes } = make(['a']);
    let disposed = 0;
    runtimes.set('a', fake('a', 0, { backend: { dispose: () => disposed++ } }));
    svc.trim(1000); // not idle long enough
    expect(disposed).toBe(0);
    svc.trim(svc.idleReleaseMs + 1);
    expect(disposed).toBe(1);
    expect(runtimes.get('a')!.backend).toBeNull();
    expect(runtimes.get('a')!.cursor).toBe(-2);
  });
  it('forgets a deleted node after the idle time (baked: after the longer undo window), never a busy one', () => {
    const { svc, runtimes } = make([]);
    runtimes.set('gone', fake('gone', 0, { backend: null }));
    runtimes.set('bakedGone', fake('bakedGone', 0, { backend: null, baked: true }));
    runtimes.set('busy', fake('busy', 0, { backend: null, working: true }));
    svc.trim(svc.idleReleaseMs + 1);
    expect(runtimes.has('gone')).toBe(false);
    expect(runtimes.has('bakedGone')).toBe(true);
    expect(runtimes.has('busy')).toBe(true);
    svc.trim(svc.idleBakedForgetMs + 1);
    expect(runtimes.has('bakedGone')).toBe(false);
  });
  it('keeps nodes that live inside a subgraph instance (prefixed ids) and baked live state', () => {
    const { svc, runtimes } = make(['sg1']);
    runtimes.set('sg1/inner', fake('sg1/inner', 0, { backend: null }));
    svc.trim(svc.idleBakedForgetMs + 1);
    expect(runtimes.has('sg1/inner')).toBe(true);
  });
});
