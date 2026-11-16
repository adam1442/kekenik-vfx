// normal.color_to_normal — Color -> encoded Normal. source 0 rgb (as stored), 1 rg (z reconstructed), 2 dxt5nm (x = A, y = G,
// z reconstructed). flip_x / flip_y mirror components; normalize renormalises (rgb source). Output = n * 0.5 + 0.5.
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let c = tex_sample(t0, uv, F.tile, F.filter_mode);
  var n = vec3f(0.0, 0.0, 1.0);
  if (P.source == 0u) {
    n = c.rgb * 2.0 - vec3f(1.0);
  } else {
    var xy = c.rg * 2.0 - vec2f(1.0);
    if (P.source == 2u) {
      xy = vec2f(c.a, c.g) * 2.0 - vec2f(1.0);
    }
    n = vec3f(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
  }
  if (P.flip_x == 1u) {
    n.x = -n.x;
  }
  if (P.flip_y == 1u) {
    n.y = -n.y;
  }
  if (P.do_normalize == 1u || P.source != 0u) {
    n = normalize(n + vec3f(0.0, 0.0, 0.000001));
  }
  return vec4f(n * 0.5 + vec3f(0.5), 1.0);
}
