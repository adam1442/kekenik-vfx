import { FIRE, SMOKE, grad, type SampleDef } from './kit';

/** Samples C: Hit Impact (decal + crater mesh), Stylized Smoke Flipbook, Tiling Lava (+ normal + surface mesh), Glow / Flare / Sprite Pack. */

export const hitImpact: SampleDef = {
  id: 'hit_impact_decal',
  name: 'Hit Impact Decal + Crater',
  description:
    'A one-shot ground impact on a 36-frame loop: jagged star burst and a shock ring expand with ease-out, cracks grow outward, radial sparks fly (Polar Scatter radius keyed), everything fades to black. Mesh: crater whose depth bounces, noisy rim, lava-lit vertex colour and tumbling debris cubes copied onto random points.',
  kind: 'sample',
  tags: ['impact', 'decal', 'cracks', 'animated', 'mesh', 'crater'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 36, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const burst = b.add('grayscale.shape', 'Burst', 0, 0, { shape: 'star', sides: 10, pinch: 0.55, size: [0.2, 0.2], softness: 0.12 });
    b.anim(burst, 'size', [[0, [0.12, 0.12]], [4, [0.62, 0.62]], [10, [0.82, 0.82]], [30, [0.9, 0.9]]]);
    b.anim(burst, 'intensity', [[0, 1.3], [8, 1], [30, 0]]);
    b.anim(burst, 'rotation', [[0, 0], [30, 14]], { interp: 'linear' });
    const jag = b.add('uv.noise', 'Jag Warp', 0, 1, { mode: 'vector', scale: [8, 8], strength: 0.035, seed: 21 });
    b.anim(jag, 'evolution', [[0, 0], [36, 1.5]], { interp: 'linear' });
    const jagged = b.add('utils.transform', 'Jag Apply', 1, 0, { edge: 'clamp' }, { input: burst, uv: jag });
    const cracks = b.add('grayscale.noise', 'Cracks', 0, 2, { noise_type: 'cracks', scale: [4, 4], edge_width: 0.06, seed: 5 });
    const grow = b.add('grayscale.shape', 'Crack Growth', 0, 3, { shape: 'circle', size: [0.2, 0.2], softness: 0.2 });
    b.anim(grow, 'size', [[0, [0.1, 0.1]], [14, [0.95, 0.95]], [36, [1, 1]]]);
    const crackM = b.blend('Cracks x Growth', 1, 2, cracks, grow, 'multiply');
    const crackLv = b.add('utils.levels', 'Crack Fade', 2, 2, { in_low: 0, in_high: 1 }, { input: crackM });
    b.anim(crackLv, 'out_high', [[0, 1], [18, 0.9], [34, 0]]);
    const sparks = b.add('grayscale.polar_scatter', 'Radial Sparks', 0, 4, { ring_count: 3, count: 26, radius_min: 0.1, radius_max: 0.14, shape: 'polygon', sides: 4, size: 0.018, stretch: 5, align_radial: true, size_rand: 0.5, radius_jitter: 0.2, seed: 8 });
    b.anim(sparks, 'radius_min', [[0, 0.08], [20, 0.32]]);
    b.anim(sparks, 'radius_max', [[0, 0.1], [20, 0.46]]);
    b.anim(sparks, 'intensity', [[0, 0], [2, 1.2], [14, 1], [32, 0]]);
    const shock = b.add('grayscale.shape', 'Shock Ring', 1, 4, { shape: 'ring', size: [0.2, 0.2], thickness: 0.05, softness: 0.4 });
    b.anim(shock, 'size', [[0, [0.15, 0.15]], [20, [0.95, 0.95]]]);
    b.anim(shock, 'intensity', [[0, 1], [22, 0.5], [30, 0]]);
    const m1 = b.blend('Burst + Cracks', 3, 0, crackLv, jagged, 'max');
    const m2 = b.blend('+ Sparks', 4, 0, sparks, m1, 'max');
    const m3 = b.blend('+ Shock Ring', 5, 0, shock, m2, 'add');
    const thr = b.add('grayscale.threshold', 'Threshold', 6, 0, { type: 'soft', threshold: 0.3, smoothness: 0.25 }, { input: m3 });
    const ramp = b.ramp('Hot Ramp', 7, 0, thr, FIRE);
    const glow = b.add('utils.glow_color', 'Glow', 8, 0, { radius: 0.05, intensity: 1 }, { input: ramp });
    const trails = b.add('utils.radial_blur_color', 'Outward Trails', 9, 0, { mode: 'zoom', amount: -0.08, falloff: 'trail', samples: 20 }, { input: glow });
    const final = b.blendC('Add Trails', 10, 0, trails, glow, 'add', { opacity: 0.5 });
    b.add('export.color', 'Export Flipbook', 11, 0, { frame_mode: 'flipbook', frame_count: 12, fb_cols: 4, fb_rows: 3 }, { input: final });
    b.add('export.mask', 'Export Mask', 7, 1, {}, { input: thr });
    b.mark('main', final);

    // 3D: crater + debris
    const crater = b.add('geometry.shapes', 'Crater', 0, 6, { shape: 'crater', radius: 1.3, depth: 0.05, rim: 0.05, segments: 72, rings: 28 });
    b.anim(crater, 'depth', [[0, 0.02], [6, 0.38], [12, 0.28], [36, 0.3]]);
    b.anim(crater, 'rim', [[0, 0.02], [6, 0.14], [36, 0.1]]);
    const rough = b.add('geometry.noise', 'Rocky Rim', 1, 6, { mode: 'normal', amplitude: 0.045, frequency: 5, octaves: 3, seed: 6 }, { input: `${crater}.mesh` });
    const heat = b.add('geometry.combine_color', 'Lava Glow', 2, 6, { source: 'gradient_radial', gradient: grad([[0, [1, 0.5, 0.1, 1]], [0.35, [0.9, 0.2, 0.03, 1]], [0.75, [0.18, 0.1, 0.07, 1]], [1, [0.08, 0.06, 0.05, 1]]]) }, { input: rough });
    const pts = b.add('geometry.points_shape', 'Debris Points', 0, 7, { mode: 'random', count: 22, size: [2.2, 2.2, 0], seed: 4 });
    const scaled = b.add('geometry.combine_scale_points', 'Random Sizes', 1, 7, { source: 'random', min: 0.5, max: 1.6, seed: 3 }, { input: `${pts}.points` });
    const rock = b.add('geometry.shapes', 'Rock', 0, 8, { shape: 'cube', size: [0.12, 0.1, 0.09] });
    const debris = b.add('geometry.copy_to_points', 'Copy Debris', 2, 7, {}, { mesh: `${rock}.mesh`, points: `${scaled}.output` });
    const dCol = b.add('geometry.combine_color', 'Debris Colour', 3, 7, { source: 'uniform', color: [0.22, 0.15, 0.1, 1] }, { input: `${debris}.mesh` });
    const fly = b.add('geometry.transform', 'Debris Flight', 4, 7, {}, { input: dCol });
    b.anim(fly, 'translate', [[0, [0, 0, 0]], [10, [0, 0, 1.25]], [26, [0, 0, 0.02]]]);
    b.anim(fly, 'rotate', [[0, [0, 0, 0]], [26, [120, 200, 90]]], { interp: 'linear' });
    b.anim(fly, 'uniform', [[0, 0.01], [2, 1], [34, 1]]);
    const all = b.add('geometry.merge', 'Merge', 5, 6, {}, { in1: heat, in2: fly });
    const mesh = b.add('export.mesh', 'Export Mesh', 6, 6, {}, { input: all });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.0005, maxMean: 0.9, frames: [3, 10, 20] }],
};

export const smokeFlipbook: SampleDef = {
  id: 'smoke_flipbook',
  name: 'Stylized Smoke Flipbook (loop)',
  description:
    'A smoke puff that is born, rises, billows and dissipates in exactly 64 frames (start = end = empty, so the flipbook loops): three looping noise layers (evolution 0 → 1), curl warp, growth of the puff mask, a rising dissolve threshold and a keyed alpha. Sheet Encode bakes 16 frames; export as 4×4 flipbook.',
  kind: 'sample',
  tags: ['smoke', 'flipbook', 'loop', 'animated'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 64, fps: 30 },
  preview: 'main',
  build(b) {
    const L = 64;
    const warp = b.add('uv.noise', 'Curl Warp', 0, 1, { mode: 'curl', scale: [2, 2], strength: 0.1, seed: 6 });
    b.loopEvolution(warp, 'evolution', L);
    b.anim(warp, 'strength', [[0, 0.04], [40, 0.14], [64, 0.04]], { pre: 'cycle', post: 'cycle' });
    const base = b.add('grayscale.noise', 'Base Puffs', 0, 0, { noise_type: 'perlin', scale: [3, 3], octaves: 5, roughness: 0.55, seed: 2 }, { uv: warp });
    b.loopEvolution(base, 'evolution', L);
    const detail = b.add('grayscale.noise', 'Billow Detail', 1, 1, { noise_type: 'billow', scale: [5, 5], octaves: 4, seed: 4 }, { uv: warp });
    b.loopEvolution(detail, 'evolution', L);
    const mix0 = b.blend('Puffs x Detail', 2, 0, detail, base, 'multiply');
    const wisp = b.add('grayscale.noise', 'Wisps', 1, 2, { noise_type: 'ridged', scale: [6, 6], octaves: 3, seed: 15 }, { uv: warp });
    b.loopEvolution(wisp, 'evolution', L);
    const mix = b.blend('Add Wisps', 2, 1, wisp, mix0, 'add', { opacity: 0.25 });
    const mask = b.add('grayscale.shape', 'Puff Mask', 2, 2, { shape: 'circle', size: [0.35, 0.35], softness: 0.9, position: [0.5, 0.62] });
    b.anim(mask, 'size', [[0, [0.3, 0.3]], [30, [0.78, 0.78]], [64, [0.3, 0.3]]], { pre: 'cycle', post: 'cycle' });
    b.anim(mask, 'position', [[0, [0.5, 0.66]], [32, [0.5, 0.48]], [64, [0.5, 0.66]]], { pre: 'cycle', post: 'cycle' });
    const cut = b.blend('x Mask', 3, 0, mask, mix, 'multiply');
    const soft = b.add('utils.blur', 'Soften', 4, 1, { radius: 0.006 }, { input: cut });
    const lv = b.add('utils.levels', 'Dissolve Levels', 4, 0, { in_low: 0.15, in_high: 0.85 }, { input: soft });
    b.anim(lv, 'in_low', [[0, 0.2], [24, 0.12], [64, 0.5]]);
    b.anim(lv, 'in_high', [[0, 0.9], [64, 0.95]]);
    const ramp = b.ramp('Smoke Ramp', 5, 0, lv, SMOKE);
    const inner = b.add('utils.levels', 'Inner Core', 5, 1, { in_low: 0.55, in_high: 1 }, { input: lv });
    const rim = b.blend('Rim Mask', 6, 1, inner, lv, 'subtract');
    const rimC = b.ramp('Rim Light', 7, 1, rim, grad([[0, [0, 0, 0, 0]], [1, [1, 0.97, 0.9, 0.8]]]));
    const lit = b.blendC('Add Rim Light', 6, 0, rimC, ramp, 'add', { opacity: 0.6 });
    const fade = b.add('color.adjust', 'Fade In / Out', 7, 0, {}, { input: lit });
    b.anim(fade, 'value', [[0, 0], [10, 1], [44, 1], [63, 0]]);
    const sheet = b.add('utils.sheet_encode', 'Sheet Encode', 8, 0, { frames: 16, auto_grid: true }, { input: fade });
    b.add('export.color', 'Export Flipbook', 9, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: fade });
    b.mark('main', fade);
    b.mark('sheet', `${sheet}.sheet`);
  },
  probes: [{ mark: 'main', minMean: 0.0005, maxMean: 0.9, frames: [8, 24, 45] }],
};

export const lavaTile: SampleDef = {
  id: 'lava_tile',
  name: 'Tiling Lava / Energy + Normal + Surface Mesh',
  description:
    'Seamlessly tiling lava that flows by whole tiles per 96-frame loop: curl-warped glowing cracks, a pulsing emissive ramp, rock height → normal map. Mesh: a subdivided plane displaced by the live lava height (Space Warp displace-by-texture) with heat vertex colours.',
  kind: 'sample',
  tags: ['lava', 'tiling', 'normal', 'animated', 'mesh', 'texture'],
  settings: { width: 1024, height: 1024, tiling: 'both', loopLength: 96, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'opaque', doubleSided: true }, display: 'unlit' },
  build(b) {
    const L = 96;
    const warp = b.add('uv.noise', 'Curl Warp', 0, 0, { mode: 'curl', scale: [3, 3], strength: 0.08, seed: 14 });
    b.loopEvolution(warp, 'evolution', L);
    const cracks = b.add('grayscale.noise', 'Lava Cracks', 1, 0, { noise_type: 'cracks', scale: [4, 4], edge_width: 0.1, seed: 3 }, { uv: warp });
    b.ramp01(cracks, 'offset', [0, 0], [1, 0], L);
    const rocks = b.add('grayscale.noise', 'Rock Height', 1, 1, { noise_type: 'perlin', scale: [3, 3], octaves: 5, seed: 17 }, { uv: warp });
    b.ramp01(rocks, 'offset', [0, 0], [1, 0], L);
    const lv = b.add('utils.levels', 'Crack Levels', 2, 0, { in_low: 0.05, in_high: 0.6 }, { input: cracks });
    const blobs = b.add('grayscale.noise', 'Heat Blobs', 2, 2, { noise_type: 'perlin', scale: [2, 2], octaves: 3, seed: 29, contrast: 1.4 });
    b.loopEvolution(blobs, 'evolution', L);
    const heat = b.blend('Cracks + Blobs', 3, 0, blobs, lv, 'add', { opacity: 0.35 });
    const ramp = b.ramp('Lava Ramp', 4, 0, heat, grad([[0, [0.01, 0, 0, 1]], [0.35, [0.5, 0.02, 0, 1]], [0.7, [1, 0.35, 0.02, 1]], [1, [1, 0.9, 0.3, 1]]]));
    b.pulse(ramp, 'intensity', 0.85, 1.25, L / 2);
    b.add('export.color', 'Export Color', 5, 0, {}, { input: ramp });
    b.mark('main', ramp);
    const h = b.blend('Height', 3, 1, cracks, rocks, 'subtract');
    const nrm = b.add('normal.create', 'Normal', 4, 1, { strength: 1.5, height_scale: 0.05 }, { input: h });
    b.add('export.normal', 'Export Normal', 5, 1, {}, { input: nrm });
    b.mark('height', h);

    // 3D surface: displaced by the live height
    const plane = b.add('geometry.shapes', 'Lava Plane', 0, 4, { shape: 'grid', size: [3, 3, 1], cols: 96, rows: 96 });
    const disp = b.add('geometry.space_warp', 'Displace by Height', 1, 4, { mode: 'displace_texture', amount: 0.25, channel: 'luma', mid: 0.5 }, { input: `${plane}.mesh`, texture: h });
    const col = b.add('geometry.combine_color', 'Heat Colour', 2, 4, { source: 'texture', blend: 'copy' }, { input: disp, texture: ramp });
    const mesh = b.add('export.mesh', 'Export Mesh', 3, 4, {}, { input: col });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.02, maxMean: 0.95, frames: [0, 48] }],
};

export const flarePack: SampleDef = {
  id: 'glow_flare_pack',
  name: 'Glow / Flare / Sprite Pack',
  description:
    'A lens-flare sprite set with life: soft glow (pulsing), spinning 4-point star, rotating ray fan, expanding halo ring, anamorphic streak (breathing length) and ghost dots. The colour result animates over a 60-frame loop; the four masks are channel-packed (R glow, G ring, B star + rays, A streak) for export.',
  kind: 'sample',
  tags: ['glow', 'flare', 'sprites', 'packed', 'animated'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 60, fps: 30 },
  preview: 'main',
  build(b) {
    const L = 60;
    const glow = b.add('grayscale.shape', 'Soft Glow', 0, 0, { shape: 'circle', size: [0.55, 0.55], softness: 1 });
    b.pulse(glow, 'size', [0.5, 0.5], [0.62, 0.62], L);
    const ring = b.add('grayscale.shape', 'Halo Ring', 0, 1, { shape: 'ring', size: [0.6, 0.6], thickness: 0.035, softness: 0.55 });
    b.pulse(ring, 'size', [0.52, 0.52], [0.78, 0.78], L);
    b.pulse(ring, 'intensity', 1, 0.45, L);
    const star = b.add('grayscale.shape', 'Star 4', 0, 2, { shape: 'star', sides: 4, pinch: 0.85, size: [0.8, 0.8], softness: 0.35 });
    b.ramp01(star, 'rotation', 0, 90, L);
    const star2 = b.add('grayscale.shape', 'Star 4 (diagonal)', 0, 3, { shape: 'star', sides: 4, pinch: 0.9, size: [0.5, 0.5], softness: 0.4, rotation: 45 });
    b.ramp01(star2, 'rotation', 45, -45, L);
    const rays = b.add('grayscale.polar_scatter', 'Ray Fan', 1, 3, { ring_count: 1, count: 24, radius_min: 0.18, radius_max: 0.18, shape: 'polygon', sides: 3, size: 0.045, stretch: 6, align_radial: true, size_rand: 0.8, seed: 5, softness: 0.4 });
    const raySpin = b.add('utils.transform', 'Spin Rays', 2, 3, { edge: 'transparent' }, { input: rays });
    b.ramp01(raySpin, 'rotation', 0, 360, L);
    const streakBase = b.add('grayscale.shape', 'Streak', 0, 4, { shape: 'ellipse', size: [1, 0.035], softness: 1 });
    b.pulse(streakBase, 'size', [0.8, 0.03], [1, 0.045], L);
    const streak = b.add('utils.directional_blur', 'Streak Smear', 1, 4, { angle: 0, length: 0.2, falloff: 'gaussian' }, { input: streakBase });
    const ghosts = b.add('grayscale.polar_scatter', 'Ghosts', 1, 5, { ring_count: 1, count: 5, radius_min: 0.12, radius_max: 0.42, shape: 'ring', size: 0.04, thickness: 0.35, softness: 0.5, spiral: 0, seed: 2, int_min: 0.4, int_max: 0.9 });
    const starsRays = b.fold('Stars + Rays', 3, 2, [star, star2, raySpin], 'max');
    const lensGray = b.fold('Flare Merge', 5, 1, [glow, ring, starsRays, streak, ghosts], 'max');
    const ramp = b.ramp('Flare Ramp', 8, 1, lensGray, grad([[0, [0, 0, 0, 1]], [0.4, [0.35, 0.15, 0.75, 1]], [0.75, [0.9, 0.7, 1, 1]], [1, [1, 1, 1, 1]]]));
    const out = b.add('utils.glow_color', 'Glow', 9, 1, { radius: 0.05, intensity: 0.8 }, { input: ramp });
    b.add('export.color', 'Export Flare', 10, 1, {}, { input: out });
    b.mark('main', out);
    const pack = b.add('utils.rgba_merge', 'Channel Pack', 4, 5, {}, { r: glow, g: ring, b: starsRays, a: streak });
    b.add('export.multimask', 'Export Multimask', 5, 5, { r_source: 'r', g_source: 'g', b_source: 'b', a_source: 'a' }, { r: pack, g: pack, b: pack, a: pack });
    b.mark('pack', pack);
  },
  probes: [
    { mark: 'main', minMean: 0.01, maxMean: 0.9, frames: [0, 30] },
    { mark: 'pack', minMean: 0.01, maxMean: 0.95 },
  ],
};
