import { curve, grad, spt, type SampleDef } from './kit';

/** Samples D (mesh / geometry showcases): Tornado Vortex, Plasma Orb (+ VAT export). */

export const tornadoVortex: SampleDef = {
  id: 'tornado_vortex',
  name: 'Tornado Vortex (mesh + scrolling dust)',
  description:
    'A swept funnel mesh (Sweep along Z with a scale curve), swaying with a travelling wave, jittered by looping 3D noise, orbiting debris cubes copied onto circle points and a vertex-colour fade. The material is a horizontally tiling dust-streak texture that scrolls exactly one tile per loop (wraps around the funnel).',
  kind: 'sample',
  tags: ['tornado', 'vortex', 'mesh', 'sweep', 'animated', 'tiling'],
  settings: { width: 512, height: 512, tiling: 'x', loopLength: 64, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'alpha', doubleSided: true, depthWrite: false }, display: 'unlit' },
  build(b) {
    const L = 64;
    const dust = b.add('grayscale.noise', 'Dust Streaks', 0, 0, { noise_type: 'perlin', scale: [3, 12], octaves: 5, roughness: 0.6, contrast: 1.5, seed: 3, anisotropy: 0.2 });
    b.ramp01(dust, 'offset', [0, 0], [1, 0], L); // wraps once around the funnel per loop
    b.loopEvolution(dust, 'evolution', L);
    const puffs = b.add('grayscale.noise', 'Puffs', 0, 1, { noise_type: 'billow', scale: [4, 6], octaves: 4, seed: 9 });
    b.ramp01(puffs, 'offset', [0, 0], [-1, 0], L);
    const mix = b.blend('Streaks x Puffs', 1, 0, puffs, dust, 'multiply', { cross_mix: 0.6 });
    const fade = b.add('grayscale.gradient', 'Height Fade', 1, 1, { gtype: 'reflected', start: [0.5, 1], end: [0.5, 0.5], curve: curve([0, 0], [0.4, 0.9], [1, 1]) });
    const body = b.blend('x Height Fade', 2, 0, fade, mix, 'multiply');
    const lv = b.add('utils.levels', 'Levels', 3, 0, { in_low: 0.12, in_high: 0.8 }, { input: body });
    const ramp = b.ramp('Dust Ramp', 4, 0, lv, grad([[0, [0.12, 0.1, 0.09, 0]], [0.45, [0.32, 0.27, 0.22, 0.65]], [1, [0.82, 0.76, 0.68, 1]]]));
    b.add('export.color', 'Export Color', 5, 0, {}, { input: ramp });
    b.mark('main', ramp);

    // 3D funnel: vertical sweep with a wide-top scale curve
    const path = { closed: false, points: [spt(0, 0, 0), spt(0.1, 0, 1.3), spt(-0.05, 0.1, 2.6), spt(0, 0, 4)] };
    const funnel = b.add('geometry.sweep', 'Funnel', 0, 3, {
      spline: path,
      profile: 'circle',
      profile_res: 40,
      width: 2,
      height: 2,
      segments: 64,
      cap_start: false,
      cap_end: false,
      twist_amount: 360,
      v_tiling: 2,
      v_by_length: true,
      use_gradient: false,
      scale_curve: curve([0, 0.1], [0.3, 0.2], [0.65, 0.5], [1, 1]),
    });
    b.ramp01(funnel, 'rotation', 0, 360, L);
    const sway = b.add('geometry.space_warp', 'Sway Wave', 1, 3, { mode: 'wave', axis: 'z', amount: 0.14, frequency: 1.2, length: 4, decay: 0 }, { input: funnel });
    b.ramp01(sway, 'phase', 0, 6.2831853, L);
    const turb = b.add('geometry.noise', 'Turbulence', 2, 3, { mode: 'vector', amplitude: 0.05, frequency: 3, octaves: 3, animate: true, loop: true, loop_cycles: 2, seed: 4 }, { input: sway });
    const col = b.add('geometry.combine_color', 'Dust Colour', 3, 3, { source: 'gradient_axis', origin: [0, 0, 0], direction: [0, 0, 1], length: 4, gradient: grad([[0, [0.2, 0.17, 0.14, 0.2]], [0.25, [0.45, 0.38, 0.3, 0.85]], [1, [0.7, 0.65, 0.58, 0.1]]]) }, { input: turb });

    // orbiting debris: random heights via per-point scale, rotating as a group
    const pts = b.add('geometry.points_shape', 'Debris Ring', 0, 5, { mode: 'circle', count: 28, radius: 1.3, align: false, random_orient: true, seed: 2 });
    const sz = b.add('geometry.combine_scale_points', 'Random Sizes', 1, 5, { source: 'random', min: 0.4, max: 1.6, seed: 7 }, { input: `${pts}.points` });
    const lift = b.add('geometry.combine_transform_points', 'Height by Index', 2, 5, { driver: 'random', translate: [0, 0, 2.4], seed: 3 }, { input: sz });
    const rock = b.add('geometry.shapes', 'Rock', 0, 6, { shape: 'cube', size: [0.14, 0.1, 0.08] });
    const copy = b.add('geometry.copy_to_points', 'Copy Debris', 3, 5, {}, { mesh: `${rock}.mesh`, points: lift });
    const rockCol = b.add('geometry.combine_color', 'Rock Colour', 4, 5, { source: 'uniform', color: [0.3, 0.24, 0.18, 1] }, { input: `${copy}.mesh` });
    const orbit = b.add('geometry.transform', 'Orbit', 5, 5, {}, { input: rockCol });
    b.ramp01(orbit, 'rotate', [0, 0, 0], [0, 0, 360], L);
    const all = b.add('geometry.merge', 'Merge', 6, 4, {}, { in1: col, in2: orbit });
    const mesh = b.add('export.mesh', 'Export Mesh', 7, 4, {}, { input: all });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.0005, maxMean: 0.9, frames: [0, 32] }],
};

export const plasmaOrb: SampleDef = {
  id: 'plasma_orb',
  name: 'Plasma Orb (geometry + Accumulate + VAT)',
  description:
    'Pure geometry showcase: a noise-boiled core sphere (also exported as a soft-body VAT), a plasma shell coloured by animated 3D noise, three tilted orbit rings turning at different speeds and a comet whose trail is built with Accumulate. The material texture is a looping worley plasma ramp.',
  kind: 'sample',
  tags: ['plasma', 'orb', 'mesh', 'accumulate', 'vat', 'animated'],
  settings: { width: 512, height: 512, tiling: 'both', loopLength: 64, fps: 30 },
  preview: 'main',
  view: { mesh: 'mesh', material: 'main', mat: { blend: 'additive', doubleSided: true }, display: 'vertex_color' },
  build(b) {
    const L = 64;
    const warp = b.add('uv.noise', 'Plasma Warp', 0, 0, { mode: 'curl', scale: [2, 2], strength: 0.09, seed: 5 });
    b.loopEvolution(warp, 'evolution', L);
    const cells = b.add('grayscale.noise', 'Plasma Cells', 1, 0, { noise_type: 'worley_f2f1', scale: [4, 4], seed: 12, contrast: 1.2 }, { uv: warp });
    b.loopEvolution(cells, 'evolution', L);
    const lv = b.add('utils.levels', 'Levels', 2, 0, { in_low: 0.0, in_high: 0.65 }, { input: cells });
    const ramp = b.ramp('Plasma Ramp', 3, 0, lv, grad([[0, [0.02, 0, 0.08, 1]], [0.4, [0.35, 0.05, 0.85, 1]], [0.75, [0.2, 0.85, 1, 1]], [1, [1, 1, 1, 1]]]));
    b.pulse(ramp, 'intensity', 0.9, 1.3, L / 2);
    b.add('export.color', 'Export Plasma', 4, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 }, { input: ramp });
    b.mark('main', ramp);

    const core = b.add('geometry.shapes', 'Core', 0, 2, { shape: 'sphere', radius: 0.6, segments: 40, rings: 20 });
    const boil = b.add('geometry.noise', 'Core Boil', 1, 2, { mode: 'normal', amplitude: 0.1, frequency: 2.4, octaves: 3, animate: true, loop: true, loop_cycles: 1, seed: 3 }, { input: `${core}.mesh` });
    const coreCol = b.add('geometry.combine_color', 'Core Colour', 2, 2, { source: 'gradient_axis', origin: [0, 0, -0.7], direction: [0, 0, 1], length: 1.4, gradient: grad([[0, [0.5, 0.1, 1, 1]], [1, [1, 0.95, 1, 1]]]) }, { input: boil });
    // soft-body VAT of the boiling core (topology is constant)
    b.add('export.mesh', 'Export Core VAT (soft)', 3, 2, { mode: 'vat_soft', frame_count: 32 }, { input: coreCol });

    const shell = b.add('geometry.shapes', 'Shell', 0, 3, { shape: 'sphere', radius: 0.9, segments: 48, rings: 24 });
    const shellN = b.add('geometry.noise', 'Shell Ripple', 1, 3, { mode: 'normal', amplitude: 0.05, frequency: 3, octaves: 2, animate: true, loop: true, loop_cycles: 2, seed: 8 }, { input: `${shell}.mesh` });
    const shellCol = b.add('geometry.combine_color', 'Shell Plasma', 2, 3, { source: 'noise', n_frequency: 2.5, n_octaves: 3, n_seed: 4, gradient: grad([[0, [0.2, 0.05, 0.6, 0.15]], [0.5, [0.3, 0.6, 1, 0.5]], [1, [0.9, 1, 1, 0.9]]]) }, { input: shellN });

    const ring = b.add('geometry.shapes', 'Orbit Ring', 0, 4, { shape: 'ring', radius: 1.35, inner_radius: 1.3, segments: 96, uv_mode: 'polar' });
    const ringCol = b.add('geometry.combine_color', 'Ring Colour', 1, 4, { source: 'gradient_radial', gradient: grad([[0, [0.3, 0.8, 1, 0.9]], [1, [0.8, 0.4, 1, 0.9]]]) }, { input: `${ring}.mesh` });
    const tilts: [number, number, number][] = [[62, 0, 0], [0, 62, 0], [40, 40, 0]];
    const turns = [1, -2, 3];
    const rings = tilts.map((t, i) => {
      const tr = b.add('geometry.transform', `Ring ${i + 1}`, 2, 4 + i, { rotate: t }, { input: ringCol });
      b.ramp01(tr, 'rotate', t, [t[0], t[1], t[2] + 360 * turns[i]], L);
      return tr;
    });

    const comet = b.add('geometry.shapes', 'Comet', 0, 7, { shape: 'sphere', radius: 0.1, segments: 16, rings: 8 });
    const cometOff = b.add('geometry.transform', 'Comet Offset', 1, 7, { translate: [1.35, 0, 0] }, { input: `${comet}.mesh` });
    const cometOrbit = b.add('geometry.transform', 'Comet Orbit', 2, 7, { rotate: [0, 0, 0] }, { input: cometOff });
    b.ramp01(cometOrbit, 'rotate', [20, 0, 0], [20, 0, 720], L);
    const trail = b.add('geometry.accumulate', 'Comet Trail', 3, 7, { max_count: 16, step_time: 0.03, decay: 0.2, scale_per_step: 0.9 }, { input: cometOrbit });
    const trailCol = b.add('geometry.combine_color', 'Trail Colour', 4, 7, { source: 'uniform', color: [0.6, 0.95, 1, 1] }, { input: trail });

    const all = b.add('geometry.merge', 'Merge A', 4, 3, {}, { in1: coreCol, in2: shellCol, in3: rings[0], in4: rings[1], in5: rings[2], in6: trailCol });
    const mesh = b.add('export.mesh', 'Export Mesh', 5, 3, {}, { input: all });
    b.mark('mesh', mesh);
  },
  probes: [{ mark: 'main', minMean: 0.01, maxMean: 0.95, frames: [0, 32] }],
};
