import { P } from '../../../engine/params/schema';
import { boltToSplines, flickerSeed, generateBolt } from '../../../engine/spline/lightning';
import { splineValue } from '../../../engine/spline/value';
import { shaderNode, shaderPass } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

export const MAX_SEGMENTS = 192;

/** simulation.lightning: branching bolt as a Spline set (+ mask rendered by an internal spline renderer). */
export default shaderNode({
  id: 'simulation.lightning',
  title: 'Lightning',
  description: 'Branching lightning bolt: recursive midpoint displacement and branch spawning between two points. Outputs a Spline set with per-point width (feeds Spline mask nodes and 3D Sweep) and a mask. Seeded; flicker changes the bolt per frame and loops seamlessly.',
  keywords: ['lightning', 'bolt', 'electric', 'spark', 'branch', 'thunder', 'spline', 'arc', 'zap', 'flicker'],
  category: 'simulation',
  icon: 'sim',
  outputs: [{ id: 'mask', name: 'Mask', type: 'gray' }, { id: 'spline', name: 'Spline', type: 'spline' }],
  extraFields: [{ name: 'segs', type: 'vec4f', count: MAX_SEGMENTS }, { name: 'wids', type: 'vec4f', count: MAX_SEGMENTS }, { name: 'nseg', type: 'u32' }],
  extra: () => ({ segs: new Float32Array(MAX_SEGMENTS * 4), wids: new Float32Array(MAX_SEGMENTS * 4), nseg: 0 }),
  timeDependent: (v) => Number(v.flicker_rate) > 0,
  cost: { gpu: 'low', tiling: 'global' },
  params: [
    P.vec2('p_start', [0.5, 0.05], { group: 'Bolt', label: 'Start', min: -1, max: 2, step: 0.005, animatable: true }),
    P.vec2('p_end', [0.5, 0.95], { group: 'Bolt', label: 'End', min: -1, max: 2, step: 0.005, animatable: true }),
    P.float('jaggedness', 0.45, { group: 'Bolt', label: 'Jaggedness', min: 0, max: 1.5, step: 0.01, animatable: true }),
    P.int('levels', 6, { group: 'Bolt', label: 'Subdivisions', min: 2, max: 8 }),
    P.float('branch_prob', 0.25, { group: 'Branches', label: 'Branch probability', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.float('branch_angle', 35, { group: 'Branches', label: 'Branch angle', min: 5, max: 85, step: 1, display: 'angle' }),
    P.float('branch_length', 0.5, { group: 'Branches', label: 'Branch length', min: 0.05, max: 1, step: 0.01, display: 'percent', tooltip: 'Length of a branch relative to its parent.' }),
    P.int('branch_depth', 2, { group: 'Branches', label: 'Branch depth', min: 0, max: 3 }),
    P.int('max_branches', 12, { group: 'Branches', label: 'Max branches', min: 0, max: 48 }),
    P.float('width', 0.02, { group: 'Stroke', label: 'Main thickness', min: 0.001, max: 0.3, softMax: 0.08, step: 0.001, animatable: true, tooltip: 'Full width at the start (UV, smaller side).' }),
    P.float('taper', 0.35, { group: 'Stroke', label: 'Tip width', min: 0.05, max: 1, step: 0.01, display: 'percent' }),
    P.float('branch_width', 0.55, { group: 'Stroke', label: 'Branch width', min: 0.05, max: 1, step: 0.01, display: 'percent' }),
    P.float('branch_bright', 0.75, { group: 'Stroke', label: 'Branch brightness', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.float('softness', 0.6, { group: 'Stroke', label: 'Edge softness', min: 0.01, max: 1, step: 0.01, display: 'percent' }),
    P.float('glow', 0.5, { group: 'Stroke', label: 'Glow', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.seed('seed', 3, { group: 'Animation', label: 'Seed' }),
    P.float('flicker_rate', 0, { group: 'Animation', label: 'Flicker rate', min: 0, max: 120, softMax: 30, step: 0.5, unit: 'Hz', tooltip: 'New random bolts per second (0 = static).' }),
    P.int('flicker_loop', 8, { group: 'Animation', label: 'Flicker loop (variants)', min: 0, max: 512, softMax: 64, tooltip: 'Number of distinct bolts before the sequence repeats (periodic seeds: the flicker loops). 0 = never repeats.' }),
  ],
  gizmos: [{ id: 'bolt_line', label: 'Bolt', type: 'line', viewport: '2d', space: 'uv', from: 'p_start', to: 'p_end' }],
  gallery: [{ name: 'Strike', params: { jaggedness: 0.5, branch_prob: 0.3 } }, { name: 'Electric arc', params: { jaggedness: 0.25, branch_prob: 0, width: 0.012 } }, { name: 'Forked', params: { branch_prob: 0.5, branch_depth: 3, max_branches: 30 } }],
  shader: src,
  evaluate(ctx, rt) {
    const p = ctx.params;
    const seed = flickerSeed(p.seed('seed'), ctx.frame.time, p.num('flicker_rate'), p.int('flicker_loop'));
    const bolt = generateBolt({
      start: p.vec2('p_start') as [number, number], end: p.vec2('p_end') as [number, number], jaggedness: p.num('jaggedness'), levels: p.int('levels'), branchProb: p.num('branch_prob'), branchAngle: p.num('branch_angle'),
      branchLength: p.num('branch_length'), branchDepth: p.int('branch_depth'), maxBranches: p.int('max_branches'), width: p.num('width'), taper: p.num('taper'), branchWidth: p.num('branch_width'), seed, maxPoints: MAX_SEGMENTS - 12,
    });
    const segs = new Float32Array(MAX_SEGMENTS * 4);
    const wids = new Float32Array(MAX_SEGMENTS * 4);
    let n = 0;
    bolt.paths.forEach((pa, k) => {
      for (let i = 0; i + 1 < pa.pts.length && n < MAX_SEGMENTS; i++, n++) {
        segs.set([pa.pts[i][0], pa.pts[i][1], pa.pts[i + 1][0], pa.pts[i + 1][1]], n * 4);
        wids.set([bolt.widths[k][i], bolt.widths[k][i + 1], pa.depth === 0 ? 1 : p.num('branch_bright') ** pa.depth, 0], n * 4);
      }
    });
    const out: Record<string, unknown> = { spline: splineValue(boltToSplines(bolt)) };
    if (ctx.wants('mask')) {
      const mask = ctx.tex('gray');
      shaderPass(ctx, rt, 'lightning mask', mask, [], { ...rt.values(ctx), segs, wids, nseg: n }, { OUT: 0 });
      out.mask = ctx.result(mask, 'gray');
    }
    return out as never;
  },
});
