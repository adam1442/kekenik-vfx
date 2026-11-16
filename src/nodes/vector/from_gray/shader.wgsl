// vector.from_gray — central-difference gradient in tile units (d height / d uv), isotropic scale, optional 90 deg rotation.
#include "vectorlib"
fn hgt(uv: vec2f) -> f32 {
  return tex_sample(t0, uv, F.tile, F.filter_mode).r;
}
fn shade(uv: vec2f) -> vec4f {
  let n = vec2f(textureDimensions(t0));
  let e = P.smooth_px / n;
  let gx = (hgt(uv + vec2f(e.x, 0.0)) - hgt(uv - vec2f(e.x, 0.0))) / (2.0 * e.x);
  let gy = (hgt(uv + vec2f(0.0, e.y)) - hgt(uv - vec2f(0.0, e.y))) / (2.0 * e.y);
  var g = vec2f(gx, gy) * 0.1 * P.strength;
  if (P.mode == 1u) { g = vec2f(-g.y, g.x); }
  g = vl_rot(g, P.rotation * 0.017453292519943);
  let l = length(g);
  if (P.slope_limit > 0.0 && l > P.slope_limit) { g = g * (P.slope_limit / l); }
  return vec4f(g, 0.0, 1.0);
}
