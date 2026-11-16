import { CYAN_G, ELECTRIC_G, curve, grad, line3, spt, type SampleSpec } from './kit';

/** Samples 12-17: spline / sweep / mesh based. Custom Profiles are drawn with Spline Shape and connected to the Sweep Profile pin. */
const BOLT_VC = grad([[0, [0.4, 0.7, 1, 1]], [0.5, [1, 1, 1, 1]], [1, [0.4, 0.7, 1, 1]]]);
const BEAM_VC = grad([[0, [0.1, 0.5, 1, 0.2]], [0.2, [0.4, 0.9, 1, 1]], [0.5, [1, 1, 1, 1]], [0.8, [0.4, 0.9, 1, 1]], [1, [0.1, 0.5, 1, 0.2]]]);
const SLASH_VC = grad([[0, [1, 0.5, 0.1, 0]], [0.5, [1, 0.85, 0.5, 1]], [1, [1, 1, 1, 0.9]]]);
const SLASH_G = grad([[0, [0.3, 0.05, 0, 0]], [0.4, [1, 0.4, 0.05, 0.8]], [0.8, [1, 0.85, 0.5, 1]], [1, [1, 1, 1, 1]]]);
const SHOCK_G = grad([[0, [0.4, 0.1, 0, 0]], [0.4, [1, 0.45, 0.1, 0.8]], [0.8, [1, 0.9, 0.6, 1]], [1, [1, 1, 1, 1]]]);
const SHOCK_VC = grad([[0, [1, 0.8, 0.4, 0]], [0.5, [1, 0.7, 0.3, 1]], [1, [1, 0.4, 0.1, 0]]]);
const SHIELD_VC = grad([[0, [0.2, 0.6, 1, 0.1]], [0.5, [0.3, 0.8, 1, 0.4]], [1, [0.6, 1, 1, 1]]]);
const RUNE_G = grad([[0, [0.1, 0.03, 0, 0]], [0.4, [0.9, 0.4, 0.05, 0.8]], [0.8, [1, 0.8, 0.3, 1]], [1, [1, 1, 0.9, 1]]]);

const arcPath = (r: number, a0: number, a1: number, n: number) => ({
  closed: false,
  points: Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
    return spt(Math.cos(a) * r, Math.sin(a) * r, 0, 1, 0);
  }),
});

export const MESH_SAMPLES: SampleSpec[] = [
  /* ------------------------------------------------------------------------------------------ 12 */
  {
    id: 'lightning_strike',
    name: { en: 'Lightning Strike', fa: 'صاعقه' },
    description: { en: 'The Lightning node produces a mask and a Spline. The spline is drawn into a core + glow mask texture and swept into a 3D bolt mesh with a custom Profile. Flicker loops every 8 frames.', fa: 'گره صاعقه یک ماسک و یک اسپلاین می‌دهد. اسپلاین به ماسک هسته + درخشش رسم می‌شود و با یک پروفایل سفارشی به مش سه‌بعدی صاعقه سوئیپ می‌شود. سوسو هر ۸ فریم تکرار می‌شود.' },
    adapt: { en: 'Change Seed / Jaggedness / Branches on the Lightning node. Everything downstream follows, textures and mesh.', fa: 'Seed، ناهمواری و شاخه‌ها را در گره Lightning عوض کنید؛ همه چیز بعد از آن (تکسچر و مش) دنبال می‌کند.' },
    category: ['lightning', 'energy', 'meshes'], tags: ['lightning', 'spline', 'mesh', 'sweep', 'loop', 'flipbook'], difficulty: 'intermediate', loops: true,
    settings: { width: 512, height: 512, tiling: 'none', loopLength: 16, fps: 30 },
    preview: 'color', thumb: { node: 'color', frame: 2 }, view: { mesh: 'xf', material: 'color', mat: { blend: 'additive', doubleSided: true }, display: 'unlit' },
    tour: [{ node: 'bolt', text: { en: 'Lightning outputs a mask and a Spline.', fa: 'صاعقه یک ماسک و یک اسپلاین می‌دهد.' } }, { node: 'sweep', text: { en: 'Sweep: Spline Path + custom Profile pin.', fa: 'سوئیپ: مسیر اسپلاین + پین پروفایل سفارشی.' } }],
    build(s) {
      s.node('sim', 'bolt', 'simulation.lightning', 'Lightning Bolt', 0, 1, { p_start: [0.5, 0.05], p_end: [0.5, 0.95], jaggedness: 0.45, levels: 6, branch_prob: 0.25, branch_depth: 2, max_branches: 12, width: 0.02, glow: 0.5, seed: 4, flicker_rate: 24, flicker_loop: 8 });
      s.node('shape', 'core', 'grayscale.spline', 'Bolt Core (spline mask)', 1, 0, { width: 0.012, softness: 0.2, intensity: 1.5 }, { spline_in: 'bolt.spline' });
      s.node('shape', 'halo', 'utils.glow', 'Bolt Glow', 2, 0, { threshold: 0.3, radius: 0.08, intensity: 3, mode: 'add' }, { input: 'core' });
      s.node('color', 'color', 'color.ramp', 'Electric Ramp', 3, 0, { gradient: ELECTRIC_G }, { input: 'halo' });
      s.node('mesh', 'profile', 'geometry.spline_shape', 'Profile (circle)', 1, 2, { shape: 'circle', points: 8, radius: 0.3 });
      s.node('mesh', 'sweep', 'geometry.sweep', 'Bolt Sweep', 2, 2, { profile: 'custom', segments: 96, width: 0.06, height: 0.06, use_gradient: true, color_gradient: BOLT_VC, scale_curve: curve([0, 0.2], [0.15, 1], [0.85, 1], [1, 0.2]) }, { profile_in: 'profile.spline', path_in: 'bolt.spline' });
      s.node('mesh', 'xf', 'geometry.transform', 'Scale to World', 3, 2, { uniform: 3, translate: [-1.5, -1.5, 0] }, { input: 'sweep' });
      s.flipExport('output', 'exportFlip', 'export.color', 'Export Flicker Flipbook', 4, 0, 16, 4, 4, { alpha: true }, { input: 'color' });
      s.node('output', 'exportMask', 'export.mask', 'Export Core Mask', 4, 1, {}, { input: 'core' });
      s.node('output', 'exportMesh', 'export.mesh', 'Export Bolt Mesh', 4, 2, { engine: 'unreal' }, { input: 'xf' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 13 */
  {
    id: 'energy_beam_mesh',
    name: { en: 'Energy Beam Mesh', fa: 'مش پرتو انرژی' },
    description: { en: 'A star Profile drawn with Spline Shape is connected to the Sweep Profile pin. Scale and twist curves shape the beam, vertex colour gives a gradient, and a scrolling noise texture is previewed with an additive material.', fa: 'یک پروفایل ستاره‌ای که با Spline Shape رسم شده به پین Profile گره Sweep وصل است. منحنی‌های مقیاس و پیچش شکل پرتو را می‌سازند، رنگ رأس گرادیان می‌دهد و تکسچر نویز متحرک با متریال جمعی پیش‌نمایش می‌شود.' },
    adapt: { en: 'Edit the profile (points / inner radius), the path with the 3D gizmo, or the curves. The texture scroll is a material setting in the 3D viewport.', fa: 'پروفایل (تعداد نقاط / شعاع داخلی)، مسیر با گیزمو سه‌بعدی یا منحنی‌ها را ویرایش کنید. اسکرول تکسچر تنظیم متریال در ویوپورت سه‌بعدی است.' },
    category: ['energy', 'meshes', 'magic'], tags: ['beam', 'mesh', 'sweep', 'spline', 'energy'], difficulty: 'intermediate', loops: true,
    settings: { width: 512, height: 512, tiling: 'both', loopLength: 64, fps: 30 },
    preview: 'tex', thumb: { node: 'tex', frame: 8 }, view: { mesh: 'sweep', material: 'tex', mat: { blend: 'additive', doubleSided: true, scroll: [0, -0.6] }, display: 'unlit' },
    tour: [{ node: 'profile', text: { en: 'Profile drawn as a Spline Shape.', fa: 'پروفایل که به‌صورت Spline Shape رسم شده.' } }, { node: 'sweep', text: { en: 'Scale + twist curves, vertex colour gradient.', fa: 'منحنی مقیاس + پیچش، گرادیان رنگ رأس.' } }],
    build(s) {
      s.node('mesh', 'profile', 'geometry.spline_shape', 'Profile (star)', 0, 0, { shape: 'star', points: 6, inner: 0.5, radius: 0.3 });
      s.node('mesh', 'sweep', 'geometry.sweep', 'Beam Sweep', 1, 0, { spline: line3([[-2, 0, 0], [-0.7, 0.3, 0.2], [0.7, -0.3, -0.2], [2, 0, 0]]), profile: 'custom', width: 0.35, height: 0.35, segments: 96, v_tiling: 4, twist_amount: 360, use_gradient: true, color_gradient: BEAM_VC, scale_curve: curve([0, 0.1], [0.15, 1], [0.85, 1], [1, 0.1]), twist_curve: curve([0, 0], [1, 1]) }, { profile_in: 'profile.spline' });
      s.node('shape', 'noise', 'grayscale.noise', 'Beam Noise (stretched)', 0, 2, { noise_type: 'billow', scale: [8, 2], octaves: 3, seed: 6 });
      s.loopEvolution('noise', 'evolution', 64);
      s.node('shape', 'lv', 'utils.levels', 'Contrast', 1, 2, { in_low: 0.2, in_high: 0.8 }, { input: 'noise' });
      s.node('color', 'tex', 'color.ramp', 'Beam Ramp', 2, 2, { gradient: CYAN_G }, { input: 'lv' });
      s.node('output', 'exportMesh', 'export.mesh', 'Export Beam Mesh', 2, 0, { engine: 'unity' }, { input: 'sweep' });
      s.node('output', 'exportTex', 'export.color', 'Export Beam Texture', 3, 2, { alpha: true }, { input: 'tex' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 14 */
  {
    id: 'sword_slash_arc',
    name: { en: 'Sword Slash Arc', fa: 'قوس ضربه شمشیر' },
    description: { en: 'An arc path is swept with a tapered custom ribbon profile. The mask texture is a crescent multiplied by panning noise; the 3D viewport scrolls the UVs. Exports the mesh and the mask.', fa: 'یک مسیر کمانی با پروفایل نواری سفارشی و باریک‌شونده سوئیپ می‌شود. تکسچر ماسک یک هلال ضرب‌شده در نویز متحرک است و ویوپورت سه‌بعدی UVها را اسکرول می‌کند. خروجی: مش و ماسک.' },
    adapt: { en: 'Change the arc angles in the 3D spline, the Scale curve (taper) and the crescent size. Pan speed = Offset keyframes.', fa: 'زاویه کمان را در اسپلاین سه‌بعدی، منحنی مقیاس (باریک‌شدن) و اندازه هلال را عوض کنید. سرعت پن = کلیدهای Offset.' },
    category: ['weapons', 'meshes'], tags: ['slash', 'sword', 'mesh', 'sweep', 'spline', 'loop'], difficulty: 'intermediate', loops: true,
    settings: { width: 512, height: 512, tiling: 'both', loopLength: 48, fps: 30 },
    preview: 'tex', thumb: { node: 'tex', frame: 12 }, view: { mesh: 'sweep', material: 'tex', mat: { blend: 'additive', doubleSided: true, scroll: [-0.8, 0] }, display: 'unlit' },
    build(s) {
      s.node('mesh', 'profile', 'geometry.spline_shape', 'Ribbon Profile', 0, 0, { shape: 'line', radius: 0.5 });
      s.node('mesh', 'sweep', 'geometry.sweep', 'Slash Sweep', 1, 0, { spline: arcPath(1.4, -80, 80, 8), profile: 'custom', width: 0.7, height: 0.05, segments: 64, use_gradient: true, color_gradient: SLASH_VC, scale_curve: curve([0, 0], [0.7, 1], [1, 0.2]) }, { profile_in: 'profile.spline' });
      s.node('shape', 'cres', 'grayscale.shape', 'Crescent', 0, 2, { shape: 'crescent', size: [0.9, 0.5], position: [0.5, 0.5], softness: 0.3 });
      s.node('shape', 'pan', 'grayscale.noise', 'Panning Noise', 0, 3, { noise_type: 'perlin', scale: [6, 2], octaves: 3, seed: 9 });
      s.ramp01('pan', 'offset', [0, 0], [1, 0], 48);
      s.node('shape', 'lv', 'utils.levels', 'Noise Contrast', 1, 3, { in_low: 0.3, in_high: 0.8, out_low: 0.2 }, { input: 'pan' });
      s.node('shape', 'mask', 'utils.blend', 'Crescent × Noise', 2, 2, { blend_type: 'multiply' }, { foreground: 'lv', background: 'cres' });
      s.node('color', 'tex', 'color.ramp', 'Slash Ramp', 3, 2, { gradient: SLASH_G }, { input: 'mask' });
      s.node('output', 'exportMesh', 'export.mesh', 'Export Slash Mesh', 2, 0, { engine: 'unreal' }, { input: 'sweep' });
      s.node('output', 'exportMask', 'export.mask', 'Export Slash Mask', 4, 2, {}, { input: 'mask' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 15 */
  {
    id: 'shockwave_ring',
    name: { en: 'Shockwave Ring', fa: 'حلقه موج شوک' },
    description: { en: 'A ring mesh with polar UVs and radial vertex colour, a texture made from noise through Cartesian-to-Polar plus an expanding ring mask, and a radial distortion warp map exported as a flipbook.', fa: 'مش حلقه با UV قطبی و رنگ رأس شعاعی، تکسچری از نویز با تبدیل دکارتی به قطبی و ماسک حلقه در حال گسترش، و نقشه وارپ اعوجاج شعاعی که به‌صورت فلیپ‌بوک خروجی می‌گیرد.' },
    adapt: { en: 'Drive the ring size keyframes for a faster blast. The warp map’s Strength is what the shader multiplies.', fa: 'کلیدهای اندازه حلقه را برای انفجار سریع‌تر تغییر دهید. قدرت نقشه وارپ همان چیزی است که شیدر ضرب می‌کند.' },
    category: ['weapons', 'energy', 'meshes', 'flipbooks'], tags: ['shockwave', 'mesh', 'warp', 'distortion', 'flipbook'], difficulty: 'intermediate',
    settings: { width: 256, height: 256, tiling: 'none', loopLength: 32, fps: 30 },
    preview: 'color', thumb: { node: 'color', frame: 14 }, view: { mesh: 'vc', material: 'color', mat: { blend: 'additive', doubleSided: true }, display: 'unlit' },
    build(s) {
      s.node('mesh', 'ring', 'geometry.shapes', 'Ring Mesh', 0, 2, { shape: 'ring', radius: 1, inner_radius: 0.75, segments: 96, uv_mode: 'polar' });
      s.node('mesh', 'vc', 'geometry.combine_color', 'Radial Vertex Color', 1, 2, { source: 'gradient_radial', length: 1, gradient: SHOCK_VC }, { input: 'ring.mesh' });
      s.node('inputs', 'streakN', 'grayscale.noise', 'Streak Noise', 0, 0, { noise_type: 'perlin', scale: [12, 3], octaves: 3, seed: 2 });
      s.node('shape', 'polar', 'utils.cartesian_to_polar', 'Cartesian → Polar', 1, 0, { angular_tiling: 8 }, { input: 'streakN' });
      s.node('shape', 'band', 'grayscale.shape', 'Ring Mask', 1, 1, { shape: 'ring', size: [0.3, 0.3], thickness: 0.25, softness: 0.5 });
      s.anim('band', 'size', [[0, [0.3, 0.3]], [32, [0.95, 0.95]]], { interp: 'linear' });
      s.node('shape', 'mask', 'utils.blend', 'Streaks × Ring', 2, 0, { blend_type: 'multiply' }, { foreground: 'polar', background: 'band' });
      s.node('color', 'color', 'color.ramp', 'Shock Ramp', 3, 0, { gradient: SHOCK_G, intensity: 1.5 }, { input: 'mask' });
      s.node('motion', 'radial', 'uv.radial', 'Radial Push', 1, 3, { radius: 0.15, strength: 0.15, inner: 0.5 });
      s.anim('radial', 'radius', [[0, 0.15], [32, 0.5]], { interp: 'linear' });
      s.flipExport('output', 'exportColor', 'export.color', 'Export Color Flipbook', 4, 0, 16, 4, 4, { alpha: true }, { input: 'color' });
      s.flipExport('output', 'exportWarp', 'export.warp', 'Export Distortion Flipbook', 4, 3, 16, 4, 4, { range: 0.1 }, { input: 'radial' });
      s.node('output', 'exportMesh', 'export.mesh', 'Export Ring Mesh', 2, 2, { engine: 'unity' }, { input: 'vc' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 16 */
  {
    id: 'shield_bubble',
    name: { en: 'Shield Bubble', fa: 'حباب سپر' },
    description: { en: 'A sphere mesh with a fresnel-like vertex-colour gradient, a hex Grid mask and a hit ripple from the Wave simulation, all in UV space. The 3D viewport shows the additive material.', fa: 'مش کره با گرادیان رنگ رأس شبیه فرنل، ماسک شبکه شش‌ضلعی و موج برخورد از شبیه‌سازی Wave، همه در فضای UV. ویوپورت سه‌بعدی متریال جمعی را نشان می‌دهد.' },
    adapt: { en: 'Move the hit point (Emitter 1) to where the shield is struck, change hex cells, or tint the Ramp.', fa: 'نقطه برخورد (Emitter 1) را به محل ضربه ببرید، تعداد خانه‌ها را عوض کنید یا رمپ را رنگ‌آمیزی کنید.' },
    category: ['energy', 'meshes', 'magic'], tags: ['shield', 'mesh', 'energy', 'ripple', 'simulation', 'loop'], difficulty: 'advanced', loops: true,
    settings: { width: 512, height: 512, tiling: 'both', loopLength: 64, fps: 30 },
    preview: 'color', thumb: { node: 'color', frame: 20 }, view: { mesh: 'vc', material: 'color', mat: { blend: 'additive', doubleSided: true }, display: 'unlit' },
    tour: [{ node: 'wave', text: { en: 'The hit ripple lives in UV space (periodic).', fa: 'موج برخورد در فضای UV است (دوره‌ای).' } }, { node: 'vc', text: { en: 'Vertex colour acts as a fresnel-like rim.', fa: 'رنگ رأس نقش لبه شبیه فرنل را بازی می‌کند.' } }],
    build(s) {
      s.node('mesh', 'sphere', 'geometry.shapes', 'Sphere', 0, 3, { shape: 'sphere', radius: 1, segments: 48, rings: 24 });
      s.node('mesh', 'vc', 'geometry.combine_color', 'Fresnel-like Gradient', 1, 3, { source: 'gradient_axis', origin: [0, 0, -1], direction: [0, 0, 1], length: 2, gradient: SHIELD_VC }, { input: 'sphere.mesh' });
      s.node('shape', 'hex', 'utils.grid', 'Hex Grid', 0, 0, { pattern: 'hex', cells: [8, 8], line_width: 0.12, output_kind: 'lines' });
      s.node('sim', 'wave', 'simulation.wave', 'Hit Ripple', 0, 1, { em1_on: true, em1_mode: 'pulse', em1_pos: [0.5, 0.5], em1_freq: 0.9375, em1_pulse: 3, damping: 0.8, boundary: 'periodic', sim_res: 256, warmup: 10, loop_mode: 'crossfade', loop_frames: 64, blend_frames: 16 });
      s.node('shape', 'hit', 'utils.levels', 'Hit Levels', 1, 1, { in_low: 0.5, in_high: 0.9 }, { input: 'wave.height' });
      s.node('shape', 'mix', 'utils.blend', 'Hex + Hit', 2, 0, { blend_type: 'add', opacity: 0.8 }, { foreground: 'hit', background: 'hex' });
      s.node('color', 'color', 'color.ramp', 'Shield Ramp', 3, 0, { gradient: CYAN_G }, { input: 'mix' });
      s.node('output', 'exportColor', 'export.color', 'Export Shield Texture', 4, 0, { alpha: true }, { input: 'color' });
      s.node('output', 'exportMask', 'export.mask', 'Export Hex Mask', 4, 1, {}, { input: 'hex' });
      s.node('output', 'exportMesh', 'export.mesh', 'Export Shield Mesh', 2, 3, { engine: 'unreal' }, { input: 'vc' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 17 */
  {
    id: 'magic_rune_circle',
    name: { en: 'Magic Rune Circle', fa: 'دایره رون جادویی' },
    description: { en: 'Concentric Shape rings, Polar Scatter stars, a hex Grid inside a radial mask and glyph strokes drawn with Spline Shape → Spline. Everything is merged into a tileable mask and given an emissive Ramp.', fa: 'حلقه‌های هم‌مرکز Shape، ستاره‌های Polar Scatter، شبکه شش‌ضلعی داخل ماسک شعاعی و خطوط نماد که با Spline Shape ← Spline رسم شده‌اند. همه در یک ماسک کاشی‌پذیر ادغام و با رمپ نورانی رنگ می‌شوند.' },
    adapt: { en: 'Add glyphs by combining more Spline Shapes, or switch to the Rune Ring node for generated glyphs. Rotation keyframes loop 360°.', fa: 'با ترکیب Spline Shape بیشتر نماد اضافه کنید یا برای نمادهای خودکار گره Rune Ring را بگذارید. کلیدهای چرخش ۳۶۰ درجه لوپ می‌شوند.' },
    category: ['magic', 'tiling', 'flipbooks'], tags: ['rune', 'magic', 'spline', 'tileable', 'loop'], difficulty: 'intermediate', loops: true,
    settings: { width: 512, height: 512, tiling: 'both', loopLength: 64, fps: 30 },
    preview: 'color', thumb: { node: 'color', frame: 10 },
    build(s) {
      s.node('shape', 'ringA', 'grayscale.shape', 'Outer Ring', 0, 0, { shape: 'ring', size: [0.9, 0.9], thickness: 0.03, softness: 0.3 });
      s.node('shape', 'ringB', 'grayscale.shape', 'Inner Ring', 0, 1, { shape: 'ring', size: [0.62, 0.62], thickness: 0.03, softness: 0.3 });
      s.node('shape', 'scatter', 'grayscale.polar_scatter', 'Star Ring', 0, 2, { shape: 'star', sides: 6, size: 0.05, radius_min: 0.36, radius_max: 0.4, count: 12, ring_count: 1 });
      s.ramp01('scatter', 'rotation', 0, 360, 64);
      s.node('shape', 'grid', 'utils.grid', 'Hex Grid', 0, 3, { pattern: 'hex', cells: [6, 6], line_width: 0.04 });
      s.node('shape', 'inner', 'grayscale.gradient', 'Inner Mask', 0, 4, { gtype: 'radial', center: [0.5, 0.5], radius: 0.3, invert: true });
      s.node('shape', 'gridMask', 'utils.blend', 'Masked Grid', 1, 3, { blend_type: 'multiply', opacity: 0.6 }, { foreground: 'grid', background: 'inner' });
      s.node('inputs', 'sp1', 'geometry.spline_shape', 'Glyph Star', 1, 5, { shape: 'star', points: 5, inner: 0.4, radius: 0.22 });
      s.ramp01('sp1', 'rotation', 0, -360, 64);
      s.node('inputs', 'sp2', 'geometry.spline_shape', 'Glyph Triangle', 1, 6, { shape: 'polygon', points: 3, radius: 0.2 });
      s.node('inputs', 'combo', 'geometry.spline_combine', 'Glyph Combine', 2, 5, {}, { a: 'sp1.spline', b: 'sp2.spline' });
      s.node('shape', 'strokes', 'grayscale.spline', 'Glyph Strokes', 3, 5, { width: 0.012, softness: 0.3, intensity: 1.5 }, { spline_in: 'combo.spline' });
      s.node('shape', 'm1', 'utils.blend', 'Rings', 1, 0, { blend_type: 'max' }, { foreground: 'ringB', background: 'ringA' });
      s.node('shape', 'm2', 'utils.blend', '+ Stars', 2, 1, { blend_type: 'max' }, { foreground: 'scatter', background: 'm1' });
      s.node('shape', 'm3', 'utils.blend', '+ Grid', 3, 2, { blend_type: 'max' }, { foreground: 'gridMask', background: 'm2' });
      s.node('shape', 'm4', 'utils.blend', '+ Glyphs', 4, 3, { blend_type: 'max' }, { foreground: 'strokes', background: 'm3' });
      s.node('color', 'color', 'color.ramp', 'Emissive Ramp', 5, 3, { gradient: RUNE_G }, { input: 'm4' });
      s.node('output', 'exportMask', 'export.mask', 'Export Tileable Mask', 6, 2, {}, { input: 'm4' });
      s.node('output', 'exportColor', 'export.color', 'Export Emissive', 6, 3, { alpha: true }, { input: 'color' });
    },
  },
];
