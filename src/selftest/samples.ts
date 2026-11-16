import type { GraphData } from '../engine/graph/graph';
import { targetKey } from '../engine/graph/evaluator';
import { loadProjectRobust } from '../engine/io/robust-load';
import { readTextureFloat32 } from '../engine/resources/readback';
import type { TextureValue } from '../engine/resources/values';
import { SAMPLE_INDEX, loadGraphText, loadMeta } from '../samples/catalog';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/**
 * GPU evaluation of EVERY file-based sample. Names start with `10 · sample`. For each sample: load it through the
 * migration pipeline, evaluate the preview node + the source of every export node at three timeline frames at a small resolution,
 * require no node errors and finite pixels, and report time + peak memory (also collected by the "Evaluate all samples" button
 * of the self-test page: see `SAMPLE_TEST_PREFIX` and `sampleResultRow`).
 */
export const SAMPLE_TEST_PREFIX = '10 · sample';
const EVAL_PX = 128;
/** Last per-sample numbers (filled by the tests, read by the results table). */
export const sampleResults = new Map<string, { ms: number; peakMB: number; targets: number; frames: number }>();

const exportSources = (g: GraphData): { nodeId: string; pinId: string }[] => {
  const exportIds = new Set(g.nodes.filter((n) => n.type.startsWith('export.')).map((n) => n.id));
  const seen = new Set<string>();
  const out: { nodeId: string; pinId: string }[] = [];
  for (const l of g.links) {
    const k = `${l.from.node}.${l.from.pin}`;
    if (exportIds.has(l.to.node) && !seen.has(k)) {
      seen.add(k);
      out.push({ nodeId: l.from.node, pinId: l.from.pin });
    }
  }
  return out;
};

export function sampleTests(h: Helpers): TestDef[] {
  const { engineOf, dispose } = h;
  return SAMPLE_INDEX.samples.map((s): TestDef => ({
    name: `${SAMPLE_TEST_PREFIX} "${s.id}" evaluates at ${EVAL_PX}px: no node errors, finite pixels (preview + every export source, 3 frames)`,
    async run(env) {
      const e = engineOf(env, 512 * 1024 * 1024);
      const t0 = performance.now();
      try {
        const meta = await loadMeta(s.id);
        const { graph } = loadProjectRobust(env.registry, await loadGraphText(s.id));
        const prevType = graph.nodes.get(meta.preview)?.type ?? '';
        const prevPin = env.registry.get(prevType)?.outputs.find((o) => ['gray', 'color', 'normal', 'uv', 'vector'].includes(o.type))?.id ?? 'output';
        const targets = [{ nodeId: meta.preview, pinId: prevPin }, ...exportSources(graph.toData())];
        const loop = graph.settings.loopLength;
        const frames = [...new Set([0, Math.min(meta.thumb.frame ?? 0, loop - 1), Math.floor(loop / 2), loop - 1])].slice(0, 3);
        const scale = Math.min(1, EVAL_PX / Math.max(graph.settings.width, graph.settings.height));
        const notes: string[] = [];
        for (const f of frames) {
          const res = await e.evaluator.evaluate(graph, targets.map((t) => ({ nodeId: t.nodeId, pinId: t.pinId })), { scale, time: f / graph.settings.fps, useCache: false });
          try {
            if (res.errors.size) throw new Error(`frame ${f}: ${[...res.errors].map(([n, m]) => `${n}: ${m}`).join('; ')}`);
            for (const t of targets) {
              const v = res.values.get(targetKey(t));
              if (!v) throw new Error(`frame ${f}: no value for ${t.nodeId}.${t.pinId}`);
              if (v.kind !== 'texture') continue; // meshes / flipbooks / splines: produced without error is the check
              const tv = v as TextureValue;
              const px = await readTextureFloat32(e.gpu, e.mm, tv.tex.texture, tv.tex.format, tv.width, tv.height);
              let sum = 0;
              for (let i = 0; i < px.length; i++) {
                if (!Number.isFinite(px[i])) throw new Error(`frame ${f}: non-finite pixel in ${t.nodeId}.${t.pinId}`);
                sum += px[i];
              }
              if (f === frames[0] && t === targets[0]) notes.push(`preview mean ${(sum / px.length).toFixed(3)}`);
            }
          } finally {
            res.release();
          }
        }
        const ms = performance.now() - t0;
        const peakMB = e.mm.peakBytes / 1048576;
        sampleResults.set(s.id, { ms, peakMB, targets: targets.length, frames: frames.length });
        return `${ms.toFixed(0)} ms · peak ${peakMB.toFixed(1)} MB · ${targets.length} targets × ${frames.length} frames · ${notes.join(', ')}`;
      } finally {
        dispose(e);
      }
    },
  }));
}
