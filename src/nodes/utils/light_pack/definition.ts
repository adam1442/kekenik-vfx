import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.light_pack: pseudo-lighting BAKE for flipbooks (not a renderer). A Gray height (e.g. the smoke body) becomes a
 * normal by central differences (resolution independent: slope per UV unit * `strength`), then three directional lights are baked into
 * the channels: R = light A, G = light B, B = light C, A = alpha (optional Alpha input, or the height). Engines recombine them with the
 * real light direction (weights = dot(light dir, map direction)). Per light: azimuth (deg, counter-clockwise from +X on screen), shared
 * elevation, wrap (soft terminator) and ambient floor. `preview` output mode shows the average as grey. Tiling-aware (wrapped taps).
 * Defaults: A = top-left, B = top-right, C = bottom (under / back light). Limitations: 2.5D fake, no shadows or occlusion.
 */
export const SHADER = defineShader('utils_light_pack.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'strength', type: 'f32' },
  { name: 'elevation', type: 'f32' },
  { name: 'angle_a', type: 'f32' },
  { name: 'angle_b', type: 'f32' },
  { name: 'angle_c', type: 'f32' },
  { name: 'wrap', type: 'f32' },
  { name: 'ambient', type: 'f32' },
  { name: 'output_mode', type: 'u32' },
  { name: 'has_alpha', type: 'u32' },
]);

/** CPU reference: lit value of one light on surface normal `n` (unit) for light azimuth / elevation (deg). Screen y is down. */
export function lightRef(n: [number, number, number], azimuthDeg: number, elevationDeg: number, wrap: number, ambient: number): number {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const l = [Math.cos(az) * Math.cos(el), -Math.sin(az) * Math.cos(el), Math.sin(el)];
  const nl = n[0] * l[0] + n[1] * l[1] + n[2] * l[2];
  const lit = Math.min(1, Math.max(0, (nl + wrap) / (1 + wrap)));
  return ambient + (1 - ambient) * lit;
}

export default defineNode({
  id: 'utils.light_pack',
  version: 1,
  category: 'utils',
  title: 'Light Pack (Fake Lighting)',
  description: 'Bakes three directional light maps (+ alpha) from a height / density map into RGBA for smoke and cloud flipbooks. The engine recombines the channels with the real light direction.',
  keywords: ['lighting', 'light map', 'smoke', 'flipbook', 'normal', 'directional', 'rlt', 'pack', 'bake', 'fake light', 'volume', 'clouds'],
  icon: 'normal-map',
  inputs: [
    { id: 'height', name: 'Height', type: 'gray', tooltip: 'Density / height of the puff (bright = closer to the viewer).' },
    { id: 'alpha', name: 'Alpha', type: 'gray', optional: true, tooltip: 'Opacity written to A. Default: the height itself.' },
  ],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  common: { texture: true, blending: false },
  params: [
    P.float('strength', 6, { group: 'Surface', min: 0, max: 64, softMax: 20, step: 0.1, animatable: true, tooltip: 'Bump strength: slope of the surface per UV unit of height change.' }),
    P.float('elevation', 40, { group: 'Lights', min: 0, max: 90, step: 1, display: 'angle', animatable: true, tooltip: 'Elevation of all three lights above the surface plane.' }),
    P.float('angle_a', 135, { group: 'Lights', label: 'Light A (R) azimuth', min: -360, max: 360, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true, tooltip: 'Counter-clockwise from +X on screen: 135 = top-left.' }),
    P.float('angle_b', 45, { group: 'Lights', label: 'Light B (G) azimuth', min: -360, max: 360, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true, tooltip: '45 = top-right.' }),
    P.float('angle_c', -90, { group: 'Lights', label: 'Light C (B) azimuth', min: -360, max: 360, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true, tooltip: '-90 = from below (under-light / back-light).' }),
    P.float('wrap', 0.4, { group: 'Shading', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'Soft terminator (wrapped diffuse): smoke scatters light past the shadow line.' }),
    P.float('ambient', 0.1, { group: 'Shading', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.enum('output_mode', 'packed', [{ value: 'packed', label: 'Packed (R = A, G = B, B = C, A = alpha)' }, { value: 'preview', label: 'Preview (average grey + alpha)' }], { group: 'Output', label: 'Output' }),
  ],
  cost: { gpu: 'low', tiling: 'halo', halo: () => 1 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [{ name: 'Soft overcast', params: { wrap: 0.8, strength: 3 } }],
  evaluate(ctx) {
    const h = ctx.texInput('height');
    if (!h) throw new Error('Light Pack needs a Height input.');
    const a = ctx.texInput('alpha');
    const p = ctx.params;
    const out = ctx.tex('color');
    ctx.pass({
      label: 'light pack',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: { strength: p.num('strength'), elevation: p.num('elevation'), angle_a: p.num('angle_a'), angle_b: p.num('angle_b'), angle_c: p.num('angle_c'), wrap: p.num('wrap'), ambient: p.num('ambient'), output_mode: p.enumIndex('output_mode'), has_alpha: a ? 1 : 0 },
      },
      textures: [h.tex, a?.tex ?? null],
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});
