// utils.vector_to_uv: delta = -v * amount (lookup semantics, CONTRACTS section 9); absolute adds the pixel's own uv.
#include "uvfield"
fn shade(uv: vec2f) -> vec4f {
  let d = -vec_sample(t0, uv, F.tile, F.filter_mode) * P.amount;
  if (P.uv_out == 1u) { return vec4f(d, 0.0, 1.0); }
  return vec4f(uv + d, 0.0, 1.0);
}
