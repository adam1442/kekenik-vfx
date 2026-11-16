// Automatic "Blending" tab pass: blends a node's own result (t0, foreground) with its Background input (t1).
#include "sampling"
#include "blend"

fn shade(uv: vec2f) -> vec4f {
  let fg = tex_sample(t0, uv, F.tile, F.filter_mode);
  let bg = tex_sample(t1, uv, F.tile, F.filter_mode);
  return blend_cross(P.blend_mode, bg, fg, P.cross_mix, P.smoothness);
}
