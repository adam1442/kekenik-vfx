// utils.glow stage 3: composite. t0 = source, t1..t6 = blurred pyramid levels 1..6 (half resolution and smaller).
// glow = sum(w_i * bicubic(level_i)); output = src + glow * tint * intensity (add) / glow only / screen.
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let c = tex_load(t0, vec2i(floor(uv * F.res)), F.tile);
  var g = tex_cubic(t1, uv, F.tile) * P.w_a.x;
  g = g + tex_cubic(t2, uv, F.tile) * P.w_a.y;
  g = g + tex_cubic(t3, uv, F.tile) * P.w_a.z;
  g = g + tex_cubic(t4, uv, F.tile) * P.w_a.w;
  g = g + tex_cubic(t5, uv, F.tile) * P.w_b.x;
  g = g + tex_cubic(t6, uv, F.tile) * P.w_b.y;
#if COLOR == 1
  g = vec4f(g.rgb * P.tint, g.a) * P.intensity;
#else
  g = g * P.intensity;
#endif
  if (P.mode == 1u) {
    return g;
  }
  if (P.mode == 2u) {
    return vec4f(1.0) - (vec4f(1.0) - clamp(c, vec4f(0.0), vec4f(1.0))) * (vec4f(1.0) - clamp(g, vec4f(0.0), vec4f(1.0)));
  }
  return c + g;
}
