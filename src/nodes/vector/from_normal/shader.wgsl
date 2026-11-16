// vector.from_normal — encoded normal (xyz * 0.5 + 0.5). Slope = -n.xy / n.z (downhill), clamped for grazing normals.
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  let n = tex_sample(t0, uv, F.tile, F.filter_mode).xyz * 2.0 - 1.0;
  var xy = vec2f(n.x, select(n.y, -n.y, P.flip_y == 1u));
  if (P.mode == 0u) { xy = -xy / max(n.z, 0.2); }
  xy = vl_rot(xy * P.strength, P.rotation * 0.017453292519943);
  return vec4f(xy, 0.0, 1.0);
}
