import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * color.blackbody: "Temperature / Blackbody ramp". Gray input t (0..1) -> temperature K = mix(kelvin_min, kelvin_max, t^curve)
 * -> physically inspired blackbody colour (Tanner Helland's Planckian-locus fit, converted to linear) multiplied by an HDR emission
 * `intensity * t^emission_curve` (hot = bright, cool = dark: the core goes above 1, the tips fade to black). Alpha = smoothstep(alpha_lo,
 * alpha_hi, t) or 1. Optional filmic tonemap for LDR preview. HDR-safe (no clamping of the output). Per-pixel, tiling-safe, no time dependence.
 * Parameters: Kelvin range, temperature curve, emission curve, intensity (+ modulation pin), tint, alpha mode, tonemap preview.
 * Limitations: the fit is valid for 1000..40000 K (inputs are clamped to it); it is an artistic ramp, not a spectral renderer.
 */
export const SHADER = defineShader('color_blackbody.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'kelvin_min', type: 'f32' },
  { name: 'kelvin_max', type: 'f32' },
  { name: 'temp_curve', type: 'f32' },
  { name: 'emission_curve', type: 'f32' },
  { name: 'intensity', type: 'f32' },
  { name: 'intensity_mod_k', type: 'f32' },
  { name: 'tint', type: 'vec4f' },
  { name: 'alpha_mode', type: 'u32' },
  { name: 'alpha_lo', type: 'f32' },
  { name: 'alpha_hi', type: 'f32' },
  { name: 'tonemap', type: 'u32' },
]);

/** CPU reference: linear RGB of a blackbody at `kelvin` (same fit as the shader). */
export function blackbodyLinear(kelvin: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (x: number): number => Math.pow(Math.min(255, Math.max(0, x)) / 255, 2.2);
  return [c(r), c(g), c(b)];
}

export default defineNode({
  id: 'color.blackbody',
  version: 1,
  category: 'color',
  title: 'Blackbody / Temperature Ramp',
  description: 'Turns a Gray temperature map into HDR fire colours: Kelvin range, emission curve (hot = bright > 1), tint, alpha from temperature and an optional tonemap preview. The core of every flame, explosion and ember.',
  keywords: ['blackbody', 'temperature', 'kelvin', 'fire', 'flame', 'ember', 'lava', 'hdr', 'emission', 'heat', 'ramp', 'explosion'],
  icon: 'ramp',
  inputs: [{ id: 'input', name: 'Temperature', type: 'gray', tooltip: '0 = cold / transparent, 1 = hottest.' }],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  common: { texture: true, blending: false },
  params: [
    P.float('kelvin_min', 1000, { group: 'Temperature', label: 'Kelvin at 0%', min: 1000, max: 40000, softMax: 6500, step: 10, tooltip: 'Colour temperature of the coolest visible value (1000 K = deep red).' }),
    P.float('kelvin_max', 4200, { group: 'Temperature', label: 'Kelvin at 100%', min: 1000, max: 40000, softMax: 9000, step: 10, animatable: true, tooltip: 'Temperature of the hottest value (4200 K yellow-white, 6500 K white, 9000 K blue-white).' }),
    P.float('temp_curve', 1, { group: 'Temperature', label: 'Temperature curve', min: 0.2, max: 4, softMax: 3, step: 0.01, tooltip: 'Power applied to the input before the Kelvin mapping (above 1 pushes the mid body towards red).' }),
    P.float('emission_curve', 1.6, { group: 'Emission', label: 'Emission curve', min: 0, max: 6, softMax: 3, step: 0.01, tooltip: 'Brightness = Intensity * value^curve: hot areas glow, cool areas fade to black.' }),
    P.float('intensity', 3, { group: 'Emission', min: 0, max: 64, softMax: 12, step: 0.05, animatable: true, modulatable: true, tooltip: 'HDR emission multiplier (the core exceeds 1).' }),
    P.color('tint', [1, 1, 1, 1], { group: 'Emission', hdr: true, animatable: true, tooltip: 'Multiplies the colour (variants: green fire, blue fire ...).' }),
    P.enum('alpha_mode', 'temperature', [{ value: 'opaque', label: 'Opaque (1)' }, { value: 'temperature', label: 'From temperature' }], { group: 'Alpha' }),
    P.float('alpha_lo', 0.02, { group: 'Alpha', label: 'Alpha from', min: 0, max: 1, step: 0.005, visibleIf: (v) => v.alpha_mode === 'temperature' }),
    P.float('alpha_hi', 0.35, { group: 'Alpha', label: 'Alpha to', min: 0, max: 1, step: 0.005, visibleIf: (v) => v.alpha_mode === 'temperature' }),
    P.bool('tonemap', false, { group: 'Preview', label: 'Filmic tonemap (LDR preview)', tooltip: 'Compresses HDR values to 0..1 for previews / LDR export. Leave off for EXR / additive engines.' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [{ name: 'Blue flame', params: { kelvin_min: 3000, kelvin_max: 12000, emission_curve: 1.2 } }, { name: 'Embers', params: { kelvin_max: 2400, intensity: 6 } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Blackbody needs a Temperature input.');
    const p = ctx.params;
    const m = ctx.mod('intensity');
    const out = ctx.tex('color');
    ctx.pass({
      label: 'blackbody',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          kelvin_min: p.num('kelvin_min'),
          kelvin_max: p.num('kelvin_max'),
          temp_curve: p.num('temp_curve'),
          emission_curve: p.num('emission_curve'),
          intensity: p.num('intensity'),
          intensity_mod_k: m.k,
          tint: p.rgba('tint'),
          alpha_mode: p.enumIndex('alpha_mode'),
          alpha_lo: p.num('alpha_lo'),
          alpha_hi: p.num('alpha_hi'),
          tonemap: p.bool('tonemap'),
        },
      },
      textures: [src.tex, m.tex?.tex ?? null],
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});
