// grayscale.curve — luminance remap through the 256-entry curve LUT (P.lut). t0 = input.
// per-pixel body = fuse(). The LUT lookup takes `P` explicitly (library `lut_curve` reads the global P, which does not exist
// inside a fused module).
#include "sampling"

// @fuse-begin
fn lut_at(P: Params, i: i32) -> f32 {
  return P.lut[i >> 2u][i & 3];
}
fn lut_eval(P: Params, x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * 255.0;
  let i = min(i32(floor(f)), 254);
  return mix(lut_at(P, i), lut_at(P, i + 1), f - f32(i));
}
fn fuse(uv: vec2f, src: vec4f, P: Params) -> vec4f {
  let v = src.r;
  let c = lut_eval(P, v);
  return vec4f(mix(v, c, P.amount), 0.0, 0.0, 1.0);
}
// @fuse-end

fn shade(uv: vec2f) -> vec4f {
  let src = tex_sample(t0, uv, F.tile, F.filter_mode);
  return fuse(uv, src, P);
}
