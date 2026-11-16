import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('normal_merge.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'mode', type: 'u32' },
  { name: 'range', type: 'f32' },
  { name: 'has_x', type: 'u32' },
  { name: 'has_y', type: 'u32' },
  { name: 'has_z', type: 'u32' },
  { name: 'flip_y', type: 'u32' },
]);

/** CPU mirror (decoded unit vector from gray values 0..1; mode 'reconstruct' or 'xyz'). */
export function mergeNormalXY(gx: number, gy: number, o: { mode: 'reconstruct' | 'xyz'; range: number; gz?: number; flipY?: boolean }): [number, number, number] {
  let x = (gx * 2 - 1) * o.range;
  let y = (gy * 2 - 1) * o.range * (o.flipY ? -1 : 1);
  if (o.mode === 'reconstruct') {
    const l2 = x * x + y * y;
    if (l2 > 1) {
      const s = 1 / Math.sqrt(l2);
      x *= s;
      y *= s;
    }
    return [x, y, Math.sqrt(Math.max(1 - x * x - y * y, 0))];
  }
  const z = Math.max((o.gz ?? 1) * 2 - 1, 1e-6);
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** normal.normal_merge — two Gray textures (X, Y) plus reconstructed or explicit Z -> Normal. */
export default defineNode({
  id: 'normal.normal_merge',
  version: 1,
  category: 'normal',
  title: 'Normal Merge',
  description: 'Builds a normal map from X and Y Gray textures (50% = 0). Z is reconstructed from X and Y, or taken from an optional third input and normalized.',
  keywords: ['normal', 'merge', 'xy', 'reconstruct z', 'combine channels', 'gray to normal'],
  icon: 'merge',
  inputs: [
    { id: 'x', name: 'X', type: 'gray', optional: true },
    { id: 'y', name: 'Y', type: 'gray', optional: true },
    { id: 'z', name: 'Z', type: 'gray', optional: true },
  ],
  outputs: [{ id: 'output', name: 'Normal', type: 'normal' }],
  params: [
    P.enum('mode', 'reconstruct', [{ value: 'reconstruct', label: 'Reconstruct Z from X, Y' }, { value: 'xyz', label: 'Use Z input (normalize)' }], { group: 'Merge' }),
    P.float('range', 1, { group: 'Merge', min: 0, max: 4, softMax: 1, step: 0.01, animatable: true, tooltip: 'Scales X / Y after decoding (strength of the tilt).' }),
    P.bool('flip_y', false, { group: 'Merge', label: 'Flip Y' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 3 }],
  gallery: [{ name: 'Explicit Z', params: { mode: 'xyz' } }],
  evaluate(ctx) {
    const x = ctx.texInput('x');
    const y = ctx.texInput('y');
    const z = ctx.texInput('z');
    const p = ctx.params;
    const out = ctx.tex('normal');
    ctx.pass({ label: 'normal merge', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { mode: p.str('mode') === 'xyz' ? 1 : 0, range: p.num('range'), has_x: !!x, has_y: !!y, has_z: !!z, flip_y: p.bool('flip_y') } }, textures: [x?.tex ?? null, y?.tex ?? null, z?.tex ?? null], ss: 1 });
    return { output: ctx.result(out, 'normal') };
  },
});
