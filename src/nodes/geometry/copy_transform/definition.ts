import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { copyAndTransform } from '../../../engine/mesh/ops';

/** geometry.copy_transform — N copies with an incremental transform and attribute ranges. */
export default defineNode({
  id: 'geometry.copy_transform',
  version: 1,
  category: 'geometry',
  title: 'Copy and Transform',
  description: 'Makes N copies; copy i is the step transform applied i times about the pivot (exact matrix composition). Writes id (copy index), age and pivot per copy, plus optional colour / pscale / age ranges and seeded jitter. Spirals, fans, stacked rings, trails.',
  keywords: ['copy', 'array', 'repeat', 'step', 'incremental', 'spiral', 'fan', 'stack', 'duplicate'],
  icon: 'cat-geometry',
  inputs: [{ id: 'input', name: 'Mesh', type: 'mesh' }],
  outputs: [{ id: 'output', name: 'Mesh', type: 'mesh' }],
  common: { texture: false },
  params: [
    P.int('copies', 4, { tab: 'Copies', min: 1, max: 100000, softMax: 64, animatable: true }),
    P.vec3('translate', [0, 0, 0.5], { tab: 'Copies', group: 'Step', step: 0.01, softMin: -10, softMax: 10, animatable: true }),
    P.vec3('rotate', [0, 0, 15], { tab: 'Copies', group: 'Step', step: 1, softMin: -360, softMax: 360, unit: '°', animatable: true }),
    P.vec3('scale', [1, 1, 1], { tab: 'Copies', group: 'Step', step: 0.001, softMin: 0.5, softMax: 1.5, animatable: true, tooltip: 'Per-copy multiplier (compounds).' }),
    P.vec3('pivot', [0, 0, 0], { tab: 'Copies', group: 'Step', step: 0.01, softMin: -10, softMax: 10, animatable: true }),
    P.vec3('jitter_translate', [0, 0, 0], { tab: 'Copies', group: 'Jitter', step: 0.01, min: 0, softMax: 2 }),
    P.vec3('jitter_rotate', [0, 0, 0], { tab: 'Copies', group: 'Jitter', step: 1, min: 0, softMax: 180, unit: '°' }),
    P.float('jitter_scale', 0, { tab: 'Copies', group: 'Jitter', min: 0, max: 0.99, step: 0.01, display: 'percent' }),
    P.seed('seed', 1, { tab: 'Copies', group: 'Jitter' }),
    P.color('color_start', [1, 1, 1, 1], { tab: 'Ranges', group: 'Color (Cd)', hdr: true }),
    P.color('color_end', [1, 1, 1, 1], { tab: 'Ranges', group: 'Color (Cd)', hdr: true }),
    P.float('pscale_start', 1, { tab: 'Ranges', group: 'pscale attribute', min: 0, max: 1000, softMax: 4, step: 0.01 }),
    P.float('pscale_end', 1, { tab: 'Ranges', group: 'pscale attribute', min: 0, max: 1000, softMax: 4, step: 0.01 }),
    P.float('age_start', 0, { tab: 'Ranges', group: 'age attribute', softMin: 0, softMax: 1, step: 0.01 }),
    P.float('age_end', 1, { tab: 'Ranges', group: 'age attribute', softMin: 0, softMax: 1, step: 0.01 }),
  ],
  gizmos: [{ id: 'xf', type: 'transform3d', viewport: '3d', space: 'world', position: 'translate', rotation: 'rotate', scale: 'scale', pivot: 'pivot' }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Copy and Transform needs a mesh');
    const p = ctx.params;
    const out = copyAndTransform(src, {
      copies: p.int('copies'), translate: p.vec3('translate'), rotate: p.vec3('rotate'), scale: p.vec3('scale'), pivot: p.vec3('pivot'),
      jitter_translate: p.vec3('jitter_translate'), jitter_rotate: p.vec3('jitter_rotate'), jitter_scale: p.num('jitter_scale'), seed: p.seed('seed'),
      color_start: p.rgba('color_start'), color_end: p.rgba('color_end'), pscale_start: p.num('pscale_start'), pscale_end: p.num('pscale_end'), age_start: p.num('age_start'), age_end: p.num('age_end'),
    });
    return { output: meshValue(out, 'mesh') };
  },
});
