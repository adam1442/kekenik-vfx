// utils.uv_split — UV field -> one Gray channel. ch 0 = U, 1 = V. output: 0 absolute (coordinate), 1 offset (signed
// delta), 2 biased (0.5 + delta / (2 range)).
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let d = uvf_sample(t0, uv, F.tile, F.filter_mode, P.uv_in);
  var dd = d;
  if (P.flip_y == 1u) {
    dd.y = -dd.y;
  }
  var r = 0.0;
  let c = select(0u, 1u, P.ch == 1u);
  let comp = select(dd.x, dd.y, c == 1u);
  if (P.output_kind == 0u) {
    let a = select(uv.x, select(uv.y, 1.0 - uv.y, P.flip_y == 1u), c == 1u) + comp;
    r = a;
  } else if (P.output_kind == 1u) {
    r = comp;
  } else {
    r = comp / P.range * 0.5 + 0.5;
  }
  return vec4f(r, 0.0, 0.0, 1.0);
}
