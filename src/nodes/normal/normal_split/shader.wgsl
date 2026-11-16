// normal.normal_split — encoded Normal -> one Gray channel. ch 0 X, 1 Y, 2 Z. format 0 encoded (n * 0.5 + 0.5),
// 1 magnitude of the signed component (abs), 2 signed clamped to 0..1 (positive part only). flip_y mirrors Y.
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  var n = tex_sample(t0, uv, F.tile, F.filter_mode).rgb * 2.0 - vec3f(1.0);
  if (P.do_normalize == 1u) {
    n = normalize(n + vec3f(0.0, 0.0, 0.000001));
  }
  if (P.flip_y == 1u) {
    n.y = -n.y;
  }
  var v = n.x;
  if (P.ch == 1u) {
    v = n.y;
  } else if (P.ch == 2u) {
    v = n.z;
  }
  var r = v * 0.5 + 0.5;
  if (P.format == 1u) {
    r = abs(v);
  } else if (P.format == 2u) {
    r = max(v, 0.0);
  }
  return vec4f(r, 0.0, 0.0, 1.0);
}
