// color.ramp — gradient map: Gray (t0) -> Color through the 256-texel gradient LUT (P.glut).
// per-pixel body = fuse(); the LUT lookup takes `P` explicitly (library `lut_gradient` reads the global P).
#include "sampling"
#include "util"

// @fuse-begin
fn grad_at(P: Params, x: f32) -> vec4f {
  let f = clamp(x, 0.0, 1.0) * 255.0;
  let i = min(i32(floor(f)), 254);
  return mix(P.glut[i], P.glut[i + 1], f - f32(i));
}
fn fuse(uv: vec2f, src: vec4f, P: Params) -> vec4f {
  let v = src.r;
  var x = (v - P.in_low) / select(P.in_high - P.in_low, 0.000001, abs(P.in_high - P.in_low) < 0.000001);
  x = x * P.repeat + P.offset;
  if (P.wrap_mode == 1u) {
    x = fract(x);
  } else if (P.wrap_mode == 2u) {
    x = 1.0 - abs(1.0 - 2.0 * fract(x * 0.5));
  }
  let g = grad_at(P, x);
  return vec4f(g.rgb * P.intensity, g.a);
}
// @fuse-end

fn shade(uv: vec2f) -> vec4f {
  let src = tex_sample(t0, uv, F.tile, F.filter_mode);
  return fuse(uv, src, P);
}
