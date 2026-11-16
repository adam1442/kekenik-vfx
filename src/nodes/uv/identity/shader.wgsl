// uv.identity — the neutral UV field. Absolute: own uv * tiles (tiles = 1: identity). Offset: uv * (tiles - 1) (0 for tiles = 1).
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  return uvf_pack(uv * (P.tiles - vec2f(1.0)), uv, P.uv_mode);
}
