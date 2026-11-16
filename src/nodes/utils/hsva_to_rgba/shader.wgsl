// utils.hsva_to_rgba — channels (H, S, V, A) of t0 -> RGBA. H wraps (1.0 == 0.0).
#include "color"
fn shade(uv: vec2f) -> vec4f {
  let c = textureLoad(t0, vec2i(floor(uv * F.res)), 0);
  let h = c.r - floor(c.r);
  return vec4f(hsv_to_rgb(vec3f(h, clamp(c.g, 0.0, 1.0), max(c.b, 0.0))), c.a);
}
