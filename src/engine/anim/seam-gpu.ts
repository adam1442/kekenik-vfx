/**
 * Loop seam verifier, GPU side. Renders the loop at a small resolution (the evaluator is borrowed exclusively),
 * reads the frames back (mapAsync, small) and runs the pure analysis of seam.ts.
 */
import { targetKey, type EvalTarget } from '../graph/evaluator';
import type { Graph } from '../graph/graph';
import type { Engine } from '../engine';
import { readTextureFloat32 } from '../resources/readback';
import { animRange } from './timebase';
import { analyzeSeam, type SeamReport } from './seam';

export interface SeamOptions {
  /** Longest side in pixels used for the comparison (default 64). */
  size?: number;
  /** Cap on frames (default 512). */
  maxFrames?: number;
  onProgress?(done: number, total: number): void;
  cancel?: { cancelled: boolean };
}

export async function verifyLoopSeam(engine: Engine, graph: Graph, target: EvalTarget, o: SeamOptions = {}): Promise<SeamReport> {
  const range = animRange(graph.timeline, graph.settings.loopLength);
  const n = Math.min(range.end - range.start, o.maxFrames ?? 512);
  const fps = graph.settings.fps;
  const scale = Math.min(1, (o.size ?? 64) / Math.max(graph.settings.width, graph.settings.height));
  const key = targetKey(target);
  const grab = async (frame: number): Promise<Float32Array> => {
    const res = await engine.evaluator.evaluate(graph, [target], { time: frame / fps, scale });
    try {
      const err = res.errors.get(target.nodeId);
      if (err) throw new Error(`Node failed: ${err}`);
      const v = res.values.get(key);
      if (!v || v.kind !== 'texture') throw new Error('The target does not produce a texture.');
      return await readTextureFloat32(engine.gpu, engine.mm, v.tex.texture, v.tex.format, v.width, v.height);
    } finally {
      res.release();
    }
  };
  return engine.scheduler.runExclusiveForce(async () => {
    const frames: Float32Array[] = [];
    for (let i = 0; i < n; i++) {
      if (o.cancel?.cancelled) throw new Error('cancelled');
      frames.push(await grab(range.start + i));
      o.onProgress?.(i + 1, n + 1);
    }
    const wrap = n === range.end - range.start ? await grab(range.end) : undefined; // frame N must equal frame 0
    o.onProgress?.(n + 1, n + 1);
    return analyzeSeam(frames, wrap);
  });
}
