// Motion Vector Interpolate: one in-between frame. t0 colour sheet, t1 motion sheet (Vector, tile fractions of the cell per frame),
// t2 occlusion sheet (Gray, optional). Target = one cell (P.dst). A is warped FORWARD by f * v, B BACKWARD by (1 - f) * v
// (backward-warped sampling), blended with weight f, and cross-faded where the consistency check failed.
//  OUT 0 frame, 1 preview (R = |A - B|, G = |warpedA - warpedB|, B = occlusion)
#include "vectorlib"
fn lum(c: vec4f) -> f32 {
  return dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
}
fn cellq(q: vec2f) -> vec2f {
  return select(clamp(q, vec2f(0.0), vec2f(1.0)), fract(q), P.wrap_tile == 1u);
}
fn shade(uv: vec2f) -> vec4f {
  let u = uv * F.full_res / P.dst;
  let pa = P.rect_a.xy + u * P.rect_a.zw;
  var v = vec2f(0.0);
  var occ = 0.0;
  if (P.has_motion == 1u) { v = tex_linear(t1, pa, vec2u(0u, 0u)).xy; }
  if (P.has_occ == 1u) { occ = tex_linear(t2, pa, vec2u(0u, 0u)).x; }
  let a0 = tex_linear(t0, pa, vec2u(0u, 0u));
  let b0 = tex_linear(t0, P.rect_b.xy + u * P.rect_b.zw, vec2u(0u, 0u));
  let aw = tex_linear(t0, P.rect_a.xy + cellq(u - P.f * v) * P.rect_a.zw, vec2u(0u, 0u));
  let bw = tex_linear(t0, P.rect_b.xy + cellq(u + (1.0 - P.f) * v) * P.rect_b.zw, vec2u(0u, 0u));
#if OUT == 1
  return vec4f(abs(lum(a0) - lum(b0)) * P.gain, abs(lum(aw) - lum(bw)) * P.gain, occ, 1.0);
#else
  let warped = mix(aw, bw, P.f);
  let cross = mix(a0, b0, P.f);
  return mix(warped, cross, clamp(occ * P.fallback, 0.0, 1.0));
#endif
}
