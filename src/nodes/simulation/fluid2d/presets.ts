import type { ParamValues } from '../../../engine/params/schema';

/**
 * Fluid 2D node presets (parameter overrides over the defaults). Values are chosen by reasoning about the units
 * (tile fractions, seconds, 30 fps): emission = amount / second, buoyancy = beta * (T - ambient) tile / s^2, expansion = cells / frame^-1 source.
 * `id` is stable; names / descriptions are English + Persian (shown in the simulation panel and the Node Gallery).
 */
export interface FluidPreset {
  id: string;
  name: { en: string; fa: string };
  description: { en: string; fa: string };
  params: ParamValues;
}

const SMOKE: [number, number, number, number] = [0.82, 0.82, 0.86, 1];

export const FLUID_PRESETS: FluidPreset[] = [
  {
    id: 'smoke_puff',
    name: { en: 'Smoke Puff', fa: 'پف دود' },
    description: { en: 'One short burst that billows up and fades. One-shot.', fa: 'یک انفجار کوتاه دود که بالا می‌رود و محو می‌شود. تک‌پخش.' },
    params: { em1_on: true, em1_pos: [0.5, 0.72], em1_radius: 0.07, em1_density: 40, em1_temperature: 6, em1_speed: 0.5, em1_mode: 'burst', em1_burst: 5, buoy_temp: 0.6, vort_eps: 6, turb_strength: 0.8, diss_density: 0.25, cooling: 1.5, boundary: 'open', loop_mode: 'none', out_smoke_color: SMOKE },
  },
  {
    id: 'rising_smoke',
    name: { en: 'Rising Smoke', fa: 'دود صعودی' },
    description: { en: 'Continuous smoke column, loops with a cross-fade.', fa: 'ستون دود پیوسته؛ با کراس‌فید لوپ می‌شود.' },
    params: { em1_on: true, em1_pos: [0.5, 0.9], em1_radius: 0.06, em1_density: 8, em1_temperature: 3, em1_speed: 0.15, buoy_temp: 1, vort_eps: 4, turb_strength: 0.6, turb_scale: 3, drag: 0.1, boundary: 'open', loop_mode: 'crossfade', loop_frames: 120, blend_frames: 24, out_smoke_color: SMOKE },
  },
  {
    id: 'candle_fire',
    name: { en: 'Candle / Torch Fire', fa: 'شعله شمع / مشعل' },
    description: { en: 'Narrow flame from fuel with a little smoke; black-body colours.', fa: 'شعله باریک از سوخت با کمی دود؛ رنگ جسم سیاه.' },
    params: { em1_on: true, em1_pos: [0.5, 0.82], em1_radius: 0.035, em1_density: 0, em1_temperature: 4, em1_fuel: 8, em1_speed: 0.2, burn_rate: 8, ignition: 0.5, heat_release: 5, expansion: 0.4, cooling: 2.5, smoke_gen: 0.35, soot_gen: 0.2, buoy_temp: 1.6, vort_eps: 6, turb_strength: 1, turb_scale: 6, diss_density: 0.5, boundary: 'open', loop_mode: 'crossfade', loop_frames: 90, blend_frames: 20 },
  },
  {
    id: 'campfire',
    name: { en: 'Campfire', fa: 'آتش کمپ' },
    description: { en: 'Wide base fire with flickering tongues and rising smoke.', fa: 'آتش با قاعده پهن، زبانه‌های لرزان و دود صعودی.' },
    params: { em1_on: true, em1_shape: 'line', em1_pos: [0.38, 0.86], em1_pos2: [0.62, 0.86], em1_radius: 0.03, em1_density: 0, em1_temperature: 5, em1_fuel: 10, em1_speed: 0.2, burn_rate: 7, heat_release: 5, expansion: 0.5, cooling: 2.2, smoke_gen: 0.5, soot_gen: 0.3, buoy_temp: 1.4, vort_eps: 8, turb_strength: 1.5, turb_scale: 5, drag: 0.1, diss_density: 0.35, boundary: 'open', loop_mode: 'crossfade', loop_frames: 96, blend_frames: 24 },
  },
  {
    id: 'explosion',
    name: { en: 'Explosion', fa: 'انفجار' },
    description: { en: 'Fast expanding fireball with a pressure wave (divergence source) and smoke. One-shot.', fa: 'گلوله آتشین با انبساط سریع، موج فشار و دود. تک‌پخش.' },
    params: { em1_on: true, em1_pos: [0.5, 0.62], em1_radius: 0.1, em1_density: 20, em1_temperature: 30, em1_fuel: 60, em1_expand: 30, em1_speed: 0, em1_mode: 'burst', em1_burst: 8, burn_rate: 14, heat_release: 10, expansion: 3, cooling: 2, smoke_gen: 0.6, soot_gen: 0.4, buoy_temp: 0.5, vort_eps: 10, turb_strength: 1.5, max_speed: 6, max_temp: 30, max_fuel: 20, max_density: 8, boundary: 'open', loop_mode: 'none', quality: 'high' },
  },
  {
    id: 'fireball',
    name: { en: 'Fireball', fa: 'گلوله آتش' },
    description: { en: 'A rising ball of fire trailing smoke. One-shot.', fa: 'گلوله آتش صعودی با دنباله دود. تک‌پخش.' },
    params: { em1_on: true, em1_pos: [0.5, 0.7], em1_radius: 0.08, em1_density: 10, em1_temperature: 15, em1_fuel: 30, em1_expand: 10, em1_speed: 0.3, em1_mode: 'burst', em1_burst: 12, burn_rate: 9, heat_release: 8, expansion: 1.5, cooling: 2, smoke_gen: 0.5, soot_gen: 0.3, buoy_temp: 1.2, vort_eps: 8, turb_strength: 1.2, max_speed: 5, max_temp: 20, boundary: 'open', loop_mode: 'none' },
  },
  {
    id: 'ink_in_water',
    name: { en: 'Ink in Water', fa: 'جوهر در آب' },
    description: { en: 'Slow viscous swirling ink, no buoyancy. Tileable.', fa: 'جوهر کند و چسبناک بدون شناوری؛ کاشی‌پذیر.' },
    params: { em1_on: true, em1_pos: [0.3, 0.5], em1_radius: 0.04, em1_density: 60, em1_temperature: 0, em1_dir: 0, em1_speed: 1, em1_mode: 'burst', em1_burst: 4, buoy_temp: 0, vort_eps: 0, viscosity: 0.0002, damping: 0.3, diss_density: 0.02, cooling: 0, boundary: 'periodic', loop_mode: 'none', out_opacity: 3, out_smoke_color: [0.1, 0.3, 0.9, 1] },
  },
  {
    id: 'magic_swirl',
    name: { en: 'Magic Swirl', fa: 'چرخش جادویی' },
    description: { en: 'Glowing vortex that keeps spinning; periodic and loopable.', fa: 'گرداب درخشان که می‌چرخد؛ دوره‌ای و قابل لوپ.' },
    params: { em1_on: true, em1_pos: [0.5, 0.5], em1_radius: 0.12, em1_density: 5, em1_temperature: 0, em1_speed: 0, buoy_temp: 0, swirl_pos: [0.5, 0.5], swirl_radius: 0.2, swirl_strength: 6, vort_eps: 12, drag: 0.2, turb_strength: 0.5, turb_speed: 1, boundary: 'periodic', loop_mode: 'periodic', loop_frames: 120, diss_density: 0.4, out_smoke_color: [0.6, 0.35, 1, 1], out_opacity: 3 },
  },
  {
    id: 'wind_wisps',
    name: { en: 'Wind Wisps', fa: 'رشته‌های باد' },
    description: { en: 'Thin streaks carried by a gusty wind; tiles horizontally.', fa: 'رشته‌های نازک که باد وزنده می‌برد؛ افقی کاشی‌پذیر.' },
    params: { em1_on: true, em1_shape: 'line', em1_pos: [0.05, 0.2], em1_pos2: [0.05, 0.8], em1_radius: 0.02, em1_density: 3, em1_temperature: 0, em1_dir: 0, em1_speed: 0.6, wind_strength: 1.2, buoy_temp: 0, vort_eps: 5, turb_strength: 1.8, turb_scale: 5, diss_density: 0.4, boundary: 'periodic', loop_mode: 'periodic', loop_frames: 120 },
  },
  {
    id: 'dust_burst',
    name: { en: 'Dust Burst', fa: 'انفجار گرد و غبار' },
    description: { en: 'Heavy dust thrown outwards that settles. One-shot.', fa: 'گرد و غبار سنگین که به بیرون پرتاب شده و ته‌نشین می‌شود. تک‌پخش.' },
    params: { em1_on: true, em1_pos: [0.5, 0.8], em1_radius: 0.07, em1_density: 40, em1_temperature: 0, em1_expand: 12, em1_speed: 0, em1_mode: 'burst', em1_burst: 3, buoy_density: 0.4, buoy_temp: 0, gravity: [0, 0.2], drag: 1.2, vort_eps: 3, turb_strength: 1, diss_density: 0.5, boundary: 'open', loop_mode: 'none', out_smoke_color: [0.62, 0.52, 0.4, 1] },
  },
  {
    id: 'steam',
    name: { en: 'Steam', fa: 'بخار' },
    description: { en: 'Light, fast-fading vapour curling in a soft breeze.', fa: 'بخار سبک و زودمحو که در نسیم می‌پیچد.' },
    params: { em1_on: true, em1_pos: [0.5, 0.9], em1_radius: 0.05, em1_density: 5, em1_temperature: 2, em1_speed: 0.2, wind_strength: 0.3, buoy_temp: 0.7, vort_eps: 8, turb_strength: 1.2, turb_scale: 6, diss_density: 0.6, boundary: 'open', loop_mode: 'crossfade', loop_frames: 90, blend_frames: 20, out_opacity: 1.5, out_smoke_color: [0.95, 0.96, 1, 1] },
  },
];

export const presetById = (id: string): FluidPreset | undefined => FLUID_PRESETS.find((p) => p.id === id);
