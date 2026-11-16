import { ELECTRIC, FIRE, FIRE_A, HOT, boltSpline, curve, grad, type SampleDef } from './kit';

/**
 * Samples A: Fire Anomaly Orb, Lightning Strike, Shockwave Ring. All are ANIMATED (keyframes on the 64 / 48 frame loop) and
 * contain a mesh part that is animated as well. `view` pre-fills the 3D viewport (mesh + material texture) on open.
 */

export const fireOrb: SampleDef = {
  id: 'fire_orb',
  name: 'Fire Anomaly Orb',
  description:
    'Looping fire sphere: curl-warped billowing flames rise through an orb mask (1 tile / loop = seamless), pulsing hot core, ember particles, radial-blur streaks, glow and a flipbook export — plus a noise-boiled sphere mesh with fire vertex colours.',
  kind: 'sample',
  tags: ['fire', 'orb', 'animated', 'particles', 'mesh'],
  settings: { width: 512, height: 512, tiling: 'both', loopLength: 64, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true, depthWrite: false }, display: 'unlit' },
  build(b) {
    const L = 64;
    const warp = b.add('uv.noise', 'Heat Curl Warp', 0, 0, { mode: 'curl', scale: [2, 2], strength: 0.07, octaves: 2, seed: 3 });
    b.loopEvolution(warp, 'evolution', L);
    const flames = b.add('grayscale.noise', 'Rising Flames', 1, 0, { noise_type: 'perlin', scale: [3, 3], octaves: 5, roughness: 0.58, contrast: 1.5, anisotropy: 0.3, seed: 11 }, { uv: warp });
    b.ramp01(flames, 'offset', [0, 0], [0, 1], L); // flames travel exactly one tile upwards per loop
    b.loopEvolution(flames, 'evolution', L);
    const orb = b.add('grayscale.shape', 'Orb Mask', 1, 1, { shape: 'circle', size: [0.72, 0.72], softness: 0.55 });
    b.pulse(orb, 'size', [0.7, 0.7], [0.76, 0.76], L);
    const rise = b.add('grayscale.gradient', 'Bottom Heavy', 1, 2, { gtype: 'linear', start: [0.5, 0.92], end: [0.5, 0.12] });
    const body = b.blend('Flames x Orb', 2, 0, flames, orb, 'multiply');
    const body2 = b.blend('x Bottom Heavy', 3, 0, rise, body, 'multiply', { cross_mix: 0.65 });
    const lv = b.add('utils.levels', 'Flame Levels', 4, 0, { in_low: 0.12, in_high: 0.72 }, { input: body2 });
    const ramp = b.ramp('Fire Ramp', 5, 0, lv, FIRE);
    const core = b.add('grayscale.shape', 'Hot Core', 3, 1, { shape: 'circle', size: [0.3, 0.3], softness: 0.95, intensity: 1.1 });
    b.pulse(core, 'size', [0.26, 0.26], [0.36, 0.36], L / 2);
    const coreC = b.ramp('Core Colour', 4, 1, core, HOT);
    const withCore = b.blendC('Add Core', 6, 0, coreC, ramp, 'add');

    // embers: looping particles (position wraps inside the emission box, age loops once per cycle)
    const pts = b.add('particle.point_attributes', 'Embers', 4, 2, { count: 90, seed: 4, box_size: [0.8, 0.8, 0], travel: [0, 0.55, 0], drift_amount: 0.06, size: 0.014, size_random: 0.6, color_gradient: FIRE_A });
    const embers = b.add('particle.render_2d', 'Render Embers', 5, 2, { extent: 1, shape: 'disc', soft: 0.85, blend: 'additive', intensity: 1.6 }, { points: `${pts}.points` });
    const withEmbers = b.blendC('Add Embers', 7, 0, embers, withCore, 'add');
    const streak = b.add('utils.radial_blur_color', 'Heat Streaks', 8, 0, { mode: 'zoom', amount: 0.16, falloff: 'trail', inner: 0.12, samples: 24 }, { input: withEmbers });
    const streaks = b.blendC('Add Streaks', 9, 0, streak, withEmbers, 'add', { opacity: 0.55 });
    const glow = b.add('utils.glow_color', 'Glow', 10, 0, { radius: 0.07, intensity: 0.9, tint: [1, 0.55, 0.2, 1] }, { input: streaks });
    b.add('export.color', 'Export Flipbook', 11, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: glow });
    b.mark('main', glow);

    // 3D: noise-boiled sphere with a fire gradient along Z
    const sph = b.add('geometry.shapes', 'Orb Sphere', 0, 4, { shape: 'sphere', radius: 0.8, segments: 48, rings: 24 });
    const boil = b.add('geometry.noise', 'Boil', 1, 4, { mode: 'normal', amplitude: 0.12, frequency: 2.2, octaves: 3, animate: true, loop: true, loop_cycles: 1, speed: 1, seed: 7 }, { input: `${sph}.mesh` });
    b.pulse(boil, 'amplitude', 0.1, 0.17, L);
    const col = b.add('geometry.combine_color', 'Fire Vertex Colour', 2, 4, { source: 'gradient_axis', origin: [0, 0, -0.9], direction: [0, 0, 1], length: 1.9, gradient: FIRE }, { input: boil });
    const mesh = b.add('export.mesh', 'Export Mesh', 3, 4, {}, { input: col });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.005, maxMean: 0.95, frames: [0, 20, 45] }],
};

export const lightningStrike: SampleDef = {
  id: 'lightning_strike',
  name: 'Lightning Strike (mask + mesh bolt)',
  description:
    'A procedural forked bolt strikes top-to-bottom (Reveal), flickers (stepped seed), morphs (Evolution) and fades while a ground flash and sparks fire — electric ramp, glow, radial light shafts. Plus a swept 4-blade mesh bolt that strikes, jitters with looping 3D noise and carries a vertex-colour gradient.',
  kind: 'sample',
  tags: ['lightning', 'bolt', 'animated', 'mesh', 'sweep', 'particles'],
  settings: { width: 512, height: 768, tiling: 'none', loopLength: 48, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const main = b.add('grayscale.lightning', 'Main Bolt', 0, 0, { start: [0.5, 0.02], end: [0.45, 0.95], width: 0.009, jag: 0.1, branches: 4, branch_length: 0.4, glow: 0.5, seed: 3 });
    b.anim(main, 'reveal', [[0, 0], [7, 1]], { interp: 'linear' });
    b.steps(main, 'seed', [[0, 3], [14, 8], [17, 3], [21, 12], [26, 5], [33, 9]]);
    b.anim(main, 'evolution', [[0, 0], [46, 1.5]], { interp: 'linear' });
    b.anim(main, 'intensity', [[0, 1], [16, 1], [17, 0.55], [18, 1], [22, 0.45], [24, 1], [30, 0.5], [47, 0]]);
    b.anim(main, 'glow', [[0, 0.4], [7, 1.0], [24, 0.7], [47, 0.2]]);
    const thin = b.add('grayscale.lightning', 'Thin Echo Bolt', 0, 1, { start: [0.52, 0.02], end: [0.47, 0.95], width: 0.004, jag: 0.14, branches: 2, glow: 0.3, seed: 21, segments: 7 });
    b.anim(thin, 'reveal', [[1, 0], [9, 1]], { interp: 'linear' });
    b.steps(thin, 'seed', [[0, 21], [15, 4], [20, 17], [28, 2]]);
    b.anim(thin, 'intensity', [[0, 0.8], [20, 0.8], [40, 0]]);
    const both = b.blend('Merge Bolts', 1, 0, thin, main, 'max');
    const halo = b.add('utils.glow', 'Bolt Glow', 2, 0, { threshold: 0.2, radius: 0.07, intensity: 2.2 }, { input: both });
    const ramp = b.ramp('Electric Ramp', 3, 0, halo, ELECTRIC);

    const flash = b.add('grayscale.shape', 'Ground Flash', 1, 2, { shape: 'ellipse', position: [0.45, 0.95], size: [0.7, 0.16], softness: 1 });
    b.anim(flash, 'intensity', [[0, 0], [6, 0], [8, 1.2], [26, 0.2], [44, 0]]);
    const flashC = b.ramp('Flash Colour', 2, 2, flash, ELECTRIC);
    const lit = b.blendC('Add Flash', 4, 0, flashC, ramp, 'add');

    const pts = b.add('particle.point_attributes', 'Ground Sparks', 3, 2, { count: 60, seed: 12, box_center: [-0.04, -0.62, 0], box_size: [0.5, 0.5, 0], travel: [0, 0.4, 0], drift_amount: 0.08, size: 0.012, size_random: 0.7, color_gradient: grad([[0, [0.6, 0.8, 1, 0]], [0.2, [0.8, 0.95, 1, 1]], [1, [0.2, 0.4, 1, 0]]]) });
    const sparks = b.add('particle.render_2d', 'Render Sparks', 4, 2, { extent: 1, shape: 'disc', soft: 0.7, blend: 'additive', intensity: 1.5 }, { points: `${pts}.points` });
    const withSparks = b.blendC('Add Sparks', 5, 0, sparks, lit, 'add');
    const shafts = b.add('utils.radial_blur_color', 'Light Shafts', 6, 0, { mode: 'zoom', amount: 0.3, falloff: 'trail', center: [0.45, 0.95], samples: 32 }, { input: withSparks });
    const final = b.blendC('Add Shafts', 7, 0, shafts, withSparks, 'add', { opacity: 0.45 });
    b.add('export.color', 'Export Flipbook', 8, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: final });
    b.mark('main', final);

    // 3D: swept 4-blade bolt + two branch bolts, looping 3D noise jitter, gradient vertex colour
    const taper = curve([0, 0.3], [0.1, 1], [0.8, 0.8], [1, 0.05]);
    const bolt = b.add('geometry.sweep', 'Bolt Sweep', 0, 4, { spline: boltSpline([0, 0, 2.2], [0, 0, 0], 14, 0.28, 5), profile: 'star', star_points: 4, star_inner: 0.04, width: 0.2, height: 0.2, segments: 96, scale_curve: taper, use_gradient: false });
    b.anim(bolt, 'width', [[0, 0], [4, 0.26], [8, 0.2], [30, 0.16], [46, 0]]);
    b.anim(bolt, 'height', [[0, 0], [4, 0.26], [8, 0.2], [30, 0.16], [46, 0]]);
    const br1 = b.add('geometry.sweep', 'Branch A', 0, 5, { spline: boltSpline([0.05, 0, 1.5], [0.8, 0.2, 0.7], 8, 0.12, 9), profile: 'star', star_points: 4, star_inner: 0.04, width: 0.1, height: 0.1, segments: 48, scale_curve: curve([0, 1], [1, 0.05]), use_gradient: false });
    const br2 = b.add('geometry.sweep', 'Branch B', 0, 6, { spline: boltSpline([-0.04, 0, 1.0], [-0.7, -0.2, 0.35], 7, 0.1, 17), profile: 'star', star_points: 4, star_inner: 0.04, width: 0.08, height: 0.08, segments: 48, scale_curve: curve([0, 1], [1, 0.05]), use_gradient: false });
    const merged = b.add('geometry.merge', 'Merge Bolt Meshes', 1, 5, {}, { in1: bolt, in2: br1, in3: br2 });
    const jit = b.add('geometry.noise', 'Bolt Jitter', 2, 5, { mode: 'vector', amplitude: 0.05, frequency: 4, octaves: 2, animate: true, loop: true, loop_cycles: 3, speed: 1, seed: 6 }, { input: merged });
    const col = b.add('geometry.combine_color', 'Bolt Colour', 3, 5, { source: 'gradient_axis', origin: [0, 0, 0], direction: [0, 0, 1], length: 2.3, gradient: grad([[0, [0.25, 0.5, 1, 1]], [0.6, [0.7, 0.9, 1, 1]], [1, [1, 1, 1, 1]]]) }, { input: jit });
    const mesh = b.add('export.mesh', 'Export Mesh', 4, 5, {}, { input: col });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.0005, maxMean: 0.6, frames: [3, 12, 24] }],
};

export const shockwaveRing: SampleDef = {
  id: 'shockwave_ring',
  name: 'Shockwave Ring',
  description:
    'Expanding ring: size, thickness and intensity are keyed with ease-out, noise breakup evolves, a flash disc fades — and a radial UV warp map (radius / strength keyed) drives a live refraction preview over a grid. Mesh: expanding ring (radius keyed) with ripple warp, looping wobble and fading vertex alpha, plus a crater-dust cone.',
  kind: 'sample',
  tags: ['shockwave', 'ring', 'warp', 'animated', 'mesh'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 48, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'unlit' },
  build(b) {
    const ring = b.add('grayscale.shape', 'Ring', 0, 0, { shape: 'ring', size: [0.2, 0.2], thickness: 0.3, softness: 0.45 });
    b.anim(ring, 'size', [[0, [0.12, 0.12]], [10, [0.55, 0.55]], [30, [0.88, 0.88]], [44, [0.98, 0.98]]]);
    b.anim(ring, 'thickness', [[0, 0.4], [14, 0.16], [44, 0.04]]);
    b.anim(ring, 'intensity', [[0, 1.2], [26, 1], [46, 0]]);
    const noise = b.add('grayscale.noise', 'Breakup', 0, 1, { noise_type: 'perlin', scale: [7, 7], octaves: 4, seed: 9, contrast: 1.3 });
    b.loopEvolution(noise, 'evolution', 48);
    const mul = b.blend('Ring x Breakup', 1, 0, noise, ring, 'multiply', { cross_mix: 0.75 });
    const lv = b.add('utils.levels', 'Levels', 2, 0, { in_low: 0.04, in_high: 0.6 }, { input: mul });
    const flash = b.add('grayscale.shape', 'Flash Disc', 1, 2, { shape: 'circle', size: [0.1, 0.1], softness: 1 });
    b.anim(flash, 'size', [[0, [0.1, 0.1]], [8, [0.5, 0.5]], [20, [0.7, 0.7]]]);
    b.anim(flash, 'intensity', [[0, 1.4], [18, 0]]);
    const sum = b.blend('Ring + Flash', 3, 0, flash, lv, 'add');
    const ramp = b.ramp('Shock Ramp', 4, 0, sum, grad([[0, [0, 0, 0, 1]], [0.45, [0.8, 0.45, 0.15, 1]], [1, [1, 0.95, 0.8, 1]]]));
    const glow = b.add('utils.glow_color', 'Glow', 5, 0, { radius: 0.05, intensity: 0.9 }, { input: ramp });
    const streak = b.add('utils.radial_blur_color', 'Outward Streaks', 6, 0, { mode: 'zoom', amount: -0.12, falloff: 'trail', samples: 24 }, { input: glow });
    const final = b.blendC('Add Streaks', 7, 0, streak, glow, 'add', { opacity: 0.5 });
    b.add('export.color', 'Export Flipbook', 8, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: final });
    b.add('export.mask', 'Export Mask', 5, 1, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: sum });
    b.mark('main', final);

    // distortion field + live refraction preview (grid pushed by the warp)
    const warp = b.add('uv.radial', 'Shock Warp', 0, 4, { falloff: 'gaussian', inner: 0.55, strength: 0.18, radius: 0.1 });
    b.anim(warp, 'radius', [[0, 0.1], [10, 0.28], [30, 0.44], [44, 0.5]]);
    b.anim(warp, 'strength', [[0, 0.3], [20, 0.2], [46, 0]]);
    const grid = b.add('utils.grid', 'Test Grid', 0, 5, { pattern: 'square', cells: [12, 12], line_width: 0.12, softness: 0.2 });
    const gridC = b.ramp('Grid Colour', 1, 5, grid, grad([[0, [0.04, 0.05, 0.08, 1]], [1, [0.7, 0.85, 1, 1]]]));
    const refr = b.add('utils.transform_color', 'Refraction Preview', 2, 4, { edge: 'clamp' }, { input: gridC, uv: warp });
    b.add('export.warp', 'Export Warp', 1, 4, { codec: 'biased', range: 0.2 }, { input: warp });
    b.mark('refraction', refr);

    // 3D: expanding ring + ripple + wobble + fading alpha; plus a dust cone
    const rmesh = b.add('geometry.shapes', 'Ring Mesh', 4, 4, { shape: 'ring', radius: 0.4, inner_radius: 0.2, segments: 96, rings: 8, uv_mode: 'polar' });
    b.anim(rmesh, 'radius', [[0, 0.3], [10, 1.2], [30, 2.4], [44, 3]]);
    b.anim(rmesh, 'inner_radius', [[0, 0.12], [10, 0.85], [30, 2.2], [44, 2.9]]);
    const col = b.add('geometry.combine_color', 'Ring Gradient', 5, 4, { source: 'gradient_radial', gradient: grad([[0, [1, 0.3, 0.05, 0]], [0.6, [1, 0.55, 0.15, 0.3]], [0.9, [1, 0.9, 0.6, 1]], [1, [1, 1, 1, 0]]]) }, { input: `${rmesh}.mesh` });
    const rip = b.add('geometry.space_warp', 'Ripple', 6, 4, { mode: 'ripple', axis: 'z', amount: 0.08, frequency: 6, decay: 0.2 }, { input: col });
    b.ramp01(rip, 'phase', 0, 6.2831853, 48);
    const wob = b.add('geometry.noise', 'Wobble', 7, 4, { mode: 'axis', axis: [0, 0, 1], amplitude: 0.05, frequency: 3, animate: true, loop: true, seed: 3 }, { input: rip });
    const dust = b.add('geometry.shapes', 'Dust Cone', 4, 5, { shape: 'cone', radius: 0.6, size: [1, 1, 0.8], segments: 32, taper: 0.4 });
    b.anim(dust, 'radius', [[0, 0.1], [14, 0.9], [44, 1.6]]);
    const dustCol = b.add('geometry.combine_color', 'Dust Colour', 5, 5, { source: 'gradient_axis', origin: [0, 0, 0], direction: [0, 0, 1], length: 0.8, gradient: grad([[0, [0.6, 0.45, 0.3, 0.5]], [1, [0.4, 0.3, 0.2, 0]]]) }, { input: `${dust}.mesh` });
    const all = b.add('geometry.merge', 'Merge', 8, 4, {}, { in1: wob, in2: dustCol });
    const mesh = b.add('export.mesh', 'Export Mesh', 9, 4, {}, { input: all });
    b.mark('mesh', mesh);
  },
  probes: [
    { mark: 'main', minMean: 0.001, maxMean: 0.9, frames: [6, 18, 32] },
    { mark: 'refraction', minMean: 0.01, maxMean: 0.95, frames: [12] },
  ],
};
