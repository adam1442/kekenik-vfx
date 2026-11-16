// color.uniform — constant (HDR) colour. t0 = intensity modulation.
// generator HEAD of fused chains: fuse() ignores `src`.
#include "sampling"
#include "util"

// @fuse-begin
fn fuse(uv: vec2f, src: vec4f, P: Params, x_int: texture_2d<f32>) -> vec4f {
  var s = P.intensity;
  if (P.intensity_mod_k != 0.0) {
    s = modulate(s, tex_sample(x_int, uv, F.tile, F.filter_mode).r, P.intensity_mod_k);
  }
  return vec4f(P.color.rgb * s, P.color.a);
}
// @fuse-end

fn shade(uv: vec2f) -> vec4f {
  return fuse(uv, vec4f(0.0), P, t0);
}
