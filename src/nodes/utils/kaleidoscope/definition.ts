import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/** utils.kaleidoscope: N-fold mirror / rotational symmetry around a centre, or mirrored tiling. Gray + Color. */
export const SHADER = defineShader('utils_kaleidoscope.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'center', type: 'vec2f' },
  { name: 'source', type: 'vec2f' },
  { name: 'tiles', type: 'vec2f' },
  { name: 'shift', type: 'vec2f' },
  { name: 'rotation', type: 'f32' },
  { name: 'angle_offset', type: 'f32' },
  { name: 'zoom', type: 'f32' },
  { name: 'radius_offset', type: 'f32' },
  { name: 'segments', type: 'i32' },
  { name: 'mirror', type: 'u32' },
  { name: 'mode', type: 'u32' },
]);

export default variants((k) =>
  defineNode({
    id: idOf('utils.kaleidoscope', k),
    version: 1,
    category: 'utils',
    title: titleOf('Kaleidoscope', k),
    description: 'N-fold mirror or rotational symmetry around a centre (mandalas, crystals, magic circles, sigils) or a mirrored tiling.',
    keywords: ['kaleidoscope', 'mandala', 'symmetry', 'mirror', 'radial', 'fold', 'crystal', 'sigil', 'hex'],
    icon: 'transform',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.enum('mode', 'radial', [{ value: 'radial', label: 'Radial (wedges)' }, { value: 'grid', label: 'Mirrored grid' }], { group: 'Symmetry' }),
      P.int('segments', 6, { group: 'Symmetry', min: 1, max: 64, softMax: 16, tooltip: 'Number of wedges around the centre.' }),
      P.bool('mirror', true, { group: 'Symmetry', tooltip: 'Reflect every second wedge (seamless). Off = pure rotational repeat.' }),
      P.vec2('center', [0.5, 0.5], { group: 'Symmetry', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true, tooltip: 'Centre of the symmetry.' }),
      P.vec2('source', [0.5, 0.5], { group: 'Source', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true, tooltip: 'Point of the input that is mapped onto the centre.' }),
      P.float('rotation', 0, { group: 'Source', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 0.5, display: 'angle', animatable: true, tooltip: 'Rotates the wedge layout.' }),
      P.float('angle_offset', 0, { group: 'Source', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 0.5, display: 'angle', animatable: true, tooltip: 'Rotates the picked part of the input inside the wedge (spins the pattern).' }),
      P.float('zoom', 1, { group: 'Source', min: 0.05, max: 16, softMax: 4, step: 0.01, animatable: true }),
      P.float('radius_offset', 0, { group: 'Source', min: -2, max: 2, softMin: -0.5, softMax: 0.5, step: 0.005, animatable: true, tooltip: 'Moves the lookup outward: animate for an endless zoom-out.' }),
      P.vec2('tiles', [2, 2], { group: 'Grid', min: 1, max: 32, step: 1, labels: ['X', 'Y'], linkable: true }),
      P.vec2('shift', [0, 0], { group: 'Grid', min: -8, max: 8, step: 0.005, animatable: true }),
    ],
    gizmos: [{ id: 'center', label: 'Symmetry centre', type: 'point', viewport: '2d', space: 'uv', param: 'center' }],
    cost: { gpu: 'low', tiling: 'global', temporaries: 0 },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
    gallery: [
      { name: 'Hex mandala', params: { segments: 6, mirror: true } },
      { name: '12-fold sigil', params: { segments: 12, mirror: false } },
      { name: 'Mirror tiles', params: { mode: 'grid', tiles: [3, 3] } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Kaleidoscope needs an input');
      const p = ctx.params;
      const out = ctx.tex(pinOf(k));
      ctx.pass({
        label: 'kaleidoscope',
        target: out,
        shader: SHADER,
        uniforms: {
          layout: LAYOUT,
          values: {
            center: p.vec2('center'),
            source: p.vec2('source'),
            tiles: p.vec2('tiles'),
            shift: p.vec2('shift'),
            rotation: p.num('rotation'),
            angle_offset: p.num('angle_offset'),
            zoom: p.num('zoom'),
            radius_offset: p.num('radius_offset'),
            segments: p.int('segments'),
            mirror: p.bool('mirror'),
            mode: p.enumIndex('mode'),
          },
        },
        textures: [src.tex],
        ss: 1,
      });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);
