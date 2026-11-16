// vector.transform — domain (offset / repeat / warp by t1) then vector math (swap, mirror, scale, rotate, length remap).
#include "vectorlib"
#include "lut_curve"
fn shade(uv: vec2f) -> vec4f {
  var p = uv * P.repeat + P.offset;
  if (P.has_warp == 1u) { p = p + vec_sample(t1, uv, F.tile, F.filter_mode) * P.warp_amount; }
  var v = vec_sample(t0, p, F.tile, F.filter_mode);
  if (P.swap == 1u) { v = v.yx; }
  if (P.mirror_x == 1u) { v.x = -v.x; }
  if (P.mirror_y == 1u) { v.y = -v.y; }
  v = vl_rot(v * P.scale, P.rotate * 0.017453292519943);
  if (P.remap_on == 1u) {
    let l = length(v);
    v = vl_norm(v) * (curve_lut(l / max(P.remap_max, 1e-6)) * P.remap_max);
  }
  return vec4f(v, 0.0, 1.0);
}
