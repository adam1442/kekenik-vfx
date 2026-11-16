// vector.motion_blur — t0 image, t1 vector
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  let v = vec_sample(t1, uv, F.tile, F.filter_mode) * P.length;
  let n = max(P.samples, 2);
  let px = vec2u(floor(uv * F.full_res));
  let jit = u01(hash_u(px.x, px.y, 3u, P.seed)) - 0.5;
  var acc = vec4f(0.0);
  for (var i = 0; i < 64; i = i + 1) {
    if (i >= n) { break; }
    let s = (f32(i) + 0.5 + jit * P.jitter) / f32(n) - P.shutter;
    acc = acc + tex_sample(t0, uv + v * s, F.tile, F.filter_mode);
  }
  return acc / f32(n);
}
