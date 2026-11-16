// _shared/kawase.wgsl — one Kawase pass: average of 4 bilinear taps at the diagonal corners (+-off) in pixels.
// Variance per pass and axis = off^2. Wrap-aware via tex_linear (F.tile).
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let o = vec2f(P.off_x, P.off_y) / F.res;
  let a = tex_linear(t0, uv + vec2f(o.x, o.y), F.tile);
  let b = tex_linear(t0, uv + vec2f(-o.x, o.y), F.tile);
  let c = tex_linear(t0, uv + vec2f(o.x, -o.y), F.tile);
  let d = tex_linear(t0, uv + vec2f(-o.x, -o.y), F.tile);
  return (a + b + c + d) * 0.25;
}
