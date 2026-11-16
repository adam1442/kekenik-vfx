// utils.color_to_uv — decode a Color texture into a UV field. codec: 0 absolute (rg = lookup coordinate), 1 offset
// (rg = signed delta), 2 biased (rg = delta / range * 0.5 + 0.5), 3 direction (rg = direction * 0.5 + 0.5, b = speed).
// flow = 1: the vector is the direction CONTENT moves (engine flowmap convention) so the lookup delta is its negative
// (codecs 2 and 3 only). flip_y mirrors the vertical component (Unity / OpenGL style flowmaps). Result stored with P.uv_mode.
// CPU mirror: decodeUvCodec() in _shared/uvparams.ts.
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let c = tex_sample(t0, uv, F.tile, F.filter_mode);
  let flip = P.flip_y == 1u;
  var d = vec2f(0.0);
  if (P.codec == 0u) {
    d = vec2f(c.x, select(c.y, 1.0 - c.y, flip)) - uv;
  } else if (P.codec == 1u) {
    d = vec2f(c.x, select(c.y, -c.y, flip));
  } else if (P.codec == 2u) {
    let s = (c.xy * 2.0 - 1.0) * P.range;
    d = vec2f(s.x, select(s.y, -s.y, flip)) * select(1.0, -1.0, P.flow == 1u);
  } else {
    let dir = c.xy * 2.0 - 1.0;
    let l = length(dir);
    let k = select(0.0, c.z * P.range / l, l > 0.000001);
    d = vec2f(dir.x, select(dir.y, -dir.y, flip)) * k * select(1.0, -1.0, P.flow == 1u);
  }
  return uvf_pack(d, uv, P.uv_mode);
}
