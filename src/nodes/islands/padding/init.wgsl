// islands.padding — JFA seed pass: pixels that belong to an island (Island Map with non-zero size) store their own packed
// coordinate (xhi, xlo, yhi, ylo; x = xhi * 1024 + xlo), others -1. The jump-flood STEP shader of utils.distance does the rest.
#include "island"

fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  let m = textureLoad(t0, p, 0);
  if (!island_valid(m)) {
    return vec4f(-1.0);
  }
  return vec4f(f32(p.x / 1024), f32(p.x % 1024), f32(p.y / 1024), f32(p.y % 1024));
}
