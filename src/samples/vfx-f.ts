import { FIRE_A, VIOLET, curve, grad, type SampleDef } from './kit';

/**
 * Samples F (Kekenik 7A++): Fluid Smoke Wisps (Fluid Advect + Kaleidoscope + Chromatic Aberration), Hex Energy Shield,
 * Portal Vortex, Stylized Flame Torch and Water Orb. All animated, all with a mesh / geometry part.
 */

const TAU = 6.2831853;

/* ------------------------------------------------------------------------------------------------------------------ */
export const fluidSmoke: SampleDef = {
  id: 'fluid_smoke_wisps',
  name: 'Fluid Smoke Wisps (advection + mandala)',
  description:
    'Stylised fluid smoke from plain shapes: a disc, a five-point star and a bar are pushed through multi-step curl-noise advection (Fluid Advect, looping evolution), merged, re-advected at a finer scale, dissolved over the loop and lit with an edge rim and a rainbow lens fringe. A Kaleidoscope branch turns the same smoke into a mandala. Mesh: a rising column of crossed planes with turbulence, exported next to a 16-frame flipbook.',
  kind: 'sample',
  tags: ['smoke', 'fluid', 'wisps', 'curl', 'mandala', 'flipbook', 'animated', 'mesh'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 96, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'alpha', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const L = 96;
    const disc = b.add('grayscale.shape', 'Source Disc', 0, 0, { shape: 'circle', size: [0.34, 0.34], position: [0.34, 0.56], softness: 0.55 });
    const star = b.add('grayscale.shape', 'Source Star', 0, 1, { shape: 'star', sides: 5, pinch: 0.5, size: [0.36, 0.36], position: [0.68, 0.42], softness: 0.35 });
    b.ramp01(star, 'rotation', 0, 72, L);
    const bar = b.add('grayscale.shape', 'Source Bar', 0, 2, { shape: 'rounded_rect', size: [0.05, 0.56], rounding: 1, position: [0.5, 0.5], softness: 0.3 });
    const adv1 = b.add('utils.fluid_advect', 'Advect Disc', 1, 0, { strength: 0.34, steps: 7, scale: [2, 2], freq_gain: 1.5, seed: 3 }, { input: disc });
    b.loopEvolution(adv1, 'evolution', L);
    b.pulse(adv1, 'strength', 0.26, 0.42, L);
    const adv2 = b.add('utils.fluid_advect', 'Advect Star', 1, 1, { strength: 0.3, steps: 8, scale: [3, 3], freq_gain: 1.45, divergence: 0.2, seed: 8 }, { input: star });
    b.loopEvolution(adv2, 'evolution', L);
    const adv3 = b.add('utils.fluid_advect', 'Advect Bar', 1, 2, { strength: 0.5, steps: 8, scale: [2, 3], freq_gain: 1.55, drift: [0, -0.1], seed: 11 }, { input: bar });
    b.loopEvolution(adv3, 'evolution', L);
    const m1 = b.blend('Disc + Star', 2, 0, adv2, adv1, 'max');
    const m2 = b.blend('+ Bar', 3, 0, adv3, m1, 'max');
    const fine = b.add('utils.fluid_advect', 'Fine Tendrils', 4, 0, { strength: 0.09, steps: 4, scale: [4, 4], freq_gain: 2, octaves: 4, seed: 5 }, { input: m2 });
    b.loopEvolution(fine, 'evolution', L);
    const dis = b.add('utils.levels', 'Dissolve', 5, 0, { in_low: 0, in_high: 1, out_low: 0, out_high: 1 }, { input: fine });
    b.anim(dis, 'in_low', [[0, 0.5], [30, 0], [66, 0], [96, 0.5]], { pre: 'cycle', post: 'cycle' });
    b.anim(dis, 'out_high', [[0, 0], [20, 1], [70, 1], [96, 0]], { pre: 'cycle', post: 'cycle' });
    const rimG = b.add('utils.edge_detect', 'Rim Edges', 6, 1, { width: 0.004, intensity: 3, softness: 0.4 }, { input: dis });
    const smokeC = b.ramp('Smoke Colour', 6, 0, dis, grad([[0, [0.04, 0.04, 0.1, 0]], [0.35, [0.25, 0.3, 0.5, 0.55]], [0.7, [0.62, 0.7, 0.9, 0.9]], [1, [0.97, 0.98, 1, 1]]]));
    const rimC = b.ramp('Rim Colour', 7, 1, rimG, grad([[0, [0, 0, 0, 0]], [1, [1, 0.62, 0.25, 1]]]));
    const lit = b.blendC('Rim Light', 7, 0, rimC, smokeC, 'add', { opacity: 0.8 });
    const bloom = b.add('utils.glow_color', 'Soft Bloom', 8, 0, { threshold: 0.7, radius: 0.06, intensity: 0.5 }, { input: lit });
    const ca = b.add('utils.chromatic_aberration', 'Rainbow Fringe', 9, 0, { amount: 0.035, falloff: 2 }, { input: bloom });
    b.pulse(ca, 'amount', 0.02, 0.05, L);
    const sheet = b.add('utils.sheet_encode', 'Sheet Encode', 10, 0, { frames: 16, auto_grid: true }, { input: ca });
    b.add('export.color', 'Export Flipbook', 11, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: ca });
    b.mark('main', ca);
    b.mark('sheet', `${sheet}.sheet`);
    // mandala branch
    const kal = b.add('utils.kaleidoscope', 'Smoke Mandala', 6, 3, { segments: 6, mirror: true, source: [0.5, 0.5], zoom: 1.2 }, { input: dis });
    b.ramp01(kal, 'rotation', 0, 120, L);
    const mandalaC = b.ramp('Mandala Colour', 7, 3, kal, grad([[0, [0.02, 0, 0.08, 1]], [0.4, [0.3, 0.1, 0.7, 1]], [0.75, [0.2, 0.8, 1, 1]], [1, [1, 1, 1, 1]]]));
    const mandalaG = b.add('utils.glow_color', 'Mandala Glow', 8, 3, { threshold: 0.6, radius: 0.05, intensity: 0.7 }, { input: mandalaC });
    b.add('export.color', 'Export Mandala', 9, 3, {}, { input: mandalaG });

    // ---------------------------------------------------------------- 3D rising column
    const cross = b.add('geometry.shapes', 'Puff Planes', 0, 5, { shape: 'cross_plane', count: 3, size: [1.4, 1.4, 1.4], cols: 4, rows: 4 });
    const pts = b.add('geometry.points_shape', 'Column Points', 0, 6, { mode: 'line', start: [0, 0, 0.2], end: [0.3, 0.2, 2.4], count: 7, align: false });
    const sc = b.add('geometry.combine_scale_points', 'Grow Upwards', 1, 6, { source: 'gradient_axis', origin: [0, 0, 0], direction: [0, 0, 1], length: 2.4, min: 0.35, max: 1.4 }, { input: `${pts}.points` });
    const copy = b.add('geometry.copy_to_points', 'Copy Puffs', 2, 5, { use_orient: false, align_normal: false }, { mesh: `${cross}.mesh`, points: sc });
    const turb = b.add('geometry.noise', 'Billow', 3, 5, { mode: 'vector', amplitude: 0.14, frequency: 1.6, octaves: 3, animate: true, loop: true, loop_cycles: 1, seed: 2 }, { input: `${copy}.mesh` });
    const col = b.add('geometry.combine_color', 'Smoke Gradient', 4, 5, { source: 'gradient_axis', origin: [0, 0, 0], direction: [0, 0, 1], length: 2.6, gradient: grad([[0, [0.95, 0.6, 0.3, 0.9]], [0.35, [0.62, 0.66, 0.8, 0.75]], [1, [0.92, 0.94, 1, 0]]]) }, { input: turb });
    const rise = b.add('geometry.transform', 'Puff Life', 5, 5, {}, { input: col });
    b.anim(rise, 'uniform', [[0, 0.05], [30, 1], [70, 1], [96, 0.05]], { pre: 'cycle', post: 'cycle' });
    b.ramp01(rise, 'rotate', [0, 0, 0], [0, 0, 60], L);
    const mesh = b.add('export.mesh', 'Export Mesh', 6, 5, {}, { input: rise });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.001, maxMean: 0.9, frames: [20, 40, 66] }],
};

/* ------------------------------------------------------------------------------------------------------------------ */
export const hexShield: SampleDef = {
  id: 'hex_shield',
  name: 'Hex Energy Shield (impact ripple + dome)',
  description:
    'A sci-fi force-field. Texture: hex lattice with fresnel-weighted edges, an expanding impact ring that lights up individual cells, crystalline Kaleidoscope cracks, flash, cyan ramp, bloom and lens fringe. Mesh: a hemispherical dome whose surface is bumped by the live hex texture (displace-by-texture), an expanding Space Warp ripple, a glowing base ring and floor glow.',
  kind: 'sample',
  tags: ['shield', 'forcefield', 'hex', 'impact', 'sci-fi', 'animated', 'mesh', 'dome'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 72, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const L = 72;
    const hexL = b.add('utils.grid', 'Hex Lines', 0, 0, { pattern: 'hex', cells: [10, 10], output_kind: 'lines', line_width: 0.12, softness: 0.35 });
    const hexC = b.add('utils.grid', 'Hex Cells', 0, 1, { pattern: 'hex', cells: [10, 10], output_kind: 'cells', random_amount: 0.85, seed: 7 });
    const fres = b.add('grayscale.gradient', 'Fresnel', 0, 2, { gtype: 'radial', center: [0.5, 0.5], radius: 0.5, curve: curve([0, 0], [0.55, 0.12], [1, 1]) });
    const fresL = b.add('utils.levels', 'Fresnel Floor', 1, 2, { out_low: 0.22, out_high: 1 }, { input: fres });
    const lineBase = b.blend('Lines x Fresnel', 2, 0, fresL, hexL, 'multiply');
    const ring = b.add('grayscale.shape', 'Impact Ring', 0, 3, { shape: 'ring', size: [0.1, 0.1], thickness: 0.08, softness: 0.7, position: [0.5, 0.5] });
    b.anim(ring, 'size', [[0, [0.05, 0.05]], [50, [1.25, 1.25]]], { interp: 'linear' });
    b.anim(ring, 'intensity', [[0, 1.2], [30, 1], [50, 0], [72, 0]]);
    const ringB = b.add('utils.blur', 'Ring Soften', 1, 3, { radius: 0.012 }, { input: ring });
    const litCells = b.blend('Ring x Cells', 2, 1, hexC, ringB, 'multiply');
    const litBoost = b.add('utils.levels', 'Cell Boost', 3, 1, { in_low: 0, in_high: 0.6 }, { input: litCells });
    const ringLines = b.blend('Ring x Lines', 3, 2, hexL, ringB, 'multiply');
    const crackN = b.add('grayscale.noise', 'Crystal Noise', 0, 4, { noise_type: 'worley_f2f1', scale: [5, 5], seed: 4 });
    b.loopEvolution(crackN, 'evolution', L);
    const crackL = b.add('utils.levels', 'Crystal Edges', 1, 4, { in_low: 0.05, in_high: 0.35, out_low: 1, out_high: 0 }, { input: crackN });
    const kal = b.add('utils.kaleidoscope', 'Crystal Mirror', 2, 4, { segments: 6, mirror: true, zoom: 1.4 }, { input: crackL });
    b.ramp01(kal, 'rotation', 0, 120, L);
    const crack = b.blend('Crystals x Fresnel', 3, 4, fres, kal, 'multiply');
    const flash = b.add('grayscale.shape', 'Impact Flash', 0, 5, { shape: 'circle', size: [0.1, 0.1], softness: 0.9 });
    b.anim(flash, 'size', [[0, [0.08, 0.08]], [10, [0.5, 0.5]], [24, [0.9, 0.9]]]);
    b.anim(flash, 'intensity', [[0, 1.6], [10, 0.9], [24, 0], [72, 0]]);
    const e1 = b.blend('Lines + Ring Lines', 4, 0, ringLines, lineBase, 'add');
    const e2 = b.blend('+ Lit Cells', 5, 0, litBoost, e1, 'add', { opacity: 0.8 });
    const e3 = b.blend('+ Crystals', 6, 0, crack, e2, 'add', { opacity: 0.35 });
    const e4 = b.blend('+ Flash', 7, 0, flash, e3, 'add');
    const colour = b.ramp('Shield Ramp', 8, 0, e4, grad([[0, [0, 0.04, 0.1, 0.0]], [0.3, [0, 0.35, 0.6, 0.45]], [0.65, [0.2, 0.85, 1, 0.9]], [1, [0.9, 1, 1, 1]]]));
    const bloom = b.add('utils.glow_color', 'Shield Bloom', 9, 0, { threshold: 0.55, radius: 0.06, intensity: 0.8, tint: [0.5, 0.9, 1, 1] }, { input: colour });
    const ca = b.add('utils.chromatic_aberration', 'Lens Fringe', 10, 0, { amount: 0.025, falloff: 2 }, { input: bloom });
    b.add('export.color', 'Export Shield', 11, 0, {}, { input: ca });
    b.add('export.mask', 'Export Hex Mask', 3, 0, {}, { input: hexL });
    b.mark('main', ca);
    b.mark('hex', hexL);

    // ---------------------------------------------------------------- 3D dome
    const dome = b.add('geometry.shapes', 'Dome', 0, 7, { shape: 'hemisphere', radius: 1.6, segments: 64, rings: 28 });
    const uvp = b.add('geometry.uv', 'Top-down UV', 1, 7, { mode: 'planar', axis: 'z', size: [3.2, 3.2, 3.2] }, { input: `${dome}.mesh` });
    const bump = b.add('geometry.space_warp', 'Hex Bumps (texture)', 2, 7, { mode: 'displace_texture', amount: 0.04, along: 'normal', channel: 'luma', mid: 0 }, { input: uvp, texture: hexL });
    const rip = b.add('geometry.space_warp', 'Impact Ripple', 3, 7, { mode: 'ripple', amount: 0.06, frequency: 4, decay: 0.4, position: [0, 0, 1.6] }, { input: bump });
    b.ramp01(rip, 'phase', 0, -TAU, L);
    const col = b.add('geometry.combine_color', 'Fresnel Colour', 4, 7, { source: 'gradient_axis', origin: [0, 0, 0], direction: [0, 0, 1], length: 1.6, gradient: grad([[0, [0.1, 0.85, 1, 0.95]], [0.35, [0.1, 0.5, 0.9, 0.4]], [1, [0.3, 0.8, 1, 0.14]]]) }, { input: rip });
    const baseRing = b.add('geometry.shapes', 'Base Ring', 0, 8, { shape: 'torus', radius: 1.62, inner_radius: 0.035, segments: 72, rings: 6 });
    const baseC = b.add('geometry.combine_color', 'Ring Glow', 1, 8, { source: 'uniform', color: [0.4, 0.95, 1, 1] }, { input: `${baseRing}.mesh` });
    const pulse = b.add('geometry.transform', 'Ring Pulse', 2, 8, {}, { input: baseC });
    b.pulse(pulse, 'uniform', 1, 1.04, L);
    const floor = b.add('geometry.shapes', 'Floor Glow', 0, 9, { shape: 'disc', radius: 2.1, segments: 64, rings: 10 });
    const floorC = b.add('geometry.combine_color', 'Floor Falloff', 1, 9, { source: 'gradient_radial', length: 2.1, gradient: grad([[0, [0.05, 0.4, 0.6, 0.35]], [0.75, [0.1, 0.6, 0.9, 0.18]], [1, [0.1, 0.6, 0.9, 0]]]) }, { input: `${floor}.mesh` });
    const all = b.add('geometry.merge', 'Merge', 5, 7, {}, { in1: col, in2: pulse, in3: floorC });
    const mesh = b.add('export.mesh', 'Export Mesh', 6, 7, {}, { input: all });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.005, maxMean: 0.9, frames: [4, 24, 48] }],
};

/* ------------------------------------------------------------------------------------------------------------------ */
export const portalVortex: SampleDef = {
  id: 'portal_vortex',
  name: 'Portal Vortex (spiral arms + ring mesh)',
  description:
    'A swirling portal that spins exactly one turn per 96-frame loop. Texture: spiral gradient arms (offset keyed by a whole cycle) roughened by Fluid Advect, an event-horizon hole, a noisy rim ring, orbiting rune crosses (Polar Scatter), mirrored Kaleidoscope overlay, violet-cyan ramp, bloom and fringe. Mesh: a disc with a hole (polar UVs), glowing torus rims, a spiral strip rotating a full turn and orbiting shards.',
  kind: 'sample',
  tags: ['portal', 'vortex', 'spiral', 'magic', 'rings', 'animated', 'mesh', 'runes'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 96, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const L = 96;
    const spiral = b.add('grayscale.gradient', 'Spiral Arms', 0, 0, { gtype: 'spiral', center: [0.5, 0.5], turns: 4, wrap_mode: 'repeat' });
    b.ramp01(spiral, 'offset', 0, 1, L);
    const arms = b.add('utils.levels', 'Arm Contrast', 1, 0, { in_low: 0.45, in_high: 0.92 }, { input: spiral });
    const rough = b.add('utils.fluid_advect', 'Roughen Arms', 2, 0, { strength: 0.07, steps: 4, scale: [4, 4], freq_gain: 1.6, seed: 9 }, { input: arms });
    b.loopEvolution(rough, 'evolution', L);
    const dist = b.add('grayscale.gradient', 'Radial Falloff', 0, 1, { gtype: 'radial', center: [0.5, 0.5], radius: 0.48, invert: true, curve: curve([0, 0], [0.5, 0.8], [1, 1]) });
    const armsF = b.blend('Arms x Falloff', 3, 0, dist, rough, 'multiply');
    const hole = b.add('grayscale.shape', 'Event Horizon', 0, 2, { shape: 'circle', size: [0.22, 0.22], softness: 0.25, invert: true });
    b.pulse(hole, 'size', [0.2, 0.2], [0.24, 0.24], L);
    const armsH = b.blend('Cut Hole', 4, 0, hole, armsF, 'multiply');
    const rim = b.add('grayscale.shape', 'Rim Ring', 0, 3, { shape: 'ring', size: [0.88, 0.88], thickness: 0.08, softness: 0.5 });
    const rimN = b.add('grayscale.noise', 'Rim Noise', 0, 4, { noise_type: 'ridged', scale: [14, 14], octaves: 3, seed: 6 });
    b.loopEvolution(rimN, 'evolution', L);
    const rimM = b.blend('Rim x Noise', 1, 3, rimN, rim, 'multiply', { cross_mix: 0.7 });
    const runes = b.add('grayscale.polar_scatter', 'Orbiting Runes', 0, 5, { ring_count: 1, count: 24, radius_min: 0.36, radius_max: 0.36, shape: 'cross', size: 0.022, thickness: 0.3, softness: 0.2, align_radial: true });
    b.ramp01(runes, 'rotation', 0, 360, L);
    const sparks = b.add('grayscale.polar_scatter', 'Inner Sparks', 0, 6, { ring_count: 4, count: 14, radius_min: 0.14, radius_max: 0.3, shape: 'circle', size: 0.01, softness: 0.6, spin: 1, size_rand: 0.5, seed: 4 });
    b.ramp01(sparks, 'rotation', 0, -360, L);
    const e1 = b.blend('Arms + Rim', 5, 0, rimM, armsH, 'max');
    const e2 = b.blend('+ Runes', 6, 0, runes, e1, 'max');
    const e3 = b.blend('+ Sparks', 7, 0, sparks, e2, 'add');
    const kal = b.add('utils.kaleidoscope', 'Mirror Overlay', 5, 1, { segments: 8, mirror: true }, { input: armsH });
    b.ramp01(kal, 'rotation', 0, 90, L);
    const e4 = b.blend('+ Mandala', 8, 0, kal, e3, 'screen', { opacity: 0.22 });
    const colour = b.ramp('Portal Ramp', 9, 0, e4, VIOLET);
    const bloom = b.add('utils.glow_color', 'Portal Bloom', 10, 0, { threshold: 0.55, radius: 0.08, intensity: 1, tint: [0.6, 0.5, 1, 1] }, { input: colour });
    b.pulse(bloom, 'intensity', 0.8, 1.3, L);
    const ca = b.add('utils.chromatic_aberration', 'Lens Fringe', 11, 0, { amount: 0.02 }, { input: bloom });
    b.add('export.color', 'Export Portal', 12, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: ca });
    b.add('export.mask', 'Export Arms Mask', 5, 2, {}, { input: armsH });
    b.mark('main', ca);

    // ---------------------------------------------------------------- 3D
    const ringM = b.add('geometry.shapes', 'Disc with Hole', 0, 7, { shape: 'ring', radius: 1.5, inner_radius: 0.45, segments: 72, rings: 8, uv_mode: 'polar' });
    const ringC = b.add('geometry.combine_color', 'Disc Gradient', 1, 7, { source: 'gradient_radial', length: 1.5, gradient: grad([[0, [0.02, 0, 0.06, 1]], [0.3, [0.25, 0.08, 0.6, 1]], [0.75, [0.5, 0.35, 1, 1]], [1, [0.6, 0.9, 1, 1]]]) }, { input: `${ringM}.mesh` });
    const outerT = b.add('geometry.shapes', 'Outer Rim', 0, 8, { shape: 'torus', radius: 1.5, inner_radius: 0.06, segments: 72, rings: 6 });
    const innerT = b.add('geometry.shapes', 'Inner Rim', 0, 9, { shape: 'torus', radius: 0.45, inner_radius: 0.04, segments: 48, rings: 6 });
    const rims = b.add('geometry.merge', 'Rims', 1, 8, {}, { in1: `${outerT}.mesh`, in2: `${innerT}.mesh` });
    const rimC = b.add('geometry.combine_color', 'Rim Glow', 2, 8, { source: 'gradient_radial', length: 1.5, gradient: grad([[0, [0.9, 0.5, 1, 1]], [1, [0.5, 0.95, 1, 1]]]) }, { input: rims });
    const spiralM = b.add('geometry.shapes', 'Spiral Strip', 0, 10, { shape: 'spiral', radius: 1.35, inner_radius: 0.5, turns: 3, size: [0.14, 0.14, 0.02], segments: 40, rows: 1 });
    const spinS = b.add('geometry.transform', 'Spin Spiral', 1, 10, { translate: [0, 0, 0.03] }, { input: `${spiralM}.mesh` });
    b.ramp01(spinS, 'rotate', [0, 0, 0], [0, 0, 360], L);
    const spiralC = b.add('geometry.combine_color', 'Spiral Glow', 2, 10, { source: 'gradient_radial', length: 1.4, gradient: grad([[0, [0.7, 0.4, 1, 0.9]], [1, [0.5, 0.9, 1, 0.3]]]) }, { input: spinS });
    const sp = b.add('geometry.points_shape', 'Shard Ring', 0, 11, { mode: 'circle', count: 14, radius: 1.75, align: true, seed: 3 });
    const ss = b.add('geometry.combine_scale_points', 'Shard Sizes', 1, 11, { source: 'random', min: 0.5, max: 1.5, seed: 9 }, { input: `${sp}.points` });
    const shard = b.add('geometry.shapes', 'Shard', 0, 12, { shape: 'cone', radius: 0.05, size: [1, 1, 0.26], segments: 4, rings: 1 });
    const shards = b.add('geometry.copy_to_points', 'Copy Shards', 2, 11, {}, { mesh: `${shard}.mesh`, points: ss });
    const shardC = b.add('geometry.combine_color', 'Shard Colour', 3, 11, { source: 'uniform', color: [0.65, 0.5, 1, 1] }, { input: `${shards}.mesh` });
    const orbit = b.add('geometry.transform', 'Orbit Shards', 4, 11, {}, { input: shardC });
    b.ramp01(orbit, 'rotate', [0, 0, 0], [0, 0, 360], L);
    const all = b.add('geometry.merge', 'Merge', 5, 8, {}, { in1: ringC, in2: rimC, in3: spiralC, in4: orbit });
    const stand = b.add('geometry.transform', 'Stand Up + Float', 6, 8, { rotate: [90, 0, 0], translate: [0, 0, 1.8] }, { input: all });
    const mesh = b.add('export.mesh', 'Export Mesh', 7, 8, {}, { input: stand });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.005, maxMean: 0.9, frames: [0, 24, 60] }],
};

/* ------------------------------------------------------------------------------------------------------------------ */
export const flameTorch: SampleDef = {
  id: 'flame_torch',
  name: 'Stylized Flame Torch (cel layers + cone mesh)',
  description:
    'A hand-painted, cel-shaded flame. Texture: an ellipse is advected upward by curl noise (drift + looping evolution), rising noise is mixed in, a height fade shapes the tip and three hard thresholds paint outer / mid / core colour layers; embers, glow and a heat-haze warp export. Mesh: three nested cones with travelling Space Warp waves, gradient vertex alpha, a wooden handle and rising ember cubes.',
  kind: 'sample',
  tags: ['fire', 'flame', 'torch', 'stylized', 'cel', 'embers', 'animated', 'mesh'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 64, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const L = 64;
    const src = b.add('grayscale.shape', 'Flame Seed', 0, 0, { shape: 'ellipse', size: [0.3, 0.7], position: [0.5, 0.6], softness: 0.5 });
    b.pulse(src, 'size', [0.3, 0.7], [0.34, 0.76], L);
    const adv = b.add('utils.fluid_advect', 'Lick Upwards', 1, 0, { strength: 0.45, steps: 8, scale: [2, 3], freq_gain: 1.55, divergence: 0.15, drift: [0, -0.3], seed: 5 }, { input: src });
    b.loopEvolution(adv, 'evolution', L);
    const rise = b.add('grayscale.noise', 'Rising Noise', 0, 1, { noise_type: 'perlin', scale: [3, 5], octaves: 4, seed: 11 });
    b.ramp01(rise, 'offset', [0, 0], [0, 1], L);
    b.loopEvolution(rise, 'evolution', L);
    const field = b.blend('Noise into Flame', 2, 0, rise, adv, 'add', { opacity: 0.32 });
    const hf = b.add('grayscale.gradient', 'Height Fade', 0, 2, { gtype: 'linear', start: [0.5, 0.92], end: [0.5, 0.12], invert: true, curve: curve([0, 0], [0.5, 0.75], [1, 1]) });
    const shaped = b.blend('Taper to Tip', 3, 0, hf, field, 'multiply');
    const outerT = b.add('grayscale.threshold', 'Outer Layer', 4, 0, { type: 'hard', threshold: 0.3 }, { input: shaped });
    const midT = b.add('grayscale.threshold', 'Mid Layer', 4, 1, { type: 'hard', threshold: 0.52 }, { input: shaped });
    const coreT = b.add('grayscale.threshold', 'Core Layer', 4, 2, { type: 'hard', threshold: 0.72 }, { input: shaped });
    b.anim(coreT, 'threshold', [[0, 0.72], [32, 0.66], [64, 0.72]], { pre: 'cycle', post: 'cycle' });
    const outerC = b.ramp('Outer Colour', 5, 0, outerT, grad([[0, [0, 0, 0, 0]], [1, [0.85, 0.1, 0.02, 1]]]));
    const midC = b.ramp('Mid Colour', 5, 1, midT, grad([[0, [0, 0, 0, 0]], [1, [1, 0.5, 0.05, 1]]]));
    const coreC = b.ramp('Core Colour', 5, 2, coreT, grad([[0, [0, 0, 0, 0]], [1, [1, 0.92, 0.45, 1]]]));
    const st1 = b.add('utils.blend_color', 'Stack Mid', 6, 0, { blend_type: 'copy', cross_mix: 1 }, { foreground: midC, background: outerC, mask: midT });
    const st2 = b.add('utils.blend_color', 'Stack Core', 7, 0, { blend_type: 'copy', cross_mix: 1 }, { foreground: coreC, background: st1, mask: coreT });
    const pts = b.add('particle.point_attributes', 'Embers', 6, 2, { count: 70, seed: 6, box_center: [0, -0.1, 0], box_size: [0.35, 0.5, 0], travel: [0, 0.6, 0], drift_amount: 0.07, size: 0.012, size_random: 0.7, color_gradient: FIRE_A });
    const emb = b.add('particle.render_2d', 'Render Embers', 7, 2, { extent: 1, shape: 'disc', soft: 0.8, blend: 'additive', intensity: 1.8 }, { points: `${pts}.points` });
    const withEmb = b.blendC('Add Embers', 8, 0, emb, st2, 'add');
    const halo = b.add('grayscale.gradient', 'Heat Halo', 8, 3, { gtype: 'radial', center: [0.5, 0.6], radius: 0.4, invert: true, curve: curve([0, 0], [0.5, 0.25], [1, 1]) });
    const haloC = b.ramp('Halo Colour', 9, 3, halo, grad([[0, [0, 0, 0, 0]], [1, [1, 0.35, 0.05, 0.5]]]));
    const comp = b.blendC('Add Halo', 9, 0, haloC, withEmb, 'add', { opacity: 0.6 });
    const bloom = b.add('utils.glow_color', 'Flame Bloom', 10, 0, { threshold: 0.6, radius: 0.07, intensity: 0.9, tint: [1, 0.6, 0.2, 1] }, { input: comp });
    b.pulse(bloom, 'intensity', 0.7, 1.1, L);
    const sheet = b.add('utils.sheet_encode', 'Sheet Encode', 11, 0, { frames: 16, auto_grid: true }, { input: bloom });
    b.add('export.color', 'Export Flipbook', 12, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: bloom });
    b.mark('main', bloom);
    b.mark('sheet', `${sheet}.sheet`);
    const haze = b.add('uv.noise', 'Heat Haze', 4, 4, { mode: 'angle', scale: [3, 5], strength: 0.05, uv_out: 'offset', seed: 2 });
    b.loopEvolution(haze, 'evolution', L);
    b.add('export.warp', 'Export Heat Haze', 5, 4, { codec: 'biased', range: 0.1 }, { input: haze });

    // ---------------------------------------------------------------- 3D
    const mk = (name: string, row: number, radius: number, height: number, segs: number, color: [number, number, number, number][], wave: number) => {
      const cone = b.add('geometry.shapes', `${name} Cone`, 0, row, { shape: 'cone', radius, size: [1, 1, height], segments: segs, rings: 12, pivot: 'base', caps: false });
      const w = b.add('geometry.space_warp', `${name} Wave`, 1, row, { mode: 'wave', axis: 'z', amount: wave, frequency: 2, length: height, decay: 0 }, { input: `${cone}.mesh` });
      b.ramp01(w, 'phase', 0, TAU, L);
      const tw = b.add('geometry.space_warp', `${name} Twist`, 2, row, { mode: 'twist', axis: 'z', amount: 40, length: height }, { input: w });
      b.anim(tw, 'amount', [[0, 20], [32, 60], [64, 20]], { pre: 'cycle', post: 'cycle' });
      return b.add('geometry.combine_color', `${name} Colour`, 3, row, { source: 'gradient_axis', origin: [0, 0, 0], direction: [0, 0, 1], length: height, gradient: grad([[0, color[0]], [0.55, color[1]], [1, color[2]]]) }, { input: tw });
    };
    const outer = mk('Outer', 6, 0.42, 1.7, 28, [[0.9, 0.12, 0.02, 0.95], [1, 0.4, 0.05, 0.6], [1, 0.6, 0.1, 0]], 0.09);
    const mid = mk('Mid', 7, 0.3, 1.3, 24, [[1, 0.5, 0.05, 0.95], [1, 0.7, 0.15, 0.7], [1, 0.85, 0.3, 0]], 0.06);
    const core = mk('Core', 8, 0.18, 0.85, 20, [[1, 0.9, 0.4, 1], [1, 0.95, 0.6, 0.8], [1, 1, 0.8, 0]], 0.04);
    const flame = b.add('geometry.merge', 'Flame', 4, 7, {}, { in1: outer, in2: mid, in3: core });
    const flick = b.add('geometry.transform', 'Flicker', 5, 7, { translate: [0, 0, 0] }, { input: flame });
    b.anim(flick, 'scale', [[0, [1, 1, 1]], [16, [0.94, 0.94, 1.08]], [32, [1.04, 1.04, 0.95]], [48, [0.96, 0.96, 1.06]], [64, [1, 1, 1]]], { pre: 'cycle', post: 'cycle' });
    const handle = b.add('geometry.shapes', 'Handle', 0, 9, { shape: 'cylinder', radius: 0.1, size: [1, 1, 1.4], segments: 16, pivot: 'base' });
    const handleT = b.add('geometry.transform', 'Handle Down', 1, 9, { translate: [0, 0, -1.4] }, { input: `${handle}.mesh` });
    const cup = b.add('geometry.shapes', 'Brazier Cup', 0, 10, { shape: 'cone', radius: 0.3, size: [1, 1, 0.3], segments: 20, pivot: 'base', caps: true });
    const cupF = b.add('geometry.transform', 'Cup Flip', 1, 10, { rotate: [180, 0, 0], translate: [0, 0, 0.02] }, { input: `${cup}.mesh` });
    const wood = b.add('geometry.merge', 'Torch Body', 2, 9, {}, { in1: handleT, in2: cupF });
    const woodC = b.add('geometry.combine_color', 'Wood Colour', 3, 9, { source: 'noise', n_frequency: 4, gradient: grad([[0, [0.14, 0.08, 0.04, 1]], [1, [0.35, 0.2, 0.1, 1]]]) }, { input: wood });
    const ep = b.add('geometry.points_shape', 'Ember Points', 0, 11, { mode: 'random', count: 26, size: [0.7, 0.7, 0], center: [0, 0, 0.5], seed: 5, align: false });
    const eb = b.add('geometry.shapes', 'Ember', 0, 12, { shape: 'cube', size: [0.035, 0.035, 0.035] });
    const embers = b.add('geometry.copy_to_points', 'Copy Embers', 2, 11, { use_orient: false, align_normal: false }, { mesh: `${eb}.mesh`, points: `${ep}.points` });
    const embC = b.add('geometry.combine_color', 'Ember Colour', 3, 11, { source: 'uniform', color: [1, 0.6, 0.15, 1] }, { input: `${embers}.mesh` });
    const embUp = b.add('geometry.transform', 'Embers Rise', 4, 11, {}, { input: embC });
    b.anim(embUp, 'translate', [[0, [0, 0, 0]], [63, [0, 0, 1.6]]], { interp: 'linear' });
    b.anim(embUp, 'uniform', [[0, 0.01], [10, 1], [48, 0.8], [63, 0.01]], { pre: 'cycle', post: 'cycle' });
    const all = b.add('geometry.merge', 'Merge', 6, 9, {}, { in1: flick, in2: woodC, in3: embUp });
    const mesh = b.add('export.mesh', 'Export Mesh', 7, 9, {}, { input: all });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.002, maxMean: 0.8, frames: [0, 20, 44] }],
};

/* ------------------------------------------------------------------------------------------------------------------ */
export const waterOrb: SampleDef = {
  id: 'water_orb',
  name: 'Water Orb (glass sphere + sloshing liquid)',
  description:
    'A glass sphere half full of luminous water on a 96-frame loop. Texture: two layers of looping caustics and noise lit through a sloshing surface (rotated gradient threshold), foam line, deep-to-cyan ramp, rising bubbles (particles), crescent highlight and fresnel rim, clipped by the sphere mask. Mesh: glass shell, liquid body with a wave-animated surface, rising bubble spheres and a metal stand.',
  kind: 'sample',
  tags: ['water', 'orb', 'glass', 'caustics', 'bubbles', 'animated', 'mesh', 'liquid'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 96, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'alpha', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const L = 96;
    const caus = b.add('grayscale.caustics', 'Caustics A', 0, 0, { scale: [3, 3], brightness: 1.3, floor_level: 0.25 });
    b.loopEvolution(caus, 'evolution', L);
    const caus2 = b.add('grayscale.caustics', 'Caustics B', 0, 1, { scale: [5, 5], brightness: 1, floor_level: 0.3, distortion: 1.4 });
    b.loopEvolution(caus2, 'evolution', L);
    const body = b.add('grayscale.noise', 'Water Body', 0, 2, { noise_type: 'perlin', scale: [3, 3], octaves: 5, seed: 5 });
    b.loopEvolution(body, 'evolution', L);
    const c1 = b.blend('Caustics Mix', 1, 0, caus2, caus, 'add', { opacity: 0.6 });
    const c2 = b.blend('+ Body', 2, 0, body, c1, 'add', { opacity: 0.35 });
    const level = b.add('grayscale.gradient', 'Level Gradient', 0, 3, { gtype: 'linear', start: [0.5, 0], end: [0.5, 1] });
    const slosh = b.add('utils.transform', 'Slosh', 1, 3, { edge: 'clamp' }, { input: level });
    b.anim(slosh, 'rotation', [[0, -5], [48, 5], [96, -5]], { pre: 'cycle', post: 'cycle' });
    b.anim(slosh, 'translate', [[0, [0, 0.02]], [32, [0, -0.02]], [64, [0, 0.02]], [96, [0, 0.02]]], { pre: 'cycle', post: 'cycle' });
    const liquid = b.add('grayscale.threshold', 'Liquid Mask', 2, 3, { type: 'soft', threshold: 0.4, smoothness: 0.01 }, { input: slosh });
    const depth = b.add('utils.levels', 'Depth Dark', 1, 2, { in_low: 0.35, in_high: 1, out_low: 1, out_high: 0.35 }, { input: level });
    const lit = b.blend('Lit Water', 3, 0, depth, c2, 'multiply', { cross_mix: 0.7 });
    const waterC = b.ramp('Water Ramp', 4, 0, lit, grad([[0, [0, 0.07, 0.18, 1]], [0.4, [0.02, 0.35, 0.6, 1]], [0.8, [0.25, 0.85, 1, 1]], [1, [0.9, 1, 1, 1]]]));
    const glass = b.add('color.uniform', 'Empty Glass', 3, 1, { color: [0.015, 0.05, 0.09, 1] });
    const filled = b.add('utils.blend_color', 'Fill Liquid', 5, 0, { blend_type: 'copy', cross_mix: 1 }, { foreground: waterC, background: glass, mask: liquid });
    const foamE = b.add('utils.edge_detect', 'Surface Edge', 3, 3, { width: 0.008, intensity: 4, softness: 0.5 }, { input: liquid });
    const foamC = b.ramp('Foam Line', 4, 3, foamE, grad([[0, [1, 1, 1, 0]], [1, [0.9, 1, 1, 1]]]));
    const withFoam = b.blendC('Add Foam', 6, 0, foamC, filled, 'add', { opacity: 0.9 });
    const pts = b.add('particle.point_attributes', 'Bubbles', 0, 5, { count: 44, seed: 3, box_center: [0, 0.18, 0], box_size: [0.5, 0.45, 0], travel: [0, 0.5, 0], drift_amount: 0.05, size: 0.02, size_random: 0.7, color_gradient: grad([[0, [0.7, 0.95, 1, 0]], [0.2, [0.85, 1, 1, 0.9]], [1, [0.7, 0.95, 1, 0]]]) });
    const bub = b.add('particle.render_2d', 'Render Bubbles', 1, 5, { extent: 1, shape: 'ring', soft: 0.5, blend: 'additive', intensity: 1.4 }, { points: `${pts}.points` });
    const withBub = b.blendC('Add Bubbles', 7, 0, bub, withFoam, 'add');
    const fres = b.add('grayscale.gradient', 'Fresnel Rim', 0, 6, { gtype: 'radial', center: [0.5, 0.5], radius: 0.46, curve: curve([0, 0], [0.7, 0.08], [1, 1]) });
    const fresC = b.ramp('Rim Colour', 1, 6, fres, grad([[0, [0, 0, 0, 0]], [1, [0.5, 0.9, 1, 1]]]));
    const withRim = b.blendC('Add Rim', 8, 0, fresC, withBub, 'add', { opacity: 0.8 });
    const hi = b.add('grayscale.shape', 'Highlight', 0, 7, { shape: 'crescent', size: [0.55, 0.55], position: [0.42, 0.4], rotation: 40, softness: 0.3 });
    const hiC = b.ramp('Highlight Colour', 1, 7, hi, grad([[0, [1, 1, 1, 0]], [1, [1, 1, 1, 0.85]]]));
    const withHi = b.blendC('Add Highlight', 9, 0, hiC, withRim, 'add', { opacity: 0.8 });
    const orbMask = b.add('grayscale.shape', 'Orb Mask', 0, 8, { shape: 'circle', size: [0.9, 0.9], softness: 0.015 });
    const orb = b.add('utils.alpha_merge', 'Orb Alpha', 10, 0, {}, { color: withHi, alpha: orbMask });
    const bloom = b.add('utils.glow_color', 'Orb Bloom', 11, 0, { threshold: 0.8, radius: 0.05, intensity: 0.5, tint: [0.6, 0.9, 1, 1] }, { input: orb });
    b.add('export.color', 'Export Orb', 12, 0, {}, { input: bloom });
    b.add('export.mask', 'Export Liquid Mask', 3, 4, {}, { input: liquid });
    b.mark('main', bloom);

    // ---------------------------------------------------------------- 3D
    const shell = b.add('geometry.shapes', 'Glass Shell', 0, 10, { shape: 'sphere', radius: 1, segments: 48, rings: 24 });
    const shellC = b.add('geometry.combine_color', 'Glass Colour', 1, 10, { source: 'uniform', color: [0.6, 0.88, 1, 0.16] }, { input: `${shell}.mesh` });
    const vol = b.add('geometry.shapes', 'Liquid Volume', 0, 11, { shape: 'hemisphere', radius: 0.96, segments: 40, rings: 20 });
    const volF = b.add('geometry.transform', 'Dome Down', 1, 11, { rotate: [180, 0, 0], translate: [0, 0, -0.05] }, { input: `${vol}.mesh` });
    const volC = b.add('geometry.combine_color', 'Liquid Gradient', 2, 11, { source: 'gradient_axis', origin: [0, 0, -1], direction: [0, 0, 1], length: 1, gradient: grad([[0, [0.0, 0.1, 0.3, 0.95]], [0.6, [0.03, 0.45, 0.75, 0.85]], [1, [0.25, 0.85, 1, 0.8]]]) }, { input: volF });
    const surf = b.add('geometry.shapes', 'Liquid Surface', 0, 12, { shape: 'disc', radius: 0.96, segments: 40, rings: 14 });
    const surfW = b.add('geometry.space_warp', 'Surface Waves', 1, 12, { mode: 'ripple', amount: 0.04, frequency: 3, decay: 0.3, position: [0.2, 0, 0] }, { input: `${surf}.mesh` });
    b.ramp01(surfW, 'phase', 0, -TAU, L);
    const surfT = b.add('geometry.transform', 'Surface Level', 2, 12, { translate: [0, 0, -0.05] }, { input: surfW });
    b.anim(surfT, 'rotate', [[0, [-4, 0, 0]], [48, [4, 0, 0]], [96, [-4, 0, 0]]], { pre: 'cycle', post: 'cycle' });
    const surfC = b.add('geometry.combine_color', 'Surface Colour', 3, 12, { source: 'gradient_radial', length: 0.96, gradient: grad([[0, [0.7, 1, 1, 0.9]], [1, [0.3, 0.85, 1, 0.75]]]) }, { input: surfT });
    const bp = b.add('geometry.points_shape', 'Bubble Points', 0, 13, { mode: 'sphere', radius: 0.55, count: 28, seed: 7, align: false });
    const bs = b.add('geometry.combine_scale_points', 'Bubble Sizes', 1, 13, { source: 'random', min: 0.4, max: 1.6, seed: 2 }, { input: `${bp}.points` });
    const bubble = b.add('geometry.shapes', 'Bubble', 0, 14, { shape: 'sphere', radius: 0.045, segments: 10, rings: 6 });
    const bubs = b.add('geometry.copy_to_points', 'Copy Bubbles', 2, 13, { use_orient: false, align_normal: false }, { mesh: `${bubble}.mesh`, points: bs });
    const bubC = b.add('geometry.combine_color', 'Bubble Colour', 3, 13, { source: 'uniform', color: [0.85, 1, 1, 0.6] }, { input: `${bubs}.mesh` });
    const bubUp = b.add('geometry.transform', 'Bubbles Rise', 4, 13, { translate: [0, 0, -0.3] }, { input: bubC });
    b.anim(bubUp, 'translate', [[0, [0, 0, -0.35]], [96, [0, 0, 0.35]]], { interp: 'linear' });
    b.pulse(bubUp, 'uniform', 0.01, 1, L);
    const stand = b.add('geometry.shapes', 'Stand Ring', 0, 15, { shape: 'torus', radius: 0.55, inner_radius: 0.08, segments: 40, rings: 8 });
    const standT = b.add('geometry.transform', 'Stand Position', 1, 15, { translate: [0, 0, -1.05] }, { input: `${stand}.mesh` });
    const standC = b.add('geometry.combine_color', 'Metal Colour', 2, 15, { source: 'gradient_radial', length: 0.65, gradient: grad([[0, [0.55, 0.5, 0.42, 1]], [1, [0.85, 0.78, 0.55, 1]]]) }, { input: standT });
    const all = b.add('geometry.merge', 'Merge', 5, 12, {}, { in1: shellC, in2: volC, in3: surfC, in4: bubUp, in5: standC });
    const mesh = b.add('export.mesh', 'Export Mesh', 6, 12, {}, { input: all });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.02, maxMean: 0.95, frames: [0, 40] }],
};
