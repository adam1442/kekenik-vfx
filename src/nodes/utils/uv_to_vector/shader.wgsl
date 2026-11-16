// utils.uv_to_vector: inverse of utils.vector_to_uv.
#include "uvfield"
fn shade(uv: vec2f) -> vec4f {
  let d = uvf_sample(t0, uv, F.tile, F.filter_mode, P.uv_in);
  return vec4f(-d / max(P.amount, 1e-6), 0.0, 1.0);
}
