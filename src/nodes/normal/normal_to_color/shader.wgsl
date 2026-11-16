// normal.normal_to_color — encoded Normal -> Color. format 0 encoded rgb (n * 0.5 + 0.5), 1 signed float (n, for EXR / float),
// 2 two channel (rg = encoded xy, b = 0), 3 dxt5nm (r = 1, g = y, b = 0, a = x). flip_y mirrors Y. Alpha = 1 unless dxt5nm.
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  var n = tex_sample(t0, uv, F.tile, F.filter_mode).rgb * 2.0 - vec3f(1.0);
  if (P.flip_y == 1u) {
    n.y = -n.y;
  }
  if (P.do_normalize == 1u) {
    n = normalize(n + vec3f(0.0, 0.0, 0.000001));
  }
  let e = n * 0.5 + vec3f(0.5);
  if (P.format == 1u) {
    return vec4f(n, 1.0);
  }
  if (P.format == 2u) {
    return vec4f(e.x, e.y, 0.0, 1.0);
  }
  if (P.format == 3u) {
    return vec4f(1.0, e.y, 0.0, e.x);
  }
  return vec4f(e, 1.0);
}
