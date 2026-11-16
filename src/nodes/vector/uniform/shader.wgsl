// vector.uniform — constant direction (Vector pin, tile fractions / s). t0 = optional mask.
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  let a = P.angle * 0.017453292519943;
  var dir = vec2f(cos(a), sin(a));
  if (P.mode == 1u) {
    dir = vl_norm((P.p_b - P.p_a) * uvf_aspect(F.full_res));
  }
  var m = 1.0;
  if (P.has_mask == 1u) { m = tex_sample(t0, uv, F.tile, F.filter_mode).r; }
  return vec4f(dir * P.strength * m, 0.0, 1.0);
}
