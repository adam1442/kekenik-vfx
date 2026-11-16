// _shared/morph_line.wgsl — one min/max pass of the sparse-table line morphology: res = op(t0(p + d*off0), t0(p + d*off1)).
// Build level k:  off0 = 0, off1 = 2^(k-1).   Final pass of a segment with half length a and top level K: off0 = -a, off1 = a - 2^K + 1.
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let n = vec2i(textureDimensions(t0));
  let p = vec2i(floor(uv * vec2f(n)));
  let d = vec2i(P.dx, P.dy);
  let a = tex_load(t0, p + d * P.off0, F.tile);
  let b = tex_load(t0, p + d * P.off1, F.tile);
  if (P.is_max == 1u) {
    return max(a, b);
  }
  return min(a, b);
}
