import { FIRE_A, curve, grad, spt, type SampleDef } from './kit';

/**
 * Samples E (Kekenik 7A++): Blooming Flower (3D), Waterfall (flow + 3D), Neon Sign (spline + tube mesh) and the Golden Snitch
 * (wings, accumulate trail, sparkle particles). Built from real nodes; every one is animated and has a mesh / geometry part.
 */

/** Sweep control point with a hard corner (polylines for letters / zig-zags). */
const cpt = (x: number, y: number, z: number) => ({ x, y, mode: 'corner' as const, attrs: { z, scale: 1, twist: 0 } });
const line2 = (pts: [number, number][], closed = false) => ({ closed, points: pts.map(([x, y]) => ({ x, y, mode: 'corner' as const })) });

const GREEN = grad([[0, [0.04, 0.2, 0.05, 1]], [1, [0.35, 0.7, 0.18, 1]]]);
const PETAL = grad([[0, [0.42, 0.015, 0.16, 1]], [0.4, [0.92, 0.22, 0.5, 1]], [0.8, [1, 0.62, 0.78, 1]], [1, [1, 0.92, 0.94, 1]]]);
const GOLD = grad([[0, [0.08, 0.03, 0.005, 1]], [0.35, [0.55, 0.28, 0.03, 1]], [0.7, [1, 0.68, 0.14, 1]], [1, [1, 0.97, 0.7, 1]]]);

/* ------------------------------------------------------------------------------------------------------------------ */
export const bloomingFlower: SampleDef = {
  id: 'blooming_flower',
  name: 'Blooming Flower (petal texture + 3D)',
  description:
    'A flower that opens and closes in a seamless 120-frame loop. Texture: a veined petal (angular vein gradient, wobble warp, bud-to-bloom gradient offset), normal map and alpha. Mesh: two rings of cupped petals (Copy Transform fans, keyed tilt), pistil and stamens (Copy To Points), swept stem and leaves, whole plant swaying with a Space Warp bend.',
  kind: 'sample',
  tags: ['flower', 'bloom', 'organic', 'animated', 'mesh', 'petal', 'stylized'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 120, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'alpha', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const L = 120;
    // ---------------------------------------------------------------- petal texture
    const petal = b.add('grayscale.shape', 'Petal Shape', 0, 0, { shape: 'ellipse', size: [0.62, 0.92], position: [0.5, 0.5], softness: 0.1 });
    const base = b.add('grayscale.gradient', 'Base to Tip', 0, 1, { gtype: 'linear', start: [0.5, 0.95], end: [0.5, 0.08] });
    const veinsRaw = b.add('grayscale.gradient', 'Vein Fan', 0, 2, { gtype: 'angular', center: [0.5, 1.02], repeat: 16, wrap_mode: 'mirror' });
    const veinLines = b.add('utils.levels', 'Vein Lines', 1, 2, { in_low: 0.82, in_high: 0.98 }, { input: veinsRaw });
    const wobble = b.add('uv.noise', 'Vein Wobble', 1, 3, { mode: 'vector', scale: [5, 5], strength: 0.014, seed: 8 });
    b.loopEvolution(wobble, 'evolution', L);
    const veinsW = b.add('utils.transform', 'Wobbly Veins', 2, 2, { edge: 'clamp' }, { input: veinLines, uv: wobble });
    const fade = b.add('utils.levels', 'Vein Fade', 3, 2, { out_low: 0, out_high: 0.7 }, { input: veinsW });
    const veinMask = b.blend('Veins x Petal', 4, 2, petal, fade, 'multiply');
    const grain = b.add('grayscale.noise', 'Petal Grain', 2, 3, { noise_type: 'perlin', scale: [9, 9], octaves: 5, roughness: 0.55, seed: 3 });
    b.loopEvolution(grain, 'evolution', L);
    const hMix = b.blend('Height + Veins', 5, 1, veinMask, petal, 'add', { opacity: 0.22 });
    const height = b.blend('Height + Grain', 6, 1, grain, hMix, 'add', { opacity: 0.06 });
    const body = b.ramp('Petal Colour', 1, 1, base, PETAL);
    b.anim(body, 'offset', [[0, -0.32], [48, 0], [78, 0.04], [120, -0.32]], { pre: 'cycle', post: 'cycle' });
    const veinTint = b.ramp('Vein Tint', 5, 2, veinMask, grad([[0, [1, 1, 1, 1]], [1, [0.62, 0.16, 0.34, 1]]]));
    const veined = b.blendC('Veins Darken', 6, 2, veinTint, body, 'multiply');
    const rim = b.add('utils.blur', 'Petal Halo', 1, 0, { radius: 0.07 }, { input: petal });
    const rimC = b.ramp('Warm Halo', 2, 0, rim, grad([[0, [1, 0.5, 0.6, 0]], [1, [1, 0.75, 0.82, 0.55]]]));
    const withHalo = b.blendC('Add Halo', 7, 2, rimC, veined, 'screen', { opacity: 0.35 });
    const tone = b.add('color.adjust', 'Bloom Tone', 8, 2, {}, { input: withHalo });
    b.anim(tone, 'saturation', [[0, 0.55], [48, 1.1], [78, 1.1], [120, 0.55]], { pre: 'cycle', post: 'cycle' });
    b.anim(tone, 'value', [[0, 0.85], [48, 1.05], [120, 0.85]], { pre: 'cycle', post: 'cycle' });
    const colour = b.add('utils.alpha_merge', 'Petal Alpha', 9, 2, {}, { color: tone, alpha: petal });
    b.add('export.color', 'Export Petal', 10, 2, {}, { input: colour });
    const nrm = b.add('normal.create', 'Petal Normal', 7, 1, { strength: 2.4 }, { input: height });
    b.add('export.normal', 'Export Normal', 8, 1, {}, { input: nrm });
    b.mark('main', colour);

    // ---------------------------------------------------------------- 3D: petals
    const disc = b.add('geometry.shapes', 'Petal Disc', 0, 5, { shape: 'disc', radius: 0.5, segments: 28, rings: 7 });
    const ell = b.add('geometry.transform', 'Petal Proportion', 1, 5, { scale: [0.62, 1, 1], translate: [0, 0.5, 0] }, { input: `${disc}.mesh` });
    const cup = b.add('geometry.space_warp', 'Cup Petal', 2, 5, { mode: 'bend', axis: 'y', amount: 38, length: 1, recompute_normals: true }, { input: ell });
    const tilt1 = b.add('geometry.transform', 'Open / Close (outer)', 3, 5, {}, { input: cup });
    b.anim(tilt1, 'rotate', [[0, [84, 0, 0]], [48, [26, 0, 0]], [78, [30, 0, 0]], [120, [84, 0, 0]]], { pre: 'cycle', post: 'cycle' });
    const ring1 = b.add('geometry.copy_transform', 'Outer Ring x5', 4, 5, { copies: 5, translate: [0, 0, 0], rotate: [0, 0, 72] }, { input: tilt1 });
    const small = b.add('geometry.transform', 'Inner Petal Size', 1, 6, { uniform: 0.72 }, { input: cup });
    const tilt2 = b.add('geometry.transform', 'Open / Close (inner)', 2, 6, {}, { input: small });
    b.anim(tilt2, 'rotate', [[0, [88, 0, 0]], [56, [52, 0, 0]], [84, [56, 0, 0]], [120, [88, 0, 0]]], { pre: 'cycle', post: 'cycle' });
    const off2 = b.add('geometry.transform', 'Offset 36°', 3, 6, { rotate: [0, 0, 36] }, { input: tilt2 });
    const ring2 = b.add('geometry.copy_transform', 'Inner Ring x5', 4, 6, { copies: 5, translate: [0, 0, 0], rotate: [0, 0, 72] }, { input: off2 });
    const petalsA = b.add('geometry.merge', 'Petals', 5, 5, {}, { in1: ring1, in2: ring2 });
    const petalCol = b.add('geometry.combine_color', 'Petal Gradient', 6, 5, { source: 'gradient_radial', length: 1, gradient: grad([[0, [0.55, 0.04, 0.2, 1]], [0.45, [0.95, 0.3, 0.55, 1]], [1, [1, 0.82, 0.88, 1]]]) }, { input: petalsA });

    // pistil + stamens
    const pistil = b.add('geometry.shapes', 'Pistil', 0, 7, { shape: 'sphere', radius: 0.12, segments: 20, rings: 12 });
    const pistilC = b.add('geometry.combine_color', 'Pistil Colour', 1, 7, { source: 'uniform', color: [1, 0.78, 0.15, 1] }, { input: `${pistil}.mesh` });
    const sp = b.add('geometry.points_shape', 'Stamen Points', 0, 8, { mode: 'sphere', count: 34, radius: 0.34, seed: 5, align: false });
    const spz = b.add('geometry.transform_points', 'Stamens Up', 1, 8, { translate: [0, 0, 0.12] }, { input: `${sp}.points` });
    const tip = b.add('geometry.shapes', 'Stamen Tip', 0, 9, { shape: 'sphere', radius: 0.028, segments: 8, rings: 6 });
    const stamens = b.add('geometry.copy_to_points', 'Copy Stamens', 2, 8, { use_orient: false, align_normal: false }, { mesh: `${tip}.mesh`, points: spz });
    const stamenC = b.add('geometry.combine_color', 'Stamen Colour', 3, 8, { source: 'uniform', color: [1, 0.55, 0.1, 1] }, { input: `${stamens}.mesh` });
    const headRaw = b.add('geometry.merge', 'Flower Head', 7, 6, {}, { in1: petalCol, in2: pistilC, in3: stamenC });
    const head = b.add('geometry.transform', 'Bloom Scale + Spin', 8, 6, { translate: [0, 0, 2.1] }, { input: headRaw });
    b.anim(head, 'uniform', [[0, 0.6], [48, 1], [78, 1], [120, 0.6]], { pre: 'cycle', post: 'cycle' });
    b.ramp01(head, 'rotate', [0, 0, 0], [0, 0, 72], L);

    // stem + leaves
    const stem = b.add('geometry.sweep', 'Stem', 0, 10, {
      spline: { closed: false, points: [spt(0, 0, 0), spt(0.18, 0, 0.8), spt(-0.06, 0.05, 1.5), spt(0, 0, 2.1)] },
      profile: 'circle', profile_res: 12, width: 0.14, height: 0.14, segments: 64, cap_start: false, cap_end: true,
      scale_curve: curve([0, 1], [0.6, 0.75], [1, 0.6]), color_gradient: GREEN, v_by_length: true,
    });
    const leafPath = { closed: false, points: [spt(0, 0, 0), spt(0.5, 0, 0.3), spt(0.95, 0, 0.18), spt(1.25, 0, -0.12)] };
    const leafSw = b.add('geometry.sweep', 'Leaf', 0, 11, { spline: leafPath, profile: 'ribbon', width: 0.55, segments: 32, scale_curve: curve([0, 0.1], [0.35, 1], [0.8, 0.7], [1, 0.05]), color_gradient: GREEN });
    const leafA = b.add('geometry.transform', 'Leaf Low', 1, 11, { translate: [0, 0, 0.55], rotate: [0, 0, 20] }, { input: leafSw });
    const leafB = b.add('geometry.transform', 'Leaf High', 1, 12, { translate: [0, 0, 1.05], rotate: [0, 0, 205], uniform: 0.75 }, { input: leafSw });
    const plant = b.add('geometry.merge', 'Plant', 9, 6, {}, { in1: stem, in2: head, in3: leafA, in4: leafB });
    const sway = b.add('geometry.space_warp', 'Breeze Sway', 10, 6, { mode: 'bend', axis: 'z', amount: 4, length: 2.6 }, { input: plant });
    b.anim(sway, 'amount', [[0, -4], [60, 4], [120, -4]], { pre: 'cycle', post: 'cycle' });
    const mesh = b.add('export.mesh', 'Export Mesh', 11, 6, {}, { input: sway });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.02, maxMean: 0.95, frames: [0, 48, 80] }],
};

/* ------------------------------------------------------------------------------------------------------------------ */
export const waterfall: SampleDef = {
  id: 'waterfall_flow',
  name: 'Waterfall (flowing textures + curved mesh)',
  description:
    'A seamless 96-frame waterfall: stretched noise layers flow by whole tiles per loop, curl-warped and directionally blurred, foam gathers at the bottom, deep-to-white colour ramp, normal map and an exported flow (warp) map. Mesh: a swept curved sheet (UV scroll keyed by whole tiles), travelling Space Warp wave, plunge-pool ripples, boulders and a spray burst.',
  kind: 'sample',
  tags: ['water', 'waterfall', 'flow', 'tiling', 'animated', 'mesh', 'normal'],
  settings: { width: 512, height: 1024, tiling: 'both', loopLength: 96, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'alpha', doubleSided: true, scroll: [0, 0] }, display: 'vertex_color' },
  build(b) {
    const L = 96;
    const streaks = b.add('grayscale.noise', 'Long Streaks', 0, 0, { noise_type: 'perlin', scale: [12, 2], octaves: 4, roughness: 0.55, seed: 4 });
    b.ramp01(streaks, 'offset', [0, 0], [0, -1], L);
    const detail = b.add('grayscale.noise', 'Fast Detail', 0, 1, { noise_type: 'billow', scale: [22, 4], octaves: 4, seed: 9 });
    b.ramp01(detail, 'offset', [0, 0], [0, -2], L);
    const lumps = b.add('grayscale.noise', 'Water Lumps', 0, 2, { noise_type: 'worley_f2f1', scale: [10, 4], seed: 12 });
    b.ramp01(lumps, 'offset', [0, 0], [0, -1], L);
    const mix1 = b.blend('Streaks x Detail', 1, 0, detail, streaks, 'multiply', { cross_mix: 0.55 });
    const mix2 = b.blend('+ Lumps', 2, 0, lumps, mix1, 'overlay', { cross_mix: 0.35 });
    const warp = b.add('uv.noise', 'Curl Wobble', 1, 3, { mode: 'curl', scale: [4, 4], strength: 0.022, seed: 2 });
    b.loopEvolution(warp, 'evolution', L);
    const warped = b.add('utils.transform', 'Apply Wobble', 3, 0, { edge: 'tiling' }, { input: mix2, uv: warp });
    const smear = b.add('utils.directional_blur', 'Vertical Smear', 4, 0, { angle: 90, length: 0.07, falloff: 'trail', samples: 24 }, { input: warped });
    b.anim(smear, 'length', [[0, 0.05], [48, 0.1], [96, 0.05]], { pre: 'cycle', post: 'cycle' });
    const lv = b.add('utils.levels', 'Body Levels', 5, 0, { in_low: 0.18, in_high: 0.82, gamma: 1.1 }, { input: smear });
    const bodyC = b.ramp('Water Ramp', 6, 0, lv, grad([[0, [0.01, 0.1, 0.22, 0.85]], [0.4, [0.06, 0.36, 0.55, 0.9]], [0.75, [0.5, 0.85, 0.95, 1]], [1, [1, 1, 1, 1]]]));
    // foam: gathers at the bottom 30 %
    const foamN = b.add('grayscale.noise', 'Foam Noise', 0, 4, { noise_type: 'worley_f1', scale: [14, 8], seed: 21, invert: true });
    b.ramp01(foamN, 'offset', [0, 0], [0, -1], L);
    const foamMask = b.add('grayscale.gradient', 'Foam Zone', 0, 5, { gtype: 'linear', start: [0.5, 0.68], end: [0.5, 1], curve: curve([0, 0], [0.5, 0.6], [1, 1]) });
    b.anim(foamMask, 'start', [[0, [0.5, 0.7]], [48, [0.5, 0.62]], [96, [0.5, 0.7]]], { pre: 'cycle', post: 'cycle' });
    const foamM = b.blend('Foam x Zone', 1, 4, foamMask, foamN, 'multiply');
    const foam = b.add('grayscale.threshold', 'Foam Cut', 2, 4, { type: 'soft', threshold: 0.42, smoothness: 0.3 }, { input: foamM });
    const foamC = b.ramp('Foam Colour', 3, 4, foam, grad([[0, [1, 1, 1, 0]], [1, [0.95, 1, 1, 1]]]));
    const withFoam = b.add('utils.blend_color', 'Add Foam', 7, 0, { blend_type: 'copy', cross_mix: 1 }, { foreground: foamC, background: bodyC, mask: foam });
    const glow = b.add('utils.glow_color', 'Sun Sparkle', 8, 0, { threshold: 0.85, radius: 0.03, intensity: 0.6 }, { input: withFoam });
    b.add('export.color', 'Export Water', 9, 0, {}, { input: glow });
    const nrm = b.add('normal.create', 'Water Normal', 6, 1, { strength: 3, height_scale: 0.06 }, { input: lv });
    b.add('export.normal', 'Export Normal', 7, 1, {}, { input: nrm });
    // flow map = downward direction + noise
    const dirUV = b.add('uv.directional', 'Flow Down', 4, 3, { angle: 90, strength: 0.1, uv_out: 'offset' });
    const nUV = b.add('uv.noise', 'Flow Turbulence', 4, 4, { mode: 'vector', scale: [6, 6], strength: 0.04, uv_out: 'offset', seed: 6 });
    b.loopEvolution(nUV, 'evolution', L);
    const flow = b.add('uv.blend', 'Flow Map', 5, 3, { op: 'add' }, { a: dirUV, b: nUV });
    b.add('export.warp', 'Export Flow Map', 6, 3, { codec: 'biased', range: 0.2 }, { input: flow });
    b.mark('main', glow);

    // ---------------------------------------------------------------- 3D
    const sheetPath = { closed: false, points: [spt(0, 0, 3.0), spt(0, 0.45, 2.92), spt(0, 0.95, 2.4), spt(0, 1.2, 1.4), spt(0, 1.3, 0.05)] };
    const sheet = b.add('geometry.sweep', 'Water Sheet', 0, 7, {
      spline: sheetPath, profile: 'ribbon', width: 2.4, segments: 72, v_by_length: true, v_tiling: 3, use_gradient: false,
      scale_curve: curve([0, 0.8], [0.5, 0.92], [1, 1]),
    });
    b.ramp01(sheet, 'v_offset', 0, 1, L);
    const wave = b.add('geometry.space_warp', 'Falling Ripples', 1, 7, { mode: 'wave', axis: 'z', amount: 0.05, frequency: 4, length: 3, decay: 0 }, { input: sheet });
    b.ramp01(wave, 'phase', 0, -6.2831853, L);
    const lumpy = b.add('geometry.noise', 'Surface Lumps', 2, 7, { mode: 'normal', amplitude: 0.045, frequency: 4, octaves: 2, animate: true, loop: true, loop_cycles: 1, seed: 3 }, { input: wave });
    const sheetC = b.add('geometry.combine_color', 'Foam to Deep', 3, 7, { source: 'gradient_axis', origin: [0, 0, 0], direction: [0, 0, 1], length: 3, gradient: grad([[0, [1, 1, 1, 1]], [0.16, [0.7, 0.92, 1, 0.92]], [0.6, [0.2, 0.62, 0.8, 0.75]], [1, [0.08, 0.4, 0.62, 0.6]]]) }, { input: lumpy });
    // plunge pool
    const pool = b.add('geometry.shapes', 'Plunge Pool', 0, 8, { shape: 'disc', radius: 1.7, segments: 64, rings: 16 });
    const poolR = b.add('geometry.space_warp', 'Pool Ripples', 1, 8, { mode: 'ripple', amount: 0.07, frequency: 3.5, decay: 0.7, position: [0, 0, 0] }, { input: `${pool}.mesh` });
    b.ramp01(poolR, 'phase', 0, -6.2831853, L);
    const poolC = b.add('geometry.combine_color', 'Pool Colour', 2, 8, { source: 'gradient_radial', length: 1.7, gradient: grad([[0, [1, 1, 1, 0.95]], [0.25, [0.4, 0.78, 0.92, 0.85]], [1, [0.1, 0.42, 0.6, 0.35]]]) }, { input: poolR });
    const poolT = b.add('geometry.transform', 'Pool Position', 3, 8, { translate: [0, 1.3, 0.02] }, { input: poolC });
    // boulders
    const bp = b.add('geometry.points_shape', 'Boulder Points', 0, 9, { mode: 'random', count: 9, size: [4.4, 1.2, 0], center: [0, 1.75, 0], seed: 14, align: false, random_orient: true });
    const bs = b.add('geometry.combine_scale_points', 'Boulder Sizes', 1, 9, { source: 'random', min: 0.5, max: 1.5, seed: 8 }, { input: `${bp}.points` });
    const rock = b.add('geometry.shapes', 'Boulder', 0, 10, { shape: 'sphere', radius: 0.3, segments: 14, rings: 9 });
    const rocks = b.add('geometry.copy_to_points', 'Copy Boulders', 2, 9, {}, { mesh: `${rock}.mesh`, points: bs });
    const rockN = b.add('geometry.noise', 'Rough Rocks', 3, 9, { mode: 'normal', amplitude: 0.08, frequency: 3, octaves: 3, seed: 5 }, { input: `${rocks}.mesh` });
    const rockC = b.add('geometry.combine_color', 'Rock Colour', 4, 9, { source: 'noise', n_frequency: 3, gradient: grad([[0, [0.12, 0.1, 0.09, 1]], [1, [0.35, 0.31, 0.27, 1]]]) }, { input: rockN });
    // spray burst
    const spp = b.add('geometry.points_shape', 'Spray Points', 0, 11, { mode: 'random', count: 36, size: [1.8, 0.8, 0], center: [0, 1.3, 0.1], seed: 3, align: false });
    const drop = b.add('geometry.shapes', 'Droplet', 0, 12, { shape: 'sphere', radius: 0.04, segments: 8, rings: 6 });
    const drops = b.add('geometry.copy_to_points', 'Copy Droplets', 2, 11, { use_orient: false, align_normal: false }, { mesh: `${drop}.mesh`, points: `${spp}.points` });
    const dropC = b.add('geometry.combine_color', 'Droplet Colour', 3, 11, { source: 'uniform', color: [0.9, 0.98, 1, 0.8] }, { input: `${drops}.mesh` });
    const spray = b.add('geometry.transform', 'Spray Burst', 4, 11, {}, { input: dropC });
    b.anim(spray, 'translate', [[0, [0, 0, 0]], [34, [0, 0, 0.55]], [66, [0, 0, 0.02]], [96, [0, 0, 0]]], { pre: 'cycle', post: 'cycle' });
    b.anim(spray, 'uniform', [[0, 0.01], [8, 1], [60, 0.9], [90, 0.01], [96, 0.01]], { pre: 'cycle', post: 'cycle' });
    const all = b.add('geometry.merge', 'Merge', 5, 8, {}, { in1: sheetC, in2: poolT, in3: rockC, in4: spray });
    const mesh = b.add('export.mesh', 'Export Mesh', 6, 8, {}, { input: all });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.1, maxMean: 0.99, frames: [0, 40] }],
};

/* ------------------------------------------------------------------------------------------------------------------ */
// "VFX" letters in uv space (1024 x 512 image). Each entry is an open polyline (corners).
const LETTERS: [number, number][][] = [
  [[0.2, 0.28], [0.28, 0.72], [0.36, 0.28]], // V
  [[0.59, 0.28], [0.47, 0.28], [0.47, 0.72]], // F stem + top
  [[0.47, 0.5], [0.57, 0.5]], // F bar
  [[0.67, 0.28], [0.83, 0.72]], // X1
  [[0.83, 0.28], [0.67, 0.72]], // X2
  [[0.2, 0.84], [0.83, 0.84]], // underline
];
export const neonSign: SampleDef = {
  id: 'neon_sign',
  name: 'Neon Sign "VFX" (spline glow + tube mesh)',
  description:
    'Hand-drawn neon letters from Spline nodes: a left-to-right draw-on wipe, hot white core, magenta halo layers, buzzing flicker (stepped keys), light spill on a brick wall and a lens fringe. Mesh: the same letters as glowing swept tubes in front of a dark back plate, swaying gently.',
  kind: 'sample',
  tags: ['neon', 'spline', 'glow', 'text', 'sign', 'animated', 'mesh'],
  settings: { width: 1024, height: 512, tiling: 'none', loopLength: 90, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const s1 = b.add('grayscale.spline', 'Letters V F', 0, 0, { spline: line2(LETTERS[0]), spline_2: line2(LETTERS[1]), spline_3: line2(LETTERS[2]), spline_4: line2(LETTERS[3]), width: 0.03, softness: 0.25 });
    const s2 = b.add('grayscale.spline', 'Letters X + Line', 0, 1, { spline: line2(LETTERS[4]), spline_2: line2(LETTERS[5]), width: 0.03, softness: 0.25 });
    const letters = b.blend('All Letters', 1, 0, s2, s1, 'max');
    const sweep = b.add('grayscale.gradient', 'Wipe Gradient', 0, 2, { gtype: 'linear', start: [1, 0.5], end: [0, 0.5] });
    const wipe = b.add('grayscale.threshold', 'Draw-on Wipe', 1, 2, { type: 'soft', threshold: 1.1, smoothness: 0.12 }, { input: sweep });
    b.anim(wipe, 'threshold', [[0, 1.1], [34, -0.15]], { interp: 'linear' });
    const drawn = b.blend('Revealed', 2, 0, wipe, letters, 'multiply');
    const power = b.add('utils.levels', 'Power / Buzz', 3, 0, { out_high: 1 }, { input: drawn });
    b.steps(power, 'out_high', [[0, 1], [40, 0.7], [42, 1], [55, 0.55], [57, 1], [62, 0.8], [64, 1], [70, 1], [72, 0.15], [75, 0.9], [78, 0.1], [82, 0.6], [84, 0], [90, 0]]);
    const core = b.add('grayscale.threshold', 'White-hot Core', 4, 1, { type: 'soft', threshold: 0.55, smoothness: 0.35 }, { input: power });
    const tube = b.add('utils.blur', 'Tube Body', 4, 0, { radius: 0.004 }, { input: power });
    const halo1 = b.add('utils.blur', 'Halo Near', 4, 2, { radius: 0.014 }, { input: power });
    const halo2 = b.add('utils.blur', 'Halo Far', 4, 3, { radius: 0.06 }, { input: power });
    b.anim(halo2, 'radius', [[0, 0.05], [45, 0.075], [90, 0.05]], { pre: 'cycle', post: 'cycle' });
    const halo = b.blend('Halo Mix', 5, 2, halo2, halo1, 'add', { opacity: 0.8 });
    const NEON = grad([[0, [0, 0, 0, 0]], [0.25, [0.3, 0.015, 0.35, 0.5]], [0.6, [1, 0.1, 0.78, 1]], [1, [1, 0.62, 0.95, 1]]]);
    const haloC = b.ramp('Magenta Halo', 6, 2, halo, NEON);
    const tubeC = b.ramp('Tube Colour', 6, 0, tube, grad([[0, [0, 0, 0, 0]], [0.5, [1, 0.12, 0.8, 1]], [1, [1, 0.8, 0.97, 1]]]));
    const coreC = b.ramp('Core Colour', 6, 1, core, grad([[0, [0, 0, 0, 0]], [1, [1, 1, 1, 1]]]));
    const t1 = b.blendC('Tube + Halo', 7, 0, tubeC, haloC, 'add');
    const t2 = b.blendC('+ Core', 8, 0, coreC, t1, 'add');
    // brick wall + light spill
    const bricks = b.add('utils.grid', 'Brick Wall', 0, 5, { pattern: 'bricks', cells: [14, 7], output_kind: 'cells_lines', line_width: 0.08, random_amount: 0.6, seed: 4 });
    const wall = b.ramp('Wall Colour', 1, 5, bricks, grad([[0, [0.012, 0.012, 0.02, 1]], [0.6, [0.045, 0.04, 0.06, 1]], [1, [0.09, 0.085, 0.11, 1]]]));
    const spillG = b.add('utils.blur', 'Spill', 2, 5, { radius: 0.16 }, { input: power });
    const spillC = b.ramp('Spill Colour', 3, 5, spillG, grad([[0, [0, 0, 0, 0]], [1, [0.9, 0.12, 0.7, 1]]]));
    const lit = b.add('utils.blend_color', 'Light on Wall', 4, 5, { blend_type: 'overlay', opacity: 1 }, { foreground: spillC, background: wall });
    b.anim(lit, 'opacity', [[0, 0.9], [45, 1], [90, 0.9]], { pre: 'cycle', post: 'cycle' });
    const scene = b.blendC('Sign over Wall', 9, 0, t2, lit, 'add');
    const bloom = b.add('utils.glow_color', 'Bloom', 10, 0, { threshold: 0.7, radius: 0.08, intensity: 0.7, tint: [1, 0.5, 0.9, 1] }, { input: scene });
    const ca = b.add('utils.chromatic_aberration', 'Lens Fringe', 11, 0, { amount: 0.012, falloff: 1.8 }, { input: bloom });
    b.pulse(ca, 'amount', 0.008, 0.02, 90);
    b.add('export.color', 'Export Sign', 12, 0, {}, { input: ca });
    b.add('export.mask', 'Export Letter Mask', 5, 1, {}, { input: power });
    b.mark('main', ca);

    // ---------------------------------------------------------------- 3D tubes (x = (u - 0.5) * 4, z = (0.5 - v) * 2)
    const tubes = LETTERS.map((pts, i) => {
      const path = { closed: false, points: pts.map(([u, v]) => cpt((u - 0.5) * 4, 0, (0.5 - v) * 2)) };
      return b.add('geometry.sweep', `Tube ${i + 1}`, 0, 7 + i, { spline: path, profile: 'circle', profile_res: 10, width: 0.085, height: 0.085, segments: 40, use_gradient: false, cap_start: true, cap_end: true });
    });
    const merged = b.add('geometry.merge', 'Tubes', 1, 8, {}, { in1: tubes[0], in2: tubes[1], in3: tubes[2], in4: tubes[3], in5: tubes[4], in6: tubes[5] });
    const glowC = b.add('geometry.combine_color', 'Neon Emissive', 2, 8, { source: 'gradient_axis', origin: [-2, 0, 0], direction: [1, 0, 0], length: 4, gradient: grad([[0, [1, 0.15, 0.85, 1]], [0.5, [1, 0.45, 0.95, 1]], [1, [0.85, 0.2, 1, 1]]]) }, { input: merged });
    const plate = b.add('geometry.shapes', 'Back Plate', 0, 13, { shape: 'plane', size: [4.7, 2.7, 1] });
    const plateR = b.add('geometry.transform', 'Plate Upright', 1, 13, { rotate: [90, 0, 0], translate: [0, 0.14, 0] }, { input: `${plate}.mesh` });
    const plateC = b.add('geometry.combine_color', 'Plate Colour', 2, 13, { source: 'uniform', color: [0.03, 0.03, 0.05, 1] }, { input: plateR });
    const both = b.add('geometry.merge', 'Sign', 3, 10, {}, { in1: glowC, in2: plateC });
    const swayT = b.add('geometry.transform', 'Sign Sway', 4, 10, { translate: [0, 0, 0] }, { input: both });
    b.anim(swayT, 'rotate', [[0, [0, 0, -3]], [45, [0, 0, 3]], [90, [0, 0, -3]]], { pre: 'cycle', post: 'cycle' });
    const mesh = b.add('export.mesh', 'Export Mesh', 5, 10, {}, { input: swayT });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.005, maxMean: 0.9, frames: [34, 50, 66] }],
};

/* ------------------------------------------------------------------------------------------------------------------ */
export const goldenSnitch: SampleDef = {
  id: 'golden_snitch',
  name: 'Golden Snitch (wings + sparkle trail)',
  description:
    'A winged golden orb darting along a figure-eight on a 64-frame loop. Texture: engraved gold sphere shading, two fans of feathers (Polar Scatter, flapping through keyed angle ranges), additive sparkle particles with motion streaks, bloom and lens fringe. Mesh: sphere + engraved rings + feather fans (Copy Transform) flapping with keyed rotation, travelling along the path with an Accumulate comet trail.',
  kind: 'sample',
  tags: ['gold', 'wings', 'trail', 'sparkle', 'particles', 'animated', 'mesh', 'accumulate'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 64, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const L = 64;
    // orb
    const orbMask = b.add('grayscale.shape', 'Orb Mask', 0, 0, { shape: 'circle', size: [0.17, 0.17], softness: 0.04 });
    const shade = b.add('grayscale.gradient', 'Sphere Shading', 0, 1, { gtype: 'radial', center: [0.46, 0.45], radius: 0.16, invert: true, curve: curve([0, 0], [0.6, 0.7], [1, 1]) });
    const engrave = b.add('grayscale.gradient', 'Engraving', 0, 2, { gtype: 'angular', center: [0.5, 0.5], repeat: 18, wrap_mode: 'mirror' });
    b.ramp01(engrave, 'offset', 0, 1, L);
    const engLine = b.add('utils.levels', 'Engrave Lines', 1, 2, { in_low: 0.46, in_high: 0.54 }, { input: engrave });
    const orbShade = b.blend('Engraved Shade', 2, 1, engLine, shade, 'multiply', { opacity: 0.25, cross_mix: 0.2 });
    const orbCol = b.ramp('Gold Ramp', 3, 1, orbShade, GOLD);
    const orb = b.add('utils.alpha_merge', 'Orb Alpha', 4, 1, {}, { color: orbCol, alpha: orbMask });
    // wings
    const wingR = b.add('grayscale.polar_scatter', 'Wing Right', 0, 3, { center: [0.5, 0.5], ring_count: 4, count: 7, radius_min: 0.09, radius_max: 0.4, shape: 'polygon', sides: 3, size: 0.026, stretch: 9, align_radial: true, angle_start: -55, angle_range: 110, softness: 0.4, size_rand: 0.3, seed: 2 });
    b.anim(wingR, 'angle_start', [[0, -55], [16, -15], [32, -55], [48, -15], [64, -55]], { pre: 'cycle', post: 'cycle' });
    const wingL = b.add('grayscale.polar_scatter', 'Wing Left', 0, 4, { center: [0.5, 0.5], ring_count: 4, count: 7, radius_min: 0.09, radius_max: 0.4, shape: 'polygon', sides: 3, size: 0.026, stretch: 9, align_radial: true, angle_start: 125, angle_range: 110, softness: 0.4, size_rand: 0.3, seed: 2 });
    b.anim(wingL, 'angle_start', [[0, 125], [16, 85], [32, 125], [48, 85], [64, 125]], { pre: 'cycle', post: 'cycle' });
    const wings = b.blend('Both Wings', 1, 3, wingL, wingR, 'max');
    const wingBlur = b.add('utils.blur', 'Feather Soften', 2, 3, { radius: 0.003 }, { input: wings });
    const wingC = b.ramp('Feather Ramp', 3, 3, wingBlur, grad([[0, [0.6, 0.35, 0.05, 0]], [0.5, [1, 0.72, 0.2, 0.8]], [1, [1, 0.97, 0.8, 1]]]));
    // sparkle trail
    const pts = b.add('particle.point_attributes', 'Sparkles', 0, 5, { count: 120, seed: 7, box_center: [-0.1, 0.02, 0], box_size: [0.8, 0.4, 0], travel: [-0.6, 0.05, 0], drift_amount: 0.05, size: 0.012, size_random: 0.7, color_gradient: FIRE_A });
    const spark = b.add('particle.render_2d', 'Render Sparkles', 1, 5, { extent: 1, shape: 'diamond', soft: 0.7, blend: 'additive', intensity: 1.6 }, { points: `${pts}.points` });
    const streakWarp = b.add('uv.noise', 'Trail Waver', 1, 6, { mode: 'curl', scale: [3, 3], strength: 0.03, seed: 4 });
    b.loopEvolution(streakWarp, 'evolution', L);
    const wavy = b.add('utils.transform_color', 'Wavy Sparkles', 2, 5, { edge: 'clamp' }, { input: spark, uv: streakWarp });
    const streak = b.add('utils.directional_blur_color', 'Motion Streak', 3, 5, { angle: 0, length: 0.14, falloff: 'trail', samples: 24 }, { input: wavy });
    const trail = b.blendC('Sparkles + Streak', 4, 5, streak, wavy, 'add', { opacity: 0.8 });
    // compose
    const c1 = b.add('utils.blend_color', 'Orb over Wings', 5, 2, { blend_type: 'copy', cross_mix: 1 }, { foreground: orb, background: wingC, mask: orbMask });
    const c2 = b.blendC('Add Sparkles', 6, 2, trail, c1, 'add');
    const bloom = b.add('utils.glow_color', 'Golden Bloom', 7, 2, { threshold: 0.6, radius: 0.07, intensity: 0.9, tint: [1, 0.75, 0.3, 1] }, { input: c2 });
    const ca = b.add('utils.chromatic_aberration', 'Lens Fringe', 8, 2, { amount: 0.015 }, { input: bloom });
    b.pulse(bloom, 'intensity', 0.7, 1.2, L);
    b.add('export.color', 'Export Flipbook', 9, 2, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: ca });
    b.mark('main', ca);

    // ---------------------------------------------------------------- 3D
    const orbM = b.add('geometry.shapes', 'Orb', 0, 8, { shape: 'sphere', radius: 0.3, segments: 40, rings: 24 });
    const orbN = b.add('geometry.noise', 'Hammered Gold', 1, 8, { mode: 'normal', amplitude: 0.006, frequency: 14, octaves: 2, seed: 4 }, { input: `${orbM}.mesh` });
    const ringA = b.add('geometry.shapes', 'Engraved Ring', 0, 9, { shape: 'torus', radius: 0.3, inner_radius: 0.012, segments: 48, rings: 8 });
    const ringB = b.add('geometry.transform', 'Ring Tilt', 1, 9, { rotate: [70, 0, 0] }, { input: `${ringA}.mesh` });
    const body = b.add('geometry.merge', 'Body', 2, 8, {}, { in1: orbN, in2: ringB });
    const bodyC = b.add('geometry.combine_color', 'Gold Vertex Colour', 3, 8, { source: 'gradient_axis', origin: [0, 0, -0.3], direction: [0, 0, 1], length: 0.6, gradient: grad([[0, [0.55, 0.28, 0.04, 1]], [0.5, [1, 0.72, 0.18, 1]], [1, [1, 0.96, 0.68, 1]]]) }, { input: body });
    const feather = b.add('geometry.shapes', 'Feather', 0, 10, { shape: 'disc', radius: 0.5, segments: 16, rings: 4 });
    const fl = b.add('geometry.transform', 'Feather Proportion', 1, 10, { scale: [0.1, 1, 1], translate: [0, 0.5, 0], uniform: 0.7 }, { input: `${feather}.mesh` });
    const fan = b.add('geometry.copy_transform', 'Feather Fan', 2, 10, { copies: 7, translate: [0, 0, 0.01], rotate: [0, 0, -13], scale: [1, 0.94, 1] }, { input: fl });
    const fanAim = b.add('geometry.transform', 'Aim Wing Out', 3, 10, { rotate: [0, 0, 52], translate: [0.25, 0, 0] }, { input: fan });
    const wingGeo = b.add('geometry.transform', 'Flap Right', 4, 10, {}, { input: fanAim });
    b.anim(wingGeo, 'rotate', [[0, [0, 38, 0]], [8, [0, -38, 0]], [16, [0, 38, 0]], [24, [0, -38, 0]], [32, [0, 38, 0]], [40, [0, -38, 0]], [48, [0, 38, 0]], [56, [0, -38, 0]], [64, [0, 38, 0]]], { pre: 'cycle', post: 'cycle' });
    const wingMirror = b.add('geometry.transform', 'Mirror Wing', 5, 10, { scale: [-1, 1, 1] }, { input: wingGeo });
    const wingsAll = b.add('geometry.merge', 'Wings', 6, 10, {}, { in1: wingGeo, in2: wingMirror });
    const wingCol = b.add('geometry.combine_color', 'Wing Colour', 7, 10, { source: 'gradient_radial', length: 0.9, gradient: grad([[0, [1, 0.8, 0.3, 1]], [0.6, [1, 0.9, 0.55, 0.85]], [1, [1, 1, 0.9, 0.2]]]) }, { input: wingsAll });
    const snitch = b.add('geometry.merge', 'Snitch', 8, 9, {}, { in1: bodyC, in2: wingCol });
    // figure-eight flight path: x = -cos(t), z = 0.45 sin(2t), sampled every 4 frames (keys shared by body and comet)
    const flight = (id: string) => {
      const keys: [number, number[]][] = [];
      for (let t = 0; t <= 64; t += 4) keys.push([t, [-Math.cos((t / 64) * Math.PI * 2), 0, 0.45 * Math.sin((t / 64) * Math.PI * 4)]]);
      b.anim(id, 'translate', keys, { pre: 'cycle', post: 'cycle' });
    };
    const fly = b.add('geometry.transform', 'Flight Path', 9, 9, {}, { input: snitch });
    flight(fly);
    const comet = b.add('geometry.shapes', 'Comet Head', 8, 11, { shape: 'sphere', radius: 0.12, segments: 16, rings: 10 });
    const cometFly = b.add('geometry.transform', 'Comet Path', 9, 11, {}, { input: `${comet}.mesh` });
    flight(cometFly);
    const trailM = b.add('geometry.accumulate', 'Comet Trail', 10, 11, { max_count: 18, step_time: 0.03, decay: 0.2, scale_per_step: 0.92 }, { input: cometFly });
    const trailC = b.add('geometry.combine_color', 'Trail Colour', 11, 11, { source: 'uniform', color: [1, 0.7, 0.2, 0.6] }, { input: trailM });
    const all = b.add('geometry.merge', 'Merge', 12, 9, {}, { in1: fly, in2: trailC });
    const mesh = b.add('export.mesh', 'Export Mesh', 13, 9, {}, { input: all });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.002, maxMean: 0.7, frames: [0, 16, 40] }],
};
