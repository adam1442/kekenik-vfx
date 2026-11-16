import type { GizmoDecl } from '../../../engine/graph/node';
import { defineNode } from '../../../engine/graph/node';
import { P, type ParamDef, type ParamValue } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.lattice — warp the input with a 4x4 control lattice (16 draggable point gizmos). Catmull-Rom interpolation: the
 * displacement AT a control point equals its parameter. `periodic` (default) wraps the lattice so the warp is seamless on
 * tiling textures; `clamped` pins the border. Params p<row><col> store displacements in UV units; Jitter adds a seeded random
 * displacement to every point (handy for organic warps).
 */
export const SHADER = defineShader('utils_lattice.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'd', type: 'vec4f', count: 8 }, { name: 'periodic', type: 'u32' }, { name: 'amount', type: 'f32' }]);

const pid = (cx: number, cy: number): string => `p${cy}${cx}`;
/** Rest position (UV) of control point (cx, cy) (pure, tested). */
export const latticeRest = (cx: number, cy: number, periodic: boolean): [number, number] => (periodic ? [cx / 4, cy / 4] : [cx / 3, cy / 3]);

/** Deterministic jitter in [-1,1]^2 for a lattice point (CPU, no GPU hash needed). */
export function latticeJitter(cx: number, cy: number, seed: number): [number, number] {
  const h = (n: number): number => {
    let x = (Math.imul(n, 0x27d4eb2d) ^ Math.imul(seed + 1, 0x165667b1)) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
  const k = cy * 4 + cx;
  return [h(k * 2 + 1) * 2 - 1, h(k * 2 + 2) * 2 - 1];
}

const pointParams: ParamDef[] = [];
const gizmos: GizmoDecl[] = [];
for (let cy = 0; cy < 4; cy++)
  for (let cx = 0; cx < 4; cx++) {
    pointParams.push(P.vec2(pid(cx, cy), [0, 0], { group: 'Control points', label: `Point ${cx + 1}, ${cy + 1}`, min: -1, max: 1, softMin: -0.5, softMax: 0.5, step: 0.002, animatable: true, advanced: true }));
    gizmos.push({
      id: `pt_${cx}${cy}`,
      label: `Lattice point ${cx + 1}, ${cy + 1}`,
      type: 'point',
      viewport: '2d',
      space: 'uv',
      param: {
        param: pid(cx, cy),
        map: {
          to: (raw: ParamValue, v) => {
            const r = latticeRest(cx, cy, v.mode !== 'clamped');
            const a = raw as number[];
            return [a[0] + r[0], a[1] + r[1]];
          },
          from: (g, v) => {
            const r = latticeRest(cx, cy, v.mode !== 'clamped');
            const a = g as number[];
            return [a[0] - r[0], a[1] - r[1]];
          },
        },
      },
    });
  }

export default variants((k) =>
  defineNode({
    id: idOf('utils.lattice', k),
    version: 1,
    category: 'utils',
    title: titleOf('Lattice', k),
    description: 'Warps the input by dragging the points of a 4x4 control lattice.',
    keywords: ['warp', 'deform', 'ffd', 'free form', 'lattice', 'distort', 'bend'],
    icon: 'lattice',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.enum('mode', 'periodic', [{ value: 'periodic', label: 'Periodic (seamless)' }, { value: 'clamped', label: 'Clamped (border pinned)' }], { group: 'Lattice' }),
      P.float('amount', 1, { group: 'Lattice', min: -4, max: 4, softMin: 0, softMax: 2, step: 0.01, animatable: true, tooltip: 'Scales all displacements.' }),
      P.float('jitter', 0, { group: 'Lattice', min: 0, max: 0.5, step: 0.005, animatable: true, tooltip: 'Seeded random displacement added to every point (UV units).' }),
      P.seed('jitter_seed', 1, { group: 'Lattice' }),
      ...pointParams,
    ],
    gizmos,
    cost: { gpu: 'low', tiling: 'global' },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
    gallery: [{ name: 'Jittered', params: { jitter: 0.08, jitter_seed: 4 } }, { name: 'Big jitter', params: { jitter: 0.2, jitter_seed: 9 } }],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Lattice needs an input');
      const p = ctx.params;
      const jit = p.num('jitter');
      const seed = p.seed('jitter_seed');
      const flat = new Array<number>(32).fill(0);
      for (let cy = 0; cy < 4; cy++)
        for (let cx = 0; cx < 4; cx++) {
          const [x, y] = p.vec2(pid(cx, cy));
          const [jx, jy] = latticeJitter(cx, cy, seed);
          const i = cy * 4 + cx;
          flat[i * 2] = x + jx * jit;
          flat[i * 2 + 1] = y + jy * jit;
        }
      const out = ctx.tex(pinOf(k));
      ctx.pass({ label: 'lattice', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { d: flat, periodic: p.str('mode') === 'periodic', amount: p.num('amount') } }, textures: [src.tex] });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);
