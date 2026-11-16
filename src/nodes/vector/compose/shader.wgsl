// vector.compose — t0 = X, t1 = Y (missing = 0)
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  var v = vec2f(0.0);
  if (P.has_x == 1u) { v.x = tex_sample(t0, uv, F.tile, F.filter_mode).r; }
  if (P.has_y == 1u) { v.y = tex_sample(t1, uv, F.tile, F.filter_mode).r; }
  if (P.centered == 1u) { v = (v - 0.5) * 2.0; }
  return vec4f(v * P.gain, 0.0, 1.0);
}
