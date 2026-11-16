// _shared/up.wgsl — bicubic (Catmull-Rom) upsample of t0 to the target size, wrap-aware (F.tile).
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  return tex_cubic(t0, uv, F.tile);
}
