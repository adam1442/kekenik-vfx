import { defineNode, type GizmoDecl } from '../../../engine/graph/node';
import { asSplineSet, splineValue } from '../../../engine/spline/value';
import { P, type SplineValue } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';
import { buildStrokes, MAX_SPLINES, TABLE_VEC4 } from './stroke';

/**
 * grayscale.spline — draws one to four splines into a mask. Uses the Spline gizmo of the 2D viewport (path gizmo, point
 * width = `w`). Width profile along the spline, cross-section profile, caps, softness, tiling wrap and a second output
 * with the end-to-end gradient (t along the spline). Closed splines are drawn as closed rings (filled shapes: use
 * Islands / Distance on the ring, not part of this node).
 */
export const SHADER = defineShader('grayscale_spline.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'pts', type: 'vec4f', count: TABLE_VEC4 },
  { name: 'ranges', type: 'vec4f', count: MAX_SPLINES },
  { name: 'bbox', type: 'vec4f', count: MAX_SPLINES },
  { name: 'softness', type: 'f32' },
  { name: 'intensity', type: 'f32' },
  { name: 'cap', type: 'u32' },
  { name: 'profile', type: 'u32' },
  { name: 'mode', type: 'u32' },
  { name: 'invert', type: 'u32' },
  { name: 'ox0', type: 'i32' },
  { name: 'ox1', type: 'i32' },
  { name: 'oy0', type: 'i32' },
  { name: 'oy1', type: 'i32' },
]);

export const SPLINE_IDS = ['spline', 'spline_2', 'spline_3', 'spline_4'] as const;
export const gizmos: GizmoDecl[] = SPLINE_IDS.map((id, i) => ({ id, label: i === 0 ? 'Spline' : `Spline ${i + 1}`, type: 'path', viewport: '2d', space: 'uv', param: id }) as GizmoDecl);

const defaultSpline = (): SplineValue => ({
  closed: false,
  points: [
    { x: 0.12, y: 0.62 },
    { x: 0.36, y: 0.3 },
    { x: 0.64, y: 0.7 },
    { x: 0.88, y: 0.38 },
  ],
});
const emptySpline = (): SplineValue => ({ closed: false, points: [] });
const ring = (cx: number, cy: number, r: number): SplineValue => ({
  closed: true,
  points: [0, 1, 2, 3].map((k) => ({ x: cx + r * Math.cos((k * Math.PI) / 2), y: cy + r * Math.sin((k * Math.PI) / 2) })),
});
const flat = { keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] };

export default defineNode({
  id: 'grayscale.spline',
  version: 1,
  category: 'grayscale',
  title: 'Spline',
  description: 'Draws splines into a mask. Edit them with the spline gizmo in the 2D viewport (click to add points, drag handles, Alt = free handles). Width profile along the length, per-point width, caps, softness; strokes wrap when the graph tiles. Second output: end-to-end gradient.',
  keywords: ['curve', 'path', 'line', 'stroke', 'beam', 'trail', 'draw', 'ribbon', 'bezier'],
  icon: 'spline',
  inputs: [{ id: 'spline_in', name: 'Spline', type: 'spline', optional: true, tooltip: 'Optional Spline input: its splines are drawn instead of the points edited in this node (first four).' }],
  outputs: [
    { id: 'output', name: 'Mask', type: 'gray' },
    { id: 'gradient', name: 'Gradient', type: 'gray', tooltip: 'End-to-end gradient: 0 at the start of the spline, 100% at its end (only where the stroke is).' },
    { id: 'spline_out', name: 'Spline', type: 'spline', tooltip: 'The splines drawn by this node (input or internal points), for Sweep, Spline Transform, ...' },
  ],
  common: { texture: true, blending: true },
  params: [
    P.spline('spline', defaultSpline(), { group: 'Splines', label: 'Spline 1', minPoints: 1, tooltip: 'Edited with the spline gizmo in a 2D viewport.' }),
    P.spline('spline_2', emptySpline(), { group: 'Splines', label: 'Spline 2', minPoints: 0, advanced: true }),
    P.spline('spline_3', emptySpline(), { group: 'Splines', label: 'Spline 3', minPoints: 0, advanced: true }),
    P.spline('spline_4', emptySpline(), { group: 'Splines', label: 'Spline 4', minPoints: 0, advanced: true }),
    P.float('width', 0.05, { group: 'Stroke', min: 0, max: 1, softMax: 0.3, step: 0.001, display: 'percent', animatable: true, tooltip: 'Full width of the stroke (fraction of the smaller image side) for points without their own width.' }),
    P.curve('width_curve', flat, { group: 'Stroke', label: 'Width profile', animatable: true, tooltip: 'Width multiplier along the length of the spline (left = start, right = end).' }),
    P.enum('cap', 'round', [{ value: 'round', label: 'Round' }, { value: 'butt', label: 'Flat' }, { value: 'square', label: 'Square' }], { group: 'Stroke', label: 'Caps', tooltip: 'End caps of open splines.' }),
    P.float('softness', 0.3, { group: 'Stroke', min: 0, max: 1, display: 'percent', step: 0.01, animatable: true, tooltip: 'Soft edge as a fraction of the half width (always at least one pixel of antialiasing).' }),
    P.enum('profile', 'flat', [{ value: 'flat', label: 'Flat' }, { value: 'round', label: 'Round (tube)' }, { value: 'cone', label: 'Cone (ridge)' }], { group: 'Stroke', label: 'Cross section' }),
    P.float('intensity', 1, { group: 'Stroke', min: 0, max: 16, softMax: 2, step: 0.01, animatable: true }),
    P.bool('invert', false, { group: 'Stroke' }),
  ],
  gizmos,
  cost: { gpu: 'medium', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 0 }],
  gallery: [
    { name: 'Tapered', params: { width: 0.09, width_curve: { keys: [{ x: 0, y: 0.05 }, { x: 0.35, y: 1 }, { x: 1, y: 0 }] }, softness: 0.15 } },
    { name: 'Closed ring', params: { spline: ring(0.5, 0.5, 0.3), width: 0.05, softness: 0.5, profile: 'round' } },
    { name: 'Flat caps', params: { cap: 'butt', width: 0.08, softness: 0.05 } },
    { name: 'Glow tube', params: { width: 0.14, softness: 1, profile: 'round' } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const v = p.values;
    const inSet = asSplineSet(ctx.inputs.spline_in);
    const splines = inSet ? [0, 1, 2, 3].map((i) => inSet.splines[i] ?? emptySpline()) : SPLINE_IDS.map((id) => v[id] as SplineValue);
    const table = buildStrokes(
      splines,
      { width: p.num('width'), widthCurve: p.curve('width_curve'), tileX: ctx.frame.tileX, tileY: ctx.frame.tileY, margin: 0.02 },
    );
    const mask = ctx.tex('gray');
    const along = ctx.tex('gray');
    const common = { ox0: table.ox0, ox1: table.ox1, oy0: table.oy0, oy1: table.oy1, pts: table.samples, ranges: table.ranges, bbox: table.bbox, softness: p.num('softness'), intensity: p.num('intensity'), cap: p.enumIndex('cap'), profile: p.enumIndex('profile'), invert: p.bool('invert') };
    ctx.pass({ label: 'spline mask', target: mask, shader: SHADER, uniforms: { layout: LAYOUT, values: { ...common, mode: 0 } }, textures: [] });
    ctx.pass({ label: 'spline gradient', target: along, shader: SHADER, uniforms: { layout: LAYOUT, values: { ...common, mode: 1 } }, textures: [] });
    return { output: ctx.result(mask, 'gray'), gradient: ctx.result(along, 'gray'), spline_out: splineValue({ splines: splines.filter((sp) => sp.points.length > 0) }) };
  },
});
