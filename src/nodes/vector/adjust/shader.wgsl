// vector.adjust — CPU mirror: adjustVector() in _shared/vectorref.ts
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  var v = vec_sample(t0, uv, F.tile, F.filter_mode);
  if (P.invert_x == 1u) { v.x = -v.x; }
  if (P.invert_y == 1u) { v.y = -v.y; }
  var l = length(v);
  if (l <= max(P.deadzone, 1e-9)) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let d = v / l;
  if (P.power != 1.0) { l = pow(l / max(P.reference, 1e-6), P.power) * P.reference; }
  l = l * P.gain;
  if (P.normalize == 1u) { l = P.length * sign(P.gain); }
  l = max(l, P.min_len * sign(P.gain));
  if (P.max_len > 0.0) { l = clamp(l, -P.max_len, P.max_len); }
  return vec4f(d * l, 0.0, 1.0);
}
