// utils.dissolve — threshold dissolve with burn edge. t0 = order (gradient / shape), t1 = noise (optional), t2 = progress modulation.
// P.which selects the output: 0 mask, 1 edge band, 2 heat. See definition.ts for the formulas.
#include "sampling"
#include "util"

fn ss01(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / max(e1 - e0, 1e-6), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn shade(uv: vec2f) -> vec4f {
  var v = clamp(tex_sample(t0, uv, F.tile, F.filter_mode).r, 0.0, 1.0);
  if (P.has_noise == 1u) {
    let n = pow(clamp(tex_sample(t1, uv, F.tile, F.filter_mode).r, 0.0, 1.0), max(P.noise_contrast, 0.01));
    v = mix(v, n, clamp(P.noise_amount, 0.0, 1.0));
  }
  let m = tex_sample(t2, uv, F.tile, F.filter_mode).r;
  var prog = clamp(modulate(P.progress, m, P.progress_mod_k), 0.0, 1.0);
  if (P.reverse == 1u) {
    prog = 1.0 - prog;
  }
  let s = max(P.softness, 1e-4);
  let e = max(P.edge_width, 0.0);
  let f = prog * (1.0 + s + e) - (s + e);
  let mask = ss01(f, f + s, v);
  var r = mask;
  if (P.which == 1u) {
    r = mask * (1.0 - ss01(f + e, f + e + s, v));
  } else if (P.which == 2u) {
    r = 1.0 - clamp((v - f) / max(e + s, 1e-4), 0.0, 1.0);
  }
  return vec4f(r, 0.0, 0.0, 1.0);
}
