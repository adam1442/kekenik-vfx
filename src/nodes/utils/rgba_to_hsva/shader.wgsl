// utils.rgba_to_hsva — RGBA -> (H, S, V, A) packed in the channels.
#include "color"
fn shade(uv: vec2f) -> vec4f {
  let c = textureLoad(t0, vec2i(floor(uv * F.res)), 0);
  return vec4f(rgb_to_hsv(max(c.rgb, vec3f(0.0))), c.a);
}
