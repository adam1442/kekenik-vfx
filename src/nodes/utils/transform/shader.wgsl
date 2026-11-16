// utils.transform — inverse-mapped affine transform. t0 = source, t1 = optional UV field (absolute lookup coordinates:
// when connected the transform is applied to the field's coordinates instead of the pixel position).
// The linear part is computed on the CPU (P.minv = row-major inverse of R * Skew * Scale in ASPECT-corrected space, so
// rotation never shears non-square images). Edge modes: 0 follow Tiling, 1 wrap, 2 clamp, 3 mirror, 4 transparent black.
#include "sampling"

fn mirror01(x: f32) -> f32 {
  return 1.0 - abs(1.0 - 2.0 * fract(x * 0.5));
}

fn shade(uv: vec2f) -> vec4f {
  var u = uv;
  if (P.has_uv == 1u) {
    u = tex_sample(t1, uv, F.tile, F.filter_mode).rg;
  }
  let asp = vec2f(F.res.x / F.res.y, 1.0);
  let q = (u - P.pivot - P.translate) * asp;
  let r = vec2f(P.minv.x * q.x + P.minv.y * q.y, P.minv.z * q.x + P.minv.w * q.y);
  var s = r / asp + P.pivot;
  var tile = F.tile;
  var inside = true;
  if (P.edge == 1u) {
    tile = vec2u(1u, 1u);
  } else if (P.edge == 2u) {
    tile = vec2u(0u, 0u);
  } else if (P.edge == 3u) {
    s = vec2f(mirror01(s.x), mirror01(s.y));
    tile = vec2u(0u, 0u);
  } else if (P.edge == 4u) {
    inside = s.x >= 0.0 && s.x <= 1.0 && s.y >= 0.0 && s.y <= 1.0;
    tile = vec2u(0u, 0u);
  }
  var c = tex_sample(t0, s, tile, F.filter_mode);
  if (!inside) {
    c = vec4f(0.0);
  }
  return c;
}
