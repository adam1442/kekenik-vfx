// _shared/blur.wgsl — one separable blur pass over t0 (gray / color / uv; every lane is blurred).
// Direction (dir_x, dir_y) in pixels, taps i = -radius..radius at i * stride, box (kind 0) or gaussian (kind 1).
// Wrap-aware through sampling.wgsl (F.tile), edges replicate when the axis does not tile.
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let n = vec2i(textureDimensions(t0));
  let p = vec2i(floor(uv * vec2f(n)));
  let d = vec2i(P.dir_x, P.dir_y) * P.stride;
  let sg = max(P.sigma, 0.0001);
  let inv2s2 = 1.0 / (2.0 * sg * sg);
  var acc = vec4f(0.0);
  var wsum = 0.0;
  for (var i = -P.radius; i <= P.radius; i = i + 1) {
    var w = 1.0;
    if (P.kind == 1u) {
      w = exp(-f32(i * i) * inv2s2);
    }
    acc = acc + tex_load(t0, p + d * i, F.tile) * w;
    wsum = wsum + w;
  }
  return acc / wsum;
}
