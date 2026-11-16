// utils.uv_to_color — encode a UV field into a Color texture (export-ready). codec 0 absolute (lookup coordinate),
// flow = 1 (codecs 2 and 3): store the direction CONTENT moves (engine flowmap convention) = negated lookup delta.
// 1 offset (signed delta), 2 biased (delta / range * 0.5 + 0.5), 3 direction * 0.5 + 0.5 with speed in B.
// CPU mirror: encodeUvCodec() in _shared/uvparams.ts.
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let d = uvf_sample(t0, uv, F.tile, F.filter_mode, P.uv_in);
  let flip = P.flip_y == 1u;
  let dy = select(d.y, -d.y, flip);
  if (P.codec == 0u) {
    let a = uv + d;
    return vec4f(a.x, select(a.y, 1.0 - a.y, flip), 0.0, 1.0);
  }
  if (P.codec == 1u) {
    return vec4f(d.x, dy, 0.0, 1.0);
  }
  let sg = select(1.0, -1.0, P.flow == 1u);
  if (P.codec == 2u) {
    return vec4f(sg * d.x / P.range * 0.5 + 0.5, sg * dy / P.range * 0.5 + 0.5, 0.0, 1.0);
  }
  let dd = vec2f(d.x, dy) * sg;
  let l = length(dd);
  let dir = select(vec2f(0.0), dd / l, l > 0.000000001);
  return vec4f(dir * 0.5 + 0.5, min(l / P.range, 1.0), 1.0);
}
