// vector.decompose — OUT 0 = x, 1 = y, 2 = length
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  let v = vec_sample(t0, uv, F.tile, F.filter_mode) * P.gain;
  var r = v.x;
  if (OUT == 1) { r = v.y; }
  if (OUT == 2) { return vec4f(length(v), 0.0, 0.0, 1.0); }
  if (P.centered == 1u) { r = r * 0.5 + 0.5; }
  return vec4f(r, 0.0, 0.0, 1.0);
}
