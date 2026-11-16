// utils.vector_visualize: mode 0 wheel, 1 signed, 2 biased. CPU mirror: wheelColor() in _shared/vectormath.ts
#include "color"
#include "uvfield"
const TAU_V: f32 = 6.28318530717959;
fn shade(uv: vec2f) -> vec4f {
  let v = vec_sample(t0, uv, F.tile, F.filter_mode);
  let s = max(P.scale, 1e-6);
  if (P.mode == 1u) { return vec4f(v.x / s, v.y / s, 0.0, 1.0); }
  if (P.mode == 2u) { return vec4f(v.x / s * 0.5 + 0.5, v.y / s * 0.5 + 0.5, 0.0, 1.0); }
  let mag = length(v);
  let hue = fract(atan2(v.y, v.x) / TAU_V);
  return vec4f(hsv_to_rgb(vec3f(hue, select(0.0, 1.0, mag > 1e-9), clamp(mag / s, 0.0, 1.0))), 1.0);
}
