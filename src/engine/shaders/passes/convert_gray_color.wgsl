// Implicit Gray -> Color conversion (r,r,r,1). t0 = gray source.
#include "sampling"
#include "color"

fn shade(uv: vec2f) -> vec4f {
  return gray_to_color(tex_point(t0, uv, F.tile).r);
}
