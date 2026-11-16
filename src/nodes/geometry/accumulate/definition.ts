import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { stableStringify } from '../../../shared/util';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { accumulateStep, getHistory } from '../../../engine/mesh/history';

/** geometry.accumulate — keeps past states of the input and merges them into a trail. */
export default defineNode({
  id: 'geometry.accumulate',
  version: 1,
  category: 'geometry',
  title: 'Accumulate',
  description:
    'Creates trails: every `Step` seconds the input mesh is stored (at most `Max count` frames and `Max memory` MB, accounted in the shared memory budget) and the output merges the current mesh with the stored ones. Older copies fade (alpha), shrink and drift by a cumulative translate / rotate per step. Point attribute `age` = step / max count. History is rebuilt from the playhead: it resets on rewind, on a long jump and on any parameter change, so playing from the start always reproduces the same trail.',
  keywords: ['accumulate', 'trail', 'history', 'echo', 'ghost', 'afterimage', 'time', 'streak', 'decay'],
  icon: 'cat-geometry',
  inputs: [{ id: 'input', name: 'Mesh', type: 'mesh' }],
  outputs: [{ id: 'output', name: 'Mesh', type: 'mesh' }],
  common: { texture: false },
  timeDependent: true,
  params: [
    P.int('max_count', 12, { tab: 'Accumulate', label: 'Max count', min: 1, max: 256, softMax: 64, tooltip: 'Frames kept (including the current one).' }),
    P.float('step_time', 0.05, { tab: 'Accumulate', label: 'Step (s)', min: 0.0005, max: 60, softMax: 1, step: 0.005, tooltip: 'Seconds between stored frames.' }),
    P.bool('include_current', true, { tab: 'Accumulate', label: 'Include current frame' }),
    P.float('max_memory_mb', 64, { tab: 'Accumulate', label: 'Max memory (MB)', min: 1, max: 1024, softMax: 256, step: 1, tooltip: 'Oldest frames are dropped beyond this cap.' }),
    P.float('decay', 0.15, { tab: 'Fade', label: 'Alpha decay / step', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.float('scale_per_step', 1, { tab: 'Fade', label: 'Scale per step', min: 0, max: 4, softMin: 0.5, softMax: 1.5, step: 0.005 }),
    P.vec3('translate', [0, 0, 0], { tab: 'Drift', label: 'Translate per step', step: 0.005, softMin: -1, softMax: 1, animatable: true }),
    P.vec3('rotate', [0, 0, 0], { tab: 'Drift', label: 'Rotate per step', step: 0.5, softMin: -45, softMax: 45, unit: '°', animatable: true }),
    P.vec3('pivot', [0, 0, 0], { tab: 'Drift', step: 0.01, softMin: -10, softMax: 10 }),
  ],
  gizmos: [{ id: 'drift', type: 'transform3d', viewport: '3d', space: 'world', position: 'translate', rotation: 'rotate', pivot: 'pivot' }],
  gallery: [{ name: 'Short echo', params: { max_count: 6, step_time: 0.04 } }, { name: 'Long fading trail', params: { max_count: 32, decay: 0.08, scale_per_step: 0.98 } }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Accumulate needs a mesh');
    const p = ctx.params;
    // every param except the (cheap to evaluate) time resets the history when it changes
    const key = stableStringify(p.values);
    const out = accumulateStep(getHistory(ctx.node.id), key, ctx.frame.time, src, {
      maxCount: p.int('max_count'), stepTime: p.num('step_time'), decay: p.num('decay'), scalePerStep: p.num('scale_per_step'), translate: p.vec3('translate'), rotate: p.vec3('rotate'), pivot: p.vec3('pivot'),
      maxBytes: p.num('max_memory_mb') * 1024 * 1024, includeCurrent: p.bool('include_current'),
    });
    return { output: meshValue(out, 'mesh') };
  },
});
