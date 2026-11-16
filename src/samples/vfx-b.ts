import { CYAN, VIOLET, curve, grad, spt, type SampleDef } from './kit';

/** Samples B: Sword Swipe, Energy Beam, Magic Circle (animated textures + animated meshes). */

export const swordSwipe: SampleDef = {
  id: 'sword_swipe',
  name: 'Sword Swipe',
  description:
    'A slash that rotates through the frame: crescent silhouette (rotation + intensity keyed), bright leading arc, panning streak noise, spin-blur trail, cyan ramp and glow. Mesh: arc strip whose sweep angle grows (keyed), rotated by a keyed Transform with a gradient window that slides over the vertex alpha.',
  kind: 'sample',
  tags: ['swipe', 'slash', 'arc', 'animated', 'mesh'],
  settings: { width: 512, height: 512, tiling: 'none', loopLength: 40, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'unlit' },
  build(b) {
    const rot: [number, number][] = [[0, -85], [10, -30], [30, 55]];
    const cres = b.add('grayscale.shape', 'Crescent', 0, 0, { shape: 'crescent', size: [0.92, 0.92], softness: 0.35 });
    b.anim(cres, 'rotation', rot);
    b.anim(cres, 'intensity', [[0, 0], [5, 1], [22, 1], [38, 0]]);
    const edge = b.add('grayscale.shape', 'Leading Arc', 0, 1, { shape: 'arc', size: [0.84, 0.84], thickness: 0.07, aperture: 110, softness: 0.4 });
    b.anim(edge, 'rotation', rot);
    b.anim(edge, 'intensity', [[0, 0], [5, 1.2], [20, 0.9], [36, 0]]);
    const streak = b.add('grayscale.noise', 'Streaks', 1, 1, { noise_type: 'perlin', scale: [3, 14], octaves: 4, contrast: 1.5, seed: 5, rotation: 28 });
    b.anim(streak, 'offset', [[0, [-0.4, 0]], [38, [0.6, 0]]], { interp: 'linear' });
    const cut = b.blend('Streaks x Crescent', 2, 0, streak, cres, 'multiply', { cross_mix: 0.55 });
    const sum = b.blend('+ Leading Arc', 3, 0, edge, cut, 'add');
    const trail = b.add('utils.radial_blur', 'Spin Trail', 4, 0, { mode: 'spin', angle: 38, falloff: 'trail', samples: 32 }, { input: sum });
    const lv = b.add('utils.levels', 'Levels', 5, 0, { in_low: 0.08, in_high: 0.8 }, { input: trail });
    const ramp = b.ramp('Cyan Ramp', 6, 0, lv, CYAN);
    const glow = b.add('utils.glow_color', 'Glow', 7, 0, { radius: 0.05, intensity: 1.1, tint: [0.4, 0.9, 1, 1] }, { input: ramp });
    b.add('export.color', 'Export Flipbook', 8, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: glow });
    b.add('export.mask', 'Export Mask', 7, 1, {}, { input: lv });
    b.mark('main', glow);
    b.mark('mask', lv);

    // 3D: growing arc strip, slashing rotation, sliding gradient window in the vertex alpha
    const arc = b.add('geometry.shapes', 'Arc Strip', 0, 3, { shape: 'arc_strip', radius: 1.4, inner_radius: 0.7, sweep: 40, segments: 64 });
    b.anim(arc, 'sweep', [[0, 30], [14, 120], [26, 165]]);
    b.anim(arc, 'inner_radius', [[0, 1.0], [14, 0.8], [26, 0.62]]);
    const tr = b.add('geometry.transform', 'Slash Rotation', 1, 3, {}, { input: `${arc}.mesh` });
    b.anim(tr, 'rotate', [[0, [0, 0, -70]], [26, [0, 0, 55]]]);
    const col = b.add('geometry.combine_color', 'Fade Window', 2, 3, { source: 'gradient_axis', direction: [1, 0, 0], length: 1.8, origin: [-1.6, 0, 0], gradient: grad([[0, [0.2, 0.8, 1, 0]], [0.5, [0.5, 0.95, 1, 0.9]], [1, [1, 1, 1, 1]]]) }, { input: tr });
    b.anim(col, 'origin', [[0, [-1.8, 0, 0]], [26, [-0.4, 0, 0]]]);
    const mesh = b.add('export.mesh', 'Export Mesh', 3, 3, {}, { input: col });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.0005, maxMean: 0.8, frames: [6, 14, 24] }],
};

export const energyBeam: SampleDef = {
  id: 'energy_beam',
  name: 'Energy Beam (Sweep)',
  description:
    'Seamless horizontal beam texture: pulsing rounded body, scrolling streak noise (one full tile per loop), counter-scrolling electric veins, hot core, glow. Mesh: swept ribbon beam with a scrolling UV (v offset keyed), a twisting 3-blade core, looping noise jitter and the streak texture baked into the vertex alpha every frame.',
  kind: 'sample',
  tags: ['beam', 'sweep', 'animated', 'mesh', 'tiling'],
  settings: { width: 512, height: 512, tiling: 'x', loopLength: 48, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true, scroll: [0, -0.6] }, display: 'unlit' },
  build(b) {
    const L = 48;
    const body = b.add('grayscale.shape', 'Beam Body', 0, 0, { shape: 'rounded_rect', size: [1, 0.3], softness: 0.65, rounding: 0.5 });
    b.pulse(body, 'size', [1, 0.28], [1, 0.36], L / 2);
    const streaks = b.add('grayscale.noise', 'Streaks', 0, 1, { noise_type: 'perlin', scale: [1, 9], octaves: 4, seed: 12, contrast: 1.3 });
    b.ramp01(streaks, 'offset', [0, 0], [1, 0], L); // exactly one tile per loop (tiling X) = seamless
    const blur = b.add('utils.directional_blur', 'Streak Blur', 1, 1, { angle: 0, length: 0.12 }, { input: streaks });
    const veins = b.add('grayscale.noise', 'Electric Veins', 1, 2, { noise_type: 'cracks', scale: [3, 2], edge_width: 0.09, seed: 4 });
    b.ramp01(veins, 'offset', [0, 0], [-2, 0], L);
    b.loopEvolution(veins, 'evolution', L);
    const bodyS = b.blend('Body x Streaks', 2, 0, blur, body, 'multiply', { cross_mix: 0.7 });
    const veinsM = b.blend('Veins x Body', 3, 1, veins, body, 'multiply');
    const withVeins = b.blend('Add Veins', 3, 0, veinsM, bodyS, 'add', { opacity: 0.8 });
    const hot = b.add('grayscale.shape', 'Hot Core', 2, 2, { shape: 'rounded_rect', size: [1, 0.07], softness: 0.5, rounding: 0.5 });
    b.pulse(hot, 'intensity', 0.8, 1.3, L / 4);
    const sum = b.blend('Add Core', 4, 0, hot, withVeins, 'add');
    const ramp = b.ramp('Beam Ramp', 5, 0, sum, grad([[0, [0, 0, 0, 1]], [0.35, [0.02, 0.2, 0.7, 1]], [0.7, [0.3, 0.8, 1, 1]], [1, [1, 1, 1, 1]]]));
    const glow = b.add('utils.glow_color', 'Glow', 6, 0, { radius: 0.05, intensity: 1.1 }, { input: ramp });
    b.add('export.color', 'Export Color', 7, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: glow });
    b.add('export.mask', 'Export Mask', 6, 1, {}, { input: sum });
    b.mark('main', glow);

    // 3D
    const path = {
      closed: false,
      points: [spt(-1.8, 0, 0.1), spt(-0.7, 0.2, 0.28), spt(0.7, -0.2, 0.28), spt(1.8, 0, 0.1)],
    };
    const ribbon = b.add('geometry.sweep', 'Beam Ribbon', 0, 4, { spline: path, profile: 'ribbon', width: 0.5, segments: 96, v_tiling: 3, use_gradient: false, scale_curve: curve([0, 0.05], [0.12, 1], [0.88, 1], [1, 0.05]) });
    b.ramp01(ribbon, 'v_offset', 0, -3, L);
    const core = b.add('geometry.sweep', 'Twisting Core', 0, 5, { spline: path, profile: 'star', star_points: 3, star_inner: 0.1, width: 0.2, height: 0.2, segments: 96, twist_amount: 540, use_gradient: false, scale_curve: curve([0, 0.05], [0.12, 1], [0.88, 1], [1, 0.05]) });
    b.ramp01(core, 'rotation', 0, 360, L);
    const merged = b.add('geometry.merge', 'Merge', 1, 4, {}, { in1: ribbon, in2: core });
    const jitter = b.add('geometry.noise', 'Jitter', 2, 4, { mode: 'vector', amplitude: 0.06, frequency: 3, animate: true, loop: true, loop_cycles: 2, seed: 5 }, { input: merged });
    const grd = b.add('geometry.combine_color', 'Length Gradient', 3, 4, { source: 'gradient_axis', origin: [-1.8, 0, 0], direction: [1, 0, 0], length: 3.6, write_a: false, gradient: grad([[0, [0.1, 0.5, 1, 1]], [0.5, [0.85, 1, 1, 1]], [1, [0.1, 0.5, 1, 1]]]) }, { input: jitter });
    const tint = b.add('geometry.combine_color', 'Streaks into Alpha', 4, 4, { source: 'texture', write_r: false, write_g: false, write_b: false, write_a: true, blend: 'multiply', gray_to_alpha: true }, { input: grd, texture: blur });
    const mesh = b.add('export.mesh', 'Export Mesh', 5, 4, {}, { input: tint });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.005, maxMean: 0.95, frames: [0, 17, 33] }],
};

export const magicCircle: SampleDef = {
  id: 'magic_circle',
  name: 'Magic Circle',
  description:
    'Counter-rotating ritual circle: outer rune ring, interlocked triangles, star ring and a hex grid, each layer spinning by whole turns per loop (seamless), pulsing violet glow. Mesh: rotating ring of pillar cones copied onto circle points, an emissive floor disc and a pulsing rune ring.',
  kind: 'sample',
  tags: ['magic', 'rotation', 'polar scatter', 'animated', 'mesh'],
  settings: { width: 1024, height: 1024, tiling: 'none', loopLength: 96, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'unlit' },
  build(b) {
    const L = 96;
    const spin = (name: string, col: number, row: number, src: string, turns: number): string => {
      const t = b.add('utils.transform', name, col, row, { edge: 'transparent' }, { input: src });
      b.ramp01(t, 'rotation', 0, 360 * turns, L);
      return t;
    };
    // static rings
    const r1 = b.add('grayscale.shape', 'Outer Ring', 0, 0, { shape: 'ring', size: [0.94, 0.94], thickness: 0.02, softness: 0.1 });
    const r2 = b.add('grayscale.shape', 'Rune Band Inner', 0, 1, { shape: 'ring', size: [0.74, 0.74], thickness: 0.014, softness: 0.1 });
    const r3 = b.add('grayscale.shape', 'Inner Ring', 0, 2, { shape: 'ring', size: [0.46, 0.46], thickness: 0.02, softness: 0.1 });
    // runes (spin +1), triangles (spin -1), stars (spin +2), grid (spin -1)
    const runes = b.add('grayscale.polar_scatter', 'Runes', 1, 0, { ring_count: 1, count: 24, radius_min: 0.4, radius_max: 0.4, shape: 'cross', size: 0.035, thickness: 0.28, align_radial: true });
    const dots = b.add('grayscale.polar_scatter', 'Rune Dots', 1, 1, { ring_count: 1, count: 48, radius_min: 0.395, radius_max: 0.395, shape: 'circle', size: 0.008 });
    const runeLayer = b.blend('Runes + Dots', 2, 0, dots, runes, 'max');
    const runeSpin = spin('Spin Runes', 3, 0, runeLayer, 1);
    const t1 = b.add('grayscale.shape', 'Triangle A', 1, 2, { shape: 'polygon', sides: 3, size: [0.66, 0.66], output_mode: 'outline', outline_width: 0.012 });
    const t2 = b.add('grayscale.shape', 'Triangle B', 1, 3, { shape: 'polygon', sides: 3, size: [0.66, 0.66], rotation: 180, output_mode: 'outline', outline_width: 0.012 });
    const tri = b.blend('Triangles', 2, 2, t2, t1, 'max');
    const triSpin = spin('Spin Triangles', 3, 2, tri, -1);
    const stars = b.add('grayscale.polar_scatter', 'Star Ring', 1, 4, { ring_count: 1, count: 12, radius_min: 0.3, radius_max: 0.3, shape: 'star', sides: 5, size: 0.05 });
    const starSpin = spin('Spin Stars', 2, 4, stars, 2);
    const grid = b.add('utils.grid', 'Hex Grid', 1, 5, { pattern: 'hex', cells: [6, 6], line_width: 0.04 });
    const disc = b.add('grayscale.shape', 'Grid Mask', 1, 6, { shape: 'circle', size: [0.5, 0.5], softness: 0.35 });
    const gridM = b.blend('Grid x Mask', 2, 5, grid, disc, 'multiply');
    const gridSpin = spin('Spin Grid', 3, 5, gridM, -1);
    const merged = b.fold('Merge', 4, 1, [r1, r2, r3, runeSpin, triSpin, starSpin, gridSpin], 'max');
    const ramp = b.ramp('Violet Ramp', 9, 1, merged, VIOLET);
    b.pulse(ramp, 'intensity', 0.9, 1.35, L / 2);
    const glow = b.add('utils.glow_color', 'Glow', 10, 1, { radius: 0.04, intensity: 1.2 }, { input: ramp });
    b.add('export.color', 'Export Color', 11, 1, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: glow });
    b.mark('main', glow);

    // 3D: spinning pillars on a ring + glowing floor + rune ring
    const pts = b.add('geometry.points_shape', 'Pillar Points', 0, 8, { mode: 'circle', count: 12, radius: 1.5, align: true });
    const pillar = b.add('geometry.shapes', 'Pillar', 0, 9, { shape: 'cone', radius: 0.09, size: [1, 1, 0.7], segments: 12, taper: 0.2 });
    b.pulse(pillar, 'size', [1, 1, 0.5], [1, 1, 0.95], L / 2);
    const copy = b.add('geometry.copy_to_points', 'Copy Pillars', 1, 8, {}, { mesh: `${pillar}.mesh`, points: `${pts}.points` });
    const copyCol = b.add('geometry.combine_color', 'Pillar Glow', 2, 8, { source: 'gradient_axis', origin: [0, 0, 0], direction: [0, 0, 1], length: 0.9, gradient: grad([[0, [0.3, 0.1, 0.9, 1]], [1, [0.8, 0.9, 1, 1]]]) }, { input: `${copy}.mesh` });
    const floor = b.add('geometry.shapes', 'Floor Disc', 0, 10, { shape: 'disc', radius: 1.75, segments: 64, uv_mode: 'planar' });
    const floorCol = b.add('geometry.combine_color', 'Floor Colour', 1, 10, { source: 'uniform', color: [0.6, 0.4, 1, 1] }, { input: `${floor}.mesh` });
    const ring = b.add('geometry.shapes', 'Rune Ring', 0, 11, { shape: 'ring', radius: 1.7, inner_radius: 1.45, segments: 96, uv_mode: 'polar' });
    const ringCol = b.add('geometry.combine_color', 'Ring Colour', 1, 11, { source: 'gradient_radial', gradient: grad([[0, [0.5, 0.2, 1, 0.1]], [0.7, [0.7, 0.5, 1, 0.8]], [1, [1, 1, 1, 0.1]]]) }, { input: `${ring}.mesh` });
    const rsc = b.add('geometry.transform', 'Ring Lift', 2, 11, { translate: [0, 0, 0.02] }, { input: ringCol });
    const all = b.add('geometry.merge', 'Merge', 3, 9, {}, { in1: copyCol, in2: floorCol, in3: rsc });
    const spinAll = b.add('geometry.transform', 'Spin Everything', 4, 9, {}, { input: all });
    b.ramp01(spinAll, 'rotate', [0, 0, 0], [0, 0, 360], L);
    const mesh = b.add('export.mesh', 'Export Mesh', 5, 9, {}, { input: spinAll });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.002, maxMean: 0.7, frames: [0, 40] }],
};
