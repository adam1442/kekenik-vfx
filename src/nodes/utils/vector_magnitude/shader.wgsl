// utils.vector_magnitude
#include "uvfield"
fn shade(uv: vec2f) -> vec4f {
  var m = length(vec_sample(t0, uv, F.tile, F.filter_mode)) / max(P.scale, 1e-6);
  if (P.clamp_out == 1u) { m = clamp(m, 0.0, 1.0); }
  return vec4f(m, 0.0, 0.0, 1.0);
}
