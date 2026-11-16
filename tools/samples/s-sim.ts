import { FLUID_PRESETS } from '../../src/nodes/simulation/fluid2d/presets';
import { BLACKBODY, CYAN_G, SMOKE_G, VIOLET_G, WATER_G, grad, type SampleSpec } from './kit';

/** Samples 1-11: fluid / simulation / vector-field based. Every value is conservative (Draft-Balanced quality, <= 512 px). */
const pre = (id: string) => FLUID_PRESETS.find((p) => p.id === id)!.params as Record<string, unknown>;
const OPAQUE_SMOKE = grad([[0, [0.1, 0.1, 0.12, 1]], [0.5, [0.35, 0.35, 0.38, 1]], [1, [0.9, 0.9, 0.93, 1]]]);
const INK = grad([[0, [0.95, 0.93, 0.86, 1]], [0.35, [0.45, 0.62, 0.9, 1]], [0.7, [0.1, 0.25, 0.75, 1]], [1, [0.02, 0.05, 0.3, 1]]]);
const WISP = grad([[0, [0.7, 0.85, 1, 0]], [1, [0.95, 0.98, 1, 1]]]);
const EDGE_GLOW = grad([[0, [0, 0, 0, 0]], [0.4, [0.9, 0.15, 0.02, 0.8]], [0.75, [1, 0.65, 0.1, 1]], [1, [1, 0.95, 0.6, 1]]]);
const PAPER = grad([[0, [0.42, 0.3, 0.17, 1]], [1, [0.86, 0.74, 0.5, 1]]]);
const ALIEN = grad([[0, [0.02, 0.06, 0.05, 1]], [0.4, [0.1, 0.35, 0.28, 1]], [0.75, [0.55, 0.8, 0.4, 1]], [1, [0.95, 0.98, 0.7, 1]]]);

export const SIM_SAMPLES: SampleSpec[] = [
  /* ------------------------------------------------------------------------------------------ 1 */
  {
    id: 'campfire_loop',
    name: { en: 'Campfire (looping flipbook)', fa: 'آتش کمپ (فلیپ‌بوک لوپ)' },
    description: { en: 'Fluid 2D with the Campfire preset. Temperature goes through a black-body Ramp, smoke density through a grey Ramp; both are added and baked as a seamless 8×8 flipbook.', fa: 'سیال دوبعدی با پریست آتش کمپ. دما از یک رمپ جسم سیاه و چگالی دود از یک رمپ خاکستری عبور می‌کند؛ هر دو جمع شده و به شکل فلیپ‌بوک ۸×۸ بدون درز پخته می‌شوند.' },
    adapt: { en: 'Move the emitter line (Emitter 1), change Fuel / Turbulence, or edit the black-body gradient. Keep Loop mode = Crossfade and Loop frames = timeline length.', fa: 'خط منبع (Emitter 1) را جابه‌جا کنید، سوخت و تلاطم را تغییر دهید یا گرادیان جسم سیاه را ویرایش کنید. حالت لوپ را روی Crossfade و طول لوپ را برابر طول تایم‌لاین نگه دارید.' },
    category: ['fire', 'flipbooks', 'simulation'], tags: ['fire', 'smoke', 'fluid', 'loop', 'flipbook'], difficulty: 'intermediate', loops: true,
    settings: { width: 512, height: 512, tiling: 'none', loopLength: 96, fps: 30 },
    preview: 'comp', thumb: { node: 'comp', frame: 40 },
    tour: [{ node: 'fluid', text: { en: 'Fluid 2D solves fire and smoke. Crossfade makes it loop.', fa: 'سیال دوبعدی آتش و دود را حل می‌کند. کراس‌فید آن را لوپ می‌کند.' } }, { node: 'fire', text: { en: 'Temperature → black-body Ramp.', fa: 'دما ← رمپ جسم سیاه.' } }, { node: 'export', text: { en: 'Pre-configured 8×8 flipbook export.', fa: 'خروجی فلیپ‌بوک ۸×۸ از پیش تنظیم‌شده.' } }],
    build(s) {
      s.node('sim', 'fluid', 'simulation.fluid2d', 'Campfire Fluid', 0, 1, { ...pre('campfire'), quality: 'balanced' });
      s.node('color', 'fire', 'color.ramp', 'Black-body Ramp', 1, 0, { gradient: BLACKBODY, in_low: 0.1, in_high: 4.5 }, { input: 'fluid.temperature' });
      s.node('color', 'smoke', 'color.ramp', 'Smoke Ramp', 1, 2, { gradient: SMOKE_G, in_low: 0, in_high: 2.5 }, { input: 'fluid.density' });
      s.node('color', 'comp', 'utils.blend_color', 'Fire + Smoke', 2, 1, { blend_type: 'add' }, { foreground: 'fire', background: 'smoke' });
      s.node('output', 'sheet', 'utils.sheet_encode', 'Sheet 8×8', 3, 0, { frames: 64, auto_grid: false, cols: 8, rows: 8, range: 'loop' }, { input: 'comp' });
      s.flipExport('output', 'export', 'export.color', 'Export Flipbook', 3, 2, 64, 8, 8, { engine: 'unreal' }, { input: 'comp' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 2 */
  {
    id: 'smoke_puff_loop',
    name: { en: 'Rising Smoke Puff (looping flipbook)', fa: 'پف دود صعودی (فلیپ‌بوک لوپ)' },
    description: { en: 'Fluid 2D smoke. Density becomes alpha, and the density height-field normal gives a soft directional light, baked as an 8×8 looping flipbook with alpha.', fa: 'دود سیال دوبعدی. چگالی به آلفا تبدیل می‌شود و نرمال میدان ارتفاع چگالی نور جهت‌دار ملایمی می‌دهد؛ خروجی فلیپ‌بوک ۸×۸ لوپ با آلفا.' },
    adapt: { en: 'Change the light by editing the Light Levels node, the smoke tint in the Ramp, or Turbulence on the fluid.', fa: 'نور را با گره Light Levels، رنگ دود را با رمپ و تلاطم را روی سیال تغییر دهید.' },
    category: ['fire', 'flipbooks', 'simulation'], tags: ['smoke', 'fluid', 'loop', 'flipbook', 'normal'], difficulty: 'intermediate', loops: true,
    settings: { width: 512, height: 512, tiling: 'none', loopLength: 120, fps: 30 },
    preview: 'out', thumb: { node: 'out', frame: 40 },
    tour: [{ node: 'fluid', text: { en: 'Rising Smoke preset, looping with a cross-fade.', fa: 'پریست دود صعودی با لوپ کراس‌فید.' } }, { node: 'normals', text: { en: 'The fluid exposes a Normal of its density field.', fa: 'سیال یک نرمال از میدان چگالی خود می‌دهد.' } }, { node: 'out', text: { en: 'Density → alpha merge.', fa: 'چگالی ← ادغام آلفا.' } }],
    build(s) {
      s.node('sim', 'fluid', 'simulation.fluid2d', 'Smoke Fluid', 0, 1, { ...pre('rising_smoke'), quality: 'balanced' });
      s.node('color', 'tone', 'color.ramp', 'Smoke Tone', 1, 0, { gradient: OPAQUE_SMOKE, in_low: 0, in_high: 2.5 }, { input: 'fluid.density' });
      s.node('color', 'alpha', 'utils.levels', 'Density → Alpha', 1, 1, { in_low: 0.05, in_high: 1.6, gamma: 0.8 }, { input: 'fluid.density' });
      s.node('shape', 'normals', 'normal.normal_to_color', 'Density Normal', 1, 2, {}, { input: 'fluid.normal' });
      s.node('shape', 'luma', 'utils.rgb_to_grayscale', 'Light Direction', 2, 2, {}, { input: 'normals' });
      s.node('shape', 'shade', 'utils.levels', 'Light Levels', 3, 2, { in_low: 0.3, in_high: 0.8, out_low: 0.35, out_high: 1.1 }, { input: 'luma' });
      s.node('color', 'lit', 'utils.blend_color', 'Lit Smoke', 3, 0, { blend_type: 'multiply', opacity: 0.85 }, { foreground: 'shade', background: 'tone' });
      s.node('color', 'out', 'utils.alpha_merge', 'Add Alpha', 4, 1, {}, { color: 'lit', alpha: 'alpha' });
      s.node('output', 'sheet', 'utils.sheet_encode', 'Sheet 8×8', 5, 0, { frames: 64, auto_grid: false, cols: 8, rows: 8, range: 'loop' }, { input: 'out' });
      s.flipExport('output', 'export', 'export.color', 'Export Flipbook', 5, 2, 64, 8, 8, { alpha: true, engine: 'unity' }, { input: 'out' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 3 */
  {
    id: 'fireball_explosion',
    name: { en: 'Fireball Explosion', fa: 'انفجار گلوله آتش' },
    description: { en: 'Fluid 2D explosion preset with an expansion burst. Fire and smoke are split into two layers and packed as RGBA (R fire, G smoke, B soot, A opacity) in one flipbook; a lit preview is also exported.', fa: 'پریست انفجار سیال دوبعدی با انبساط انفجاری. آتش و دود در دو لایه جدا شده و به‌صورت RGBA (R آتش، G دود، B دوده، A کدری) در یک فلیپ‌بوک بسته‌بندی می‌شوند؛ پیش‌نمایش رنگی هم خروجی می‌گیرد.' },
    adapt: { en: 'Raise Expansion / Temperature for a bigger blast, then re-tune the Smoke Levels. Unpack the layers in your shader: R = emissive fire, G = lit smoke.', fa: 'برای انفجار بزرگ‌تر انبساط و دما را زیاد کنید و سپس Smoke Levels را تنظیم کنید. در شیدر: R = آتش نورانی، G = دود نورخور.' },
    category: ['fire', 'flipbooks', 'simulation'], tags: ['fire', 'smoke', 'explosion', 'fluid', 'flipbook', 'packed'], difficulty: 'advanced',
    settings: { width: 512, height: 512, tiling: 'none', loopLength: 72, fps: 30 },
    preview: 'preview', thumb: { node: 'preview', frame: 14 },
    tour: [{ node: 'fluid', text: { en: 'One-shot explosion: a burst emitter with expansion.', fa: 'انفجار تک‌پخش: منبع انفجاری با انبساط.' } }, { node: 'pack', text: { en: 'Fire, smoke and soot packed into RGB; alpha = max.', fa: 'آتش، دود و دوده در RGB؛ آلفا = بیشینه.' } }],
    build(s) {
      s.node('sim', 'fluid', 'simulation.fluid2d', 'Explosion Fluid', 0, 1, { ...pre('explosion'), quality: 'balanced' });
      s.node('shape', 'smokeLv', 'utils.levels', 'Smoke Levels', 1, 2, { in_low: 0, in_high: 3 }, { input: 'fluid.density' });
      s.node('shape', 'alpha', 'utils.blend', 'Opacity = max', 2, 1, { blend_type: 'max' }, { foreground: 'fluid.fire_mask', background: 'smokeLv' });
      s.node('output', 'pack', 'utils.rgba_merge', 'Pack RGBA', 3, 1, {}, { r: 'fluid.fire_mask', g: 'smokeLv', b: 'fluid.soot', a: 'alpha' });
      s.node('color', 'fire', 'color.ramp', 'Fire Ramp', 1, 0, { gradient: BLACKBODY, in_low: 0.1, in_high: 12 }, { input: 'fluid.temperature' });
      s.node('color', 'smoke', 'color.ramp', 'Smoke Ramp', 2, 2, { gradient: SMOKE_G }, { input: 'smokeLv' });
      s.node('color', 'preview', 'utils.blend_color', 'Lit Preview', 3, 2, { blend_type: 'add' }, { foreground: 'fire', background: 'smoke' });
      s.flipExport('output', 'exportPacked', 'export.color', 'Export Packed Layers', 4, 1, 36, 6, 6, { alpha: true, engine: 'unreal', color_space: 'linear' }, { input: 'pack' });
      s.flipExport('output', 'exportPreview', 'export.color', 'Export Preview Flipbook', 4, 2, 36, 6, 6, { alpha: true }, { input: 'preview' });
      s.node('output', 'sheet', 'utils.sheet_encode', 'Sheet 6×6', 4, 0, { frames: 36, auto_grid: false, cols: 6, rows: 6, range: 'loop' }, { input: 'preview' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 4 */
  {
    id: 'ink_in_water',
    name: { en: 'Ink in Water (tileable)', fa: 'جوهر در آب (کاشی‌پذیر)' },
    description: { en: 'Slow viscous fluid with two swirling emitters and periodic boundaries, so the ink wraps around the edges: a tileable paper-and-ink background plus a density mask.', fa: 'سیال کند و چسبناک با دو منبع چرخان و مرز دوره‌ای؛ جوهر از لبه‌ها عبور می‌کند. پس‌زمینه کاشی‌پذیر کاغذ و جوهر به‌همراه ماسک چگالی.' },
    adapt: { en: 'Move the two emitters and the Swirl, change the ink colours in the Ramp, scrub the timeline to pick the frame you like and export it.', fa: 'دو منبع و گردابه را جابه‌جا کنید، رنگ جوهر را در رمپ عوض کنید و روی تایم‌لاین فریم دلخواه را انتخاب و خروجی بگیرید.' },
    category: ['water', 'tiling', 'simulation'], tags: ['ink', 'fluid', 'tileable', 'water', 'simulation'], difficulty: 'intermediate',
    settings: { width: 512, height: 512, tiling: 'both', loopLength: 120, fps: 30 },
    preview: 'tiles', thumb: { node: 'paper', frame: 45 },
    build(s) {
      s.node('sim', 'fluid', 'simulation.fluid2d', 'Ink Fluid', 0, 1, { ...pre('ink_in_water'), quality: 'balanced', em2_on: true, em2_pos: [0.72, 0.5], em2_dir: 180, em2_speed: 1, em2_density: 60, em2_temperature: 0, em2_mode: 'burst', em2_burst: 4, em2_start: 20, em2_radius: 0.04, swirl_pos: [0.5, 0.5], swirl_radius: 0.3, swirl_strength: 6 });
      s.node('color', 'paper', 'color.ramp', 'Ink on Paper', 1, 0, { gradient: INK, in_low: 0, in_high: 2.5 }, { input: 'fluid.density' });
      s.node('shape', 'mask', 'utils.levels', 'Ink Mask', 1, 2, { in_low: 0, in_high: 2.5 }, { input: 'fluid.density' });
      s.node('output', 'tiles', 'utils.tile_color', 'Tiling Check 2×2', 2, 0, { tiles: [2, 2] }, { input: 'paper' });
      s.node('output', 'export', 'export.color', 'Export Tileable Background', 3, 0, { alpha: false }, { input: 'paper' });
      s.node('output', 'exportMask', 'export.mask', 'Export Ink Mask', 3, 2, { depth: '16' }, { input: 'mask' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 5 */
  {
    id: 'wind_wisps',
    name: { en: 'Wind Wisps', fa: 'رشته‌های باد' },
    description: { en: 'Curl Vector Noise plus Vortex fields drive a LIC streak pattern, which Vector Advect flows around a seamless loop (flow-map mode). Outputs a tileable looping mask.', fa: 'نویز برداری کرل و میدان‌های گردابه الگوی رگه‌های LIC را می‌سازند و Vector Advect آن را در یک لوپ بی‌درز (حالت فلوم‌پ) جاری می‌کند. خروجی: ماسک کاشی‌پذیر لوپ.' },
    adapt: { en: 'Add more vortices (W2..W4), lengthen the LIC streaks, or feed a different pattern into Advect. The loop is the Phase keyframes 0 → 1.', fa: 'گردابه‌های بیشتر (W2..W4) اضافه کنید، رگه‌های LIC را بلندتر کنید یا الگوی دیگری به Advect بدهید. لوپ همان کلیدهای Phase از ۰ تا ۱ است.' },
    category: ['water', 'tiling', 'flipbooks'], tags: ['wind', 'vector', 'loop', 'tileable', 'flipbook'], difficulty: 'intermediate', loops: true,
    settings: { width: 512, height: 512, tiling: 'both', loopLength: 64, fps: 30 },
    preview: 'tint', thumb: { node: 'tint', frame: 20 },
    tour: [{ node: 'flow', text: { en: 'Curl noise + vortices form one flow field.', fa: 'نویز کرل و گردابه‌ها یک میدان جریان می‌سازند.' } }, { node: 'adv', text: { en: 'Flow-map advection: Phase 0 → 1 loops seamlessly.', fa: 'ادوکشن فلوم‌پ: فاز ۰ تا ۱ بدون درز لوپ می‌شود.' } }],
    build(s) {
      s.node('inputs', 'curl', 'vector.noise', 'Curl Flow', 0, 0, { kind: 'curl', scale: [3, 3], octaves: 3, strength: 0.25, z_cells: 2, seed: 7 });
      s.loopEvolution('curl', 'evolution', 64);
      s.node('inputs', 'vort', 'vector.vortex', 'Vortex Swirls', 0, 1, { w1_pos: [0.3, 0.4], w1_radius: 0.35, w1_strength: 0.5, w2_pos: [0.72, 0.65], w2_radius: 0.3, w2_strength: -0.45 });
      s.node('inputs', 'grain', 'grayscale.noise', 'Grain Noise', 0, 2, { noise_type: 'perlin', scale: [6, 6], octaves: 3, seed: 3 });
      s.node('motion', 'flow', 'vector.combine', 'Flow = Curl + Vortex', 1, 0, { mode: 'add', gain_a: 1, gain_b: 0.6 }, { a: 'curl', b: 'vort' });
      s.node('shape', 'lic', 'vector.lic', 'LIC Streaks', 2, 0, { length: 0.14, steps: 24, contrast: 3, noise_cells: 0.5 }, { vector: 'flow', noise: 'grain' });
      s.node('motion', 'adv', 'vector.advect', 'Looping Flow Advect', 3, 0, { mode: 'flowmap', strength: 0.12, phase: 0, steps: 8 }, { input: 'lic', vector: 'flow' });
      s.ramp01('adv', 'phase', 0, 1, 64);
      s.node('color', 'lv', 'utils.levels', 'Mask Levels', 4, 0, { in_low: 0.25, in_high: 0.85 }, { input: 'adv' });
      s.node('color', 'tint', 'color.ramp', 'Wisp Tint', 5, 0, { gradient: WISP }, { input: 'lv' });
      s.node('output', 'exportMask', 'export.mask', 'Export Tileable Mask', 6, 0, { depth: '16' }, { input: 'lv' });
      s.flipExport('output', 'exportFlip', 'export.color', 'Export Flipbook', 6, 1, 16, 4, 4, { alpha: true }, { input: 'tint' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 6 */
  {
    id: 'magic_vortex_portal',
    name: { en: 'Magic Vortex Portal', fa: 'پورتال گردابه جادویی' },
    description: { en: 'Polar-scattered rune stars are flow-map advected by a Vector Vortex, faded by a radial mask, coloured with a violet Ramp and bloomed. Loops seamlessly; the result is additive-ready.', fa: 'ستاره‌های رونی پراکنده در شبکه قطبی با یک گردابه برداری به‌صورت فلوم‌پ جابه‌جا می‌شوند، با ماسک شعاعی محو و با رمپ بنفش رنگ می‌شوند. بدون درز لوپ می‌شود و برای ترکیب جمعی آماده است.' },
    adapt: { en: 'Swap the scatter shape, change the vortex strength, or edit the Ramp. Use the Additive blend in your engine.', fa: 'شکل پراکنش را عوض کنید، قدرت گردابه را تغییر دهید یا رمپ را ویرایش کنید. در موتور بازی از ترکیب Additive استفاده کنید.' },
    category: ['magic', 'energy', 'flipbooks'], tags: ['portal', 'magic', 'vector', 'loop', 'flipbook'], difficulty: 'intermediate', loops: true,
    settings: { width: 512, height: 512, tiling: 'none', loopLength: 64, fps: 30 },
    preview: 'glow', thumb: { node: 'glow', frame: 16 },
    build(s) {
      s.node('inputs', 'scatter', 'grayscale.polar_scatter', 'Rune Stars', 0, 0, { radius_min: 0.12, radius_max: 0.42, ring_count: 4, count: 10, shape: 'star', sides: 5, size: 0.07 });
      s.ramp01('scatter', 'rotation', 0, 360, 64);
      s.node('inputs', 'vort', 'vector.vortex', 'Portal Vortex', 0, 1, { core: 0.12, w1_pos: [0.5, 0.5], w1_radius: 0.55, w1_strength: 1.2 });
      s.node('inputs', 'fade', 'grayscale.gradient', 'Radial Fade', 0, 2, { gtype: 'radial', center: [0.5, 0.5], radius: 0.5, invert: true });
      s.node('motion', 'adv', 'vector.advect', 'Vortex Advect', 1, 0, { mode: 'flowmap', strength: 0.25, steps: 8, phase: 0 }, { input: 'scatter', vector: 'vort' });
      s.ramp01('adv', 'phase', 0, 1, 64);
      s.node('shape', 'mask', 'utils.blend', 'Edge Fade', 2, 0, { blend_type: 'multiply' }, { foreground: 'adv', background: 'fade' });
      s.node('shape', 'lv', 'utils.levels', 'Contrast', 3, 0, { in_low: 0.05, in_high: 0.7 }, { input: 'mask' });
      s.node('color', 'ramp', 'color.ramp', 'Violet Ramp', 4, 0, { gradient: VIOLET_G }, { input: 'lv' });
      s.node('color', 'glow', 'utils.glow_color', 'Bloom', 5, 0, { threshold: 0.6, radius: 0.08, intensity: 1.2 }, { input: 'ramp' });
      s.flipExport('output', 'export', 'export.color', 'Export Flipbook (additive)', 6, 0, 16, 4, 4, { alpha: true, engine: 'unity' }, { input: 'glow' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 7 */
  {
    id: 'water_ripples_normal',
    name: { en: 'Water Ripples + Normal', fa: 'موج‌های آب + نرمال' },
    description: { en: 'Wave simulation with two animated impulse sources (pulse rates fit the loop). Height drives a water Ramp blended with caustics; the simulation normal is exported as a normal map.', fa: 'شبیه‌سازی موج با دو منبع ضربه متحرک (نرخ ضربه‌ها با لوپ هماهنگ است). ارتفاع رمپ آب را می‌سازد و با کاستیک ترکیب می‌شود؛ نرمال شبیه‌سازی به‌صورت نرمال مپ خروجی می‌گیرد.' },
    adapt: { en: 'Change Damping or Wave speed, move the emitters, set Boundary to Periodic for a tiling pond, and adjust the caustic opacity.', fa: 'میرایی یا سرعت موج را تغییر دهید، منابع را جابه‌جا کنید، برای برکه کاشی‌پذیر مرز را Periodic کنید و کدری کاستیک را تنظیم کنید.' },
    category: ['water', 'simulation', 'flipbooks'], tags: ['water', 'ripple', 'normal', 'simulation', 'loop'], difficulty: 'intermediate', loops: true,
    settings: { width: 512, height: 512, tiling: 'none', loopLength: 96, fps: 30 },
    preview: 'water', thumb: { node: 'water', frame: 40 },
    tour: [{ node: 'wave', text: { en: 'Two pulsing emitters; frequency × loop length = whole pulses.', fa: 'دو منبع ضربه‌ای؛ فرکانس × طول لوپ = تعداد صحیح ضربه.' } }, { node: 'exportNormal', text: { en: 'The wave normal, exported for the engine.', fa: 'نرمال موج، آماده خروجی برای موتور.' } }],
    build(s) {
      s.node('sim', 'wave', 'simulation.wave', 'Ripple Simulation', 0, 1, { em1_on: true, em1_mode: 'pulse', em1_pos: [0.35, 0.4], em1_freq: 1.25, em1_pulse: 3, em2_on: true, em2_mode: 'pulse', em2_pos: [0.7, 0.65], em2_freq: 0.625, em2_pulse: 3, damping: 0.5, boundary: 'reflect', sim_res: 256, warmup: 30, loop_mode: 'crossfade', loop_frames: 96, blend_frames: 24 });
      s.node('inputs', 'caustics', 'grayscale.caustics', 'Caustics', 0, 3, { scale: [3, 3], brightness: 1, floor_level: 0.2 });
      s.loopEvolution('caustics', 'evolution', 96);
      s.node('shape', 'height', 'utils.levels', 'Height Levels', 1, 0, { in_low: 0.3, in_high: 0.7 }, { input: 'wave.height' });
      s.node('shape', 'mix', 'utils.blend', 'Caustics Blend', 2, 1, { blend_type: 'add', opacity: 0.45 }, { foreground: 'caustics', background: 'height' });
      s.node('color', 'water', 'color.ramp', 'Water Ramp', 3, 1, { gradient: WATER_G }, { input: 'mix' });
      s.node('output', 'exportNormal', 'export.normal', 'Export Normal', 3, 3, { engine: 'unity' }, { input: 'wave.normal' });
      s.node('output', 'exportColor', 'export.color', 'Export Water Color', 4, 1, { alpha: false }, { input: 'water' });
      s.flipExport('output', 'exportFlip', 'export.color', 'Export Flipbook', 4, 2, 36, 6, 6, { alpha: false }, { input: 'water' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 8 */
  {
    id: 'alien_skin_tileable',
    name: { en: 'Alien Skin (tileable)', fa: 'پوست بیگانه (کاشی‌پذیر)' },
    description: { en: 'Reaction-Diffusion (coral pattern, periodic) becomes a height map; Normal Create and a Color Ramp turn it into a skin. Exports colour, normal and a packed mask (R height, G edges, B cavity).', fa: 'واکنش-نفوذ (الگوی مرجان، دوره‌ای) به نقشه ارتفاع تبدیل می‌شود؛ Normal Create و رمپ رنگی آن را به پوست تبدیل می‌کنند. خروجی: رنگ، نرمال و ماسک بسته‌بندی‌شده (R ارتفاع، G لبه‌ها، B حفره).' },
    adapt: { en: 'Try Feed 0.029 / Kill 0.057 for a maze pattern. More Warm-up gives a more settled pattern; keep Periodic on for tiling.', fa: 'برای الگوی هزارتو Feed ۰٫۰۲۹ و Kill ۰٫۰۵۷ را امتحان کنید. گرم‌کردن بیشتر الگو را پایدارتر می‌کند؛ برای کاشی‌پذیری Periodic را روشن نگه دارید.' },
    category: ['environment', 'tiling', 'simulation'], tags: ['skin', 'organic', 'tileable', 'normal', 'packed', 'simulation'], difficulty: 'intermediate',
    settings: { width: 512, height: 512, tiling: 'both', loopLength: 64, fps: 30 },
    preview: 'color', thumb: { node: 'color' },
    build(s) {
      s.node('sim', 'rd', 'simulation.reaction_diffusion', 'Coral Pattern', 0, 1, { feed: 0.0545, kill: 0.062, seed_mode: 'noise', seed_density: 0.03, periodic: true, sim_res: 256, warmup: 120 });
      s.node('shape', 'height', 'utils.levels', 'Height Levels', 1, 1, { in_low: 0.05, in_high: 0.9, gamma: 1.1 }, { input: 'rd.pattern' });
      s.node('shape', 'normal', 'normal.create', 'Normal Create', 2, 0, { strength: 3 }, { input: 'height' });
      s.node('shape', 'edge', 'utils.edge_detect', 'Edges', 2, 1, { width: 0.004, intensity: 6 }, { input: 'height' });
      s.node('shape', 'cavity', 'utils.blur', 'Cavity', 2, 2, { radius: 0.02 }, { input: 'height' });
      s.node('color', 'color', 'color.ramp', 'Skin Ramp', 3, 1, { gradient: ALIEN }, { input: 'height' });
      s.node('output', 'exportColor', 'export.color', 'Export Color', 4, 0, { alpha: false, engine: 'unreal' }, { input: 'color' });
      s.node('output', 'exportNormal', 'export.normal', 'Export Normal', 4, 1, { engine: 'unreal' }, { input: 'normal' });
      s.node('output', 'exportPacked', 'export.multimask', 'Export Packed Mask', 4, 2, { slots: 'rgb', engine: 'unreal' }, { r: 'height', g: 'edge', b: 'cavity' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 9 */
  {
    id: 'burn_dissolve_reveal',
    name: { en: 'Burn / Dissolve Reveal', fa: 'نمایش با سوختن / حل‌شدن' },
    description: { en: 'Dissolve / Burn Front spreads from the centre with a noise-modulated speed. The burned mask reveals the paper, the edge glow is mapped to fire colours. Exports a threshold-animation flipbook and a time-to-burn map.', fa: 'جبهه سوختن / حل‌شدن از مرکز با سرعت تعدیل‌شده با نویز پخش می‌شود. ماسک سوخته کاغذ را آشکار می‌کند و درخشش لبه به رنگ آتش نگاشت می‌شود. خروجی: فلیپ‌بوک انیمیشن آستانه و نقشه زمان‌سوختن.' },
    adapt: { en: 'Use the Time-to-burn map as a Dissolve threshold in your material: animate one scalar from 0 to 1. Change ignition point or wind for directional burns.', fa: 'نقشه زمان‌سوختن را به‌عنوان آستانه Dissolve در متریال استفاده کنید: یک عدد از ۰ تا ۱ انیمیت می‌شود. نقطه آتش یا باد را برای سوختن جهت‌دار تغییر دهید.' },
    category: ['fire', 'environment', 'simulation', 'flipbooks'], tags: ['burn', 'dissolve', 'fire', 'simulation', 'flipbook'], difficulty: 'intermediate',
    settings: { width: 512, height: 512, tiling: 'none', loopLength: 96, fps: 30 },
    preview: 'comp', thumb: { node: 'comp', frame: 50 },
    tour: [{ node: 'burn', text: { en: 'Front speed is modulated by noise and height.', fa: 'سرعت جبهه با نویز و ارتفاع تعدیل می‌شود.' } }, { node: 'exportTime', text: { en: 'Time-to-burn: a ready-made dissolve threshold.', fa: 'زمان‌سوختن: یک آستانه آماده برای Dissolve.' } }],
    build(s) {
      s.node('inputs', 'noise', 'grayscale.noise', 'Speed Noise', 0, 0, { noise_type: 'perlin', scale: [5, 5], octaves: 4, seed: 11 });
      s.node('inputs', 'dome', 'grayscale.gradient', 'Height Dome', 0, 2, { gtype: 'radial', center: [0.5, 0.5], radius: 0.7 });
      s.node('inputs', 'paperN', 'grayscale.noise', 'Paper Fibres', 0, 3, { noise_type: 'perlin', scale: [3, 3], octaves: 5, seed: 4 });
      s.node('sim', 'burn', 'simulation.burn_front', 'Burn Front', 1, 1, { front_speed: 0.3, burn_duration: 1.5, height_influence: 0.3, noise_influence: 0.7, ignite_pos: [0.5, 0.5], ignite_radius: 0.04, sim_res: 256, warmup: 0 }, { noise: 'noise', height: 'dome' });
      s.node('color', 'paper', 'color.ramp', 'Paper Colour', 1, 3, { gradient: PAPER }, { input: 'paperN' });
      s.node('shape', 'unburned', 'utils.math', 'Unburned = 1 − Burned', 2, 2, { op: 'one_minus' }, { a: 'burn.burned' });
      s.node('color', 'revealed', 'utils.alpha_merge', 'Paper with Hole', 3, 3, {}, { color: 'paper', alpha: 'unburned' });
      s.node('color', 'glow', 'color.ramp', 'Edge Glow Ramp', 2, 0, { gradient: EDGE_GLOW }, { input: 'burn.edge' });
      s.node('color', 'comp', 'utils.blend_color', 'Glow over Paper', 4, 1, { blend_type: 'add' }, { foreground: 'glow', background: 'revealed' });
      s.flipExport('output', 'exportThreshold', 'export.mask', 'Export Threshold Flipbook', 5, 0, 16, 4, 4, {}, { input: 'burn.burned' });
      s.node('output', 'exportTime', 'export.mask', 'Export Time-to-burn Map', 5, 1, { depth: '16' }, { input: 'burn.time' });
      s.flipExport('output', 'exportColor', 'export.color', 'Export Color Flipbook', 5, 2, 16, 4, 4, { alpha: true }, { input: 'comp' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 10 */
  {
    id: 'heat_haze_distortion',
    name: { en: 'Heat Haze Distortion', fa: 'اعوجاج گرمایی' },
    description: { en: 'Looping Vector Noise, faded toward the border by a radial mask, becomes a UV offset field and is exported as a distortion (warp) map. A grid preview shows the effect.', fa: 'نویز برداری لوپ، که با ماسک شعاعی به سمت لبه محو می‌شود، به میدان جابه‌جایی UV تبدیل و به‌صورت نقشه اعوجاج (وارپ) خروجی می‌گیرد. شبکه پیش‌نمایش اثر را نشان می‌دهد.' },
    adapt: { en: 'Increase Strength for stronger shimmer, and keep Range on the export equal to the shader’s distortion scale.', fa: 'برای لرزش قوی‌تر قدرت را زیاد کنید و Range خروجی را برابر مقیاس اعوجاج شیدر نگه دارید.' },
    category: ['fire', 'environment', 'flipbooks'], tags: ['distortion', 'warp', 'vector', 'loop', 'flipbook'], difficulty: 'beginner', loops: true,
    settings: { width: 256, height: 256, tiling: 'none', loopLength: 48, fps: 30 },
    preview: 'check', thumb: { node: 'check', frame: 10 },
    build(s) {
      s.node('inputs', 'fade', 'grayscale.gradient', 'Edge Fade', 0, 1, { gtype: 'radial', center: [0.5, 0.5], radius: 0.55, invert: true });
      s.node('inputs', 'grid', 'utils.grid', 'Preview Grid', 0, 2, { pattern: 'square', cells: [10, 10], line_width: 0.08 });
      s.node('motion', 'haze', 'vector.noise', 'Haze Noise', 1, 0, { kind: 'plain', scale: [5, 5], octaves: 2, strength: 0.25, z_cells: 2, seed: 5 }, { mask: 'fade' });
      s.loopEvolution('haze', 'evolution', 48);
      s.node('motion', 'uv', 'utils.vector_to_uv', 'Vector → UV', 2, 0, { amount: 0.03 }, { input: 'haze' });
      s.node('shape', 'check', 'utils.transform', 'Warped Grid Preview', 3, 2, {}, { input: 'grid', uv: 'uv' });
      s.node('output', 'warp', 'export.warp', 'Export Distortion Map', 3, 0, { range: 0.06 }, { input: 'uv' });
      s.flipExport('output', 'warpFlip', 'export.warp', 'Export Distortion Flipbook', 4, 0, 16, 4, 4, { range: 0.06 }, { input: 'uv' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 11 */
  {
    id: 'motion_vector_showcase',
    name: { en: 'Motion Vector Showcase', fa: 'نمایش بردار حرکت' },
    description: { en: 'A 12-frame looping flipbook (spinning star + orbiting dot) gets Motion Vectors generated, then Motion Vector Interpolate expands it to 48 smooth frames. The vector flipbook is exported with a sidecar JSON.', fa: 'یک فلیپ‌بوک لوپ ۱۲ فریمی (ستاره چرخان + نقطه در مدار) بردار حرکت می‌گیرد و Motion Vector Interpolate آن را به ۴۸ فریم نرم می‌رساند. فلیپ‌بوک برداری همراه فایل JSON جانبی خروجی می‌گیرد.' },
    adapt: { en: 'Replace the star and orbit with your own 12-frame animation, then raise Count. In the engine use the vector sheet for frame blending with Motion Vector Scale as in the sidecar.', fa: 'ستاره و مدار را با انیمیشن ۱۲ فریمی خودتان جایگزین و سپس Count را زیاد کنید. در موتور شیت برداری را با مقیاس ذکرشده در JSON جانبی برای ترکیب فریم‌ها به‌کار ببرید.' },
    category: ['flipbooks', 'simulation'], tags: ['motion', 'vector', 'flipbook', 'loop'], difficulty: 'advanced', loops: true,
    settings: { width: 256, height: 256, tiling: 'none', loopLength: 12, fps: 30 },
    preview: 'interp', thumb: { node: 'tone', frame: 3 },
    tour: [{ node: 'sheet', text: { en: 'The source flipbook: 12 frames, 4×3.', fa: 'فلیپ‌بوک منبع: ۱۲ فریم، ۴×۳.' } }, { node: 'mv', text: { en: 'Generate motion vectors between frames.', fa: 'تولید بردار حرکت بین فریم‌ها.' } }, { node: 'interp', text: { en: 'Expand to 48 frames.', fa: 'گسترش به ۴۸ فریم.' } }],
    build(s) {
      s.node('inputs', 'star', 'grayscale.shape', 'Spinning Star', 0, 0, { shape: 'star', sides: 5, pinch: 0.5, size: [0.4, 0.4], position: [0.5, 0.5], softness: 0.15 });
      s.ramp01('star', 'rotation', 0, 72, 12);
      s.node('inputs', 'orb', 'grayscale.shape', 'Orbiting Dot', 0, 1, { shape: 'circle', size: [0.16, 0.16], position: [0.5, 0.15], softness: 0.3 });
      s.anim('orb', 'position', [[0, [0.5, 0.15]], [3, [0.85, 0.5]], [6, [0.5, 0.85]], [9, [0.15, 0.5]], [12, [0.5, 0.15]]], { pre: 'cycle', post: 'cycle', interp: 'linear' });
      s.node('shape', 'merge', 'utils.blend', 'Star + Dot', 1, 0, { blend_type: 'max' }, { foreground: 'orb', background: 'star' });
      s.node('color', 'tone', 'color.ramp', 'Tone', 2, 0, { gradient: CYAN_G }, { input: 'merge' });
      s.node('output', 'sheet', 'utils.sheet_encode', 'Source Sheet 4×3', 3, 0, { frames: 12, auto_grid: false, cols: 4, rows: 3, range: 'loop' }, { input: 'tone' });
      s.node('motion', 'mv', 'vector.motion_generate', 'Motion Generate', 4, 0, { method: 'fast', max_disp: 32, loop_wrap: true }, { flipbook: 'sheet.flipbook' });
      s.node('motion', 'interp', 'vector.motion_interpolate', 'Motion Interpolate ×4', 5, 0, { mode: 'count', count: 48, loop_wrap: true }, { flipbook: 'sheet.flipbook', motion: 'mv.motion' });
      s.node('output', 'exportVec', 'export.motion_vector', 'Export Vector Flipbook (+JSON)', 5, 1, { mv_cols: 4, mv_rows: 3, mv_frames: 12, mv_fps: 30, fb_json: true }, { input: 'mv.sheet' });
      s.node('output', 'exportSheet', 'export.color', 'Export 48-frame Sheet', 6, 0, { alpha: true }, { input: 'interp.sheet' });
    },
  },
];

