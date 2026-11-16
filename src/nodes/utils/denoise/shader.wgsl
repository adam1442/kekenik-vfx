// utils.denoise — Non-local means with a small patch (cross of 5 taps or 3x3), search window (2R+1)^2.
// weight = exp(-max(d - 2 sigma^2, 0) / h^2), d = mean squared patch distance. Wrap-aware (tex_load + F.tile).
#include "sampling"

fn patch_dist(p: vec2i, q: vec2i) -> f32 {
  var d = 0.0;
  var n = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      if (P.patch_kind == 0u && i != 0 && j != 0) {
        continue;
      }
      let a = tex_load(t0, p + vec2i(i, j), F.tile);
      let b = tex_load(t0, q + vec2i(i, j), F.tile);
      let e = a - b;
#if COLOR == 1
      d = d + dot(e.rgb, e.rgb) / 3.0;
#else
      d = d + e.r * e.r;
#endif
      n = n + 1.0;
    }
  }
  return d / n;
}

fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  let c0 = tex_load(t0, p, F.tile);
  let h2 = max(P.strength * P.strength, 0.000001);
  let s2 = 2.0 * P.sigma * P.sigma;
  var acc = c0;
  var wsum = 1.0;
  for (var j = -P.search; j <= P.search; j = j + 1) {
    for (var i = -P.search; i <= P.search; i = i + 1) {
      if (i == 0 && j == 0) {
        continue;
      }
      let q = p + vec2i(i, j);
      let d = patch_dist(p, q);
      let w = exp(-max(d - s2, 0.0) / h2);
      acc = acc + tex_load(t0, q, F.tile) * w;
      wsum = wsum + w;
    }
  }
  return mix(c0, acc / wsum, P.amount);
}
