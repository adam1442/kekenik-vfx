// color.blackbody — gray temperature -> HDR blackbody colour. t0 = temperature, t1 = intensity modulation.
// Planckian-locus fit (Tanner Helland) evaluated on temp = K / 100, valid for 1000..40000 K, result converted sRGB -> linear (pow 2.2).
#include "sampling"
#include "util"

fn bb_srgb(k: f32) -> vec3f {
  let t = clamp(k, 1000.0, 40000.0) / 100.0;
  var r = 255.0;
  var g = 255.0;
  var b = 255.0;
  if (t <= 66.0) {
    g = 99.4708025861 * log(t) - 161.1195681661;
    if (t <= 19.0) {
      b = 0.0;
    } else {
      b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
    }
  } else {
    r = 329.698727446 * pow(t - 60.0, -0.1332047592);
    g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
  }
  return clamp(vec3f(r, g, b), vec3f(0.0), vec3f(255.0)) / 255.0;
}

// Narkowicz ACES fit: HDR -> 0..1 (preview only).
fn filmic(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

fn shade(uv: vec2f) -> vec4f {
  let t = clamp(tex_sample(t0, uv, F.tile, F.filter_mode).r, 0.0, 1.0);
  let m = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  let k = mix(P.kelvin_min, P.kelvin_max, pow(t, max(P.temp_curve, 0.01)));
  let lin = pow(bb_srgb(k), vec3f(2.2));
  let power = modulate(P.intensity, m, P.intensity_mod_k) * pow(t, max(P.emission_curve, 0.0));
  var rgb = lin * power * P.tint.rgb;
  var a = P.tint.a;
  if (P.alpha_mode == 1u) {
    a = a * smoothstep(P.alpha_lo, max(P.alpha_hi, P.alpha_lo + 1e-4), t);
  }
  if (P.tonemap == 1u) {
    rgb = filmic(rgb);
  }
  return vec4f(rgb, a);
}
