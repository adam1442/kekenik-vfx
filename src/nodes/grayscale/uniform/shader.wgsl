// grayscale.uniform — constant gray, optionally modulated per pixel by a Gray texture (t0).
// generator HEAD of fused chains: fuse() ignores `src`.
#include "sampling"
#include "util"

// @fuse-begin
fn fuse(uv: vec2f, src: vec4f, P: Params, x_val: texture_2d<f32>) -> vec4f {
  let m = tex_sample(x_val, uv, F.tile, F.filter_mode).r;
  return vec4f(modulate(P.value, m, P.value_mod_k), 0.0, 0.0, 1.0);
}
// @fuse-end

fn shade(uv: vec2f) -> vec4f {
  return fuse(uv, vec4f(0.0), P, t0);
}
