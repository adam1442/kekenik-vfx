// utils.blur — per-pixel radius blend. t0 = source (sigma 0), t1..t5 = gaussian levels with sigma = S * {1/16, 1/8, 1/4, 1/2, 1},
// t6 = Gray radius modulation texture. The local radius fraction f = modulate(1, m, k) in [0,1] picks the two nearest
// levels and interpolates linearly between them (blending gaussians is an approximation; exact at the level sigmas).
#include "sampling"
#include "util"

fn level(i: i32, uv: vec2f) -> vec4f {
  switch (i) {
    case 0: { return tex_sample(t0, uv, F.tile, F.filter_mode); }
    case 1: { return tex_sample(t1, uv, F.tile, F.filter_mode); }
    case 2: { return tex_sample(t2, uv, F.tile, F.filter_mode); }
    case 3: { return tex_sample(t3, uv, F.tile, F.filter_mode); }
    case 4: { return tex_sample(t4, uv, F.tile, F.filter_mode); }
    default: { return tex_sample(t5, uv, F.tile, F.filter_mode); }
  }
}

fn shade(uv: vec2f) -> vec4f {
  let m = tex_sample(t6, uv, F.tile, F.filter_mode).r;
  let f = clamp(modulate(1.0, m, P.mod_k), 0.0, 1.0);
  var fr = array<f32, 6>(0.0, 0.0625, 0.125, 0.25, 0.5, 1.0);
  var i = 0;
  for (var j = 0; j < 5; j = j + 1) {
    if (f >= fr[j]) {
      i = j;
    }
  }
  let i1 = min(i + 1, 5);
  let span = max(fr[i1] - fr[i], 0.000001);
  let w = clamp((f - fr[i]) / span, 0.0, 1.0);
  return mix(level(i, uv), level(i1, uv), w);
}
