// vector.project — MODE 0: divergence of t0 (cells / s); MODE 1: Jacobi sweep t0 = p, t1 = div (iterations == 0: p = -div / 4);
// MODE 2: subtract the pressure gradient (t1) from the field t0. Wraps with F.tile (periodic), clamps otherwise.
#include "vectorlib"
fn ld(t: texture_2d<f32>, uv: vec2f) -> vec4f {
  return tex_point(t, uv, F.tile);
}
fn shade(uv: vec2f) -> vec4f {
  let n = vec2f(textureDimensions(t0));
  let px = 1.0 / n;
#if MODE == 0
  let r = ld(t0, uv + vec2f(px.x, 0.0)).x;
  let l = ld(t0, uv - vec2f(px.x, 0.0)).x;
  let d = ld(t0, uv + vec2f(0.0, px.y)).y;
  let u = ld(t0, uv - vec2f(0.0, px.y)).y;
  return vec4f(0.5 * ((r - l) * n.x + (d - u) * n.y) / max(n.x, n.y), 0.0, 0.0, 1.0);
#elif MODE == 1
  let pr = ld(t0, uv + vec2f(px.x, 0.0)).x;
  let pl = ld(t0, uv - vec2f(px.x, 0.0)).x;
  let pd = ld(t0, uv + vec2f(0.0, px.y)).x;
  let pu = ld(t0, uv - vec2f(0.0, px.y)).x;
  let dv = ld(t1, uv).x;
  var s = pr + pl + pd + pu;
  if (P.iterations == 0) { s = 0.0; }
  return vec4f((s - dv) * 0.25, 0.0, 0.0, 1.0);
#else
  let v = ld(t0, uv).xy;
  let gx = (ld(t1, uv + vec2f(px.x, 0.0)).x - ld(t1, uv - vec2f(px.x, 0.0)).x) * 0.5;
  let gy = (ld(t1, uv + vec2f(0.0, px.y)).x - ld(t1, uv - vec2f(0.0, px.y)).x) * 0.5;
  let sc = max(n.x, n.y);
  let proj = v - vec2f(gx, gy) * sc / n;
  return vec4f(mix(v, proj, P.amount), 0.0, 1.0);
#endif
}
