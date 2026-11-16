import { LAVA_G, grad, type SampleSpec } from './kit';

/** Samples 18-22: texture / game-ready kits and the two beginner tutorials. */
const NOISE_G = grad([[0, [0.04, 0.05, 0.08, 1]], [0.5, [0.25, 0.45, 0.7, 1]], [1, [0.95, 0.98, 1, 1]]]);
const SCORCH_G = grad([[0, [0, 0, 0, 0]], [1, [0.02, 0.02, 0.02, 0.85]]]);

export const TEX_SAMPLES: SampleSpec[] = [
  /* ------------------------------------------------------------------------------------------ 18 */
  {
    id: 'tileable_lava_energy',
    name: { en: 'Tileable Lava Energy', fa: 'گدازه انرژی کاشی‌پذیر' },
    description: { en: 'Fractal cells and Worley cracks are flow-map advected by a curl Vector Noise for a seamless loop. Exports height, normal and an emissive mask with the Unreal / Unity / Godot presets; a 4×4 tiling preview is included.', fa: 'سلول‌های فراکتال و ترک‌های ورلی با نویز برداری کرل به‌صورت فلوم‌پ جاری می‌شوند و لوپ بی‌درز می‌سازند. خروجی ارتفاع، نرمال و ماسک نورانی با پریست‌های Unreal / Unity / Godot؛ پیش‌نمایش کاشی ۴×۴ هم هست.' },
    adapt: { en: 'Change the export Engine on each export node, raise Normal strength, or tint the Lava gradient. Keep tiling on.', fa: 'موتور (Engine) هر گره خروجی را تغییر دهید، قدرت نرمال را زیاد کنید یا گرادیان گدازه را رنگ کنید. کاشی‌کاری را روشن نگه دارید.' },
    category: ['environment', 'tiling', 'flipbooks'], tags: ['lava', 'tileable', 'loop', 'normal', 'game', 'flipbook'], difficulty: 'advanced', loops: true,
    settings: { width: 512, height: 512, tiling: 'both', loopLength: 64, fps: 30 },
    preview: 'color', thumb: { node: 'color', frame: 16 },
    tour: [{ node: 'adv', text: { en: 'Flow-map advection loops with Phase 0 → 1.', fa: 'ادوکشن فلوم‌پ با فاز ۰ تا ۱ لوپ می‌شود.' } }, { node: 'exportHeight', text: { en: 'Three exports, three engine presets.', fa: 'سه خروجی، سه پریست موتور.' } }],
    build(s) {
      s.node('inputs', 'cells', 'grayscale.fractal', 'Lava Cells', 0, 0, { scale: [3, 3], seed: 2, octaves: 3 });
      s.node('inputs', 'cracks', 'grayscale.noise', 'Cracks', 0, 1, { noise_type: 'worley_f2f1', scale: [5, 5], seed: 3 });
      s.node('inputs', 'flow', 'vector.noise', 'Curl Flow', 0, 2, { kind: 'curl', scale: [2, 2], strength: 0.2, z_cells: 2, seed: 5 });
      s.loopEvolution('flow', 'evolution', 64);
      s.node('shape', 'base', 'utils.blend', 'Cells × Cracks', 1, 0, { blend_type: 'multiply' }, { foreground: 'cracks', background: 'cells' });
      s.node('motion', 'adv', 'vector.advect', 'Looping Advect', 2, 0, { mode: 'flowmap', strength: 0.15, phase: 0, steps: 8 }, { input: 'base', vector: 'flow' });
      s.ramp01('adv', 'phase', 0, 1, 64);
      s.node('shape', 'height', 'utils.levels', 'Height', 3, 0, { in_low: 0.05, in_high: 0.9 }, { input: 'adv' });
      s.node('shape', 'normal', 'normal.create', 'Normal Create', 4, 0, { strength: 5 }, { input: 'height' });
      s.node('shape', 'emis', 'utils.levels', 'Emissive Mask', 3, 1, { in_low: 0.3, in_high: 0.8, out_low: 1, out_high: 0 }, { input: 'adv' });
      s.node('color', 'color', 'color.ramp', 'Lava Ramp', 4, 1, { gradient: LAVA_G }, { input: 'emis' });
      s.node('shape', 'tile4', 'utils.tile', 'Tiling Check 4×4', 4, 2, { tiles: [4, 4] }, { input: 'height' });
      s.node('output', 'exportHeight', 'export.mask', 'Export Height (Unreal)', 5, 0, { engine: 'unreal', depth: '16' }, { input: 'height' });
      s.node('output', 'exportNormal', 'export.normal', 'Export Normal (Unity)', 5, 1, { engine: 'unity' }, { input: 'normal' });
      s.node('output', 'exportEmissive', 'export.mask', 'Export Emissive Mask (Godot)', 5, 2, { engine: 'godot' }, { input: 'emis' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 19 */
  {
    id: 'sprite_pack',
    name: { en: 'Sprite Pack', fa: 'بسته اسپرایت' },
    description: { en: 'A flare, a spark, a soft glow and a smoke blob live in one 2×2 atlas. The atlas feeds a Fractal through its Atlas input to scatter random sprites, and the four sprites are also channel-packed into RGBA.', fa: 'یک فلر، یک جرقه، یک درخشش نرم و یک لکه دود در یک اطلس ۲×۲ قرار دارند. اطلس از طریق ورودی Atlas به یک Fractal می‌رسد تا اسپرایت‌های تصادفی پخش کند و چهار اسپرایت در RGBA هم کانال‌پک می‌شوند.' },
    adapt: { en: 'Move a sprite by changing its position / center, or replace a generator with your own mask. The packed export keeps flare = R, spark = G, glow = B, smoke = A.', fa: 'با تغییر موقعیت / مرکز اسپرایت را جابه‌جا کنید یا مولد را با ماسک خودتان عوض کنید. خروجی پک‌شده: فلر = R، جرقه = G، درخشش = B، دود = A.' },
    category: ['environment', 'flipbooks'], tags: ['sprites', 'atlas', 'packed', 'game'], difficulty: 'intermediate',
    settings: { width: 1024, height: 1024, tiling: 'none', loopLength: 64, fps: 30 },
    preview: 'atlas', thumb: { node: 'atlas' },
    tour: [{ node: 'atlas', text: { en: 'All four sprites in one atlas.', fa: 'هر چهار اسپرایت در یک اطلس.' } }, { node: 'scatter', text: { en: 'Fractal reads the atlas through its Atlas input.', fa: 'Fractal اطلس را از ورودی Atlas می‌خواند.' } }],
    build(s) {
      s.node('shape', 'flare', 'grayscale.starburst', 'Flare', 0, 0, { center: [0.25, 0.75], radius: 0.22, rays: 4 });
      s.node('shape', 'spark', 'grayscale.shape', 'Spark', 0, 1, { shape: 'star', sides: 4, pinch: 0.7, size: [0.3, 0.3], position: [0.75, 0.75], softness: 0.4 });
      s.node('shape', 'glow', 'grayscale.gradient', 'Soft Glow', 0, 2, { gtype: 'radial', center: [0.25, 0.25], radius: 0.22, invert: true });
      s.node('inputs', 'blobN', 'grayscale.noise', 'Smoke Noise', 0, 3, { noise_type: 'perlin', scale: [6, 6], octaves: 4, seed: 7 });
      s.node('shape', 'blobG', 'grayscale.gradient', 'Smoke Falloff', 0, 4, { gtype: 'radial', center: [0.75, 0.25], radius: 0.22, invert: true });
      s.node('shape', 'smoke', 'utils.blend', 'Smoke Blob', 1, 3, { blend_type: 'multiply' }, { foreground: 'blobN', background: 'blobG' });
      s.node('shape', 'a1', 'utils.blend', 'Flare + Spark', 1, 0, { blend_type: 'max' }, { foreground: 'spark', background: 'flare' });
      s.node('shape', 'a2', 'utils.blend', '+ Glow', 2, 1, { blend_type: 'max' }, { foreground: 'glow', background: 'a1' });
      s.node('shape', 'atlas', 'utils.blend', '+ Smoke = Atlas', 3, 2, { blend_type: 'max' }, { foreground: 'smoke', background: 'a2' });
      s.node('shape', 'scatter', 'grayscale.fractal', 'Sprite Scatter (Atlas input)', 4, 0, { atlas_size: [2, 2], scale: [3, 3], seed: 5 }, { pattern: 'atlas' });
      s.node('output', 'pack', 'utils.rgba_merge', 'Channel Pack', 4, 2, {}, { r: 'flare', g: 'spark', b: 'glow', a: 'smoke' });
      s.node('output', 'exportAtlas', 'export.mask', 'Export Atlas', 5, 0, { depth: '16' }, { input: 'atlas' });
      s.node('output', 'exportPack', 'export.color', 'Export Packed RGBA', 5, 2, { alpha: true, color_space: 'linear' }, { input: 'pack' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 20 */
  {
    id: 'hit_impact_decals',
    name: { en: 'Hit Impact Decal Set', fa: 'مجموعه دکال برخورد' },
    description: { en: 'An impact flash and shock ring, Worley crack lines and a scorch mask, packed as RGBA (R flash, G cracks, B scorch, A opacity) and exported as a 4×4 flipbook.', fa: 'فلش و حلقه شوک برخورد، خطوط ترک ورلی و ماسک سوختگی، کانال‌پک به‌صورت RGBA (R فلش، G ترک، B سوختگی، A کدری) و خروجی فلیپ‌بوک ۴×۴.' },
    adapt: { en: 'Change the crack Scale / seed per material, or time the flash decay with the Intensity keyframes.', fa: 'مقیاس و seed ترک‌ها را برای هر متریال تغییر دهید یا محو شدن فلش را با کلیدهای Intensity زمان‌بندی کنید.' },
    category: ['weapons', 'flipbooks'], tags: ['impact', 'decal', 'packed', 'flipbook'], difficulty: 'intermediate',
    settings: { width: 256, height: 256, tiling: 'none', loopLength: 16, fps: 30 },
    preview: 'pack', thumb: { node: 'pack', frame: 3 },
    build(s) {
      s.node('shape', 'flash', 'grayscale.starburst', 'Impact Flash', 0, 0, { center: [0.5, 0.5], radius: 0.45, rays: 8, intensity: 2 });
      s.anim('flash', 'intensity', [[0, 2], [15, 0.2]], { interp: 'linear' });
      s.node('shape', 'ring', 'grayscale.ripple', 'Shock Ring', 0, 1, { center: [0.5, 0.5], radius: 0.05, width: 0.04, count: 1 });
      s.anim('ring', 'radius', [[0, 0.05], [15, 0.45]], { interp: 'linear' });
      s.node('inputs', 'crackN', 'grayscale.noise', 'Voronoi Cracks', 0, 2, { noise_type: 'cracks', scale: [6, 6], seed: 8 });
      s.node('inputs', 'fall', 'grayscale.gradient', 'Radial Falloff', 0, 3, { gtype: 'radial', center: [0.5, 0.5], radius: 0.5, invert: true });
      s.node('inputs', 'scorchN', 'grayscale.noise', 'Scorch Noise', 0, 4, { noise_type: 'perlin', scale: [4, 4], octaves: 4, seed: 12 });
      s.node('shape', 'burst', 'utils.blend', 'Flash + Ring', 1, 0, { blend_type: 'max' }, { foreground: 'ring', background: 'flash' });
      s.node('shape', 'cracks', 'utils.blend', 'Cracks × Falloff', 1, 2, { blend_type: 'multiply' }, { foreground: 'crackN', background: 'fall' });
      s.node('shape', 'scorch', 'utils.blend', 'Scorch × Falloff', 1, 4, { blend_type: 'multiply' }, { foreground: 'scorchN', background: 'fall' });
      s.node('shape', 'alpha', 'utils.blend', 'Opacity', 2, 3, { blend_type: 'max' }, { foreground: 'scorch', background: 'burst' });
      s.node('color', 'pack', 'utils.rgba_merge', 'Pack RGBA', 3, 1, {}, { r: 'burst', g: 'cracks', b: 'scorch', a: 'alpha' });
      s.node('color', 'scorchTint', 'color.ramp', 'Scorch Preview', 3, 4, { gradient: SCORCH_G }, { input: 'scorch' });
      s.flipExport('output', 'exportPack', 'export.color', 'Export Packed Flipbook', 4, 1, 16, 4, 4, { alpha: true, color_space: 'linear' }, { input: 'pack' });
    },
  },
  /* ------------------------------------------------------------------------------------------ 21 */
  {
    id: 'hello_nodes',
    name: { en: 'Hello Nodes (tutorial)', fa: 'سلام گره‌ها (آموزش)' },
    description: { en: 'The smallest useful graph: Noise → Levels → Ramp → Export. Four numbered comment frames explain each step.', fa: 'کوچک‌ترین گراف مفید: نویز ← Levels ← رمپ ← خروجی. چهار فریم شماره‌دار هر مرحله را توضیح می‌دهند.' },
    adapt: { en: 'Click a node and change a parameter: the preview updates live. Add a Blur or a second Noise between the steps.', fa: 'روی یک گره کلیک و پارامتر را تغییر دهید: پیش‌نمایش زنده به‌روز می‌شود. بین مراحل یک Blur یا نویز دوم اضافه کنید.' },
    category: ['beginner'], tags: ['tutorial', 'tileable'], difficulty: 'beginner',
    settings: { width: 512, height: 512, tiling: 'both', loopLength: 64, fps: 30 },
    preview: 'ramp', thumb: { node: 'ramp' }, roleFrames: false,
    frames: {
      step1: { en: '1 · Noise makes a pattern', fa: '۱ · نویز یک الگو می‌سازد' },
      step2: { en: '2 · Levels sets contrast', fa: '۲ · Levels کنتراست را تنظیم می‌کند' },
      step3: { en: '3 · Ramp adds colour', fa: '۳ · رمپ رنگ اضافه می‌کند' },
      step4: { en: '4 · Export saves a file', fa: '۴ · خروجی فایل را ذخیره می‌کند' },
    },
    build(s) {
      s.node('inputs', 'noise', 'grayscale.noise', 'Noise', 0, 0, { noise_type: 'perlin', scale: [4, 4], octaves: 4, seed: 1 });
      s.node('shape', 'levels', 'utils.levels', 'Levels', 1, 0, { in_low: 0.25, in_high: 0.75 }, { input: 'noise' });
      s.node('color', 'ramp', 'color.ramp', 'Ramp', 2, 0, { gradient: NOISE_G }, { input: 'levels' });
      s.node('output', 'export', 'export.color', 'Export', 3, 0, { alpha: false }, { input: 'ramp' });
      s.frame('step1', '#5aa7e0', 'noise');
      s.frame('step2', '#6cc080', 'levels');
      s.frame('step3', '#c070d0', 'ramp');
      s.frame('step4', '#e06c6c', 'export');
    },
  },
  /* ------------------------------------------------------------------------------------------ 22 */
  {
    id: 'tiling_check_tutorial',
    name: { en: 'Tiling Check (tutorial)', fa: 'بررسی کاشی‌کاری (آموزش)' },
    description: { en: 'The same noise generated with Tiling off, on, and horizontal-only, each shown as a 3×3 tiling preview so you can see the seams. Node tiling modes override the graph setting.', fa: 'همان نویز با کاشی‌کاری خاموش، روشن و فقط افقی، که هرکدام به‌صورت پیش‌نمایش ۳×۳ نشان داده می‌شود تا درزها دیده شوند. حالت کاشی‌کاری گره تنظیم گراف را بازنویسی می‌کند.' },
    adapt: { en: 'In any node: Texture tab → Tiling → Absolute. Always check the 3×3 preview before exporting a tiling texture.', fa: 'در هر گره: تب Texture ← Tiling ← Absolute. پیش از خروجی گرفتن از تکسچر کاشی‌پذیر همیشه پیش‌نمایش ۳×۳ را ببینید.' },
    category: ['beginner', 'tiling'], tags: ['tutorial', 'tiling', 'tileable'], difficulty: 'beginner',
    settings: { width: 512, height: 512, tiling: 'both', loopLength: 64, fps: 30 },
    preview: 'viewB', thumb: { node: 'viewB' }, roleFrames: false,
    frames: {
      off: { en: 'A · Tiling off: seams are visible', fa: 'الف · کاشی‌کاری خاموش: درزها دیده می‌شوند' },
      on: { en: 'B · Tiling on: seamless', fa: 'ب · کاشی‌کاری روشن: بدون درز' },
      horiz: { en: 'C · Horizontal only: seams on top / bottom', fa: 'پ · فقط افقی: درز در بالا و پایین' },
    },
    build(s) {
      const n = { noise_type: 'perlin', scale: [3, 3], octaves: 3, seed: 21 };
      s.node('inputs', 'noiseA', 'grayscale.noise', 'Noise (tiling off)', 0, 0, { ...n, tex_tiling_mode: 'absolute', tex_tiling: 'none' });
      s.node('inputs', 'noiseB', 'grayscale.noise', 'Noise (tiling on)', 0, 2, { ...n, tex_tiling_mode: 'absolute', tex_tiling: 'both' });
      s.node('inputs', 'noiseC', 'grayscale.noise', 'Noise (horizontal)', 0, 4, { ...n, tex_tiling_mode: 'absolute', tex_tiling: 'x' });
      s.node('shape', 'viewA', 'utils.tile', '3×3 Preview A', 1, 0, { tiles: [3, 3] }, { input: 'noiseA' });
      s.node('shape', 'viewB', 'utils.tile', '3×3 Preview B', 1, 2, { tiles: [3, 3] }, { input: 'noiseB' });
      s.node('shape', 'viewC', 'utils.tile', '3×3 Preview C', 1, 4, { tiles: [3, 3] }, { input: 'noiseC' });
      s.node('output', 'export', 'export.mask', 'Export Tileable Noise', 2, 2, {}, { input: 'noiseB' });
      s.frame('off', '#e06c6c', 'noiseA', 'viewA');
      s.frame('on', '#6cc080', 'noiseB', 'viewB', 'export');
      s.frame('horiz', '#e0a45a', 'noiseC', 'viewC');
    },
  },
];
