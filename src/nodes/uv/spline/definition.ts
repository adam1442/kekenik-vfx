import { defineNode, type GizmoDecl } from '../../../engine/graph/node';
import { P, type SplineValue } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { asSplineSet, splineValue } from '../../../engine/spline/value';
import { buildStrokes, MAX_SPLINES, TABLE_VEC4 } from '../../grayscale/spline/stroke';
import { FALLOFF_OPTIONS } from '../radial/definition';
import { modOf, uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_spline.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'pts', type: 'vec4f', count: TABLE_VEC4 },
  { name: 'ranges', type: 'vec4f', count: MAX_SPLINES },
  { name: 'bbox', type: 'vec4f', count: MAX_SPLINES },
  { name: 'strength', type: 'f32' },
  { name: 'strength_mod_k', type: 'f32' },
  { name: 'soft', type: 'f32' },
  { name: 'falloff', type: 'u32' },
  { name: 'mode', type: 'u32' },
  { name: 'reverse_dir', type: 'u32' },
  { name: 'ox0', type: 'i32' },
  { name: 'ox1', type: 'i32' },
  { name: 'oy0', type: 'i32' },
  { name: 'oy1', type: 'i32' },
  { name: 'uv_mode', type: 'u32' },
]);
const IDS = ['spline', 'spline_2', 'spline_3', 'spline_4'] as const;
const gizmos: GizmoDecl[] = IDS.map((id, i) => ({ id, label: i === 0 ? 'Spline' : `Spline ${i + 1}`, type: 'path', viewport: '2d', space: 'uv', param: id }) as GizmoDecl);
const defaultSpline = (): SplineValue => ({ closed: false, points: [{ x: 0.1, y: 0.6 }, { x: 0.35, y: 0.35 }, { x: 0.65, y: 0.65 }, { x: 0.9, y: 0.4 }] });
const emptySpline = (): SplineValue => ({ closed: false, points: [] });

/** uv.spline — flow along (or away from / towards) splines with width and falloff. Uses the Spline gizmo (path). */
export default defineNode({
  id: 'uv.spline',
  version: 1,
  category: 'uv',
  title: 'UV Spline',
  description: 'Flow field along up to four splines: content flows in the direction of the spline inside its width and fades out with a falloff. Also pushes away from / pulls towards the spine. Edit with the spline gizmo.',
  keywords: ['uv', 'spline', 'path', 'flow', 'river', 'trail', 'beam', 'direction', 'curve'],
  icon: 'spline',
  inputs: [{ id: 'spline_in', name: 'Spline', type: 'spline', optional: true, tooltip: 'Optional Spline input: its splines (first four) are used instead of the points edited in this node.' }],
  outputs: [
    { id: 'output', name: 'UV', type: 'uv' },
    { id: 'spline_out', name: 'Spline', type: 'spline', tooltip: 'The splines used by this node (input or internal points), for Sweep, Spline Transform, ...' },
  ],
  params: [
    P.spline('spline', defaultSpline(), { group: 'Splines', label: 'Spline 1', minPoints: 1, tooltip: 'Edited with the spline gizmo in a 2D viewport.' }),
    P.spline('spline_2', emptySpline(), { group: 'Splines', label: 'Spline 2', minPoints: 0, advanced: true }),
    P.spline('spline_3', emptySpline(), { group: 'Splines', label: 'Spline 3', minPoints: 0, advanced: true }),
    P.spline('spline_4', emptySpline(), { group: 'Splines', label: 'Spline 4', minPoints: 0, advanced: true }),
    P.enum('mode', 'along', [{ value: 'along', label: 'Along the spline' }, { value: 'away', label: 'Away from the spine' }, { value: 'towards', label: 'Towards the spine' }], { group: 'Flow' }),
    P.float('strength', 0.1, { group: 'Flow', min: -4, max: 4, softMin: -0.5, softMax: 0.5, step: 0.001, display: 'percent', modulatable: true, animatable: true, tooltip: 'Distance content moves (fraction of the smaller side).' }),
    P.bool('reverse', false, { group: 'Flow', label: 'Reverse direction' }),
    P.float('width', 0.1, { group: 'Width', min: 0, max: 1, softMax: 0.4, step: 0.001, display: 'percent', animatable: true, tooltip: 'Full width of the flow band (fraction of the smaller side).' }),
    P.curve('width_curve', { keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] }, { group: 'Width', label: 'Width profile', animatable: true }),
    P.float('softness', 0.6, { group: 'Width', min: 0, max: 4, softMax: 2, step: 0.01, display: 'percent', animatable: true, tooltip: 'Fade-out distance beyond the half width, relative to the half width.' }),
    P.enum('falloff', 'smooth', FALLOFF_OPTIONS, { group: 'Width' }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  gizmos,
  cost: { gpu: 'medium', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Narrow stream', params: { width: 0.05, softness: 0.3 } }, { name: 'Suction', params: { mode: 'towards', strength: 0.08 } }],
  evaluate(ctx) {
    const p = ctx.params;
    const soft = p.num('softness');
    const inSet = asSplineSet(ctx.inputs.spline_in);
    const splines = inSet ? [0, 1, 2, 3].map((i) => inSet.splines[i] ?? emptySpline()) : IDS.map((id) => p.values[id] as SplineValue);
    const table = buildStrokes(
      splines,
      { width: p.num('width'), widthCurve: p.curve('width_curve'), tileX: ctx.frame.tileX, tileY: ctx.frame.tileY, margin: 0.02 + soft * Math.max(p.num('width'), 0.05) },
    );
    const m = modOf(ctx, 'strength');
    const out = ctx.tex('uv');
    ctx.pass({
      label: 'uv spline',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: { pts: table.samples, ranges: table.ranges, bbox: table.bbox, strength: p.num('strength'), strength_mod_k: m.k, soft, falloff: p.enumIndex('falloff'), mode: p.enumIndex('mode'), reverse_dir: p.bool('reverse'), ox0: table.ox0, ox1: table.ox1, oy0: table.oy0, oy1: table.oy1, uv_mode: uvModeIndex(p.str('uv_out')) },
      },
      textures: [m.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'uv'), spline_out: splineValue({ splines: splines.filter((sp) => sp.points.length > 0) }) };
  },
});
