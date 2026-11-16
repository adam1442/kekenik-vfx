// export.motion_vector — Vector -> encoded RG (0.5 neutral, or signed), same maths as vector.motion_encode (OUT 0).
#include "uvfield"
fn shade(uv: vec2f) -> vec4f {
  let v = vec_sample(t0, uv, F.tile, F.filter_mode);
  let s = max(P.scale, 1e-6);
  var e = vec2f(v.x, select(v.y, -v.y, P.flip == 1u)) / s;
  if (P.signed_out == 0u) { e = clamp(e * 0.5 + 0.5, vec2f(0.0), vec2f(1.0)); }
  return vec4f(e, 0.0, 1.0);
}
