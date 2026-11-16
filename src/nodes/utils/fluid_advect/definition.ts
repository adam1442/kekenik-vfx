import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.fluid_advect (Kekenik "Fluid Advect"): multi-step curl-noise advection of the input. Turns plain shapes into curling
 * stylised smoke / ink / nebula tendrils. Gray + Color variants. Tiling aware (periodic lattices), loops in Z (evolution).
 */
export const SHADER = defineShader('utils_fluid_advect.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'scale', type: 'vec2f' },
  { name: 'offset', type: 'vec2f' },
  { name: 'drift', type: 'vec2f' },
  { name: 'strength', type: 'f32' },
  { name: 'strength_mod_k', type: 'f32' },
  { name: 'roughness', type: 'f32' },
  { name: 'evolution', type: 'f32' },
  { name: 'freq_gain', type: 'f32' },
  { name: 'step_decay', type: 'f32' },
  { name: 'divergence', type: 'f32' },
  { name: 'steps', type: 'i32' },
  { name: 'octaves', type: 'i32' },
  { name: 'z_cells', type: 'i32' },
  { name: 'seed', type: 'u32' },
]);

export default variants((k) =>
  defineNode({
    id: idOf('utils.fluid_advect', k),
    version: 1,
    category: 'utils',
    title: titleOf('Fluid Advect', k),
    description:
      'Pushes the input back along a divergence-free curl-noise velocity field several times (finer swirls every step): thin curling smoke / ink tendrils from any simple shape. Tiles and loops.',
    keywords: ['fluid', 'smoke', 'advect', 'advection', 'curl', 'swirl', 'ink', 'wisp', 'turbulence', 'warp', 'tendril'],
    icon: 'noise',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.float('strength', 0.28, { group: 'Flow', min: 0, max: 4, softMax: 1, step: 0.005, display: 'percent', animatable: true, modulatable: true, tooltip: 'Total displacement of all steps (fraction of the smaller side).' }),
      P.int('steps', 6, { group: 'Flow', min: 1, max: 16, tooltip: 'Advection steps: more steps = longer, finer tendrils.' }),
      P.vec2('scale', [2, 2], { group: 'Flow', min: 0.1, max: 64, softMin: 1, softMax: 8, step: 1, labels: ['X', 'Y'], linkable: true, animatable: true, tooltip: 'Cells of the first (largest) curl across the image. Whole numbers are used while tiling.' }),
      P.float('freq_gain', 1.45, { group: 'Flow', label: 'Frequency gain', min: 1, max: 3, step: 0.01, tooltip: 'Every step multiplies the noise frequency by this factor.' }),
      P.float('step_decay', 0.78, { group: 'Flow', label: 'Step decay', min: 0.2, max: 1.5, step: 0.01, tooltip: 'Relative weight of every following step (< 1 = fine curls are weaker).' }),
      P.float('divergence', 0, { group: 'Flow', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: '0 = pure swirling curl, 100% = puffy gradient flow (billowing).' }),
      P.vec2('drift', [0, 0], { group: 'Flow', min: -2, max: 2, softMin: -0.5, softMax: 0.5, step: 0.005, animatable: true, tooltip: 'Constant wind / buoyancy (UV units, y down). Animate with a whole tile for seamless scrolling.' }),
      P.int('octaves', 3, { group: 'Noise', min: 1, max: 6 }),
      P.float('roughness', 0.5, { group: 'Noise', min: 0, max: 1, step: 0.01, display: 'percent' }),
      P.vec2('offset', [0, 0], { group: 'Noise', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true }),
      P.float('evolution', 0, { group: 'Animation', min: -1000, max: 1000, softMin: 0, softMax: 1, step: 0.01, animatable: true, tooltip: '0 -> 1 is one seamless loop.' }),
      P.int('z_cells', 2, { group: 'Animation', label: 'Z layers', min: 1, max: 16 }),
      P.seed('seed', 3, { group: 'Noise' }),
    ],
    gizmos: [{ id: 'pattern', label: 'Noise offset', type: 'transform', viewport: '2d', space: 'uv', position: { param: 'offset', map: { scale: -1, offset: 0.5 } }, scale: { param: 'scale', map: { reciprocal: true } }, tilingSafe: true }],
    cost: { gpu: 'high', tiling: 'global', temporaries: 0 },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
    gallery: [
      { name: 'Thin tendrils', params: { strength: 0.4, steps: 8, freq_gain: 1.6 } },
      { name: 'Billowing', params: { divergence: 0.7, strength: 0.25, steps: 4 } },
      { name: 'Rising wisps', params: { drift: [0, -0.15], strength: 0.2 } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Fluid Advect needs an input');
      const p = ctx.params;
      const ms = ctx.mod('strength');
      const out = ctx.tex(pinOf(k));
      ctx.pass({
        label: 'fluid advect',
        target: out,
        shader: SHADER,
        uniforms: {
          layout: LAYOUT,
          values: {
            scale: p.vec2('scale'),
            offset: p.vec2('offset'),
            drift: p.vec2('drift'),
            strength: p.num('strength'),
            strength_mod_k: ms.k,
            roughness: p.num('roughness'),
            evolution: p.num('evolution'),
            freq_gain: p.num('freq_gain'),
            step_decay: p.num('step_decay'),
            divergence: p.num('divergence'),
            steps: p.int('steps'),
            octaves: p.int('octaves'),
            z_cells: p.int('z_cells'),
            seed: p.seed('seed'),
          },
        },
        textures: [src.tex, ms.tex?.tex ?? null],
        ss: 1,
      });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);
