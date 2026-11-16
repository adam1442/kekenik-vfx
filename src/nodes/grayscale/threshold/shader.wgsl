// grayscale.threshold — hard / soft threshold. t0 = input, t1 = threshold modulation.
// per-pixel body = fuse() (see color/adjust/shader.wgsl for the convention).
#include "sampling"
#include "util"

// @fuse-begin
fn fuse(uv: vec2f, src: vec4f, P: Params, x_thr: texture_2d<f32>) -> vec4f {
  let v = src.r;
  var thr = P.threshold;
  if (P.threshold_mod_k != 0.0) {
    thr = modulate(thr, tex_sample(x_thr, uv, F.tile, F.filter_mode).r, P.threshold_mod_k);
  }
  var r = 0.0;
  if (P.soft == 1u && P.smoothness > 0.00001) {
    r = smoothstep(thr - P.smoothness, thr + P.smoothness, v);
  } else {
    r = select(0.0, 1.0, v >= thr);
  }
  if (P.invert == 1u) {
    r = 1.0 - r;
  }
  return vec4f(mix(P.low, P.high, r), 0.0, 0.0, 1.0);
}
// @fuse-end

fn shade(uv: vec2f) -> vec4f {
  let src = tex_sample(t0, uv, F.tile, F.filter_mode);
  return fuse(uv, src, P, t1);
}
