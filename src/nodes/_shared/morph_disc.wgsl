// _shared/morph_disc.wgsl — exact small-radius disc min/max (direct loop, used for radius <= 6 px). Wrap-aware.
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let n = vec2i(textureDimensions(t0));
  let p = vec2i(floor(uv * vec2f(n)));
  var acc = tex_load(t0, p, F.tile);
  for (var dy = -P.radius; dy <= P.radius; dy = dy + 1) {
    for (var dx = -P.radius; dx <= P.radius; dx = dx + 1) {
      if (f32(dx * dx + dy * dy) <= P.r2) {
        let v = tex_load(t0, p + vec2i(dx, dy), F.tile);
        if (P.is_max == 1u) {
          acc = max(acc, v);
        } else {
          acc = min(acc, v);
        }
      }
    }
  }
  return acc;
}
