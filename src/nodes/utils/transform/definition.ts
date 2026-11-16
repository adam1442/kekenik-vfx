import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.transform / utils.transform_color — translate / rotate / scale / skew around a pivot (aspect-correct), edge
 * handling Tiling | Wrap | Clamp | Mirror | Transparent, filtering from the node's Texture tab (Point / Linear / Cubic).
 * Optional UV pin: UV values are ABSOLUTE lookup coordinates (identity field = own uv); the transform is applied to them.
 * Seamless input stays seamless under integer translate steps and whole-number scale / 90° rotations with Tiling on.
 */
export const SHADER = defineShader('utils_transform.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'translate', type: 'vec2f' },
  { name: 'pivot', type: 'vec2f' },
  { name: 'minv', type: 'vec4f' },
  { name: 'edge', type: 'u32' },
  { name: 'has_uv', type: 'u32' },
]);

/** Row-major inverse of M = R(rot) * Skew(skx, sky) * diag(sx, sy) (angles in radians) — pure, tested. */
export function transformInverse(rot: number, scale: [number, number], skew: [number, number]): [number, number, number, number] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const kx = Math.tan(skew[0]);
  const ky = Math.tan(skew[1]);
  // K * S
  const a = scale[0];
  const b = kx * scale[1];
  const cc = ky * scale[0];
  const d = scale[1];
  // R * (K * S)
  const m00 = c * a - s * cc;
  const m01 = c * b - s * d;
  const m10 = s * a + c * cc;
  const m11 = s * b + c * d;
  const det = m00 * m11 - m01 * m10;
  const inv = Math.abs(det) < 1e-9 ? 0 : 1 / det;
  return [m11 * inv, -m01 * inv, -m10 * inv, m00 * inv];
}
/** CPU mirror of the shader mapping for a pixel position (aspect = width / height). */
export function transformMapUv(uv: [number, number], t: { translate: [number, number]; pivot: [number, number]; minv: number[]; aspect: number }): [number, number] {
  const qx = (uv[0] - t.pivot[0] - t.translate[0]) * t.aspect;
  const qy = uv[1] - t.pivot[1] - t.translate[1];
  const rx = t.minv[0] * qx + t.minv[1] * qy;
  const ry = t.minv[2] * qx + t.minv[3] * qy;
  return [rx / t.aspect + t.pivot[0], ry + t.pivot[1]];
}

export default variants((k) =>
  defineNode({
    id: idOf('utils.transform', k),
    version: 1,
    category: 'utils',
    title: titleOf('Transform', k),
    description: 'Translate, rotate, scale and skew around a pivot with wrap / clamp / mirror edge handling.',
    keywords: ['move', 'rotate', 'scale', 'skew', 'offset', 'zoom', 'shift', 'pivot', 'transform'],
    icon: 'transform',
    common: { texture: true, blending: true },
    inputs: [
      { id: 'input', name: 'Input', type: pinOf(k) },
      { id: 'uv', name: 'UV', type: 'uv', optional: true, tooltip: 'Optional absolute lookup coordinates; the transform is applied to them.' },
    ],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.vec2('translate', [0, 0], { group: 'Transform', label: 'Position', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true, tooltip: 'Offset in UV units (1 = one image).' }),
      P.float('rotation', 0, { group: 'Transform', min: -36000, max: 36000, softMin: -180, softMax: 180, step: 0.5, display: 'angle', animatable: true }),
      P.vec2('scale', [1, 1], { group: 'Transform', min: -64, max: 64, softMin: 0.1, softMax: 4, step: 0.01, labels: ['X', 'Y'], linkable: true, animatable: true }),
      P.vec2('skew', [0, 0], { group: 'Transform', min: -80, max: 80, softMin: -45, softMax: 45, step: 0.5, labels: ['X', 'Y'], animatable: true, tooltip: 'Shear in degrees.' }),
      P.vec2('pivot', [0.5, 0.5], { group: 'Transform', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
      P.enum('edge', 'tiling', [{ value: 'tiling', label: 'Follow Tiling' }, { value: 'wrap', label: 'Wrap' }, { value: 'clamp', label: 'Clamp' }, { value: 'mirror', label: 'Mirror' }, { value: 'transparent', label: 'Transparent' }], { group: 'Edges' }),
    ],
    gizmos: [
      {
        id: 'transform',
        label: 'Transform',
        type: 'transform',
        viewport: '2d',
        space: 'uv',
        position: { param: 'translate', map: { offset: [0.5, 0.5] } },
        rotation: 'rotation',
        scale: 'scale',
        pivot: 'pivot',
      },
    ],
    cost: { gpu: 'trivial', tiling: 'global' },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
    gallery: [
      { name: 'Rotated 30°', params: { rotation: 30, edge: 'wrap' } },
      { name: 'Mirror zoom out', params: { scale: [0.5, 0.5], edge: 'mirror' } },
      { name: 'Skewed', params: { skew: [25, 0], edge: 'wrap' } },
    ],
    /** identity short-cut (the evaluator forwards the input, no pass recorded). */
    identity: (v) => (v.translate as number[])[0] === 0 && (v.translate as number[])[1] === 0 && v.rotation === 0 && (v.scale as number[])[0] === 1 && (v.scale as number[])[1] === 1 && (v.skew as number[])[0] === 0 && (v.skew as number[])[1] === 0,
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Transform needs an input');
      const p = ctx.params;
      const uvIn = ctx.texInput('uv');
      const out = ctx.tex(pinOf(k));
      const [sx, sy] = p.vec2('scale');
      const [kx, ky] = p.vec2('skew');
      const rad = Math.PI / 180;
      const safe = (v: number): number => (Math.abs(v) < 1e-4 ? (v < 0 ? -1e-4 : 1e-4) : v);
      ctx.pass({
        label: 'transform',
        target: out,
        shader: SHADER,
        uniforms: {
          layout: LAYOUT,
          values: { translate: p.vec2('translate'), pivot: p.vec2('pivot'), minv: transformInverse(p.num('rotation') * rad, [safe(sx), safe(sy)], [kx * rad, ky * rad]), edge: p.enumIndex('edge'), has_uv: !!uvIn },
        },
        textures: [src.tex, uvIn?.tex ?? null],
      });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);
