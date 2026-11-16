// normal.normal_merge — X, Y (and optional Z) Gray textures -> encoded Normal. Gray 0..1 decodes to -1..1 (0.5 = 0) and is
// scaled by P.range; missing X / Y = 0. mode 0: Z reconstructed = sqrt(1 - x^2 - y^2); mode 1: Z from the third input
// (missing = 1) then normalised. flip_y mirrors Y. CPU mirror: mergeNormalXY().
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let gx = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  let gy = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  var xy = vec2f(select(0.0, gx * 2.0 - 1.0, P.has_x == 1u), select(0.0, gy * 2.0 - 1.0, P.has_y == 1u)) * P.range;
  if (P.flip_y == 1u) {
    xy.y = -xy.y;
  }
  var n = vec3f(0.0, 0.0, 1.0);
  if (P.mode == 0u) {
    let l2 = dot(xy, xy);
    let s = select(1.0, inverseSqrt(l2), l2 > 1.0);
    let xyc = xy * s;
    n = vec3f(xyc, sqrt(max(1.0 - dot(xyc, xyc), 0.0)));
  } else {
    let z = select(1.0, tex_sample(t2, uv, F.tile, F.filter_mode).r * 2.0 - 1.0, P.has_z == 1u);
    n = normalize(vec3f(xy, max(z, 0.000001)));
  }
  return vec4f(n * 0.5 + vec3f(0.5), 1.0);
}
