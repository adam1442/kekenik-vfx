// utils.uv_merge — two Gray textures -> UV field. t0 = U, t1 = V (missing = identity / zero). source: 0 absolute
// (gray = lookup coordinate), 1 offset (gray = signed delta), 2 biased (gray 0.5 = neutral, +-range at 0 / 1).
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let gu = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  let gv = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  var d = vec2f(0.0);
  if (P.source == 0u) {
    let a = vec2f(select(uv.x, gu, P.has_u == 1u), select(uv.y, gv, P.has_v == 1u));
    d = a - uv;
  } else if (P.source == 1u) {
    d = vec2f(select(0.0, gu, P.has_u == 1u), select(0.0, gv, P.has_v == 1u));
  } else {
    d = vec2f(select(0.0, (gu * 2.0 - 1.0) * P.range, P.has_u == 1u), select(0.0, (gv * 2.0 - 1.0) * P.range, P.has_v == 1u));
  }
  if (P.flip_y == 1u) {
    d.y = -d.y;
  }
  return uvf_pack(d, uv, P.uv_mode);
}
