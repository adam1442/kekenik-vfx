// islands.to_grayscale — one gray value per island from the Island Map (t0). mode 0 random, 1 area of the bounding box, 2 width, 3 height,
// 4 aspect (w / (w + h)), 5 position x (box centre), 6 position y, 7 distance of the box centre to the image centre (wrap aware).
// Size modes are divided by P.size_ref (fraction of the image side / area). Value -> optional quantisation -> out range [lo, hi].
#include "sampling"
#include "island"

fn shade(uv: vec2f) -> vec4f {
  let m = tex_sample(t0, uv, F.tile, 0u);
  if (!island_valid(m)) {
    return vec4f(P.bg, 0.0, 0.0, 1.0);
  }
  var v = 0.0;
  let c = island_center(m);
  if (P.mode == 0u) {
    v = island_rand(m, P.seed);
  } else if (P.mode == 1u) {
    v = m.z * m.w / max(P.size_ref * P.size_ref, 0.000001);
  } else if (P.mode == 2u) {
    v = m.z / max(P.size_ref, 0.000001);
  } else if (P.mode == 3u) {
    v = m.w / max(P.size_ref, 0.000001);
  } else if (P.mode == 4u) {
    v = (m.z * F.res.x) / max(m.z * F.res.x + m.w * F.res.y, 0.000001);
  } else if (P.mode == 5u) {
    v = c.x - floor(c.x);
  } else if (P.mode == 6u) {
    v = c.y - floor(c.y);
  } else {
    var d = (c - vec2f(0.5)) * F.full_res / min(F.full_res.x, F.full_res.y);
    v = length(d) / 0.70710678;
  }
  v = clamp(v, 0.0, 1.0);
  if (P.steps > 1) {
    v = floor(v * f32(P.steps) - 0.0001) / f32(P.steps - 1);
    v = clamp(v, 0.0, 1.0);
  }
  return vec4f(mix(P.out_range.x, P.out_range.y, v), 0.0, 0.0, 1.0);
}
