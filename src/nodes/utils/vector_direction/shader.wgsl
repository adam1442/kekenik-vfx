// utils.vector_direction: turns in 0..1 (0 = +x, clockwise on screen because y points down). CPU mirror: vecAngle01()
#include "uvfield"
fn shade(uv: vec2f) -> vec4f {
  let v = vec_sample(t0, uv, F.tile, F.filter_mode);
  var a = atan2(v.y, v.x) / 6.28318530717959 + P.offset;
  a = a - floor(a);
  if (P.unsigned_out == 0u && a > 0.5) { a = a - 1.0; }
  return vec4f(a, 0.0, 0.0, 1.0);
}
