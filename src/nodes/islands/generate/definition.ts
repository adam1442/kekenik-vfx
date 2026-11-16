import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { autoIterations, islandSlots, LABELS_SHADER, MAPS_LAYOUT, MAPS_SHADER, recordLabels, recordStats, MAX_ISLAND_OPTIONS } from '../../_shared/islands';
import { CCL_SHADER, CCL_LAYOUT, STATS_SHADER, STATS_LAYOUT } from '../../_shared/islands';
import { uvModeIndex, uvOutParam } from '../../_shared/uvparams';

/**
 * islands.generate — connected-component labelling of a mask on the GPU (Substance "Flood Fill" family).
 *  1. union-find in compute shaders (init, N x [hook, compress]; 4 or 8 connectivity; wraps on tiling axes; bounded rounds),
 *  2. exact label texture (root pixel = first pixel of the island in raster order),
 *  3. per-island statistics (bounding box relative to the root so wrapped islands work, pixel count, centre of mass) by
 *     atomics into an open-addressing hash table (`Max islands` entries; overflow degrades to one-pixel islands),
 *  4. outputs: Island Map (bbox) / ID / Size / Centre / Labels. Data format: docs/CONTRACTS.md "Island data format".
 * Cost at 1024^2: 2 x ~14 compute dispatches of 1 M threads + 3 compute passes + 4 fullscreen passes (~1-2 ms estimated).
 */
export default defineNode({
  id: 'islands.generate',
  version: 1,
  category: 'islands',
  title: 'Islands Generate',
  description: 'Finds the connected islands of a mask and describes every one of them: bounding box (Island Map for the other Islands nodes), random ID, size, centre of mass and an exact label. Tiling aware, 4 or 8 connectivity.',
  keywords: ['islands', 'flood fill', 'connected components', 'labeling', 'cluster', 'id', 'bounding box', 'per element', 'shards'],
  icon: 'islands',
  inputs: [{ id: 'input', name: 'Mask', type: 'gray' }],
  outputs: [
    { id: 'islands', name: 'Island Map', type: 'color', tooltip: 'rgba = bounding box (min x, min y, width, height) of the island in UV units. Wire into the other Islands nodes.' },
    { id: 'id', name: 'ID', type: 'gray', tooltip: 'Random gray per island (hash of the Island Map).' },
    { id: 'size', name: 'Size', type: 'gray', tooltip: 'Island area relative to Size reference.' },
    { id: 'center', name: 'Centre', type: 'uv', tooltip: 'Centre of mass of the island (absolute UV coordinate, same for every pixel of the island).' },
    { id: 'labels', name: 'Labels', type: 'color', tooltip: 'Exact label: packed coordinate of the first pixel of the island (xhi, xlo, yhi, ylo).' },
  ],
  params: [
    P.float('threshold', 0.5, { group: 'Mask', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
    P.bool('invert', false, { group: 'Mask' }),
    P.enum('connectivity', 'eight', [{ value: 'four', label: '4-connected' }, { value: 'eight', label: '8-connected' }], { group: 'Mask' }),
    P.float('size_reference', 0.1, { group: 'Output', label: 'Size reference', min: 0.0001, max: 1, softMax: 0.5, step: 0.001, display: 'percent', animatable: true, tooltip: 'Fraction of the image area that maps to 100% in the Size output.' }),
    P.seed('seed', 1, { group: 'Output', label: 'ID seed' }),
    P.enum('max_islands', '65536', MAX_ISLAND_OPTIONS.map((n) => ({ value: String(n), label: `${n.toLocaleString('en-US')}` })), { group: 'Limits', label: 'Max islands', tooltip: 'Capacity of the statistics table (memory = 96 bytes per island). Extra islands degrade to one-pixel boxes.' }),
    P.int('rounds', 0, { group: 'Limits', label: 'Rounds (0 = auto)', min: 0, max: 64, tooltip: 'Union-find rounds. Auto = log2(size) + 4, which converged for every tested shape in 2-5 rounds.' }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'medium', tiling: 'global', temporaries: 3 },
  shaders: [
    { source: LABELS_SHADER, textures: 0, storage: 1 },
    { source: MAPS_SHADER, uniforms: MAPS_LAYOUT, textures: 2, storage: 1 },
  ],
  gallery: [
    { name: '4-connected', params: { connectivity: 'four' } },
    { name: 'Inverted mask', params: { invert: true } },
    { name: 'Small table', params: { max_islands: '16384' } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Islands Generate needs a mask input');
    const p = ctx.params;
    const rounds = p.int('rounds') > 0 ? p.int('rounds') : autoIterations(ctx.frame.width, ctx.frame.height);
    const labels = recordLabels(ctx, src.tex, { threshold: p.num('threshold'), invert: p.bool('invert'), eight: p.str('connectivity') === 'eight', rounds });
    const slots = islandSlots(Number(p.str('max_islands')));
    const dec = recordStats(ctx, labels, slots);
    const base = { cap_mask: slots - 1, seed: p.seed('seed') >>> 0, uv_mode: uvModeIndex(p.str('uv_out')), size_ref: p.num('size_reference') };
    const run = (which: number, pin: 'color' | 'gray' | 'uv', label: string, texs: (typeof labels | null)[]) => {
      const t = ctx.tex(pin);
      ctx.pass({ label: `islands ${label}`, target: t, shader: MAPS_SHADER, uniforms: { layout: MAPS_LAYOUT, values: { ...base, which } }, textures: texs, storageBuffers: [dec.buffer], ss: 1 });
      return t;
    };
    const map = run(0, 'color', 'map', [labels, null]);
    const size = run(1, 'gray', 'size', [labels, null]);
    const center = run(2, 'uv', 'centre', [labels, null]);
    const id = run(3, 'gray', 'id', [labels, map]);
    return { islands: ctx.result(map, 'color'), id: ctx.result(id, 'gray'), size: ctx.result(size, 'gray'), center: ctx.result(center, 'uv'), labels: ctx.result(labels, 'color') };
  },
});
// Compute shaders are declared for tooling through these exports (the engine's `shaders` list only covers fullscreen passes).
export { CCL_SHADER, CCL_LAYOUT, STATS_SHADER, STATS_LAYOUT };
