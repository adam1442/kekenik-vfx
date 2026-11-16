import { defineNode } from '../../../engine/graph/node';
import { consoleBus } from '../../../shared/log';
import { liftTo3D, normalizeProfile, type ProfileIssue } from '../../../engine/spline/ops';
import { asSplineSet } from '../../../engine/spline/value';
import { mergeMeshes } from '../../../engine/mesh/ops';
import { P, type CurveValue, type GradientValue, type SplineValue } from '../../../engine/params/schema';
import { meshValue } from '../../../engine/mesh/accounting';
import { defaultSweepSpline, ORIENTATIONS, PROFILES, sweep, type SweepOrientation, type SweepParams, type SweepProfile } from '../../../engine/mesh/sweep';

const flat = (y: number): CurveValue => ({ keys: [{ x: 0, y }, { x: 1, y }] });
const diamond = (): SplineValue => ({ closed: true, points: [{ x: 0.5, y: 0.1, mode: 'corner' }, { x: 0.9, y: 0.5, mode: 'corner' }, { x: 0.5, y: 0.9, mode: 'corner' }, { x: 0.1, y: 0.5, mode: 'corner' }] });
const circleSpline = (z = 0, r = 1.2): SplineValue => ({
  closed: true,
  points: Array.from({ length: 8 }, (_, i) => ({ x: Math.cos((i / 8) * Math.PI * 2) * r, y: Math.sin((i / 8) * Math.PI * 2) * r, attrs: { z, scale: 1, twist: 0 } })),
});
const arcSpline = (): SplineValue => ({
  closed: false,
  points: Array.from({ length: 6 }, (_, i) => {
    const a = (-60 + (i / 5) * 160) * (Math.PI / 180);
    return { x: Math.cos(a) * 1.4, y: Math.sin(a) * 1.4, attrs: { z: 0, scale: 1, twist: 0 } };
  }),
});
const fade = (a: number, b: number): GradientValue => ({ stops: [{ pos: 0, color: [1, 1, 1, a] }, { pos: 1, color: [1, 1, 1, b] }] });

/** geometry.sweep — extrude a profile along a 3D spline (beams, arcs, sword swipes, ribbons, tubes). */
export default defineNode({
  id: 'geometry.sweep',
  version: 1,
  category: 'geometry',
  title: 'Sweep',
  description:
    'Extrudes a 2D profile (circle, ribbon, star or a custom spline) along a 3D spline you edit with the gizmo. Scale and twist curves run along the length, taper / roll / orientation mode (minimal torsion, Frenet, up vector) control the frames, caps close tubes, closed loops make rings. UV U runs around the profile, V along the length (tiling + offset for scrolling). Vertex colour comes from a gradient along the length; `age` (0..1 along the length) and `pscale` are written as point attributes. The heart of beams, arcs, sword swipes and ribbons.',
  keywords: ['sweep', 'extrude', 'beam', 'arc', 'ribbon', 'tube', 'swipe', 'trail', 'spline', 'path', 'profile', 'loop'],
  icon: 'cat-geometry',
  inputs: [
    { id: 'profile_in', name: 'Profile', type: 'spline', optional: true, tooltip: 'Optional Spline used as the custom profile (auto-centred, normalised to unit size, winding fixed; several splines = several loops). Overrides the built-in profile.' },
    { id: 'path_in', name: 'Path', type: 'spline', optional: true, tooltip: 'Optional Spline used as the sweep path (3D, or a 2D spline lifted to 3D). Overrides the built-in 3D spline.' },
  ],
  outputs: [{ id: 'output', name: 'Mesh', type: 'mesh' }],
  common: { texture: false },
  params: [
    P.spline('spline', defaultSweepSpline(), { tab: 'Path', label: '3D Spline', tooltip: 'Edit the points with the gizmo in the 3D viewport (point, in / out tangents, per-point scale and twist handles).', minPoints: 2 }),
    P.bool('closed', false, { tab: 'Path', label: 'Closed loop', tooltip: 'Join the last point to the first (rings, shockwaves).' }),
    P.int('segments', 48, { tab: 'Path', label: 'Segments', min: 1, max: 4096, softMax: 256, tooltip: 'Rings along the length (arc-length spaced).' }),
    P.enum('profile', 'circle', PROFILES.map((m) => ({ value: m, label: m.replace(/^\w/, (c) => c.toUpperCase()) })), { tab: 'Profile' }),
    P.int('profile_res', 12, { tab: 'Profile', label: 'Profile resolution', min: 3, max: 256, softMax: 48, visibleIf: (v) => v.profile === 'circle' || v.profile === 'custom' }),
    P.int('star_points', 5, { tab: 'Profile', min: 3, max: 32, visibleIf: (v) => v.profile === 'star' }),
    P.float('star_inner', 0.45, { tab: 'Profile', label: 'Star inner radius', min: 0.01, max: 1, step: 0.01, visibleIf: (v) => v.profile === 'star' }),
    P.spline('profile_spline', diamond(), { tab: 'Profile', label: 'Custom profile', minPoints: 2, tooltip: 'Drawn in the unit square, centred on the path.', visibleIf: (v) => v.profile === 'custom' }),
    P.float('width', 0.2, { tab: 'Profile', min: 0, max: 1000, softMax: 2, step: 0.005, animatable: true, tooltip: 'Profile size across the binormal axis.' }),
    P.float('height', 0.2, { tab: 'Profile', min: 0, max: 1000, softMax: 2, step: 0.005, animatable: true, tooltip: 'Profile size along the normal axis (ignored by Ribbon).' }),
    P.bool('cap_start', true, { tab: 'Profile', label: 'Cap start', tooltip: 'Closed profiles on open paths only.' }),
    P.bool('cap_end', true, { tab: 'Profile', label: 'Cap end' }),
    P.curve('scale_curve', flat(1), { tab: 'Shape', group: 'Along length', label: 'Scale along length', tooltip: 'Profile scale over the path (0 = start, 1 = end).' }),
    P.curve('twist_curve', flat(0), { tab: 'Shape', group: 'Along length', label: 'Twist along length' }),
    P.float('twist_amount', 360, { tab: 'Shape', group: 'Along length', label: 'Twist at curve = 1', min: -100000, max: 100000, softMin: -720, softMax: 720, unit: '°', step: 1, animatable: true }),
    P.float('rotation', 0, { tab: 'Shape', group: 'Along length', label: 'Rotation', min: -3600, max: 3600, softMin: -180, softMax: 180, unit: '°', step: 1, animatable: true }),
    P.float('taper_start', 1, { tab: 'Shape', group: 'Taper', label: 'Taper start', min: 0, max: 100, softMax: 2, step: 0.01, animatable: true }),
    P.float('taper_end', 1, { tab: 'Shape', group: 'Taper', label: 'Taper end', min: 0, max: 100, softMax: 2, step: 0.01, animatable: true }),
    P.bool('use_point_attrs', true, { tab: 'Shape', group: 'Taper', label: 'Per-point scale / twist', tooltip: 'Blend the per-point scale and twist handles of the spline gizmo into the sweep.' }),
    P.enum('orientation', 'minimal_torsion', ORIENTATIONS.map((m) => ({ value: m, label: { minimal_torsion: 'Minimal torsion', frenet: 'Frenet', up_vector: 'Up vector' }[m] })), { tab: 'Orientation' }),
    P.vec3('up', [0, 0, 1], { tab: 'Orientation', label: 'Up vector', step: 0.01, softMin: -1, softMax: 1, tooltip: 'Reference for the first frame (minimal torsion) or every frame (up vector). A ribbon faces along it.' }),
    P.float('u_tiling', 1, { tab: 'UV', group: 'U (around)', label: 'U tiling', min: 0.01, max: 1000, softMax: 8, step: 0.01 }),
    P.float('v_tiling', 1, { tab: 'UV', group: 'V (along)', label: 'V tiling', min: 0.001, max: 10000, softMax: 16, step: 0.01, animatable: true }),
    P.float('v_offset', 0, { tab: 'UV', group: 'V (along)', label: 'V offset (scroll)', min: -100000, max: 100000, softMin: -4, softMax: 4, step: 0.01, animatable: true, tooltip: 'Animate this to scroll a texture along the mesh.' }),
    P.bool('v_by_length', false, { tab: 'UV', group: 'V (along)', label: 'V in world units', tooltip: 'V = distance along the path x tiling (constant texel density when the spline is resized).' }),
    P.bool('use_gradient', true, { tab: 'Color', label: 'Vertex colour gradient' }),
    P.gradient('color_gradient', fade(1, 1), { tab: 'Color', label: 'Color along length', visibleIf: (v) => !!v.use_gradient, tooltip: 'Written to point Cd (alpha is an ordinary channel).' }),
    P.enum('normals', 'smooth', ['smooth', 'flat'], { tab: 'Color', label: 'Normals' }),
  ],
  gizmos: [{ id: 'path', type: 'spline3d', viewport: '3d', space: 'world', param: 'spline' }],
  gallery: [
    { name: 'Energy beam', params: { profile: 'ribbon', width: 0.35, segments: 64, v_tiling: 4, scale_curve: { keys: [{ x: 0, y: 0.1 }, { x: 0.15, y: 1 }, { x: 0.85, y: 1 }, { x: 1, y: 0.1 }] }, color_gradient: fade(0.1, 1) } },
    { name: 'Tube', params: { profile: 'circle', profile_res: 16, width: 0.15, height: 0.15, taper_end: 0.2 } },
    { name: 'Sword swipe', params: { profile: 'ribbon', spline: arcSpline(), width: 0.6, segments: 64, scale_curve: { keys: [{ x: 0, y: 0 }, { x: 0.7, y: 1 }, { x: 1, y: 0.2 }] }, color_gradient: fade(0, 1) } },
    { name: 'Star twist', params: { profile: 'star', star_points: 6, width: 0.3, height: 0.3, twist_curve: { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, twist_amount: 180, normals: 'flat' } },
    { name: 'Torus ring', params: { spline: circleSpline(), closed: true, profile: 'circle', width: 0.15, height: 0.15, segments: 64 } },
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const p = ctx.params;
    const v = p.values;
    const profSet = asSplineSet(ctx.inputs.profile_in);
    const pathSet = asSplineSet(ctx.inputs.path_in);
    let path = v.spline as unknown as SplineValue;
    if (pathSet?.splines[0]) {
      const s0 = pathSet.splines[0];
      path = s0.points.some((q) => q.attrs && 'z' in q.attrs) ? s0 : liftTo3D(s0); // 2D (UV) path is lifted to 3D
    }
    const base = (profile: SweepParams['profile'], profileSpline: SplineValue | null): SweepParams => ({
      spline: path,
      closed: p.bool('closed'),
      segments: p.int('segments'),
      profile,
      profileRes: p.int('profile_res'),
      profileSpline,
      width: p.num('width'),
      height: p.num('height'),
      starPoints: p.int('star_points'),
      starInner: p.num('star_inner'),
      scaleCurve: p.curve('scale_curve'),
      twistCurve: p.curve('twist_curve'),
      twistAmount: p.num('twist_amount'),
      rotation: p.num('rotation'),
      taperStart: p.num('taper_start'),
      taperEnd: p.num('taper_end'),
      orientation: p.str('orientation') as SweepOrientation,
      up: p.vec3('up'),
      capStart: p.bool('cap_start'),
      capEnd: p.bool('cap_end'),
      uTiling: p.num('u_tiling'),
      vTiling: p.num('v_tiling'),
      vOffset: p.num('v_offset'),
      vByLength: p.bool('v_by_length'),
      colorGradient: p.gradient('color_gradient'),
      useGradient: p.bool('use_gradient'),
      normals: p.str('normals') as 'smooth' | 'flat',
      usePointAttrs: p.bool('use_point_attrs'),
    });
    const warnings: string[] = [];
    let loops: Array<SplineValue | null>;
    let profile = p.str('profile') as SweepProfile;
    if (profSet && profSet.splines.length) {
      profile = 'custom';
      loops = profSet.splines.map((sp, i) => {
        const n = normalizeProfile(sp);
        for (const issue of n.issues) warnings.push(`Profile ${i + 1}: ${ISSUE_TEXT[issue]}`);
        return n.issues.includes('tooFewPoints') || n.issues.includes('degenerate') ? null : n.value;
      });
      loops = loops.filter((l): l is SplineValue => !!l);
      if (!loops.length) throw new Error('The connected Profile has no usable spline (needs at least 2 distinct points).');
    } else {
      loops = [v.profile_spline as unknown as SplineValue];
      if (profile === 'custom') {
        const n = normalizeProfile(loops[0] as SplineValue);
        for (const issue of n.issues) warnings.push(`Custom profile: ${ISSUE_TEXT[issue]}`);
      }
    }
    for (const w of warnings) warnOnce(`Sweep: ${w}`);
    const meshes = loops.map((l) => sweep(base(profile, l)));
    return { output: meshValue(meshes.length === 1 ? meshes[0] : mergeMeshes(meshes), 'mesh') };
  },
});

const ISSUE_TEXT: Record<ProfileIssue, string> = {
  tooFewPoints: 'too few points (needs at least 2).',
  degenerate: 'degenerate (all points coincide).',
  selfIntersect: 'the outline crosses itself; faces may overlap.',
};
const seen = new Set<string>();
function warnOnce(msg: string): void {
  if (seen.has(msg)) return;
  if (seen.size > 200) seen.clear();
  seen.add(msg);
  consoleBus.warn(msg, { source: 'eval' });
}
