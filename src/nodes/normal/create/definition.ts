import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('normal_create.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'radius', type: 'f32' },
  { name: 'strength', type: 'f32' },
  { name: 'height_scale', type: 'f32' },
  { name: 'kernel', type: 'u32' },
  { name: 'directx', type: 'u32' },
  { name: 'invert', type: 'u32' },
]);
export const KERNELS = ['central', 'sobel', 'scharr'] as const;

/**
 * CPU reference (pure): normal from a height image, same math as shader.wgsl with whole-pixel steps (e_px = `step`),
 * wrap or clamp per axis. Returns ENCODED rgb (n * 0.5 + 0.5), 3 floats per pixel.
 */
export function normalFromHeight(h: ArrayLike<number>, w: number, ht: number, o: { strength: number; heightScale: number; step?: number; kernel?: (typeof KERNELS)[number]; directx?: boolean; invert?: boolean; tileX?: boolean; tileY?: boolean }): Float32Array {
  const step = o.step ?? 1;
  const out = new Float32Array(w * ht * 3);
  const at = (x: number, y: number): number => {
    const xi = o.tileX ? ((x % w) + w) % w : Math.min(Math.max(x, 0), w - 1);
    const yi = o.tileY ? ((y % ht) + ht) % ht : Math.min(Math.max(y, 0), ht - 1);
    const v = h[yi * w + xi];
    return o.invert ? 1 - v : v;
  };
  const eIso = step / Math.min(w, ht);
  const k = (o.strength * o.heightScale) / eIso;
  for (let y = 0; y < ht; y++)
    for (let x = 0; x < w; x++) {
      let gx: number;
      let gy: number;
      const s = step;
      if ((o.kernel ?? 'central') === 'central') {
        gx = (at(x + s, y) - at(x - s, y)) * 0.5;
        gy = (at(x, y + s) - at(x, y - s)) * 0.5;
      } else {
        const tl = at(x - s, y - s), tc = at(x, y - s), tr = at(x + s, y - s), ml = at(x - s, y), mr = at(x + s, y), bl = at(x - s, y + s), bc = at(x, y + s), br = at(x + s, y + s);
        if (o.kernel === 'sobel') {
          gx = (tr + 2 * mr + br - (tl + 2 * ml + bl)) * 0.125;
          gy = (bl + 2 * bc + br - (tl + 2 * tc + tr)) * 0.125;
        } else {
          gx = (3 * tr + 10 * mr + 3 * br - (3 * tl + 10 * ml + 3 * bl)) / 32;
          gy = (3 * bl + 10 * bc + 3 * br - (3 * tl + 10 * tc + 3 * tr)) / 32;
        }
      }
      const nx = -gx * k;
      const ny = gy * k * (o.directx ? -1 : 1);
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 3;
      out[i] = nx * inv * 0.5 + 0.5;
      out[i + 1] = ny * inv * 0.5 + 0.5;
      out[i + 2] = inv * 0.5 + 0.5;
    }
  return out;
}

/** normal.create — height map -> encoded normal map. */
export default defineNode({
  id: 'normal.create',
  version: 1,
  category: 'normal',
  title: 'Normal Create',
  description: 'Creates a normal map from a height map: strength and height scale, OpenGL / DirectX Y convention, 4-way central, 8-way Sobel or Scharr kernels, tiling aware.',
  keywords: ['normal', 'height to normal', 'bump', 'normal map', 'sobel', 'scharr', 'opengl', 'directx', 'create'],
  icon: 'mask',
  inputs: [{ id: 'input', name: 'Height', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Normal', type: 'normal' }],
  params: [
    P.float('strength', 1, { group: 'Normal', min: 0, max: 64, softMax: 4, step: 0.01, animatable: true, tooltip: 'Multiplier of the slope.' }),
    P.float('height_scale', 0.05, { group: 'Normal', min: 0, max: 4, softMax: 0.5, step: 0.001, display: 'percent', animatable: true, tooltip: 'Height 0 -> 100% corresponds to this fraction of the smaller image side (resolution independent).' }),
    P.enum('kernel', 'sobel', [{ value: 'central', label: '4-way (central difference)' }, { value: 'sobel', label: '8-way Sobel' }, { value: 'scharr', label: '8-way Scharr' }], { group: 'Normal' }),
    P.float('radius', 0.001, { group: 'Normal', label: 'Sample distance', min: 0, max: 0.2, softMax: 0.02, step: 0.0005, display: 'percent', animatable: true, tooltip: 'Distance of the taps as a fraction of the smaller side (at least one pixel). Larger = broader, softer normals.' }),
    P.enum('y_convention', 'opengl', [{ value: 'opengl', label: 'OpenGL (+Y up) — Unity, Godot' }, { value: 'directx', label: 'DirectX (-Y) — Unreal' }], { group: 'Normal', label: 'Y convention' }),
    P.bool('invert', false, { group: 'Normal', label: 'Invert height' }),
  ],
  common: { texture: true, blending: false },
  gizmos: [{ id: 'radius', label: 'Sample distance', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }],
  cost: { gpu: 'low', tiling: 'halo', halo: () => 16 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'DirectX (Unreal)', params: { y_convention: 'directx' } }, { name: 'Soft & broad', params: { radius: 0.01, strength: 2 } }, { name: 'Scharr crisp', params: { kernel: 'scharr' } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Normal Create needs a height input');
    const p = ctx.params;
    const out = ctx.tex('normal');
    ctx.pass({
      label: 'normal create',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { radius: p.num('radius'), strength: p.num('strength'), height_scale: p.num('height_scale'), kernel: p.enumIndex('kernel'), directx: p.str('y_convention') === 'directx', invert: p.bool('invert') } },
      textures: [src.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'normal') };
  },
});
